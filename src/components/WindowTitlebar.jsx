import { useState, useEffect } from "react";

// Only rendered on Windows (platform === 'win32')
// Provides minimize / maximize / close buttons and a draggable title area.
export default function WindowTitlebar() {
  const [maximized, setMaximized] = useState(false);

  // Poll maximized state (Electron doesn't push this to the renderer)
  useEffect(() => {
    if (!window.electron?.windowIsMaximized) return;
    let active = true;
    const poll = () => {
      if (!active) return;
      window.electron.windowIsMaximized().then((v) => {
        if (active) setMaximized(v);
      });
      setTimeout(poll, 500);
    };
    poll();
    return () => {
      active = false;
    };
  }, []);

  const minimize = () => window.electron?.windowMinimize();
  const toggleMaximize = () =>
    window.electron
      ?.windowToggleMaximize()
      .then(() => window.electron?.windowIsMaximized().then(setMaximized));
  const close = () => window.electron?.windowClose();

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 32,
        zIndex: 10000,
        background: "#0d0d0d",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        alignItems: "center",
        userSelect: "none",
        // WebkitAppRegion makes the bar draggable in Electron
        WebkitAppRegion: "drag",
      }}
    >
      {/* App name / logo */}
      <div
        style={{
          paddingLeft: 12, // sit over the sidebar
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 2,
          color: "rgba(255,255,255,0.35)",
          fontFamily: "var(--font-display)",
          flexGrow: 1,
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
        }}
      >
        STREAMBERT
      </div>

      {/* Window control buttons, NOT draggable */}
      <div
        style={{
          display: "flex",
          height: "100%",
          WebkitAppRegion: "no-drag",
        }}
      >
        {/* Minimize */}
        <TitlebarBtn
          onClick={minimize}
          hoverBg="rgba(255,255,255,0.08)"
          title="Minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="none">
            <rect width="10" height="1" fill="currentColor" />
          </svg>
        </TitlebarBtn>

        {/* Maximize / Restore */}
        <TitlebarBtn
          onClick={toggleMaximize}
          hoverBg="rgba(255,255,255,0.08)"
          title={maximized ? "Restore" : "Maximize"}
        >
          {maximized ? (
            // Restore icon (two overlapping squares)
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect
                x="2"
                y="0"
                width="8"
                height="8"
                rx="0.5"
                stroke="currentColor"
                strokeWidth="1"
                fill="none"
              />
              <rect
                x="0"
                y="2"
                width="8"
                height="8"
                rx="0.5"
                stroke="currentColor"
                strokeWidth="1"
                fill="none"
                style={{ fill: "#0d0d0d" }}
              />
            </svg>
          ) : (
            // Maximize icon (square)
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect
                x="0.5"
                y="0.5"
                width="9"
                height="9"
                rx="0.5"
                stroke="currentColor"
                strokeWidth="1"
                fill="none"
              />
            </svg>
          )}
        </TitlebarBtn>

        {/* Close */}
        <TitlebarBtn
          onClick={close}
          hoverBg="rgba(229,9,20,0.85)"
          title="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <line
              x1="0"
              y1="0"
              x2="10"
              y2="10"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            <line
              x1="10"
              y1="0"
              x2="0"
              y2="10"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        </TitlebarBtn>
      </div>
    </div>
  );
}

function TitlebarBtn({ children, onClick, hoverBg, title }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 46,
        height: "100%",
        background: hovered ? hoverBg : "transparent",
        border: "none",
        cursor: "default",
        color: hovered ? "#fff" : "rgba(255,255,255,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 0.15s, color 0.15s",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}
