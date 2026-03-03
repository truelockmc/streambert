import { useState, useEffect, useRef } from "react";
import { storage, STORAGE_KEYS } from "../utils/storage";
import { SUBTITLE_LANGUAGES } from "../utils/subtitles";
import { DEFAULT_INVIDIOUS_BASE } from "../components/TrailerModal";
import { RATING_COUNTRIES } from "../utils/ageRating";
import { WarningIcon } from "../components/Icons";

// Dynamically fetched from Electron (package.json → app.getVersion())
// Falls back to a placeholder until the async call resolves.
export let APP_VERSION = "0.0.0";
if (window.electron?.getAppVersion) {
  window.electron.getAppVersion().then((v) => {
    APP_VERSION = v;
  });
}
const GITHUB_REPO = "truelockmc/streambert";

// Normalise "1.3" → "1.3.0" so "1.3.0" === "1.3" after normalisation
function normaliseVersion(v) {
  const parts = String(v).replace(/^v/i, "").split(".");
  while (parts.length < 3) parts.push("0");
  return parts.slice(0, 3).map(Number).join(".");
}

export async function checkForUpdates() {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
    {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
  const data = await res.json();
  const latestRaw = (data.tag_name || "").replace(/^v/i, "");
  const latest = normaliseVersion(latestRaw);
  const current = normaliseVersion(APP_VERSION);
  const url =
    data.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`;
  return {
    latest: latestRaw || APP_VERSION,
    current: APP_VERSION,
    url,
    hasUpdate: latest !== current && latestRaw !== "",
  };
}

// ── Home row config ───────────────────────────────────────────────────────────
export const HOME_ROWS = [
  { id: "continue", label: "Continue Watching" },
  { id: "similar", label: "Similar to…" },
  { id: "trendingMovies", label: "Trending Movies" },
  { id: "trendingTV", label: "Trending Series" },
  { id: "topRated", label: "Top Rated" },
];

const DEFAULT_ROW_ORDER = HOME_ROWS.map((r) => r.id);
const DEFAULT_ROW_VISIBLE = Object.fromEntries(
  HOME_ROWS.map((r) => [r.id, true]),
);

export function loadHomeLayout() {
  const savedOrder = storage.get("homeRowOrder");
  const savedVisible = storage.get("homeRowVisible");

  // Merge saved order: keep existing order, append any new rows at the end
  const knownIds = new Set(HOME_ROWS.map((r) => r.id));
  const baseOrder = savedOrder
    ? [
        ...savedOrder.filter((id) => knownIds.has(id)), // keep valid saved entries
        ...DEFAULT_ROW_ORDER.filter((id) => !savedOrder.includes(id)), // append new ones
      ]
    : DEFAULT_ROW_ORDER;

  // Merge saved visible: keep saved values, default new keys to true
  const baseVisible = savedVisible
    ? {
        ...DEFAULT_ROW_VISIBLE, // new keys default to true
        ...savedVisible, // saved values take precedence
      }
    : DEFAULT_ROW_VISIBLE;

  return { order: baseOrder, visible: baseVisible };
}

function saveHomeLayout(order, visible) {
  storage.set("homeRowOrder", order);
  storage.set("homeRowVisible", visible);
}

// ── Start page config ─────────────────────────────────────────────────────────
const START_PAGE_OPTIONS = [
  { value: "home", label: "🏠  Home" },
  { value: "history", label: "🕐  Library / History" },
  { value: "downloads", label: "⬇  Downloads" },
];

export function loadStartPage() {
  return storage.get("startPage") || "home";
}

// Age limit options: null = none, or specific ages
const AGE_LIMIT_OPTIONS = [
  { value: "", label: "No restriction" },
  { value: "0", label: "0 — All audiences (G / FSK 0)" },
  { value: "7", label: "7 — Family friendly (PG / FSK 6)" },
  { value: "12", label: "12 — Teens and up" },
  { value: "13", label: "13 — PG-13 and equivalent" },
  { value: "15", label: "15 — Older teens" },
  { value: "16", label: "16 — FSK 16 and equivalent" },
  { value: "17", label: "17 — R / 17+ and equivalent" },
  { value: "18", label: "18 — Adults only (NC-17 / FSK 18)" },
];

// ── Confirmation Dialog ───────────────────────────────────────────────────────
function ResetConfirmDialog({ onConfirm, onCancel }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "36px 40px",
          maxWidth: 460,
          width: "90%",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
      >
        {/* Warning icon */}
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "rgba(229,9,20,0.12)",
            border: "1px solid rgba(229,9,20,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
          }}
        >
          <WarningIcon size={24} />
        </div>

        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 26,
            letterSpacing: 1,
            marginBottom: 10,
          }}
        >
          RESET STREAMBERT?
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--text2)",
            lineHeight: 1.7,
            marginBottom: 28,
          }}
        >
          This will permanently delete all your settings, watch history, saved
          titles, progress data, and cached data. Your downloaded video files
          will{" "}
          <span style={{ color: "var(--text)", fontWeight: 600 }}>not</span> be
          deleted.
          <br />
          <br />
          <span style={{ color: "var(--red)" }}>
            This action cannot be undone.
          </span>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <button
            className="btn btn-ghost"
            style={{ flex: 1 }}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="btn"
            style={{
              flex: 1,
              background: "var(--red)",
              color: "#fff",
              border: "none",
              fontWeight: 600,
            }}
            onClick={onConfirm}
          >
            Yes, Reset Everything
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Status Badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  if (!status) return null;
  const isError = status.startsWith("✕");
  return (
    <div
      style={{
        marginTop: 10,
        fontSize: 13,
        fontWeight: 500,
        color: isError ? "var(--red)" : "#48c774",
      }}
    >
      {status}
    </div>
  );
}

// ── Clean Row ─────────────────────────────────────────────────────────────────
function CleanRow({
  title,
  description,
  buttonLabel,
  onAction,
  danger,
  sizeLabel,
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [hovered, setHovered] = useState(false);

  const handle = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await onAction();
      setStatus(result?.msg || "✓ Done");
    } catch (e) {
      setStatus("✕ " + (e.message || "Something went wrong"));
    } finally {
      setBusy(false);
      setTimeout(() => setStatus(null), 4000);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 24,
      }}
    >
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "var(--text)",
            marginBottom: 4,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {title}
          {sizeLabel && (
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text2)",
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "3px 10px",
                letterSpacing: 0.2,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {sizeLabel}
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: "var(--text3)", lineHeight: 1.6 }}>
          {description}
        </div>
        <StatusBadge status={status} />
      </div>
      <div style={{ flexShrink: 0, paddingTop: 2 }}>
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={handle}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={
            danger
              ? {
                  color: hovered ? "#fff" : "var(--red)",
                  background: hovered ? "rgba(229,9,20,0.85)" : "transparent",
                  borderColor: hovered ? "transparent" : "rgba(229,9,20,0.35)",
                  opacity: busy ? 0.5 : 1,
                  transition: "all 0.2s",
                }
              : { opacity: busy ? 0.5 : 1 }
          }
        >
          {busy ? "Working…" : buttonLabel}
        </button>
      </div>
    </div>
  );
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "…";
  if (bytes === -1) return null; // unavailable, show nothing
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024)
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

// ── Version & Update Section ──────────────────────────────────────────────────
function VersionSection() {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null); // { latest, current, url, hasUpdate } | { error }
  const [autoCheck, setAutoCheck] = useState(
    () => !!storage.get("autoCheckUpdates"),
  );
  const [autoSaved, setAutoSaved] = useState(false);
  const [currentVersion, setCurrentVersion] = useState(APP_VERSION);

  useEffect(() => {
    if (window.electron?.getAppVersion) {
      window.electron.getAppVersion().then((v) => {
        APP_VERSION = v;
        setCurrentVersion(v);
      });
    }
  }, []);

  const runCheck = async () => {
    setChecking(true);
    setResult(null);
    try {
      const r = await checkForUpdates();
      setResult(r);
    } catch (e) {
      setResult({ error: e.message || "Could not reach GitHub." });
    } finally {
      setChecking(false);
    }
  };

  const toggleAuto = (val) => {
    setAutoCheck(val);
    storage.set("autoCheckUpdates", val ? 1 : 0);
    setAutoSaved(true);
    setTimeout(() => setAutoSaved(false), 1800);
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">App Version</div>

      {/* Version row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "var(--text3)" }}>
            Current version
          </span>
          <code
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--text)",
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 12px",
            }}
          >
            v{currentVersion}
          </code>
        </div>

        <button
          className="btn btn-ghost"
          disabled={checking}
          onClick={runCheck}
          style={{ opacity: checking ? 0.6 : 1 }}
        >
          {checking ? "Checking…" : "Check for Updates"}
        </button>

        {result && !result.error && result.hasUpdate && (
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "rgba(229,9,20,0.12)",
              border: "1px solid rgba(229,9,20,0.4)",
              color: "var(--red)",
              borderRadius: 8,
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
              transition: "background 0.2s",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "rgba(229,9,20,0.22)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "rgba(229,9,20,0.12)")
            }
          >
            🎉 v{result.latest} available — Download
          </a>
        )}

        {result && !result.error && !result.hasUpdate && (
          <span style={{ fontSize: 13, color: "#48c774", fontWeight: 500 }}>
            ✓ You're up to date
          </span>
        )}

        {result?.error && (
          <span style={{ fontSize: 13, color: "var(--red)" }}>
            ✕ {result.error}
          </span>
        )}
      </div>

      {/* Auto-check toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={() => toggleAuto(!autoCheck)}
          style={{
            background: autoCheck ? "var(--red)" : "var(--surface2)",
            border: "1px solid " + (autoCheck ? "var(--red)" : "var(--border)"),
            borderRadius: 20,
            width: 40,
            height: 22,
            cursor: "pointer",
            position: "relative",
            flexShrink: 0,
            transition: "background 0.2s, border-color 0.2s",
          }}
          title={autoCheck ? "Disable auto-check" : "Enable auto-check"}
        >
          <span
            style={{
              position: "absolute",
              top: 2,
              left: autoCheck ? 20 : 2,
              width: 16,
              height: 16,
              background: "#fff",
              borderRadius: "50%",
              transition: "left 0.2s",
              boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
            }}
          />
        </button>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>
            Check for updates on startup
          </div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
            Shows a notification banner if a new version is available. Off by
            default.
          </div>
        </div>
        {autoSaved && (
          <span style={{ fontSize: 12, color: "#48c774" }}>✓ Saved</span>
        )}
      </div>
    </div>
  );
}

// ── Home Layout Section ───────────────────────────────────────────────────────
function HomeLayoutSection() {
  const [order, setOrder] = useState(() => {
    const { order: o } = loadHomeLayout();
    return o;
  });
  const [visible, setVisible] = useState(() => {
    const { visible: v } = loadHomeLayout();
    return v;
  });
  const [saved, setSaved] = useState(false);
  const dragItem = useRef(null);
  const dragOver = useRef(null);

  const handleDragStart = (idx) => {
    dragItem.current = idx;
  };
  const handleDragEnter = (idx) => {
    dragOver.current = idx;
  };
  const handleDragEnd = () => {
    const newOrder = [...order];
    const dragged = newOrder.splice(dragItem.current, 1)[0];
    newOrder.splice(dragOver.current, 0, dragged);
    dragItem.current = null;
    dragOver.current = null;
    setOrder(newOrder);
  };

  const toggleVisible = (id) => {
    setVisible((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSave = () => {
    storage.set("homeRowOrder", order);
    storage.set("homeRowVisible", visible);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const rowLabels = Object.fromEntries(HOME_ROWS.map((r) => [r.id, r.label]));

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">Home Page Layout</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        Choose which rows appear on the Home page and drag to reorder them. The
        hero banner is always shown at the top.
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxWidth: 480,
        }}
      >
        {order.map((id, idx) => (
          <div
            key={id}
            draggable
            onDragStart={() => handleDragStart(idx)}
            onDragEnter={() => handleDragEnter(idx)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => e.preventDefault()}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "10px 14px",
              cursor: "grab",
              opacity: visible[id] ? 1 : 0.45,
              transition: "opacity 0.2s",
              userSelect: "none",
            }}
          >
            {/* Drag handle */}
            <span
              style={{
                color: "var(--text3)",
                fontSize: 16,
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              ⠿
            </span>

            {/* Label */}
            <span
              style={{
                flex: 1,
                fontSize: 14,
                fontWeight: 500,
                color: "var(--text)",
              }}
            >
              {rowLabels[id] || id}
            </span>

            {/* Toggle */}
            <button
              onClick={() => toggleVisible(id)}
              style={{
                background: visible[id] ? "var(--red)" : "var(--surface2)",
                border:
                  "1px solid " + (visible[id] ? "var(--red)" : "var(--border)"),
                borderRadius: 20,
                width: 40,
                height: 22,
                cursor: "pointer",
                position: "relative",
                flexShrink: 0,
                transition: "background 0.2s, border-color 0.2s",
              }}
              title={visible[id] ? "Hide row" : "Show row"}
            >
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  left: visible[id] ? 20 : 2,
                  width: 16,
                  height: 16,
                  background: "#fff",
                  borderRadius: "50%",
                  transition: "left 0.2s",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                }}
              />
            </button>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <button className="btn btn-primary" onClick={handleSave}>
          Save Layout
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: "#48c774" }}>✓ Saved</span>
        )}
      </div>
    </div>
  );
}

// ── Start Page Section ────────────────────────────────────────────────────────
function StartPageSection() {
  const [startPage, setStartPage] = useState(
    () => storage.get("startPage") || "home",
  );
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    storage.set("startPage", startPage);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">Start Page</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        Choose which page opens when you launch Streambert.
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <select
          value={startPage}
          onChange={(e) => setStartPage(e.target.value)}
          style={{
            background: "var(--surface2)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "9px 14px",
            fontSize: 14,
            cursor: "pointer",
            minWidth: 220,
          }}
        >
          {[
            { value: "home", label: "🏠  Home" },
            { value: "history", label: "🕐  Library / History" },
            { value: "downloads", label: "⬇  Downloads" },
          ].map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={handleSave}>
          Save
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: "#48c774" }}>✓ Saved</span>
        )}
      </div>
    </div>
  );
}

// ── Subtitle Settings ─────────────────────────────────────────────────────────
function SubtitleSettingsSection() {
  const [enabled, setEnabled] = useState(
    () =>
      storage.get(STORAGE_KEYS.SUBTITLE_ENABLED) !== 0 &&
      storage.get(STORAGE_KEYS.SUBTITLE_ENABLED) !== "0",
  );
  const [lang, setLang] = useState(
    () => storage.get(STORAGE_KEYS.SUBTITLE_LANG) || "en",
  );
  const [apiKey, setApiKey] = useState(
    () => storage.get(STORAGE_KEYS.OS_API_KEY) || "",
  );
  const [subdlApiKey, setSubdlApiKey] = useState(
    () => storage.get(STORAGE_KEYS.SUBDL_API_KEY) || "",
  );
  const [showKey, setShowKey] = useState(false);
  const [showSubdlKey, setShowSubdlKey] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    storage.set(STORAGE_KEYS.SUBTITLE_ENABLED, enabled ? 1 : 0);
    storage.set(STORAGE_KEYS.SUBTITLE_LANG, lang);
    storage.set(STORAGE_KEYS.OS_API_KEY, apiKey.trim());
    storage.set(STORAGE_KEYS.SUBDL_API_KEY, subdlApiKey.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">Subtitle Downloads</div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text3)",
          marginBottom: 20,
          lineHeight: 1.6,
        }}
      >
        Automatically find and download subtitles via{" "}
        <span
          style={{
            color: "var(--red)",
            cursor: "pointer",
            textDecoration: "underline",
          }}
          onClick={() => window.electron?.openExternal("https://subdl.com")}
        >
          SubDL
        </span>{" "}
        (Subscene library) and{" "}
        <span
          style={{
            color: "var(--red)",
            cursor: "pointer",
            textDecoration: "underline",
          }}
          onClick={() =>
            window.electron?.openExternal(
              "https://www.opensubtitles.com/en/consumers",
            )
          }
        >
          OpenSubtitles
        </span>
        . SubDL is recommended: free key, huge library.
      </div>

      {/* Enable toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <button
          onClick={() => setEnabled((v) => !v)}
          style={{
            width: 40,
            height: 22,
            borderRadius: 11,
            border: "none",
            cursor: "pointer",
            background: enabled ? "var(--red)" : "var(--surface2)",
            position: "relative",
            transition: "background 0.2s",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 3,
              left: enabled ? 21 : 3,
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: "#fff",
              transition: "left 0.2s",
            }}
          />
        </button>
        <span
          style={{
            fontSize: 14,
            color: enabled ? "var(--text)" : "var(--text3)",
          }}
        >
          {enabled
            ? "Auto-download subtitles when downloading videos"
            : "Subtitle download disabled"}
        </span>
      </div>

      {enabled && (
        <>
          {/* Default language */}
          <div style={{ marginBottom: 16 }}>
            <div
              style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}
            >
              Default language
            </div>
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              style={{
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text)",
                padding: "7px 12px",
                fontSize: 13,
                cursor: "pointer",
                minWidth: 200,
              }}
            >
              {SUBTITLE_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          {/* SubDL API key (primary source) */}
          <div style={{ marginBottom: 16 }}>
            <div
              style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}
            >
              SubDL API key{" "}
              <span
                style={{
                  color: "var(--text3)",
                  cursor: "pointer",
                  fontSize: 11,
                }}
                onClick={() =>
                  window.electron?.openExternal("https://subdl.com/settings")
                }
              >
                (free, register at subdl.com ↗)
              </span>
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: "rgba(99,149,255,0.15)",
                  color: "#6395ff",
                  border: "1px solid rgba(99,149,255,0.3)",
                }}
              >
                RECOMMENDED
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                className="apikey-input"
                style={{ flex: 1, maxWidth: 400, marginBottom: 0 }}
                type={showSubdlKey ? "text" : "password"}
                placeholder="Primary source: Subscene library, generous limits"
                value={subdlApiKey}
                onChange={(e) => setSubdlApiKey(e.target.value)}
              />
              <button
                className="btn btn-ghost"
                style={{ padding: "6px 12px", fontSize: 12 }}
                onClick={() => setShowSubdlKey((v) => !v)}
              >
                {showSubdlKey ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {/* OpenSubtitles API key (secondary/optional) */}
          <div style={{ marginBottom: 16 }}>
            <div
              style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}
            >
              OpenSubtitles API key{" "}
              <span
                style={{
                  color: "var(--text3)",
                  cursor: "pointer",
                  fontSize: 11,
                }}
                onClick={() =>
                  window.electron?.openExternal(
                    "https://www.opensubtitles.com/en/consumers",
                  )
                }
              >
                (optional, get one free ↗)
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                className="apikey-input"
                style={{ flex: 1, maxWidth: 400, marginBottom: 0 }}
                type={showKey ? "text" : "password"}
                placeholder="Optional secondary source"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button
                className="btn btn-ghost"
                style={{ padding: "6px 12px", fontSize: 12 }}
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
          </div>
        </>
      )}

      <div
        style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}
      >
        <button className="btn btn-primary" onClick={handleSave}>
          Save
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: "#4caf50" }}>✓ Saved</span>
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SettingsPage({ apiKey, onChangeApiKey }) {
  const [downloadPath, setDownloadPath] = useState(
    () => storage.get("downloadPath") || "",
  );
  const [watchedThreshold, setWatchedThreshold] = useState(
    () => storage.get("watchedThreshold") ?? 20,
  );
  const [saved, setSaved] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetHovered, setResetHovered] = useState(false);

  // Age Rating
  const [ratingCountry, setRatingCountry] = useState(
    () => storage.get("ratingCountry") || "US",
  );
  const [ageLimit, setAgeLimit] = useState(() => {
    const v = storage.get("ageLimit");
    return v === null || v === undefined ? "" : String(v);
  });
  const [ageSaved, setAgeSaved] = useState(false);

  const saveAgeSettings = () => {
    storage.set("ratingCountry", ratingCountry);
    if (ageLimit === "" || ageLimit === null) {
      storage.remove("ageLimit");
    } else {
      storage.set("ageLimit", Number(ageLimit));
    }
    setAgeSaved(true);
    setTimeout(() => setAgeSaved(false), 2000);
  };

  // Invidious
  const [invidiousBase, setInvidiousBase] = useState(
    () => storage.get("invidiousBase") || DEFAULT_INVIDIOUS_BASE,
  );
  const [invidiousStatus, setInvidiousStatus] = useState(null); // null | { ok: bool, msg: string }
  const [invidiousChecking, setInvidiousChecking] = useState(false);
  const [invidiousSaved, setInvidiousSaved] = useState(false);

  const checkInvidious = async (baseUrl) => {
    const clean = (baseUrl || "").trim().replace(/\/$/, "");
    if (!clean) {
      setInvidiousStatus({ ok: false, msg: "Please enter a URL first." });
      return;
    }
    setInvidiousChecking(true);
    setInvidiousStatus(null);
    try {
      const url = `${clean}/api/v1/stats`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        setInvidiousStatus({
          ok: true,
          msg: "Instance reachable and responding.",
        });
      } else {
        setInvidiousStatus({
          ok: false,
          msg: `Server responded with status ${res.status}.`,
        });
      }
    } catch (e) {
      setInvidiousStatus({
        ok: false,
        msg: "Could not reach instance. Check the URL or try another.",
      });
    } finally {
      setInvidiousChecking(false);
    }
  };

  const saveInvidiousBase = () => {
    const clean = (invidiousBase || "").trim().replace(/\/$/, "");
    storage.set("invidiousBase", clean || DEFAULT_INVIDIOUS_BASE);
    setInvidiousBase(clean || DEFAULT_INVIDIOUS_BASE);
    setInvidiousSaved(true);
    setTimeout(() => setInvidiousSaved(false), 2000);
  };

  // Storage sizes - null = loading, -1 = unavailable, ≥0 = real value
  const [sizes, setSizes] = useState({ cache: null, downloads: null });

  useEffect(() => {
    if (typeof window === "undefined" || !window.electron) {
      setSizes({ cache: -1, downloads: -1 });
      return;
    }
    (async () => {
      try {
        const [cacheRes, downloadsRes] = await Promise.all([
          window.electron.getCacheSize?.() ?? null,
          window.electron.getDownloadsSize?.() ?? null,
        ]);
        setSizes({
          cache: cacheRes?.bytes ?? -1,
          downloads: downloadsRes?.bytes ?? -1,
        });
      } catch {
        setSizes({ cache: -1, downloads: -1 });
      }
    })();
  }, []);

  const isElectron = typeof window !== "undefined" && !!window.electron;

  const pickFolder = async () => {
    if (!isElectron) return;
    const folder = await window.electron.pickFolder();
    if (folder) {
      setDownloadPath(folder);
      storage.set("downloadPath", folder);
      flash();
    }
  };

  const handleSavePath = () => {
    storage.set("downloadPath", downloadPath);
    flash();
  };

  const handleSaveThreshold = () => {
    const val = Math.max(1, Math.min(300, Number(watchedThreshold) || 20));
    setWatchedThreshold(val);
    storage.set("watchedThreshold", val);
    flash();
  };

  const flash = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // ── Clean handlers ─────────────────────────────────────────────────────────

  const handleClearCache = async () => {
    if (isElectron) await window.electron.clearAppCache();
    setSizes((prev) => ({ ...prev, cache: 0 }));
    return { msg: "✓ Cache cleared successfully" };
  };

  const handleClearWatchProgress = async () => {
    storage.remove("progress");
    storage.remove("history");
    storage.remove("watched");
    if (isElectron) await window.electron.clearWatchData();
    setTimeout(() => window.location.reload(), 800);
    return { msg: "✓ Watch data cleared" };
  };

  const handleDeleteAllDownloads = async () => {
    let msg = "✓ All downloads removed";
    setSizes((prev) => ({ ...prev, downloads: 0 }));
    if (isElectron) {
      const res = await window.electron.deleteAllDownloads();
      if (res?.deleted != null) {
        msg = `✓ Removed ${res.deleted} file${res.deleted !== 1 ? "s" : ""}`;
        if (res.errors > 0) msg += ` (${res.errors} could not be deleted)`;
      }
    } else {
      storage.remove("localFiles");
    }
    return { msg };
  };

  const handleResetApp = async () => {
    setShowResetConfirm(false);
    if (isElectron) await window.electron.resetApp();
    storage.clearAll();
    window.location.reload();
  };

  return (
    <>
      {showResetConfirm && (
        <ResetConfirmDialog
          onConfirm={handleResetApp}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}

      <div className="fade-in" style={{ padding: "48px 48px 80px" }}>
        {/* Page title */}
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 48,
            letterSpacing: 1,
            marginBottom: 6,
          }}
        >
          SETTINGS
        </div>
        <div style={{ color: "var(--text3)", fontSize: 14, marginBottom: 48 }}>
          App configuration for Streambert
        </div>

        {/* ── Version & Updates ── */}
        <VersionSection />

        <div
          style={{ height: 1, background: "var(--border)", marginBottom: 40 }}
        />

        {/* ── TMDB API Key/Read Access Token ── */}
        <div style={{ marginBottom: 40 }}>
          <div className="settings-section-title">TMDB Read Access Token</div>
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <code
              style={{
                fontSize: 13,
                color: "var(--text2)",
                background: "var(--surface2)",
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid var(--border)",
              }}
            >
              {apiKey ? apiKey.slice(0, 8) + "••••••••••••••••" : "(not set)"}
            </code>
            <button className="btn btn-ghost" onClick={onChangeApiKey}>
              Change API Token
            </button>
          </div>
        </div>

        <div
          style={{ height: 1, background: "var(--border)", marginBottom: 40 }}
        />

        {/* ── Age Rating ── */}
        <div style={{ marginBottom: 40 }}>
          <div className="settings-section-title">
            Age Rating &amp; Parental Controls
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--text3)",
              marginBottom: 20,
              lineHeight: 1.6,
            }}
          >
            Set a maximum age rating. Content rated above this Age will still be
            visible but{" "}
            <strong style={{ color: "var(--text)" }}>
              you wont be able to play it.
            </strong>{" "}
            . Set to <em>No restriction</em> to disable this feature entirely.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Country */}
            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text2)",
                  marginBottom: 8,
                }}
              >
                Rating Country
              </div>
              <select
                value={ratingCountry}
                onChange={(e) => setRatingCountry(e.target.value)}
                style={{
                  background: "var(--surface2)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "9px 14px",
                  fontSize: 14,
                  cursor: "pointer",
                  minWidth: 280,
                }}
              >
                {RATING_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Age limit */}
            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text2)",
                  marginBottom: 8,
                }}
              >
                Maximum Allowed Age Rating
              </div>
              <select
                value={ageLimit}
                onChange={(e) => setAgeLimit(e.target.value)}
                style={{
                  background: "var(--surface2)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "9px 14px",
                  fontSize: 14,
                  cursor: "pointer",
                  minWidth: 280,
                }}
              >
                {AGE_LIMIT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button className="btn btn-primary" onClick={saveAgeSettings}>
                Save
              </button>
              {ageSaved && (
                <span style={{ fontSize: 13, color: "#48c774" }}>✓ Saved</span>
              )}
            </div>
          </div>
        </div>

        <div
          style={{ height: 1, background: "var(--border)", marginBottom: 40 }}
        />

        {/* ── Invidious Base URL ── */}
        <div style={{ marginBottom: 40 }}>
          <div className="settings-section-title">Invidious Instance</div>
          <div
            style={{
              fontSize: 13,
              color: "var(--text3)",
              marginBottom: 16,
              lineHeight: 1.6,
            }}
          >
            Trailers are played via{" "}
            <span style={{ color: "var(--text)", fontWeight: 600 }}>
              Invidious
            </span>
            , a privacy-friendly YouTube frontend. Your configured instance is
            tried first; if it should fail, the app automatically falls back
            through a list of known working instances. The default is{" "}
            <code style={{ fontSize: 12 }}>{DEFAULT_INVIDIOUS_BASE}</code>. The
            instance must have its API enabled (
            <code style={{ fontSize: 12 }}>/api/v1/stats</code> reachable).
          </div>
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <input
              className="apikey-input"
              style={{ flex: 1, minWidth: 260, marginBottom: 0 }}
              placeholder={DEFAULT_INVIDIOUS_BASE}
              value={invidiousBase}
              onChange={(e) => {
                setInvidiousBase(e.target.value);
                setInvidiousStatus(null);
              }}
            />
            <button
              className="btn btn-ghost"
              disabled={invidiousChecking}
              onClick={() => checkInvidious(invidiousBase)}
              style={{ opacity: invidiousChecking ? 0.5 : 1 }}
            >
              {invidiousChecking ? "Checking…" : "Check"}
            </button>
            <button className="btn btn-primary" onClick={saveInvidiousBase}>
              Save
            </button>
          </div>

          {/* Status indicator */}
          {invidiousStatus && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 12,
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: invidiousStatus.ok ? "#48c774" : "#ff3860",
                  boxShadow: invidiousStatus.ok
                    ? "0 0 6px rgba(72,199,116,0.6)"
                    : "0 0 6px rgba(255,56,96,0.6)",
                }}
              />
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: invidiousStatus.ok ? "#48c774" : "#ff3860",
                }}
              >
                {invidiousStatus.msg}
              </span>
            </div>
          )}

          {invidiousSaved && (
            <div style={{ marginTop: 10, fontSize: 13, color: "#48c774" }}>
              ✓ Saved
            </div>
          )}
        </div>

        <div
          style={{ height: 1, background: "var(--border)", marginBottom: 40 }}
        />

        {/* ── Auto-Watched Threshold ── */}
        <div style={{ marginBottom: 40 }}>
          <div className="settings-section-title">Auto-Watched Threshold</div>
          <div
            style={{
              fontSize: 13,
              color: "var(--text3)",
              marginBottom: 16,
              lineHeight: 1.6,
            }}
          >
            A movie or episode is automatically marked as{" "}
            <span style={{ color: "#48c774", fontWeight: 600 }}>Watched ✓</span>{" "}
            when the remaining time drops to this value or below. Set between 1
            and 300 seconds.
          </div>
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="number"
                min={1}
                max={300}
                className="apikey-input"
                style={{ width: 90, marginBottom: 0 }}
                value={watchedThreshold}
                onChange={(e) => setWatchedThreshold(e.target.value)}
              />
              <span style={{ fontSize: 14, color: "var(--text2)" }}>
                seconds
              </span>
            </div>
            <button className="btn btn-primary" onClick={handleSaveThreshold}>
              Save
            </button>
          </div>
          {saved && (
            <div style={{ marginTop: 10, fontSize: 13, color: "#48c774" }}>
              ✓ Saved
            </div>
          )}
        </div>

        <div
          style={{ height: 1, background: "var(--border)", marginBottom: 40 }}
        />

        {/* ── Download Folder ── */}
        <div style={{ marginBottom: 56 }}>
          <div className="settings-section-title">Download Folder</div>
          <div
            style={{
              fontSize: 13,
              color: "var(--text3)",
              marginBottom: 16,
              lineHeight: 1.6,
            }}
          >
            Downloaded videos will be saved here.
          </div>
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <input
              className="apikey-input"
              style={{ flex: 1, minWidth: 260, marginBottom: 0 }}
              placeholder="/home/you/Movies"
              value={downloadPath}
              onChange={(e) => setDownloadPath(e.target.value)}
            />
            {isElectron && (
              <button className="btn btn-secondary" onClick={pickFolder}>
                Browse …
              </button>
            )}
            <button className="btn btn-primary" onClick={handleSavePath}>
              Save
            </button>
          </div>
          {saved && (
            <div style={{ marginTop: 10, fontSize: 13, color: "#4caf50" }}>
              ✓ Saved
            </div>
          )}
          {!downloadPath && (
            <div style={{ marginTop: 10, fontSize: 13, color: "var(--red)" }}>
              ⚠ No download folder set, videos cannot be downloaded until you
              set one.
            </div>
          )}
        </div>

        {/* ══ HOME PAGE LAYOUT ═════════════════════════════════════════════════ */}
        <div
          style={{ height: 1, background: "var(--border)", marginBottom: 40 }}
        />

        {/* ── Subtitle Downloads ── */}
        <SubtitleSettingsSection />

        <div
          style={{ height: 1, background: "var(--border)", marginBottom: 40 }}
        />
        <HomeLayoutSection />

        <div
          style={{ height: 1, background: "var(--border)", marginBottom: 40 }}
        />
        <StartPageSection />

        <div
          style={{ height: 1, background: "var(--border)", marginBottom: 40 }}
        />

        {/* ══ STORAGE & DATA ══════════════════════════════════════════════════ */}
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 22,
            letterSpacing: 1,
            marginBottom: 6,
          }}
        >
          STORAGE & DATA
        </div>
        <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 28 }}>
          Manage cached data, watch history, and app storage
        </div>

        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          {/* Cache */}
          <div style={{ padding: "22px 24px" }}>
            <CleanRow
              title="Clear Cache"
              description="Removes temporary browser cache, shader cache, and service worker data from all internal sessions (main, video player, trailer). Does not affect your personal data or settings."
              buttonLabel="Clear Cache"
              onAction={handleClearCache}
              sizeLabel={formatBytes(sizes.cache)}
            />
          </div>

          <div style={{ height: 1, background: "var(--border)" }} />

          {/* Watch Progress */}
          <div style={{ padding: "22px 24px" }}>
            <CleanRow
              title="Clear Watch Progress"
              description="Resets all watch history, continue-watching progress, and watched / completed markings for movies and series. Also clears internal video player session data."
              buttonLabel="Clear Progress"
              onAction={handleClearWatchProgress}
            />
          </div>

          <div style={{ height: 1, background: "var(--border)" }} />

          {/* Delete Downloads */}
          <div style={{ padding: "22px 24px" }}>
            <CleanRow
              title="Delete All Downloads"
              description="Permanently deletes all video files that were downloaded through Streambert and removes them from the download list. Only files downloaded trough the app will be deleted, nothing else in your folder is touched."
              buttonLabel="Delete All"
              onAction={handleDeleteAllDownloads}
              sizeLabel={formatBytes(sizes.downloads)}
              danger
            />
          </div>

          <div style={{ height: 1, background: "var(--border)" }} />

          {/* Full Reset */}
          <div
            style={{ padding: "22px 24px", background: "rgba(229,9,20,0.03)" }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 24,
              }}
            >
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: "var(--text)",
                    marginBottom: 4,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  Reset App
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 1,
                      color: "var(--red)",
                      background: "rgba(229,9,20,0.12)",
                      border: "1px solid rgba(229,9,20,0.25)",
                      padding: "2px 7px",
                      borderRadius: 4,
                      textTransform: "uppercase",
                    }}
                  >
                    Irreversible
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--text3)",
                    lineHeight: 1.6,
                  }}
                >
                  Completely resets Streambert to factory defaults, clears all
                  settings, API Token, saved library, watch history/progress,
                  and all cached data. Your downloaded video files will not be
                  touched.
                </div>
              </div>
              <div style={{ flexShrink: 0, paddingTop: 2 }}>
                <button
                  className="btn"
                  onClick={() => setShowResetConfirm(true)}
                  onMouseEnter={() => setResetHovered(true)}
                  onMouseLeave={() => setResetHovered(false)}
                  style={{
                    color: resetHovered ? "#fff" : "var(--red)",
                    background: resetHovered
                      ? "rgba(229,9,20,0.85)"
                      : "rgba(229,9,20,0.08)",
                    border: resetHovered
                      ? "1px solid transparent"
                      : "1px solid rgba(229,9,20,0.3)",
                    transition: "all 0.2s",
                  }}
                >
                  Reset App
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
