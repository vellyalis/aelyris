// Earliest possible perf marker — before any module side-effects run.
// Paired with "app:first-paint" in App.tsx; dumped via logBootMetrics().
performance.mark("app:boot");

import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/ibm-plex-sans/300.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { ErrorBoundary } from "./shared/ui/ErrorBoundary";
import { App } from "./App";
import "./styles/global.css";

// Disable WebView2 default context menu (browser-like right-click)
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

