/**
 * Device-pixel geometry helpers for the terminal canvas backing store.
 *
 * Pure (modulo a single window read for DPR) and extracted from TerminalCanvas
 * so the integer-bitmap / CSS-size maths is unit-testable and the renderer
 * keeps shrinking toward the 800-line budget. Keeping the backing store an
 * exact integer multiple of the CSS size avoids WebView2 rescaling the painted
 * bitmap (the classic "terminal text looks soft even though the font is fine"
 * failure mode).
 */
const MAX_CANVAS_DEVICE_PIXEL_RATIO = 4;

export function currentCanvasDevicePixelRatio(): number {
  if (typeof window === "undefined") return 1;
  const ratio = Number(window.devicePixelRatio);
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return Math.min(MAX_CANVAS_DEVICE_PIXEL_RATIO, Math.max(1, ratio));
}

export function snapCanvasTextCoord(value: number, devicePixelRatio: number): number {
  if (!Number.isFinite(value)) return value;
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return value;
  return Math.round(value * devicePixelRatio) / devicePixelRatio;
}

export function canvasBitmapSize(cssSize: number, devicePixelRatio: number): number {
  if (!Number.isFinite(cssSize) || cssSize <= 0) return 1;
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return Math.ceil(cssSize);
  return Math.max(1, Math.ceil(cssSize * devicePixelRatio));
}

export function canvasCssSize(bitmapSize: number, devicePixelRatio: number): number {
  if (!Number.isFinite(bitmapSize) || bitmapSize <= 0) return 1;
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return bitmapSize;
  return bitmapSize / devicePixelRatio;
}
