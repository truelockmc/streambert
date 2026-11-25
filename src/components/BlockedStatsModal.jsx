import { useEffect } from "react";
import { useTranslation, Trans } from "react-i18next";
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
  const { t, i18n } = useTranslation();

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
            {t("blocked.title")}
          </div>
          <button
            className="blocked-modal-close"
            onClick={onClose}
            title={t("common.close")}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="blocked-modal-subtitle">
          {sessionTotal > 0
            ? t("blocked.sessionSummary", { count: sessionTotal })
            : t("blocked.startPlaying")}
        </div>

        <div className="blocked-modal-list">
          {sessionDomains.length === 0 ? (
            <div className="blocked-modal-empty">
              {t("blocked.empty")}
            </div>
          ) : (
            sessionDomains.map(([domain, count]) => (
              <div key={domain} className="blocked-modal-row">
                <span className="blocked-modal-domain">{domain}</span>
                <span className="blocked-modal-count">
                  {count.toLocaleString(i18n.language)}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="blocked-modal-footer">
          <ShieldBlockIcon size={13} />
          <span>
            <Trans
              i18nKey="blocked.alltime"
              count={alltimeTotal}
              values={{ formatted: alltimeTotal.toLocaleString(i18n.language) }}
              components={{ strong: <strong /> }}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
