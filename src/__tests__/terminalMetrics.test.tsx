import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  measureTerminalCellWidth,
  snapTerminalCssPixel,
  useTerminalCellMetrics,
} from "../features/terminal/terminalMetrics";
import { FALLBACK_TELEMETRY_EVENT, type FallbackTelemetryDetail } from "../shared/lib/fallbackTelemetry";

function collectFallbackEvents() {
  const events: FallbackTelemetryDetail[] = [];
  const listener = (event: Event) => {
    events.push((event as CustomEvent<FallbackTelemetryDetail>).detail);
  };
  window.addEventListener(FALLBACK_TELEMETRY_EVENT, listener);
  return {
    events,
    cleanup: () => window.removeEventListener(FALLBACK_TELEMETRY_EVENT, listener),
  };
}

describe("terminal cell metrics", () => {
  it("snaps measured cell width to physical pixels so canvas glyphs do not land between pixels", () => {
    expect(snapTerminalCssPixel(8.4, 1.25)).toBe(8.8);
    expect(snapTerminalCssPixel(8.4, 1)).toBe(8);

    const originalDpr = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          font: "",
          measureText: () => ({ width: 8.4 }),
        }) as unknown as CanvasRenderingContext2D,
    );

    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 1.25,
    });

    try {
      expect(measureTerminalCellWidth()).toBe(8.8);
    } finally {
      getContextSpy.mockRestore();
      if (originalDpr) {
        Object.defineProperty(window, "devicePixelRatio", originalDpr);
      } else {
        Reflect.deleteProperty(window, "devicePixelRatio");
      }
    }
  });

  it("reports font readiness failures instead of silently keeping stale IME cell metrics", async () => {
    let rejectReady: (err: unknown) => void = () => {};
    const ready = new Promise<unknown>((_resolve, reject) => {
      rejectReady = reject;
    });
    const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        ready,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    const getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          font: "",
          measureText: () => ({ width: 8 }),
        }) as unknown as CanvasRenderingContext2D,
    );
    const telemetry = collectFallbackEvents();

    try {
      renderHook(() => useTerminalCellMetrics());

      await act(async () => {
        rejectReady(new Error("font loader failed"));
        await ready.catch(() => undefined);
      });

      await waitFor(() => {
        expect(telemetry.events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              source: "terminal-metrics",
              operation: "fonts_ready",
              severity: "warning",
              userVisible: true,
            }),
          ]),
        );
      });
    } finally {
      telemetry.cleanup();
      getContextSpy.mockRestore();
      if (originalFonts) {
        Object.defineProperty(document, "fonts", originalFonts);
      } else {
        Reflect.deleteProperty(document, "fonts");
      }
    }
  });
});
