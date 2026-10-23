import { useEffect, useState } from "react";

// Loading overlay content shown while the main process scrapes HiAnime.
// Subscribes to "hianime-progress" events and renders the lookup steps.

const STEPS = [
  { id: "search", label: "Searching title" },
  { id: "episodes", label: "Loading episode list" },
  { id: "stream", label: "Fetching stream" },
  { id: "player", label: "Starting player" },
];

export default function HiAnimeLoader({ what = "episode", playerStarting }) {
  const [stage, setStage] = useState("search");

  useEffect(() => {
    setStage("search");
    const off = window.electron?.onHiAnimeProgress?.((s) => {
      if (s) setStage(s);
    });
    return () => {
      if (typeof off === "function") off();
    };
  }, []);

  const current = playerStarting
    ? STEPS.length - 1
    : Math.max(
        0,
        STEPS.findIndex((s) => s.id === stage),
      );

  return (
    <>
      <div className="spinner" />
      <span style={{ fontSize: 14, color: "var(--text2)" }}>
        Looking up {what} on HiAnime…
      </span>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          minWidth: 190,
        }}
        role="status"
        aria-live="polite"
      >
        {STEPS.map((step, i) => (
          <div
            key={step.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color:
                i < current
                  ? "var(--text2)"
                  : i === current
                    ? "var(--text)"
                    : "var(--text3)",
              opacity: i > current ? 0.5 : 1,
              fontWeight: i === current ? 600 : 400,
            }}
          >
            <span style={{ width: 14, textAlign: "center" }}>
              {i < current ? "✓" : i === current ? "●" : "○"}
            </span>
            {step.label}
          </div>
        ))}
      </div>
    </>
  );
}
