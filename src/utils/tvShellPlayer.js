import { useEffect } from "react";

export function hasTvShellPlayer() {
  return (
    typeof window !== "undefined" &&
    typeof window.StreambertTv?.openPlayer === "function"
  );
}

/** Fire TV shell plays the source in its own WebView. Electron keeps using <webview>. */
export function useTvShellPlayer(url, active) {
  useEffect(() => {
    if (!hasTvShellPlayer()) return undefined;
    if (!active || !url || url === "about:blank") {
      window.StreambertTv.closePlayer();
      return undefined;
    }
    window.StreambertTv.openPlayer(url);
    return () => window.StreambertTv.closePlayer();
  }, [url, active]);
}
