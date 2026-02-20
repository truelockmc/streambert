import { useState, useEffect, useRef } from "react";
import { StreambertLogo, PlayIcon } from "./Icons";

const TMDB_BASE = "https://api.themoviedb.org/3";

async function validateToken(token) {
  // Step 1: Can we reach TMDB at all?
  try {
    const pingRes = await fetch(`${TMDB_BASE}/configuration`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(7000),
    });

    // TMDB is reachable — now check the response
    if (pingRes.status === 401) {
      return { ok: false, reason: "invalid_token" };
    }
    if (pingRes.status === 403) {
      return { ok: false, reason: "forbidden" };
    }
    if (!pingRes.ok) {
      return { ok: false, reason: "tmdb_error", status: pingRes.status };
    }

    // Step 2: Run a real content request to confirm full API access
    const testRes = await fetch(`${TMDB_BASE}/trending/movie/week`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(7000),
    });
    if (!testRes.ok) {
      return { ok: false, reason: "api_error", status: testRes.status };
    }

    return { ok: true };
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    // Network failure — TMDB not reachable
    return { ok: false, reason: "unreachable" };
  }
}

function errorMessage(reason, status) {
  switch (reason) {
    case "invalid_token":
      return {
        title: "Invalid token",
        body: "TMDB rejected the token (401 Unauthorized). Make sure you copied the long JWT Read Access Token, not the shorter API Key.",
      };
    case "forbidden":
      return {
        title: "Access denied",
        body: "TMDB returned 403 Forbidden. Your account may be suspended or the token may have been revoked.",
      };
    case "timeout":
      return {
        title: "Request timed out",
        body: "TMDB took too long to respond. Check your internet connection and try again.",
      };
    case "unreachable":
      return {
        title: "Cannot reach TMDB",
        body: "No connection to api.themoviedb.org. Check your internet connection.",
      };
    default:
      return {
        title: "Something went wrong",
        body: `TMDB returned an unexpected error${status ? ` (HTTP ${status})` : ""}. Try again in a moment.`,
      };
  }
}

export default function SetupScreen({ onSave, onSkip }) {
  const [key, setKey] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null); // { title, body }
  const inputRef = useRef(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      window.focus();
      inputRef.current?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, []);

  const handleSubmit = async () => {
    const token = key.trim();
    if (!token) return;
    setChecking(true);
    setError(null);
    const result = await validateToken(token);
    setChecking(false);
    if (result.ok) {
      onSave(token);
    } else {
      setError(errorMessage(result.reason, result.status));
    }
  };

  return (
    <div className="apikey-modal">
      <div className="apikey-box">
        <div className="apikey-logo">
          <StreambertLogo />
        </div>
        <div className="apikey-title">STREAMBERT</div>
        <p className="apikey-sub">
          Enter your <strong>free</strong> TMDB{" "}
          <strong>Read Access Token</strong> to get started.
          <br />
          Go to{" "}
          <a
            className="apikey-link"
            href="https://www.themoviedb.org/settings/api"
            target="_blank"
            rel="noreferrer"
          >
            themoviedb.org → Settings → API
          </a>{" "}
          and copy the <em>API Read Access Token</em> (the long JWT, not the
          shorter API Key below).
        </p>
        <input
          className={`apikey-input${error ? " apikey-input-error" : ""}`}
          placeholder="Paste your TMDB Read Access Token (eyJ...)..."
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && !checking && handleSubmit()}
          ref={inputRef}
          disabled={checking}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            borderColor: error ? "#f44336" : focused ? "var(--red)" : undefined,
          }}
        />

        {error && (
          <div className="apikey-error-box">
            <div className="apikey-error-title">⚠ {error.title}</div>
            <div className="apikey-error-body">{error.body}</div>
          </div>
        )}

        <button
          className="btn btn-primary"
          style={{
            width: "100%",
            justifyContent: "center",
            padding: "13px",
            marginTop: error ? 0 : undefined,
          }}
          onClick={handleSubmit}
          disabled={!key.trim() || checking}
        >
          {checking ? (
            <>
              <span className="apikey-spinner" /> Checking…
            </>
          ) : (
            <>
              <PlayIcon /> Let's go
            </>
          )}
        </button>

        {onSkip && (
          <button
            onClick={onSkip}
            style={{
              marginTop: 14,
              background: "none",
              border: "none",
              color: "var(--text3)",
              fontSize: 13,
              cursor: "pointer",
              padding: "6px 0",
              width: "100%",
              textAlign: "center",
              transition: "color 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text2)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text3)")}
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}
