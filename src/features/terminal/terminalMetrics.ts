import { useEffect, useMemo, useState } from "react";

export const TERMINAL_FONT_SIZE = 14;
export const TERMINAL_FONT_FAMILY =
  "'IBM Plex Mono', 'Cascadia Code', 'BIZ UDGothic', 'Yu Gothic UI', 'Meiryo', 'Noto Sans Mono CJK JP', monospace";

export interface TerminalCellMetrics {
  width: number;
  height: number;
}

export function measureTerminalCellWidth(
  fontSize: number = TERMINAL_FONT_SIZE,
  fontFamily: string = TERMINAL_FONT_FAMILY,
): number {
  const fallback = fontSize * 0.6;
  if (typeof document === "undefined") return fallback;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return fallback;
  ctx.font = `${fontSize}px ${fontFamily}`;
  const measured = ctx.measureText("M").width;
  return measured > 0 ? measured : fallback;
}

export function terminalCellHeight(fontSize: number = TERMINAL_FONT_SIZE): number {
  return Math.round(fontSize * 1.25);
}

export function measureTerminalCellMetrics(
  fontSize: number = TERMINAL_FONT_SIZE,
  fontFamily: string = TERMINAL_FONT_FAMILY,
): TerminalCellMetrics {
  return {
    width: measureTerminalCellWidth(fontSize, fontFamily),
    height: terminalCellHeight(fontSize),
  };
}

export function useTerminalCellMetrics(
  fontSize: number = TERMINAL_FONT_SIZE,
  fontFamily: string = TERMINAL_FONT_FAMILY,
): TerminalCellMetrics {
  const [fontEpoch, setFontEpoch] = useState(0);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const fonts = document.fonts;
    if (!fonts) return;

    let cancelled = false;
    const refresh = () => {
      if (!cancelled) setFontEpoch((epoch) => epoch + 1);
    };

    void fonts.ready.then(refresh).catch(() => {});
    fonts.addEventListener?.("loadingdone", refresh);
    return () => {
      cancelled = true;
      fonts.removeEventListener?.("loadingdone", refresh);
    };
  }, []);

  return useMemo(() => measureTerminalCellMetrics(fontSize, fontFamily), [fontSize, fontFamily, fontEpoch]);
}
