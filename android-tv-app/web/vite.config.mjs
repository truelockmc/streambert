// Builds the unmodified Streambert React UI (../../src) for the
// Android TV WebView shell. TV-specific pieces live next to this file:
//   public/tv-shim.js     window.electron replacement (classic script, runs first)
//   tv-main.js            entry: <tv-webview> element + D-pad nav, then the app
// Output goes straight into the Android app's assets.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appSrc = path.resolve(here, "../../src");
const appPublic = path.resolve(here, "../../public");
const nodeModules = path.resolve(here, "node_modules");
const norm = (p) => p.replace(/\\/g, "/");

// Electron's <webview> tag has no Android equivalent and custom element names
// need a hyphen, so the JSX is retargeted at our <tv-webview> element.
const retargetWebview = {
  name: "streambert-tv-webview",
  enforce: "pre",
  transform(code, id) {
    if (!norm(id).startsWith(norm(appSrc))) return null;
    if (!/\.jsx$/.test(id) || !code.includes("<webview")) return null;
    return code
      .replace(/<webview(\s|>)/g, "<tv-webview$1")
      .replace(/<\/webview>/g, "</tv-webview>");
  },
};

// Our publicDir holds tv-shim.js, so copy the app's own public files the UI
// references (Icons.jsx loads ./logo.svg).
const copyAppPublic = {
  name: "streambert-tv-app-public",
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "logo.svg",
      source: fs.readFileSync(path.join(appPublic, "logo.svg")),
    });
  },
};

export default defineConfig({
  root: here,
  base: "./",
  plugins: [retargetWebview, react(), copyAppPublic],
  resolve: {
    // The app source lives outside this package, so point its bare imports
    // at our node_modules.
    alias: [
      { find: /^react-dom(\/.*)?$/, replacement: `${nodeModules}/react-dom$1` },
      { find: /^react(\/.*)?$/, replacement: `${nodeModules}/react$1` },
      { find: /^hls\.js(\/.*)?$/, replacement: `${nodeModules}/hls.js$1` },
    ],
  },
  build: {
    outDir: path.resolve(here, "../app/src/main/assets/www"),
    emptyOutDir: true,
    target: "chrome100",
    minify: "terser",
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          settings: [path.join(appSrc, "pages/SettingsPage")],
          movie: [path.join(appSrc, "pages/MoviePage")],
          tv: [path.join(appSrc, "pages/TVPage")],
          downloads: [path.join(appSrc, "pages/DownloadsPage")],
        },
      },
    },
  },
});
