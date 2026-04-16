import { useEffect } from "react";
import type { Terminal } from "@xterm/xterm";

/**
 * Orphan cleanup for old IME overlay implementations.
 * xterm.js handles IME composition natively via CompositionHelper.
 */
export function useIMEOverlay(
  _term: Terminal | null,
  containerRef: React.RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll<HTMLElement>("[data-ime-input]").forEach((el) => el.remove());
    container.querySelectorAll<HTMLElement>("div[style*='pointer-events: none'][style*='z-index: 100']").forEach((el) => el.remove());
  }, [containerRef]);
}
