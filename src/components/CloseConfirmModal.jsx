import { Trans, useTranslation } from "react-i18next";
import { DownloadIcon } from "./Icons";

export default function CloseConfirmModal({ count, onConfirm, onCancel }) {
  const { t } = useTranslation();
  return (
    <div className="close-confirm-overlay">
      <div className="close-confirm-modal">
        <div className="close-confirm-icon-wrap">
          <div className="close-confirm-icon-ring">
            <DownloadIcon />
          </div>
        </div>

        <div className="close-confirm-title">
          {t("closeConfirm.title", { count })}
        </div>

        <div className="close-confirm-body">
          <Trans
            i18nKey="closeConfirm.body"
            count={count}
            components={{ count: <span className="close-confirm-count" /> }}
          />
        </div>

        <div className="close-confirm-actions">
          <button className="btn close-confirm-btn-cancel" onClick={onCancel}>
            {t("closeConfirm.keepDownloading")}
          </button>
          <button className="btn close-confirm-btn-confirm" onClick={onConfirm}>
            {t("closeConfirm.cancelAndClose")}
          </button>
        </div>
      </div>
    </div>
  );
}
