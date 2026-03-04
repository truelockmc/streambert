// Keyboard Shortcuts reference modal
export default function KeyboardShortcutsModal({ onClose }) {
  const shortcuts = [
    { keys: ["Ctrl", "F"], desc: "Open search" },
    { keys: ["Esc"], desc: "Close search / modal" },
    { keys: ["Ctrl", "Z"], desc: "Navigate back" },
    { keys: ["Ctrl", "R"], desc: "Reload app" },
    { keys: ["?"], desc: "Show this shortcuts overview" },
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 5000,
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          padding: "36px 40px",
          minWidth: 380,
          maxWidth: 480,
          width: "90%",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 28,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 22,
              letterSpacing: 1,
              color: "var(--text)",
            }}
          >
            KEYBOARD SHORTCUTS
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text3)",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ×
          </button>
        </div>

        {/* Shortcut rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {shortcuts.map(({ keys, desc }, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                padding: "10px 14px",
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
            >
              <span style={{ fontSize: 14, color: "var(--text2)" }}>
                {desc}
              </span>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {keys.map((k, j) => (
                  <kbd
                    key={j}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "3px 9px",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderBottom: "2px solid rgba(255,255,255,0.12)",
                      borderRadius: 5,
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--text)",
                      fontFamily: "monospace",
                      minWidth: 28,
                    }}
                  >
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* GitHub support link */}
        <div
          style={{
            marginTop: 20,
            padding: "14px 16px",
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text)",
                marginBottom: 2,
              }}
            >
              Need help or found a bug?
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)" }}>
              Open an issue or browse the README on GitHub
            </div>
          </div>
          <a
            href="https://github.com/truelockmc/streambert"
            onClick={(e) => {
              e.preventDefault();
              window.electron?.openExternal(
                "https://github.com/truelockmc/streambert",
              );
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 14px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 7,
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text)",
              textDecoration: "none",
              flexShrink: 0,
              cursor: "pointer",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.39.6.11.82-.26.82-.58v-2.03c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02.005 2.04.14 3 .4 2.28-1.55 3.29-1.23 3.29-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58C20.57 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            GitHub ↗
          </a>
        </div>

        <div
          style={{
            marginTop: 12,
            fontSize: 12,
            color: "var(--text3)",
            textAlign: "center",
          }}
        >
          Press{" "}
          <kbd
            style={{
              fontSize: 11,
              padding: "1px 5px",
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: 3,
            }}
          >
            ?
          </kbd>{" "}
          or{" "}
          <kbd
            style={{
              fontSize: 11,
              padding: "1px 5px",
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: 3,
            }}
          >
            Esc
          </kbd>{" "}
          to close
        </div>
      </div>
    </div>
  );
}
