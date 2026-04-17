import { useEffect, useState } from "react";

export type RendererMode = "xterm" | "wgpu" | "native";

const STORAGE_KEY = "aether:renderer";

function readRenderer(): RendererMode {
  // Phase 2 lockdown: both `wgpu` and `native` hang the webview on startup
  // (visual-verification 2026-04-17). Until those paths are diagnosed we
  // hard-pin to `xterm` and normalise any stale localStorage value so users
  // cannot be stranded in a frozen app. Revert this block — and re-enable
  // the Settings dropdown options — once the hangs are fixed.
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    if (val && val !== "xterm") localStorage.setItem(STORAGE_KEY, "xterm");
  } catch {
    /* ignore */
  }
  return "xterm";
}

/**
 * Hook returning the active terminal renderer.
 *
 * - `"xterm"`  — legacy xterm.js renderer (default, stable)
 * - `"wgpu"`   — experimental GPU Canvas renderer (gpu_* commands)
 * - `"native"` — Phase 2 native Rust engine + TerminalCanvas (requires
 *   `AETHER_TERM_NATIVE=1` on the backend; falls back to blank otherwise)
 *
 * Persisted in localStorage under `aether:renderer`; updates propagate via
 * the `storage` event (Settings dispatches a synthetic event after write).
 */
export function useGpuRenderer(): RendererMode {
  const [renderer, setRenderer] = useState<RendererMode>(readRenderer);

  useEffect(() => {
    const handler = () => setRenderer(readRenderer());
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  return renderer;
}
