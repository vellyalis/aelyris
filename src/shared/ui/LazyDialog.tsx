import { type ReactNode, Suspense } from "react";
import { ErrorBoundary } from "./ErrorBoundary";

/**
 * Common wrapper for every code-split dialog (Settings, Watchdog,
 * About, Help, CommandPalette, QuickOpen, PRInspector, WebInspector).
 *
 * Two responsibilities:
 *
 * 1. **Make Suspense visible.** The previous `fallback={null}`
 *    convention meant a chunk that took even ~150 ms to land would
 *    look indistinguishable from a broken click — exactly the
 *    "settings won't open" symptom dogfood reported. A semi-opaque
 *    scrim with a "Loading…" line tells the user the click landed
 *    and the dialog is on its way.
 *
 * 2. **Surface lazy-load errors instead of swallowing them.** A
 *    chunk that fails to fetch (CSP violation, transient network
 *    error in dev, build asset rename) used to fall through to
 *    `null` and the user would see nothing at all. Wrapping in an
 *    `ErrorBoundary` makes the failure render an actionable retry
 *    panel.
 *
 * Both fixes are belt-and-braces: the dialogs themselves should not
 * routinely take >100 ms to chunk-load on a local Tauri build, and
 * the chunks should not routinely fail to fetch. But silent failure
 * is the worst class of UX bug — the user does not know whether
 * they pressed the button correctly, whether the app is hanging,
 * or whether the feature is missing. This wrapper makes the answer
 * always observable.
 */
export function LazyDialog({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingScrim />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function LoadingScrim() {
  return (
    <div
      role="status"
      aria-label="Loading dialog"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--scrim-standard-bg)",
        backdropFilter: "var(--scrim-standard-blur)",
        WebkitBackdropFilter: "var(--scrim-standard-blur)",
        zIndex: "var(--z-overlay)",
        pointerEvents: "auto",
      }}
    >
      <span
        style={{
          color: "var(--text-secondary)",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-md)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        Loading…
      </span>
    </div>
  );
}
