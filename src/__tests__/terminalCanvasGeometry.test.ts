import { afterEach, describe, expect, it } from "vitest";
import {
  canvasBitmapSize,
  canvasCssSize,
  currentCanvasDevicePixelRatio,
  snapCanvasTextCoord,
} from "../features/terminal/terminalCanvasGeometry";

function setDevicePixelRatio(value: number): void {
  Object.defineProperty(window, "devicePixelRatio", { value, configurable: true });
}

describe("canvasBitmapSize", () => {
  it("scales the CSS size up to an integer backing-store size", () => {
    expect(canvasBitmapSize(100, 2)).toBe(200);
    expect(canvasBitmapSize(100, 1)).toBe(100);
    expect(canvasBitmapSize(10.3, 2)).toBe(21); // ceil(20.6)
  });

  it("guards against non-positive inputs", () => {
    expect(canvasBitmapSize(0, 2)).toBe(1);
    expect(canvasBitmapSize(-5, 2)).toBe(1);
    expect(canvasBitmapSize(100, 0)).toBe(100); // dpr invalid -> ceil(cssSize)
  });
});

describe("canvasCssSize", () => {
  it("is the exact inverse of the bitmap scale", () => {
    expect(canvasCssSize(200, 2)).toBe(100);
    expect(canvasCssSize(canvasBitmapSize(100, 2), 2)).toBe(100);
  });

  it("guards against non-positive inputs", () => {
    expect(canvasCssSize(0, 2)).toBe(1);
    expect(canvasCssSize(200, 0)).toBe(200);
  });
});

describe("snapCanvasTextCoord", () => {
  it("snaps a coordinate to the device-pixel grid", () => {
    expect(snapCanvasTextCoord(10.3, 2)).toBe(10.5); // round(20.6)/2 = 21/2
    expect(snapCanvasTextCoord(10, 1)).toBe(10);
  });

  it("passes through non-finite values and invalid ratios untouched", () => {
    expect(snapCanvasTextCoord(Number.NaN, 2)).toBeNaN();
    expect(snapCanvasTextCoord(10.3, 0)).toBe(10.3);
  });
});

describe("currentCanvasDevicePixelRatio", () => {
  afterEach(() => setDevicePixelRatio(1));

  it("returns the window ratio within bounds", () => {
    setDevicePixelRatio(1.5);
    expect(currentCanvasDevicePixelRatio()).toBe(1.5);
  });

  it("clamps to the [1, 4] range and floors invalid ratios to 1", () => {
    setDevicePixelRatio(10);
    expect(currentCanvasDevicePixelRatio()).toBe(4);
    setDevicePixelRatio(0);
    expect(currentCanvasDevicePixelRatio()).toBe(1);
    setDevicePixelRatio(Number.NaN);
    expect(currentCanvasDevicePixelRatio()).toBe(1);
  });
});
