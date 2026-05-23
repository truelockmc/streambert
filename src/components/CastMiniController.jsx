import { useEffect, useState } from "react";
import { CastingIcon, PlayIcon, SubtitlesIcon } from "./Icons";

const PauseIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);

const Skip = ({ dir = 1, size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={dir < 0 ? { transform: "scaleX(-1)" } : undefined}
    aria-hidden="true"
  >
    <path d="M12 5a7 7 0 1 1-7 7" />
    <path d="M12 2.5 15 5l-3 2.5" />
  </svg>
);

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Play/pause/seek/volume/subtitle/disconnect controls for the active session.
 *
 * Props:
 *   cast: useCast() result
 *   variant: "player" | "global" | "modal"
 *     player  horizontal bar pinned under the in-app player
 *     global  horizontal bar pinned in the sidebar
 *     modal   stacked layout for the cast picker popup (full remote)
 */
export default function CastMiniController({ cast, variant = "player" }) {
  const { sessionState, position, duration, volume, currentDevice } = cast;

  const [drag, setDrag] = useState(null);
  const [subsOn, setSubsOn] = useState(true);

  useEffect(() => {
    if (drag === null) return;
    const onUp = () => setDrag(null);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
    };
  }, [drag]);

  if (sessionState === "idle" || !currentDevice) return null;

  const pct =
    duration > 0
      ? Math.max(0, Math.min(100, ((drag ?? position) / duration) * 100))
      : 0;

  const handleScrubChange = (e) => setDrag((Number(e.target.value) / 100) * duration);
  const handleScrubCommit = (e) => {
    cast.seek((Number(e.target.value) / 100) * duration);
    setDrag(null);
  };

  const isPlaying = sessionState === "playing";
  const isBuffering = sessionState === "buffering" || sessionState === "connecting";

  const toggleSubs = () => {
    const next = !subsOn;
    setSubsOn(next);
    cast.setSubtitleTrack?.(next ? 0 : -1);
  };

  const playPauseBtn = (
    <button
      className="icon-btn"
      onClick={() => (isPlaying ? cast.pause() : cast.play())}
      disabled={isBuffering}
      title={isPlaying ? "Pause" : "Play"}
    >
      {isBuffering ? "…" : isPlaying ? <PauseIcon /> : <PlayIcon />}
    </button>
  );

  const subsBtn = (
    <button
      className="icon-btn"
      onClick={toggleSubs}
      title={subsOn ? "Turn subtitles off" : "Turn subtitles on"}
      style={{ opacity: subsOn ? 1 : 0.45 }}
    >
      <SubtitlesIcon />
    </button>
  );

  const seekBar = (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 100,
      }}
    >
      <span style={timeStyle("right")}>{fmtTime(drag ?? position)}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={0.1}
        value={pct}
        onChange={handleScrubChange}
        onMouseUp={handleScrubCommit}
        onTouchEnd={handleScrubCommit}
        disabled={!duration}
        style={{ flex: 1, cursor: duration ? "pointer" : "default" }}
      />
      <span style={timeStyle("left")}>{duration ? fmtTime(duration) : "--:--"}</span>
    </div>
  );

  const volumeSlider = (
    <input
      type="range"
      min={0}
      max={100}
      step={1}
      value={Math.round((volume || 0) * 100)}
      onChange={(e) => cast.setVolume(Number(e.target.value) / 100)}
      title="Volume"
      style={{ width: variant === "modal" ? 110 : 70, cursor: "pointer" }}
    />
  );

  const stopBtn = (
    <button
      className="btn btn-ghost"
      style={{ padding: "4px 10px", fontSize: 11 }}
      onClick={() => cast.disconnect()}
      title="Stop casting"
    >
      Stop
    </button>
  );

  const deviceLabel = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <CastingIcon size={16} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1 }}>
          Casting to
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {currentDevice.friendlyName || currentDevice.name}
        </div>
      </div>
    </div>
  );

  // ── Modal: stacked full remote ──────────────────────────────────────────────
  if (variant === "modal") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: 14,
          background: "var(--surface2)",
          border: "1px solid var(--border)",
          borderRadius: 10,
        }}
      >
        {deviceLabel}
        {seekBar}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            className="icon-btn"
            onClick={() => cast.seek(Math.max(0, (position || 0) - 10))}
            title="Back 10s"
          >
            <Skip dir={-1} />
          </button>
          {playPauseBtn}
          <button
            className="icon-btn"
            onClick={() => cast.seek((position || 0) + 10)}
            title="Forward 10s"
          >
            <Skip dir={1} />
          </button>
          {subsBtn}
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              gap: 6,
              justifyContent: "flex-end",
            }}
          >
            🔊 {volumeSlider}
          </div>
          {stopBtn}
        </div>
      </div>
    );
  }

  // ── Player / global: horizontal bar ─────────────────────────────────────────
  const containerStyle =
    variant === "global"
      ? {
          padding: "10px 12px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          margin: "8px",
        }
      : {
          padding: "8px 12px",
          background: "var(--surface)",
          borderTop: "1px solid var(--border)",
        };

  return (
    <div style={containerStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 32 }}>
        <div style={{ maxWidth: variant === "global" ? "none" : 180, flexShrink: 0 }}>
          {deviceLabel}
        </div>
        {playPauseBtn}
        {seekBar}
        {subsBtn}
        {variant === "player" && volumeSlider}
        {stopBtn}
      </div>
    </div>
  );
}

function timeStyle(textAlign) {
  return {
    fontSize: 10,
    color: "var(--text3)",
    fontVariantNumeric: "tabular-nums",
    minWidth: 36,
    textAlign,
  };
}
