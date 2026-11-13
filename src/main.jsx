import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { bootTvMode, fitTvViewport } from "./utils/tvMode";
import { EPISODE_MATCH_SOURCE } from "./utils/episodeMatch";
import "./styles/global.css";

window.__sbEpisodeMatchSource = EPISODE_MATCH_SOURCE;
bootTvMode();
window.addEventListener("resize", fitTvViewport);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
