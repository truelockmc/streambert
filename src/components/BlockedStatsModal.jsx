import { useEffect } from "react";
import { CloseIcon, ShieldBlockIcon } from "./Icons";

/**
 * Modal showing which ad/tracker domains were blocked during the current session
 * and the all-time total blocked count.
 */
export default function BlockedStatsModal({
  sessionDomains,
  sessionTotal,
  alltimeTotal,
  onClose,
}) {
  // Close on Escape
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="blocked-modal-overlay" onClick={onClose}>
      <div className="blocked-modal" onClick={(e) => e.stopPropagation()}>
        <div className="blocked-modal-header">
          <div className="blocked-modal-title">
            <ShieldBlockIcon size={15} />
            Ads &amp; Trackers Blocked
          </div>
          <button
            className="blocked-modal-close"
            onClick={onClose}
            title="Close"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="blocked-modal-subtitle">
          {sessionTotal > 0
            ? `${sessionTotal} ad/tracker request${sessionTotal === 1 ? "" : "s"} blocked this session`
            : "Start playing content to see blocked ads & trackers."}
        </div>

        <div className="blocked-modal-list">
          {sessionDomains.length === 0 ? (
            <div className="blocked-modal-empty">
              No ads or trackers blocked yet, play something to start.
            </div>
          ) : (
            sessionDomains.map(([domain, count]) => (
              <div key={domain} className="blocked-modal-row">
                <span className="blocked-modal-domain">{domain}</span>
                <span className="blocked-modal-count">
                  {count.toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="blocked-modal-footer">
          <ShieldBlockIcon size={13} />
          All-time:&nbsp;
          <strong>
            {alltimeTotal.toLocaleString()} ad &amp; tracker request
            {alltimeTotal === 1 ? "" : "s"}
          </strong>
          &nbsp;blocked
        </div>
      </div>
    </div>
  );
}
