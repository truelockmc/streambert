import { useState, useEffect } from "react";
import { CloseIcon, DownloadIcon, SettingsIcon } from "./Icons";
import { storage } from "../utils/storage";

export default function DownloadModal({
  onClose,
  m3u8Url,
  mediaName,
  downloaderFolder,
  setDownloaderFolder,
  onOpenSettings,
  onDownloadStarted, // (entry) => void, called when download begins
  // metadata for progress tracking
  mediaId,
  mediaType,
  season,
  episode,
  // TMDB metadata for offline display
  posterPath,
  tmdbId,
}) {
  const [downloadPath, setDownloadPath] = useState(
    () => storage.get("downloadPath") || "",
  );
  const [settingPath, setSettingPath] = useState(false);
  const [downloader, setDownloader] = useState(null);
  const [checking, setChecking] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState(null);

  const isElectron = typeof window !== "undefined" && !!window.electron;

  const ua = navigator.userAgent.toLowerCase();
  const binaryHint = ua.includes("win")
    ? "Windows_x64-portable"
    : ua.includes("mac")
      ? "For MacOS you will have to compile it yourself"
      : "Linux_x64-portable";

  const releaseUrl =
    "https://github.com/truelockmc/video-downloader/releases/latest";

  useEffect(() => {
    if (!downloaderFolder || !isElectron) return;
    setChecking(true);
    window.electron.checkDownloader(downloaderFolder).then((result) => {
      setDownloader(result);
      setChecking(false);
    });
  }, [downloaderFolder]);

  const pickBinaryFolder = async () => {
    const folder = await window.electron.pickFolder();
    if (folder) setDownloaderFolder(folder);
  };

  const pickDownloadFolder = async () => {
    const folder = await window.electron.pickFolder();
    if (folder) {
      setDownloadPath(folder);
      storage.set("downloadPath", folder);
      setSettingPath(false);
    }
  };

  const handleDownload = async () => {
    if (!downloader?.binaryPath || !downloadPath || !m3u8Url) return;
    setDownloadStatus("starting");
    const result = await window.electron.runDownload({
      binaryPath: downloader.binaryPath,
      m3u8Url,
      name: mediaName,
      downloadPath,
      mediaId,
      mediaType,
      season,
      episode,
      posterPath: posterPath || null,
      tmdbId: tmdbId || mediaId || null,
    });
    if (result.ok) {
      if (onDownloadStarted) {
        onDownloadStarted({
          id: result.id,
          name: mediaName,
          m3u8Url,
          downloadPath,
          filePath: null,
          status: "downloading",
          progress: 0,
          speed: "",
          size: "",
          totalFragments: 0,
          lastMessage: "Starting…",
          startedAt: Date.now(),
          completedAt: null,
          mediaId,
          mediaType,
          season,
          episode,
          posterPath: posterPath || null,
          tmdbId: tmdbId || mediaId || null,
        });
      }
      setDownloadStatus("ok");
    } else {
      setDownloadStatus(result.error || "Failed to start");
    }
  };

  // ── No download path → force setup ───────────────────────────────────────
  if (!downloadPath || settingPath) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="download-modal" onClick={(e) => e.stopPropagation()}>
          <div className="download-modal-header">
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <DownloadIcon /> Set Download Folder
            </span>
            <button className="icon-btn" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>
          <div style={{ padding: 24 }}>
            <div
              style={{
                fontSize: 14,
                color: "var(--text2)",
                marginBottom: 20,
                lineHeight: 1.6,
              }}
            >
              {settingPath ? (
                "Choose where downloaded videos should be saved:"
              ) : (
                <>
                  <span style={{ color: "var(--red)", fontWeight: 600 }}>
                    No download folder set.
                  </span>
                  <br />
                  Choose where to save downloaded videos:
                </>
              )}
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
                marginBottom: 16,
              }}
            >
              <input
                className="apikey-input"
                style={{ flex: 1, minWidth: 200, marginBottom: 0 }}
                placeholder="/home/you/Movies"
                value={downloadPath}
                onChange={(e) => setDownloadPath(e.target.value)}
              />
              {isElectron && (
                <button
                  className="btn btn-secondary"
                  onClick={pickDownloadFolder}
                >
                  Browse …
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="btn btn-primary"
                style={{ flex: 1, justifyContent: "center" }}
                disabled={!downloadPath.trim()}
                onClick={() => {
                  storage.set("downloadPath", downloadPath.trim());
                  setSettingPath(false);
                }}
              >
                Confirm
              </button>
              {settingPath && (
                <button
                  className="btn btn-ghost"
                  onClick={() => setSettingPath(false)}
                >
                  Cancel
                </button>
              )}
            </div>
            {onOpenSettings && (
              <div style={{ marginTop: 14, textAlign: "center" }}>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, color: "var(--text3)" }}
                  onClick={() => {
                    onClose();
                    onOpenSettings();
                  }}
                >
                  <SettingsIcon /> Open Settings
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Main modal ────────────────────────────────────────────────────────────
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="download-modal" onClick={(e) => e.stopPropagation()}>
        <div className="download-modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <DownloadIcon /> Download
          </span>
          <button className="icon-btn" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        {!m3u8Url && (
          <div className="download-waiting">
            <div
              className="spinner"
              style={{ width: 24, height: 24, borderWidth: 2 }}
            />
            Waiting for stream URL … (start the video first)
          </div>
        )}

        {m3u8Url && (
          <>
            <div className="download-url-block">
              <div className="download-url-label">Stream URL found</div>
              <code className="download-url-code">{m3u8Url}</code>
            </div>

            {!downloader?.exists && (
              <div className="download-instructions">
                <div className="download-instructions-title">
                  Set up Video Downloader
                </div>
                <ol className="download-steps">
                  <li>
                    Download the latest release from{" "}
                    <a
                      className="download-link"
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        isElectron && window.electron.openExternal(releaseUrl);
                      }}
                    >
                      github.com/truelockmc/video-downloader
                    </a>{" "}
                    , for your OS: <code>{binaryHint}</code>
                  </li>
                  <li>Extract the release into a folder of your choice</li>
                  <li>
                    Select that folder below, it must contain{" "}
                    <code>_internal</code> and the binary
                  </li>
                </ol>
                <div className="download-folder-row">
                  <button
                    className="btn btn-secondary"
                    onClick={pickBinaryFolder}
                  >
                    Choose folder …
                  </button>
                  {downloaderFolder && (
                    <span className="download-folder-path">
                      {downloaderFolder}
                    </span>
                  )}
                </div>
                {checking && (
                  <div className="download-checking">
                    <div
                      className="spinner"
                      style={{ width: 16, height: 16, borderWidth: 2 }}
                    />{" "}
                    Checking …
                  </div>
                )}
                {!checking &&
                  downloader &&
                  !downloader.exists &&
                  downloaderFolder && (
                    <div className="download-error">
                      No binary found. Make sure <code>_internal</code> and the
                      binary are inside the chosen folder.
                    </div>
                  )}
              </div>
            )}

            {downloader?.exists && (
              <div className="download-ready">
                <div className="download-found-badge">
                  ✓ Video Downloader found
                </div>

                {/* Wrong binary folder */}
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    marginBottom: 14,
                  }}
                >
                  <span style={{ fontSize: 12, color: "var(--text3)" }}>
                    Wrong binary folder?
                  </span>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: "4px 10px", fontSize: 12 }}
                    onClick={pickBinaryFolder}
                  >
                    Change
                  </button>
                </div>

                {downloadStatus !== "ok" && (
                  <button
                    className="btn btn-primary"
                    onClick={handleDownload}
                    disabled={downloadStatus === "starting"}
                    style={{ width: "100%", justifyContent: "center" }}
                  >
                    <DownloadIcon />
                    {downloadStatus === "starting"
                      ? "Starting …"
                      : "Start Download"}
                  </button>
                )}

                {downloadStatus === "ok" && (
                  <div style={{ textAlign: "center", padding: "12px 0" }}>
                    <div
                      className="download-success"
                      style={{ fontSize: 15, marginBottom: 8 }}
                    >
                      ✓ Download started!
                    </div>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 13 }}
                      onClick={onClose}
                    >
                      Close — track progress in Downloads
                    </button>
                  </div>
                )}
                {downloadStatus &&
                  downloadStatus !== "ok" &&
                  downloadStatus !== "starting" && (
                    <div className="download-error">{downloadStatus}</div>
                  )}

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    marginTop: 14,
                  }}
                >
                  <span style={{ fontSize: 12, color: "var(--text3)" }}>
                    Save to: <code>{downloadPath}</code>
                  </span>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: "4px 10px", fontSize: 12 }}
                    onClick={() => setSettingPath(true)}
                  >
                    Change
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
