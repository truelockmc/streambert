import { useEffect, useRef, useState } from "react";
import { CastingIcon, PlayIcon, SubtitlesIcon } from "./Icons";

const PauseIcon = ({ size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Compact play/pause/seek/volume/disconnect bar.
 *
 * Props:
 *   cast: useCast() result
 *   variant: "player" | "global"  — affects positioning + max width
 */
export default function CastMiniController({ cast, variant = "player" }) {
  const { sessionState, position, duration, volume, currentDevice } = cast;

  // Local scrubber state — avoids snap-back while user drags
  const [drag, setDrag] = useState(null);
  const seekRef = useRef(null);
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

  const handleScrubChange = (e) => {
    const v = Number(e.target.value);
    setDrag((v / 100) * duration);
  };
  const handleScrubCommit = (e) => {
    const v = Number(e.target.value);
    cast.seek((v / 100) * duration);
    setDrag(null);
  };

  const isPlaying = sessionState === "playing";
  const isBuffering = sessionState === "buffering" || sessionState === "connecting";

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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          minHeight: 32,
        }}
      >
        <CastingIcon size={16} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            flex: variant === "global" ? 1 : "0 0 auto",
            maxWidth: variant === "global" ? "none" : 180,
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "var(--text3)",
              lineHeight: 1,
            }}
          >
            Casting to
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {currentDevice.friendlyName || currentDevice.name}
          </div>
        </div>

        <button
          className="icon-btn"
          onClick={() => (isPlaying ? cast.pause() : cast.play())}
          disabled={isBuffering}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isBuffering ? "…" : isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>

        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 100,
          }}
        >
          <span
            style={{
              fontSize: 10,
              color: "var(--text3)",
              fontVariantNumeric: "tabular-nums",
              minWidth: 36,
              textAlign: "right",
            }}
          >
            {fmtTime(drag ?? position)}
          </span>
          <input
            ref={seekRef}
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
          <span
            style={{
              fontSize: 10,
              color: "var(--text3)",
              fontVariantNumeric: "tabular-nums",
              minWidth: 36,
            }}
          >
            {duration ? fmtTime(duration) : "--:--"}
          </span>
        </div>

        <button
          className="icon-btn"
          onClick={() => {
            const next = !subsOn;
            setSubsOn(next);
            cast.setSubtitleTrack?.(next ? 0 : -1);
          }}
          title={subsOn ? "Turn subtitles off" : "Turn subtitles on"}
          style={{ opacity: subsOn ? 1 : 0.45 }}
        >
          <SubtitlesIcon />
        </button>

        {variant === "player" && (
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round((volume || 0) * 100)}
            onChange={(e) => cast.setVolume(Number(e.target.value) / 100)}
            title="Volume"
            style={{ width: 70, cursor: "pointer" }}
          />
        )}

        <button
          className="btn btn-ghost"
          style={{ padding: "4px 10px", fontSize: 11 }}
          onClick={() => cast.disconnect()}
          title="Disconnect from device"
        >
          Stop
        </button>
      </div>
    </div>
  );
}
