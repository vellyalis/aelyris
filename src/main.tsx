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
import { App } from "./App";
import { ErrorBoundary } from "./shared/ui/ErrorBoundary";
import "./styles/global.css";

// Disable WebView2 default context menu (browser-like right-click)
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

// Default body to focused so the very first frame uses the
// "active" glass alphas. Rust `setup` then emits real focus
// changes via `aether:window-focused` — see `body[data-window-
// focused="false"]` in global.css for the inactive override that
// keeps the panels readable as glass instead of solid slabs when
// the user Alt-Tabs away.
document.body.setAttribute("data-window-focused", "true");
void (async () => {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<boolean>("aether:window-focused", (event) => {
      document.body.setAttribute(
        "data-window-focused",
        event.payload ? "true" : "false",
      );
    });
  } catch {
    // Outside Tauri (vitest / vite preview) we just stay in the
    // "focused" state — nothing emits the event.
  }
})();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
