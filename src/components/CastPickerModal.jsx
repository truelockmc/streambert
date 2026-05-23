import { useEffect, useState } from "react";
import { CastIcon } from "./Icons";
import CastMiniController from "./CastMiniController";
import { storage, STORAGE_KEYS } from "../utils/storage";

const MAX_RECENT = 5;

function pushRecent(deviceId) {
  if (!deviceId) return;
  const cur = storage.get(STORAGE_KEYS.CAST_RECENT_DEVICE_IDS) || [];
  const next = [deviceId, ...cur.filter((id) => id !== deviceId)].slice(
    0,
    MAX_RECENT,
  );
  storage.set(STORAGE_KEYS.CAST_RECENT_DEVICE_IDS, next);
}

function TypeBadge({ type }) {
  const isCast = type === "cast";
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: "1px 6px",
        borderRadius: 3,
        background: isCast
          ? "rgba(99,149,255,0.15)"
          : "rgba(180,130,255,0.15)",
        color: isCast ? "#6395ff" : "#b482ff",
        border: `1px solid ${
          isCast ? "rgba(99,149,255,0.3)" : "rgba(180,130,255,0.3)"
        }`,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        flexShrink: 0,
      }}
    >
      {isCast ? "CAST" : "DLNA"}
    </span>
  );
}

function DeviceRow({ device, busy, onSelect }) {
  return (
    <button
      onClick={() => onSelect(device)}
      disabled={busy}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        textAlign: "left",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "10px 12px",
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.5 : 1,
        color: "var(--text)",
      }}
    >
      <TypeBadge type={device.type} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {device.friendlyName || device.name}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--text3)",
            marginTop: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {device.model ? `${device.model} · ` : ""}
          {device.address}
          {device.port ? `:${device.port}` : ""}
        </div>
      </div>
    </button>
  );
}

/**
 * CastPickerModal — list discovered Chromecast + DLNA devices.
 *
 * Props:
 *   open: bool
 *   onClose: () => void
 *   loadArgs: object — passed to cast:load after connect succeeds
 *   onConnected: (device) => void
 *   cast: useCast() result (devices, isDiscovering, connect, load, startDiscovery, ...)
 */
export default function CastPickerModal({
  open,
  onClose,
  loadArgs,
  onConnected,
  cast,
}) {
  const [connectingId, setConnectingId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    // Re-query on open. The mDNS browser stays alive for the session (passive,
    // no polling), so devices already found remain listed; this just refreshes.
    cast.startDiscovery();
  }, [open]);

  if (!open) return null;

  const recentIds = storage.get(STORAGE_KEYS.CAST_RECENT_DEVICE_IDS) || [];
  const recentDevices = recentIds
    .map((id) => cast.devices.find((d) => d.id === id))
    .filter(Boolean);
  const recentIdSet = new Set(recentDevices.map((d) => d.id));
  const otherDevices = cast.devices.filter((d) => !recentIdSet.has(d.id));

  const handleSelect = async (device) => {
    setConnectingId(device.id);
    setError(null);
    try {
      const r = await cast.connect(device.id);
      if (!r?.ok) {
        setError(r?.error || "Connect failed");
        return;
      }
      pushRecent(device.id);
      if (loadArgs) {
        const lr = await cast.load(loadArgs);
        if (!lr?.ok) {
          setError(lr?.error || "Load failed");
          return;
        }
      }
      onConnected?.(device);
      onClose?.();
    } finally {
      setConnectingId(null);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999999,
        background: "rgba(0,0,0,0.78)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          width: 520,
          maxWidth: "95vw",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "15px 20px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontWeight: 600,
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            <CastIcon size={14} />
            {cast.currentDevice ? "Casting" : "Cast to a device"}
          </span>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              className="btn btn-ghost"
              style={{ padding: "4px 10px", fontSize: 11 }}
              onClick={() => cast.startDiscovery()}
              disabled={cast.isDiscovering}
            >
              {cast.isDiscovering ? "Scanning…" : "⟳ Refresh"}
            </button>
            <button className="icon-btn" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div
          style={{
            padding: "12px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            overflowY: "auto",
            flex: 1,
          }}
        >
          {cast.currentDevice && (
            <CastMiniController cast={cast} variant="modal" />
          )}

          {cast.currentDevice && otherDevices.length + recentDevices.length > 1 && (
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--text3)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              Switch device
            </div>
          )}

          {recentDevices.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--text3)",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                Recent
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {recentDevices.map((d) => (
                  <DeviceRow
                    key={d.id}
                    device={d}
                    busy={connectingId !== null}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            </div>
          )}

          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--text3)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: 6,
              }}
            >
              {recentDevices.length ? "Other devices" : "Available devices"}
            </div>
            {otherDevices.length === 0 && !cast.isDiscovering && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text3)",
                  padding: "16px 4px",
                  textAlign: "center",
                }}
              >
                No devices found on your network.
                <br />
                Make sure your TV/projector is on and connected to the same
                Wi-Fi.
              </div>
            )}
            {cast.isDiscovering && otherDevices.length === 0 && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text3)",
                  padding: "12px 4px",
                  textAlign: "center",
                }}
              >
                Scanning the network…
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {otherDevices.map((d) => (
                <DeviceRow
                  key={d.id}
                  device={d}
                  busy={connectingId !== null}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          </div>

          {(error || cast.lastError) && (
            <div
              style={{
                padding: "8px 12px",
                background: "rgba(229,9,20,0.08)",
                border: "1px solid rgba(229,9,20,0.3)",
                borderRadius: 8,
                color: "var(--red)",
                fontSize: 12,
              }}
            >
              {error || cast.lastError}
            </div>
          )}

          {connectingId && (
            <div
              style={{
                fontSize: 12,
                color: "var(--text3)",
                textAlign: "center",
              }}
            >
              Connecting…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
