/**
 * Seasonal / event-based logo overlays for the Streambert sidebar.
 *
 * To add a new event:
 *   1. Add an entry to EVENTS below.
 *   2. `check(now)` receives a Date (returns true when date is active)
 *   3. `render()` returns a React element that overlays the logo.
 *      Keep it contained within a 40×40 px area (the logo wrapper size).
 *
 * Events are evaluated top-to-bottom; the first match wins.
 */

import { useEffect, useState } from "react";

// ── Event definitions ────────────────────────────────────────────────────────

const EVENTS = [
  // ── Pride Month (June) ───────────────────────────────────────────────────
  {
    id: "pride",
    check: (d) => d.getMonth() === 5, // June = 5
    render: () => <PrideOverlay />,
  },

  // ── Christmas (Dec 20 – Dec 31) ──────────────────────────────────────────
  {
    id: "christmas",
    check: (d) => d.getMonth() === 11 && d.getDate() >= 20,
    render: () => <SnowOverlay />,
  },

  // ── New Year (Jan 1 – Jan 5) ─────────────────────────────────────────────
  {
    id: "newyear",
    check: (d) => d.getMonth() === 0 && d.getDate() <= 5,
    render: () => <SnowOverlay />,
  },

  // ── Halloween (Oct 24 – Oct 31) ──────────────────────────────────────────
  {
    id: "halloween",
    check: (d) => d.getMonth() === 9 && d.getDate() >= 24,
    render: () => <HalloweenOverlay />,
  },
];

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useSeasonalEvent() {
  const [event, setEvent] = useState(() => getActiveEvent());

  // Re-check at midnight so the overlay appears/disappears without a reload
  useEffect(() => {
    const msUntilMidnight = () => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      return midnight - now;
    };

    let timeout;
    const schedule = () => {
      timeout = setTimeout(() => {
        setEvent(getActiveEvent());
        schedule();
      }, msUntilMidnight());
    };
    schedule();
    return () => clearTimeout(timeout);
  }, []);

  return event;
}

/**
 * To test an event temporarily, change getActiveEvent() to:
 *   const now = new Date("2024-10-28"); // Halloween
 *   const now = new Date("2024-12-25"); // Christmas
 *   const now = new Date("2024-06-15"); // Pride
 *
 * To make it normal again:
 *  const now = new Date();
 */
function getActiveEvent() {
  const now = new Date();
  return EVENTS.find((e) => e.check(now)) ?? null;
}

// ── Pride overlay ─────────────────────────────────────────────────────────────
// Small pride flag in the bottom-right corner of the logo.

const PRIDE_STRIPES = [
  "#FF0018",
  "#FFA52C",
  "#FFFF41",
  "#008018",
  "#0000F9",
  "#86007D",
];

function PrideOverlay() {
  return (
    <div style={overlayBase}>
      {/* tiny flag in bottom-right corner */}
      <div
        style={{
          position: "absolute",
          bottom: 3,
          right: 2,
          width: 14,
          height: 10,
          borderRadius: 1,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
        }}
      >
        {PRIDE_STRIPES.map((color, i) => (
          <div key={i} style={{ flex: 1, background: color }} />
        ))}
      </div>
    </div>
  );
}

// ── Snow overlay ─────────────────────────────────────────────────────────────

const SNOWFLAKES = Array.from({ length: 7 }, (_, i) => ({
  left: `${10 + i * 13}%`,
  delay: `${i * 0.4}s`,
  duration: `${1.6 + (i % 3) * 0.5}s`,
  size: i % 2 === 0 ? 3 : 2,
}));

function SnowOverlay() {
  return (
    <div style={{ ...overlayBase, overflow: "hidden" }}>
      <style>{`
        @keyframes sb-snow-fall {
          0%   { transform: translateY(-6px) rotate(0deg); opacity: 0; }
          15%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { transform: translateY(44px) rotate(180deg); opacity: 0; }
        }
      `}</style>
      {SNOWFLAKES.map((s, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: s.left,
            top: 0,
            width: s.size,
            height: s.size,
            borderRadius: "50%",
            background: "#fff",
            opacity: 0,
            animation: `sb-snow-fall ${s.duration} ${s.delay} infinite linear`,
          }}
        />
      ))}
    </div>
  );
}

// ── Halloween overlay ─────────────────────────────────────────────────────────

function HalloweenOverlay() {
  return (
    <div style={overlayBase}>
      {/* tiny pumpkin in bottom-right corner */}
      <div
        style={{
          position: "absolute",
          bottom: 1,
          right: 1,
          width: 14,
          height: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          lineHeight: 1,
        }}
      >
        🎃
      </div>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const overlayBase = {
  position: "absolute",
  inset: 0,
  borderRadius: "inherit",
  display: "flex",
  flexDirection: "column",
  pointerEvents: "none",
  overflow: "hidden",
};
