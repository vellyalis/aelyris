import { useState, useEffect } from "react";

/**
 * Hook to check if the GPU terminal renderer is enabled.
 * Returns "wgpu" (Canvas-based GPU renderer) or "xterm" (xterm.js).
 *
 * User can toggle via Settings → "GPU Terminal (Experimental)".
 * Stored in localStorage as "aether:renderer".
 */
export function useGpuRenderer(): "wgpu" | "xterm" {
  const [renderer, setRenderer] = useState<"wgpu" | "xterm">(() => {
    try {
      return (localStorage.getItem("aether:renderer") as "wgpu" | "xterm") ?? "xterm";
    } catch { return "xterm"; }
  });

  useEffect(() => {
    const handler = () => {
      try {
        const val = localStorage.getItem("aether:renderer");
        if (val === "wgpu" || val === "xterm") setRenderer(val);
      } catch { /* ignore */ }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  return renderer;
}
