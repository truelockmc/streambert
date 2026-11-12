import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { bootTvMode, fitTvViewport } from "./utils/tvMode";
import "./styles/global.css";

bootTvMode();
window.addEventListener("resize", fitTvViewport);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
