import { useEffect, useMemo, useState } from "react";
import { formatFallbackError, reportFallback } from "../../shared/lib/fallbackTelemetry";

export const TERMINAL_FONT_SIZE = 14;
export const TERMINAL_LINE_HEIGHT = 1.25;
export const TERMINAL_FONT_FAMILY =
  "'Cascadia Code', 'Cascadia Mono', 'Cascadia Next JP', 'BIZ UDGothic', 'Yu Gothic UI', 'Meiryo', 'Noto Sans Mono CJK JP', 'IBM Plex Mono', monospace";

export interface TerminalCellMetrics {
  width: number;
  height: number;
}

export function currentTerminalDevicePixelRatio(): number {
  if (typeof window === "undefined") return 1;
  const ratio = Number(window.devicePixelRatio);
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return ratio;
}

export function snapTerminalCssPixel(value: number, devicePixelRatio = currentTerminalDevicePixelRatio()): number {
  if (!Number.isFinite(value) || value <= 0) return value;
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return value;
  return Math.max(1, Math.round(value * devicePixelRatio) / devicePixelRatio);
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
  return snapTerminalCssPixel(measured > 0 ? measured : fallback);
}

export function terminalCellHeight(
  fontSize: number = TERMINAL_FONT_SIZE,
  lineHeight: number = TERMINAL_LINE_HEIGHT,
): number {
  const multiplier = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : TERMINAL_LINE_HEIGHT;
  return Math.round(fontSize * multiplier);
}

export function measureTerminalCellMetrics(
  fontSize: number = TERMINAL_FONT_SIZE,
  fontFamily: string = TERMINAL_FONT_FAMILY,
  lineHeight: number = TERMINAL_LINE_HEIGHT,
): TerminalCellMetrics {
  return {
    width: measureTerminalCellWidth(fontSize, fontFamily),
    height: terminalCellHeight(fontSize, lineHeight),
  };
}

export function useTerminalCellMetrics(
  fontSize: number = TERMINAL_FONT_SIZE,
  fontFamily: string = TERMINAL_FONT_FAMILY,
  lineHeight: number = TERMINAL_LINE_HEIGHT,
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

    void fonts.ready.then(refresh).catch((err) => {
      reportFallback(
        {
          source: "terminal-metrics",
          operation: "fonts_ready",
          severity: "warning",
          message: `Terminal font readiness failed; cell metrics may use fallback sizing. ${formatFallbackError(err)}`,
          userVisible: true,
        },
        { throttleMs: 10_000 },
      );
    });
    fonts.addEventListener?.("loadingdone", refresh);
    return () => {
      cancelled = true;
      fonts.removeEventListener?.("loadingdone", refresh);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: fontEpoch retriggers measurement once async font loads change glyph widths.
  return useMemo(
    () => measureTerminalCellMetrics(fontSize, fontFamily, lineHeight),
    [fontSize, fontFamily, lineHeight, fontEpoch],
  );
}
