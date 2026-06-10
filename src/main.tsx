// Earliest possible perf marker — before any module side-effects run.
// Paired with "app:first-paint" in App.tsx; dumped via logBootMetrics().
performance.mark("app:boot");

import { listen as tauriListen } from "@tauri-apps/api/event";
import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/ibm-plex-sans/300.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { App } from "./App";
import { getAetherHost, isTauriRuntime } from "./shared/lib/tauriRuntime";
import { ErrorBoundary } from "./shared/ui/ErrorBoundary";
import "./styles/global.css";

// Disable WebView2 default context menu (browser-like right-click)
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

const setAetherHost = (host: "tauri" | "browser") => {
  document.documentElement.setAttribute("data-aether-host", host);
};
setAetherHost(getAetherHost());

// Default body to focused so the very first frame uses the
// "active" glass alphas. Rust `setup` then emits real focus
// changes via `aether:window-focused` — see `body[data-window-
// focused="false"]` in global.css for the inactive override that
// keeps the panels readable as glass instead of solid slabs when
// the user Alt-Tabs away.
document.body.setAttribute("data-window-focused", "true");
void (async () => {
  if (!isTauriRuntime()) {
    setAetherHost("browser");
    return;
  }
  try {
    const { listen } = await Promise.resolve({ listen: tauriListen });
    setAetherHost("tauri");
    await listen<boolean>("aether:window-focused", (event) => {
      document.body.setAttribute("data-window-focused", event.payload ? "true" : "false");
    });
  } catch {
    setAetherHost("browser");
    // Outside Tauri (vitest / vite preview) we just stay in the
    // "focused" state — nothing emits the event.
  }
})();

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Missing #root element");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

// Mark the document so index.html's `[data-react-mounted="true"]
// #splash` rule fades the splash overlay out. We wait one frame
// so React's first commit lands first — flipping the flag before
// commit would yield a black gap between splash fade-out and the
// real UI showing. Removing the splash node entirely (via
// `transitionend`) keeps the DOM clean afterwards.
requestAnimationFrame(() => {
  document.documentElement.setAttribute("data-react-mounted", "true");
  const splash = document.getElementById("splash");
  if (splash) {
    splash.addEventListener("transitionend", () => splash.parentElement?.removeChild(splash), { once: true });
  }
});
