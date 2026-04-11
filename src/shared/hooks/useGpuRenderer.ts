import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Hook to check if the GPU terminal renderer is enabled.
 * Returns "wgpu" or "xterm" based on the Rust feature flag.
 */
export function useGpuRenderer(): "wgpu" | "xterm" {
  const [renderer, setRenderer] = useState<"wgpu" | "xterm">("xterm");

  useEffect(() => {
    invoke<string>("get_terminal_renderer")
      .then((mode) => {
        if (mode === "wgpu") {
          setRenderer("wgpu");
        }
      })
      .catch(() => {
        // Fallback to xterm if command not available
        setRenderer("xterm");
      });
  }, []);

  return renderer;
}
