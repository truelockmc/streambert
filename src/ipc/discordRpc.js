// ── Discord Rich Presence (zero-dependency IPC client) ────────────────────────
// Talks directly to the local Discord client trough native node net/fs
//
// Protocol summary (see discord/discord-rpc docs):
//   Frame = uint32LE opcode + uint32LE payloadLength + JSON payload (utf8)
//   Opcodes: 0 HANDSHAKE, 1 FRAME, 2 CLOSE

const net = require("net");
const fs = require("fs");
const path = require("path");

const CLIENT_ID = "1522558650076627076";

const MIN_SEND_INTERVAL_MS = 15000;
// How long to wait before retrying a failed/absent Discord connection.
const RECONNECT_DELAY_MS = 15000;

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2 };

function candidatePipePaths() {
  if (process.platform === "win32") {
    return Array.from({ length: 10 }, (_, i) => `\\\\.\\pipe\\discord-ipc-${i}`);
  }
  const base =
    process.env.XDG_RUNTIME_DIR ||
    process.env.TMPDIR ||
    process.env.TMP ||
    process.env.TEMP ||
    "/tmp";
  const dirs = [
    base,
    path.join(base, "app/com.discordapp.Discord"), // flatpak
    path.join(base, "snap.discord"), // snap
  ];
  const paths = [];
  for (const dir of dirs) {
    for (let i = 0; i < 10; i++) paths.push(path.join(dir, `discord-ipc-${i}`));
  }
  return paths;
}

function makeNonce() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function encodeFrame(op, obj) {
  const payload = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.alloc(8);
  header.writeUInt32LE(op, 0);
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

// ── Module state ───────────────────────────────────────────────────────────
let enabled = false;
let socket = null;
let ready = false;
let recvBuffer = Buffer.alloc(0);
let reconnectTimer = null;

let pendingActivity = undefined; // undefined = nothing queued yet
let hasPending = false;
let lastSentAt = 0;
let flushTimer = null;

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function clearFlushTimer() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

function scheduleReconnect() {
  if (!enabled || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (enabled) connect();
  }, RECONNECT_DELAY_MS);
}

function teardownSocket() {
  ready = false;
  recvBuffer = Buffer.alloc(0);
  if (socket) {
    socket.removeAllListeners();
    socket.destroy();
    socket = null;
  }
}

function onSocketDown() {
  teardownSocket();
  scheduleReconnect();
}

function handleFrame(op, obj) {
  if (op === OP.FRAME && obj && obj.cmd === "DISPATCH" && obj.evt === "READY") {
    ready = true;
    flush();
  }
}

function onData(chunk) {
  recvBuffer = Buffer.concat([recvBuffer, chunk]);
  while (recvBuffer.length >= 8) {
    const op = recvBuffer.readUInt32LE(0);
    const len = recvBuffer.readUInt32LE(4);
    if (recvBuffer.length < 8 + len) break;
    const payload = recvBuffer.subarray(8, 8 + len);
    recvBuffer = recvBuffer.subarray(8 + len);
    try {
      handleFrame(op, JSON.parse(payload.toString("utf8")));
    } catch {
    }
  }
}

function tryPaths(paths, index) {
  if (!enabled || index >= paths.length) {
    scheduleReconnect();
    return;
  }
  const target = paths[index];
  const sock = net.createConnection(target);
  let settled = false;

  const failNext = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    sock.removeAllListeners();
    sock.destroy();
    tryPaths(paths, index + 1);
  };

  const timeout = setTimeout(failNext, 1000);

  sock.once("connect", () => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    socket = sock;
    socket.on("data", onData);
    socket.on("close", onSocketDown);
    socket.on("error", onSocketDown);
    socket.write(encodeFrame(OP.HANDSHAKE, { v: 1, client_id: CLIENT_ID }));
  });
  sock.once("error", failNext);
}

function connect() {
  if (!enabled || socket) return;
  clearReconnectTimer();
  tryPaths(candidatePipePaths(), 0);
}

function doSend() {
  if (!hasPending || !socket || !ready) return;
  const activity = pendingActivity;
  hasPending = false;
  lastSentAt = Date.now();
  try {
    socket.write(
      encodeFrame(OP.FRAME, {
        cmd: "SET_ACTIVITY",
        args: { pid: process.pid, activity: activity || null },
        nonce: makeNonce(),
      }),
    );
  } catch {
    onSocketDown();
  }
}

function flush() {
  if (!hasPending || !socket || !ready) return;
  clearFlushTimer();
  const elapsed = Date.now() - lastSentAt;
  if (elapsed >= MIN_SEND_INTERVAL_MS) {
    doSend();
  } else {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, MIN_SEND_INTERVAL_MS - elapsed);
  }
}

// ── Public API ────────────────────────────────────────────────────────────

function setEnabled(next) {
  next = !!next;
  if (next === enabled) return;
  enabled = next;
  if (enabled) {
    connect();
  } else {
    clearReconnectTimer();
    clearFlushTimer();
    hasPending = false;
    pendingActivity = undefined;
    teardownSocket();
  }
}

/** activity: null clears presence, otherwise a Discord activity payload. */
function updateActivity(activity) {
  if (!enabled) return;
  pendingActivity = activity;
  hasPending = true;
  flush();
}

function shutdown() {
  clearReconnectTimer();
  clearFlushTimer();
  teardownSocket();
}

function register(ipcMain) {
  ipcMain.handle("discord-rpc-set-enabled", (_e, next) => {
    setEnabled(next);
  });
  ipcMain.handle("discord-rpc-update-activity", (_e, activity) => {
    updateActivity(activity);
  });
}

module.exports = { register, setEnabled, updateActivity, shutdown };
