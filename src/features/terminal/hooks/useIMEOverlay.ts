import { useEffect } from "react";
import type { Terminal } from "@xterm/xterm";

/**
 * Manages IME composition overlay for CJK input in xterm.js.
 * Hides xterm's built-in composition view and shows a custom overlay
 * positioned at the cursor location.
 */
export function useIMEOverlay(
  term: Terminal | null,
  containerRef: React.RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    if (!term || !containerRef.current) return;
    const container = containerRef.current;
    const textarea = term.textarea;
    if (!textarea) return;

    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: absolute; display: none; pointer-events: none; z-index: 100;
      font-family: "IBM Plex Mono", "Cascadia Code", monospace;
      font-size: 14px; line-height: 1.4;
      color: var(--text-primary); background: var(--glass-dense);
      padding: 0 2px; border-radius: 2px;
    `;
    container.style.position = "relative";
    container.appendChild(overlay);

    const getCursorPos = () => {
      const cursor = container.querySelector(".xterm-cursor-layer");
      if (!cursor) return null;
      const style = window.getComputedStyle(cursor);
      return { left: parseInt(style.left || "0"), top: parseInt(style.top || "0") };
    };

    const hideXtermComposition = () => {
      const comp = container.querySelector(".xterm-composition-view") as HTMLElement | null;
      if (comp) comp.style.display = "none";
    };
    const showXtermComposition = () => {
      const comp = container.querySelector(".xterm-composition-view") as HTMLElement | null;
      if (comp) comp.style.display = "";
    };

    const onStart = () => {
      overlay.style.display = "block";
      overlay.textContent = "";
      hideXtermComposition();
    };
    const onUpdate = (e: CompositionEvent) => {
      overlay.textContent = e.data;
      const pos = getCursorPos();
      if (pos) {
        overlay.style.left = `${pos.left}px`;
        overlay.style.top = `${pos.top}px`;
      }
      hideXtermComposition();
    };
    const onEnd = () => {
      overlay.style.display = "none";
      overlay.textContent = "";
      showXtermComposition();
    };

    textarea.addEventListener("compositionstart", onStart);
    textarea.addEventListener("compositionupdate", onUpdate);
    textarea.addEventListener("compositionend", onEnd);

    return () => {
      textarea.removeEventListener("compositionstart", onStart);
      textarea.removeEventListener("compositionupdate", onUpdate);
      textarea.removeEventListener("compositionend", onEnd);
      overlay.remove();
    };
  }, [term, containerRef]);
}
