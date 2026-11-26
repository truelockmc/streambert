import { useState } from "react";
import { secureStorage, STORAGE_KEYS } from "../utils/storage";

export default function WyzieKeyModal({ onDone, onSkip }) {
  const [manualKey, setManualKey] = useState("");
  const [phase, setPhase] = useState("prompt");
  const [errorMsg, setErrorMsg] = useState("");

  const isElectron = typeof window !== "undefined" && !!window.electron;

  const saveAndFinish = async (key) => {
    await secureStorage.set(STORAGE_KEYS.WYZIE_API_KEY, key.trim());
    setPhase("success");
    setTimeout(() => onDone(key.trim()), 1000);
  };

  const handleManualSubmit = async () => {
    const key = manualKey.trim();
    if (!key) return;
    setPhase("validating");
    setErrorMsg("");
    try {
      const res = isElectron
        ? await window.electron.wyzieValidateKey(key)
        : { ok: true };
      if (res.ok) {
        await saveAndFinish(key);
      } else {
        setPhase("manual");
        setErrorMsg(res.error || "Invalid key, please try again.");
      }
    } catch (e) {
      setPhase("manual");
      setErrorMsg(e.message);
    }
  };

  const handleRedeem = async () => {
    if (!isElectron) return;
    setPhase("redeeming");
    setErrorMsg("");
    try {
      const res = await window.electron.wyzieOpenRedeem();
      if (res.cancelled) {
        setPhase("prompt");
        return;
      }
      if (res.timeout) {
        setPhase("timeout");
        return;
      }
      if (res.ok && res.key) {
        await saveAndFinish(res.key);
      } else {
        setPhase("prompt");
        setErrorMsg("Could not extract API key. Please copy it manually.");
      }
    } catch (e) {
      setPhase("prompt");
      setErrorMsg(e.message);
    }
  };

  const cardStyle = {
    background: "var(--bg2)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: "28px 32px",
    width: 440,
    maxWidth: "90vw",
    boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => e.target === e.currentTarget && onSkip()}
    >
      <div style={cardStyle}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: "rgba(180,130,255,0.15)",
              border: "1px solid rgba(180,130,255,0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              flexShrink: 0,
            }}
          >
            🔑
          </div>
          <div>
            <div
              style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}
            >
              Wyzie Subs requires an API key
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
              Free, no account required
            </div>
          </div>
        </div>

        {(phase === "prompt" || phase === "error") && (
          <>
            <div
              style={{
                fontSize: 13,
                color: "var(--text3)",
                lineHeight: 1.65,
                marginBottom: 22,
              }}
            >
              Wyzie Subs now requires a free API key. Claim one instantly by
              solving a quick captcha, no registration needed.
              {errorMsg && (
                <div
                  style={{
                    marginTop: 10,
                    padding: "8px 12px",
                    borderRadius: 6,
                    background: "rgba(255,80,80,0.1)",
                    border: "1px solid rgba(255,80,80,0.25)",
                    color: "#ff6060",
                    fontSize: 12,
                  }}
                >
                  {errorMsg}
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                className="btn btn-primary"
                style={{ width: "100%", padding: "10px 0", fontSize: 13 }}
                onClick={handleRedeem}
              >
                Get free key — opens redeem page
              </button>
              <button
                className="btn btn-ghost"
                style={{ width: "100%", padding: "9px 0", fontSize: 13 }}
                onClick={() => {
                  setPhase("manual");
                  setErrorMsg("");
                }}
              >
                I already have a key — enter manually
              </button>
              <button
                className="btn btn-ghost"
                style={{
                  width: "100%",
                  padding: "8px 0",
                  fontSize: 12,
                  color: "var(--text3)",
                }}
                onClick={onSkip}
              >
                Skip — use without subtitles
              </button>
            </div>
          </>
        )}

        {phase === "manual" && (
          <>
            <div
              style={{
                fontSize: 13,
                color: "var(--text3)",
                marginBottom: 14,
                lineHeight: 1.6,
              }}
            >
              Paste your Wyzie API key below. It looks like{" "}
              <code style={{ color: "var(--text)", fontSize: 11 }}>
                wyzie-xxxxxxxxxxxxxxxx
              </code>
            </div>
            <input
              className="apikey-input"
              style={{
                width: "100%",
                marginBottom: 10,
                boxSizing: "border-box",
              }}
              type="text"
              placeholder="wyzie-..."
              value={manualKey}
              onChange={(e) => setManualKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleManualSubmit()}
              autoFocus
            />
            {errorMsg && (
              <div
                style={{
                  marginBottom: 10,
                  padding: "7px 10px",
                  borderRadius: 6,
                  background: "rgba(255,80,80,0.1)",
                  border: "1px solid rgba(255,80,80,0.25)",
                  color: "#ff6060",
                  fontSize: 12,
                }}
              >
                {errorMsg}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: "7px 14px" }}
                onClick={() => {
                  setPhase("prompt");
                  setErrorMsg("");
                }}
              >
                Back
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1, fontSize: 13, padding: "8px 0" }}
                onClick={handleManualSubmit}
                disabled={!manualKey.trim()}
              >
                Confirm & validate
              </button>
            </div>
          </>
        )}

        {phase === "redeeming" && (
          <div
            style={{
              textAlign: "center",
              padding: "24px 0",
              color: "var(--text3)",
              fontSize: 13,
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 12 }}>🌐</div>
            <div
              style={{ color: "var(--text)", fontWeight: 600, marginBottom: 6 }}
            >
              Complete the captcha in the popup window
            </div>
            Please wait — key will be saved automatically…
          </div>
        )}

        {phase === "validating" && (
          <div
            style={{
              textAlign: "center",
              padding: "24px 0",
              color: "var(--text3)",
              fontSize: 13,
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 12 }}>⏳</div>
            Validating key…
          </div>
        )}

        {phase === "success" && (
          <div
            style={{
              textAlign: "center",
              padding: "24px 0",
              color: "#63cab7",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 10 }}>✅</div>
            API key saved! Loading subtitles…
          </div>
        )}

        {phase === "timeout" && (
          <>
            <div
              style={{
                textAlign: "center",
                padding: "20px 0 16px",
                color: "var(--text3)",
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 10 }}>⏱️</div>
              No key received within 10 seconds.
              <br />
              The captcha may not have been completed, or the redirect failed.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                className="btn btn-primary"
                style={{ width: "100%", padding: "9px 0", fontSize: 13 }}
                onClick={handleRedeem}
              >
                Try again
              </button>
              <button
                className="btn btn-ghost"
                style={{ width: "100%", padding: "9px 0", fontSize: 13 }}
                onClick={() => {
                  setPhase("manual");
                  setErrorMsg("");
                }}
              >
                Enter key manually
              </button>
              <button
                className="btn btn-ghost"
                style={{
                  width: "100%",
                  padding: "8px 0",
                  fontSize: 12,
                  color: "var(--text3)",
                }}
                onClick={onSkip}
              >
                Skip
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
