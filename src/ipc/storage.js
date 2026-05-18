// ── IPC: Secure key store + Scheduled Backups ─────────────────────────────────
// Handles safeStorage (OS keychain) and scheduled backup read/write/trigger.
//
// Exports register(ipcMain) + helpers used by index.js (migration, backup trigger)

const { app, ipcMain, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");

// ── Secure key/value store ────────────────────────────────────────────────────
// Falls back to plain base64 when OS encryption is unavailable (rare Linux).

let _secureStoreFile = null;
const secureStoreFile = () =>
  _secureStoreFile ||
  (_secureStoreFile = path.join(app.getPath("userData"), "secure-store.json"));

let _secureStoreCache = null;

function readSecureStore() {
  if (_secureStoreCache) return _secureStoreCache;
  try {
    _secureStoreCache = JSON.parse(fs.readFileSync(secureStoreFile(), "utf8"));
  } catch {
    _secureStoreCache = {};
  }
  return _secureStoreCache;
}

function writeSecureStore(data) {
  _secureStoreCache = data;
  fs.writeFileSync(secureStoreFile(), JSON.stringify(data));
}

function secureStoreGet(key) {
  const store = readSecureStore();
  const raw = store[key];
  if (!raw) return null;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(raw, "base64"));
    }
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function secureStoreSet(key, value) {
  const store = readSecureStore();
  if (value === null || value === undefined || value === "") {
    delete store[key];
  } else {
    if (safeStorage.isEncryptionAvailable()) {
      store[key] = safeStorage.encryptString(value).toString("base64");
    } else {
      store[key] = Buffer.from(value, "utf8").toString("base64");
    }
  }
  writeSecureStore(store);
}

// ── Secret migration (AppImage update key re-encryption) ──────────────────────
// When the AppImage binary is replaced, safeStorage can no longer decrypt the
// old ciphertext. We write a short-lived plaintext file before exit and
// re-encrypt it on the next startup.

const migrationFile = () =>
  path.join(app.getPath("userData"), ".secret-migration.json");

function writeSecretMigration() {
  try {
    const store = readSecureStore();
    const plain = {};
    for (const [k, raw] of Object.entries(store)) {
      if (!raw) continue;
      try {
        if (safeStorage.isEncryptionAvailable()) {
          plain[k] = safeStorage.decryptString(Buffer.from(raw, "base64"));
        } else {
          plain[k] = Buffer.from(raw, "base64").toString("utf8");
        }
      } catch {
        /* skip unreadable keys */
      }
    }
    if (Object.keys(plain).length > 0) {
      fs.writeFileSync(migrationFile(), JSON.stringify(plain), { mode: 0o600 });
    }
  } catch {
    /* best-effort */
  }
}

function applySecretMigrationIfNeeded() {
  const mf = migrationFile();
  if (!fs.existsSync(mf)) return;
  let plain = null;
  try {
    const raw = fs.readFileSync(mf, "utf8");
    // Delete IMMEDIATELY after reading
    try {
      fs.unlinkSync(mf);
    } catch {
      try {
        fs.writeFileSync(mf, "{}", { mode: 0o600 });
      } catch {}
    }
    plain = JSON.parse(raw);
  } catch {
    return;
  }
  if (!plain) return;
  for (const [k, v] of Object.entries(plain)) {
    try {
      if (v) secureStoreSet(k, v);
    } catch {}
  }
}

// Safety-net: nuke migration file on quit if it somehow survived
app.on("quit", () => {
  try {
    fs.unlinkSync(migrationFile());
  } catch {}
});

// ── Scheduled backup store ────────────────────────────────────────────────────

const scheduledBackupSettingsFile = () =>
  path.join(app.getPath("userData"), "scheduled-backup-settings.json");

function loadScheduledBackupSettings() {
  try {
    const raw = fs.readFileSync(scheduledBackupSettingsFile(), "utf8");
    return JSON.parse(raw);
  } catch {
    return {
      enabled: false,
      path: "",
      keepCount: 5,
      frequency: "startup",
      lastRun: null,
    };
  }
}

function saveScheduledBackupSettings(settings) {
  fs.writeFileSync(
    scheduledBackupSettingsFile(),
    JSON.stringify(settings, null, 2),
    "utf8",
  );
}

function shouldRunScheduledBackup(settings) {
  if (!settings.enabled || !settings.path) return false;
  if (settings.frequency === "startup") return true;
  if (!settings.lastRun) return true;
  const diff = Date.now() - new Date(settings.lastRun).getTime();
  if (settings.frequency === "daily") return diff >= 86_400_000;
  if (settings.frequency === "weekly") return diff >= 604_800_000;
  if (settings.frequency === "monthly") return diff >= 2_592_000_000;
  return false;
}

// ── IPC registration ──────────────────────────────────────────────────────────

function register() {
  ipcMain.handle("get-app-version", () => app.getVersion());

  ipcMain.handle("secure-store-get", (_, key) => {
    try {
      return { ok: true, value: secureStoreGet(key) };
    } catch {
      return { ok: false, value: null };
    }
  });

  ipcMain.handle("secure-store-set", (_, { key, value }) => {
    try {
      secureStoreSet(key, value);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("get-scheduled-backup-settings", () =>
    loadScheduledBackupSettings(),
  );

  ipcMain.handle("set-scheduled-backup-settings", (_, settings) => {
    try {
      saveScheduledBackupSettings(settings);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("perform-scheduled-backup", (_, { data, settings }) => {
    try {
      const backupDir = settings.path;
      if (!backupDir) return { ok: false, error: "No backup path set" };

      const resolvedBackupDir = path.resolve(backupDir);
      fs.mkdirSync(resolvedBackupDir, { recursive: true });

      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      const filename = `streambert-backup-${timestamp}.json`;
      const fullPath = path.join(resolvedBackupDir, filename);
      if (!fullPath.startsWith(resolvedBackupDir + path.sep))
        return { ok: false, error: "Invalid backup path" };
      fs.writeFileSync(
        fullPath,
        JSON.stringify(
          {
            version: 1,
            exportedAt: new Date().toISOString(),
            scheduledBackup: true,
            data,
          },
          null,
          2,
        ),
        "utf8",
      );

      // Prune old backups
      const keepCount = Math.max(1, Number(settings.keepCount) || 5);
      fs.readdirSync(resolvedBackupDir)
        .filter(
          (f) => f.startsWith("streambert-backup-") && f.endsWith(".json"),
        )
        .map((f) => ({
          name: f,
          mtime: fs.statSync(path.join(resolvedBackupDir, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(keepCount)
        .forEach(({ name }) => {
          try {
            fs.unlinkSync(path.join(resolvedBackupDir, name));
          } catch {}
        });

      saveScheduledBackupSettings({
        ...settings,
        lastRun: new Date().toISOString(),
      });
      return { ok: true, path: fullPath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = {
  register,
  applySecretMigrationIfNeeded,
  writeSecretMigration,
  loadScheduledBackupSettings,
  shouldRunScheduledBackup,
};
