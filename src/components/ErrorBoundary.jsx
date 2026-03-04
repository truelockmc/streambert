import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Could send to a logging service here
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const { error } = this.state;

    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#0a0a0a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 20,
          padding: 40,
          fontFamily: "var(--font-sans, sans-serif)",
        }}
      >
        {/* Icon */}
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            background: "rgba(229,9,20,0.12)",
            border: "1px solid rgba(229,9,20,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
          }}
        >
          ⚠
        </div>

        <div
          style={{
            fontFamily: "var(--font-display, monospace)",
            fontSize: 28,
            letterSpacing: 1,
            color: "#fff",
          }}
        >
          SOMETHING WENT WRONG
        </div>

        <div
          style={{
            fontSize: 14,
            color: "rgba(255,255,255,0.5)",
            textAlign: "center",
            maxWidth: 500,
          }}
        >
          An unexpected error occurred in this section. Your data is safe, you
          can try reloading the app.
        </div>

        {error && (
          <pre
            style={{
              fontSize: 12,
              color: "rgba(229,9,20,0.8)",
              background: "rgba(229,9,20,0.06)",
              border: "1px solid rgba(229,9,20,0.2)",
              borderRadius: 8,
              padding: "12px 16px",
              maxWidth: 600,
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {error.message}
          </pre>
        )}

        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              background: "var(--surface, #1a1a1a)",
              border: "1px solid var(--border, rgba(255,255,255,0.1))",
              borderRadius: 8,
              color: "#fff",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
              padding: "10px 22px",
            }}
          >
            Try Again
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "rgba(229,9,20,0.85)",
              border: "none",
              borderRadius: 8,
              color: "#fff",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
              padding: "10px 22px",
            }}
          >
            Reload App
          </button>
        </div>
      </div>
    );
  }
}
