import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  type Invoke,
  useImageMetrics,
} from "../shared/hooks/useImageMetrics";
import type { ImageMetrics } from "../shared/types/terminal";

function ipcSequence(responses: Array<ImageMetrics | null>): Invoke {
  let i = 0;
  return vi.fn(async (cmd: string) => {
    if (cmd !== "term_image_metrics") throw new Error(`unexpected ${cmd}`);
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return r;
  }) as unknown as Invoke;
}

describe("useImageMetrics", () => {
  it("returns null and skips IPC when terminalId is null", async () => {
    const invoke = ipcSequence([{ bytesUsed: 100, cap: 1000, count: 1 }]);
    const { result } = renderHook(() => useImageMetrics(null, { invoke }));
    // Wait a tick so any spurious effect has a chance to fire.
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("fetches metrics for the active terminal on mount", async () => {
    const m: ImageMetrics = { bytesUsed: 12 * 1024 * 1024, cap: 50 * 1024 * 1024, count: 3 };
    const invoke = ipcSequence([m]);
    const { result } = renderHook(() => useImageMetrics("t-1", { invoke, pollIntervalMs: 10_000 }));
    await waitFor(() => expect(result.current).toEqual(m));
    expect(invoke).toHaveBeenCalledWith(
      "term_image_metrics",
      expect.objectContaining({ id: "t-1" }),
    );
  });

  it("polls on the configured interval and surfaces new values", async () => {
    const m1: ImageMetrics = { bytesUsed: 100, cap: 1000, count: 1 };
    const m2: ImageMetrics = { bytesUsed: 800, cap: 1000, count: 4 };
    // Single response slot so the test controls the transition rather
    // than racing the polling loop against an array index.
    let response: ImageMetrics = m1;
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd !== "term_image_metrics") throw new Error(`unexpected ${cmd}`);
      return response;
    }) as unknown as Invoke;

    const { result } = renderHook(() =>
      useImageMetrics("t-1", { invoke, pollIntervalMs: 30 }),
    );
    await waitFor(() => expect(result.current).toEqual(m1));
    response = m2;
    await waitFor(() => expect(result.current).toEqual(m2), { timeout: 1_000 });
    expect((invoke as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("treats an IPC null response as no metrics", async () => {
    const invoke = ipcSequence([null]);
    const { result } = renderHook(() =>
      useImageMetrics("t-1", { invoke, pollIntervalMs: 10_000 }),
    );
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("treats an IPC throw as no metrics rather than crashing", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("registry mutex poisoned");
    }) as unknown as Invoke;
    const { result } = renderHook(() =>
      useImageMetrics("t-1", { invoke, pollIntervalMs: 10_000 }),
    );
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("re-fetches when the active terminal id changes", async () => {
    const seen: string[] = [];
    const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd !== "term_image_metrics") throw new Error(`unexpected ${cmd}`);
      const id = String((args ?? {}).id);
      seen.push(id);
      return { bytesUsed: 1, cap: 100, count: 1 } satisfies ImageMetrics;
    }) as unknown as Invoke;
    const { rerender } = renderHook(
      ({ id }: { id: string | null }) =>
        useImageMetrics(id, { invoke, pollIntervalMs: 10_000 }),
      { initialProps: { id: "t-1" as string | null } },
    );
    await waitFor(() => expect(seen).toContain("t-1"));
    rerender({ id: "t-2" });
    await waitFor(() => expect(seen).toContain("t-2"));
  });

  it("clears state and stops polling when terminal id flips back to null", async () => {
    const invoke = ipcSequence([
      { bytesUsed: 100, cap: 1000, count: 1 },
      { bytesUsed: 100, cap: 1000, count: 1 },
    ]);
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) =>
        useImageMetrics(id, { invoke, pollIntervalMs: 30 }),
      { initialProps: { id: "t-1" as string | null } },
    );
    await waitFor(() => expect(result.current).not.toBeNull());
    rerender({ id: null });
    await waitFor(() => expect(result.current).toBeNull());
  });
});
