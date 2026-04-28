import { renderHook, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  type CreateImageBitmap,
  type Invoke,
  useTerminalImages,
} from "../shared/hooks/useTerminalImages";
import type { ImageRef } from "../shared/types/terminal";

// jsdom does not provide a constructible ImageData. The hook only
// passes the instance straight through to `createImageBitmap`, so a
// minimal stand-in carrying width/height/data is enough for the test.
beforeAll(() => {
  if (typeof globalThis.ImageData === "undefined") {
    class StubImageData {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      colorSpace: PredefinedColorSpace = "srgb";
      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    }
    (globalThis as { ImageData?: typeof ImageData }).ImageData =
      StubImageData as unknown as typeof ImageData;
  }
});

interface RawImageData {
  format: "png" | "rgba8";
  dataBase64: string;
  widthPx: number;
  heightPx: number;
}

function makeBitmap(label: string): ImageBitmap {
  // Minimal stand-in. Tests only need identity and a `close` spy.
  return {
    width: 0,
    height: 0,
    close: vi.fn(),
    // Tag with a label so assertions can distinguish bitmaps without
    // relying on the (untyped) input source.
    __label: label,
  } as unknown as ImageBitmap;
}

function makeFactory(byId: Record<string, ImageBitmap>): CreateImageBitmap {
  // The factory dispatches by the dataBase64 contents we baked into
  // each invoke response — keeps the test decoupled from real PNG /
  // RGBA bytes.
  let calls = 0;
  return vi.fn(async (source: ImageBitmapSource) => {
    calls++;
    if (source instanceof Blob) {
      const buf = new Uint8Array(await source.arrayBuffer());
      const tag = new TextDecoder().decode(buf);
      return byId[tag] ?? makeBitmap(`png-${calls}`);
    }
    if ((source as ImageData).data) {
      // ImageData branch — return a deterministic bitmap so callers can
      // assert "we made one for this id".
      return byId.rgba ?? makeBitmap(`rgba-${calls}`);
    }
    return makeBitmap(`unknown-${calls}`);
  });
}

function ipcReturning(map: Record<number, RawImageData>): Invoke {
  return vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd !== "term_image_data") throw new Error(`unexpected ${cmd}`);
    const id = Number((args ?? {}).imageId);
    return map[id] ?? null;
  }) as unknown as Invoke;
}

const ref = (id: number, overrides: Partial<ImageRef> = {}): ImageRef => ({
  id,
  cellRow: 0,
  cellCol: 0,
  widthPx: 1,
  heightPx: 1,
  ...overrides,
});

describe("useTerminalImages", () => {
  it("returns an empty map when terminal id is null", async () => {
    const invoke = ipcReturning({});
    const factory = makeFactory({});
    const { result } = renderHook(() =>
      useTerminalImages(null, [ref(1)], { invoke, createImageBitmap: factory }),
    );
    await waitFor(() => expect(result.current.size).toBe(0));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns an empty map for an empty image list", async () => {
    const invoke = ipcReturning({});
    const factory = makeFactory({});
    const { result } = renderHook(() =>
      useTerminalImages("t-1", [], { invoke, createImageBitmap: factory }),
    );
    await waitFor(() => expect(result.current.size).toBe(0));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("fetches and caches PNG bitmaps by id", async () => {
    const png42 = makeBitmap("png-42");
    const factory = makeFactory({ "id-42": png42 });
    const invoke = ipcReturning({
      42: {
        format: "png",
        dataBase64: btoa("id-42"),
        widthPx: 10,
        heightPx: 4,
      },
    });
    const { result } = renderHook(() =>
      useTerminalImages("t-1", [ref(42)], { invoke, createImageBitmap: factory }),
    );
    await waitFor(() => expect(result.current.size).toBe(1));
    expect(result.current.get(42)).toBe(png42);
    expect(invoke).toHaveBeenCalledWith(
      "term_image_data",
      expect.objectContaining({ id: "t-1", imageId: 42 }),
    );
  });

  it("does not re-fetch an id that is already cached", async () => {
    const factory = makeFactory({});
    const invoke = ipcReturning({
      7: { format: "png", dataBase64: btoa("hi"), widthPx: 1, heightPx: 1 },
    });
    const { result, rerender } = renderHook(
      ({ refs }: { refs: ImageRef[] }) =>
        useTerminalImages("t-1", refs, { invoke, createImageBitmap: factory }),
      { initialProps: { refs: [ref(7)] } },
    );
    await waitFor(() => expect(result.current.size).toBe(1));
    expect(invoke).toHaveBeenCalledTimes(1);
    // Re-render with the same id — must not refetch.
    rerender({ refs: [ref(7, { cellCol: 5 })] });
    await waitFor(() => expect(result.current.get(7)).toBeDefined());
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("evicts bitmaps for ids no longer in the snapshot and calls close()", async () => {
    const bmp1 = makeBitmap("a");
    const factory = makeFactory({ a: bmp1 });
    const invoke = ipcReturning({
      1: { format: "png", dataBase64: btoa("a"), widthPx: 1, heightPx: 1 },
    });
    const { result, rerender } = renderHook(
      ({ refs }: { refs: ImageRef[] }) =>
        useTerminalImages("t-1", refs, { invoke, createImageBitmap: factory }),
      { initialProps: { refs: [ref(1)] } },
    );
    await waitFor(() => expect(result.current.size).toBe(1));
    rerender({ refs: [] });
    await waitFor(() => expect(result.current.size).toBe(0));
    expect(bmp1.close).toHaveBeenCalled();
  });

  it("treats an IPC null response as 'skip this image'", async () => {
    const factory = makeFactory({});
    const invoke = ipcReturning({}); // returns null for everything
    const { result } = renderHook(() =>
      useTerminalImages("t-1", [ref(99)], { invoke, createImageBitmap: factory }),
    );
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    // Cache stays empty — paint pass will skip the entry.
    expect(result.current.size).toBe(0);
  });

  it("treats an IPC throw as 'skip this image' rather than crashing", async () => {
    const factory = makeFactory({});
    const invoke = vi.fn(async () => {
      throw new Error("registry mutex poisoned");
    }) as unknown as Invoke;
    const { result } = renderHook(() =>
      useTerminalImages("t-1", [ref(5)], { invoke, createImageBitmap: factory }),
    );
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(result.current.size).toBe(0);
  });

  it("materialises an RGBA8 payload via ImageData", async () => {
    const rgbaBitmap = makeBitmap("rgba");
    const factory = makeFactory({ rgba: rgbaBitmap });
    // 2x1 RGBA = 8 bytes. base64 of [0,0,0,255, 255,255,255,255]
    const rgbaBytes = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]);
    const dataBase64 = btoa(String.fromCharCode(...rgbaBytes));
    const invoke = ipcReturning({
      11: { format: "rgba8", dataBase64, widthPx: 2, heightPx: 1 },
    });
    const { result } = renderHook(() =>
      useTerminalImages("t-1", [ref(11)], { invoke, createImageBitmap: factory }),
    );
    await waitFor(() => expect(result.current.size).toBe(1));
    expect(result.current.get(11)).toBe(rgbaBitmap);
  });

  it("does not re-fetch when only image positions change (id-set stable)", async () => {
    // Race contract: the producer (`applyDiff` in `useTerminalSnapshot`)
    // returns a fresh `images` array on every full=true diff and on every
    // partial whose image set changed. A consumer that re-runs its effect
    // every render would issue a new fetch on every full=true frame, then
    // cancel it on the next, and the image would never appear. The hook
    // must stabilise on id-set so position-only churn doesn't invalidate
    // the in-flight fetch.
    const png = makeBitmap("ok");
    const factory = makeFactory({ a: png });
    const invoke = ipcReturning({
      9: { format: "png", dataBase64: btoa("a"), widthPx: 1, heightPx: 1 },
    });
    const { result, rerender } = renderHook(
      ({ refs }: { refs: ImageRef[] }) =>
        useTerminalImages("t-1", refs, { invoke, createImageBitmap: factory }),
      { initialProps: { refs: [ref(9, { cellRow: 0, cellCol: 0 })] } },
    );
    await waitFor(() => expect(result.current.size).toBe(1));
    expect(invoke).toHaveBeenCalledTimes(1);
    // Re-render N times with the same id but a *new array reference* and
    // shifted positions, simulating diff-driven snapshot churn. The
    // bitmap stays cached and the IPC is not called again.
    for (let i = 1; i < 6; i++) {
      rerender({ refs: [ref(9, { cellRow: i, cellCol: i * 2 })] });
    }
    await waitFor(() => expect(result.current.get(9)).toBeDefined());
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does not strand an in-flight fetch when the id-set changes (overlapping ids)", async () => {
    // Race contract: when the snapshot's id-set CHANGES (e.g. a new
    // image is added) while a fetch for an existing id is still in
    // flight, the cleanup cancels the old `.then`. The new effect
    // cycle then iterates the new id-set; the old `.then` must not
    // delete the inflight marker for ids that are still wanted, or the
    // new cycle will have skipped them (because inflight.has=true at
    // iteration time) and the cleared marker arrives too late to
    // re-trigger a fetch — leaving the image permanently un-fetched.
    let resolveFirst: (v: RawImageData | null) => void = () => {};
    const firstFetch = new Promise<RawImageData | null>((r) => {
      resolveFirst = r;
    });
    let firstCalled = 0;
    const a1 = makeBitmap("a1");
    const b = makeBitmap("b");
    const factory = makeFactory({ "a-payload": a1, "b-payload": b });
    let aCallCount = 0;
    const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd !== "term_image_data") throw new Error(`unexpected ${cmd}`);
      const id = Number((args ?? {}).imageId);
      if (id === 1) {
        aCallCount++;
        if (aCallCount === 1) {
          firstCalled++;
          // Hold the first fetch indefinitely so the rerender races
          // against it.
          return firstFetch;
        }
        return { format: "png", dataBase64: btoa("a-payload"), widthPx: 1, heightPx: 1 };
      }
      if (id === 2) {
        return { format: "png", dataBase64: btoa("b-payload"), widthPx: 1, heightPx: 1 };
      }
      return null;
    }) as unknown as Invoke;

    const { result, rerender } = renderHook(
      ({ refs }: { refs: ImageRef[] }) =>
        useTerminalImages("t-1", refs, { invoke, createImageBitmap: factory }),
      { initialProps: { refs: [ref(1)] } },
    );
    // Wait until the first fetch has been issued (still pending).
    await waitFor(() => expect(firstCalled).toBe(1));
    // Re-render with an EXPANDED id-set — id=1 is still wanted, id=2 is new.
    // This invalidates the old effect cycle while id=1's fetch is in flight.
    rerender({ refs: [ref(1), ref(2)] });
    // Resolve the original fetch — the cancelled `.then` must NOT delete
    // the inflight marker for id=1 (the new cycle either claimed it
    // afresh, or has already skipped it and is waiting). Either way the
    // image must eventually appear.
    resolveFirst({ format: "png", dataBase64: btoa("a-payload"), widthPx: 1, heightPx: 1 });
    await waitFor(() => expect(result.current.size).toBe(2), { timeout: 2_000 });
    expect(result.current.get(1)).toBe(a1);
    expect(result.current.get(2)).toBe(b);
  });

  it("re-fetches after the id-set actually changes (new image arrives)", async () => {
    const a = makeBitmap("a");
    const b = makeBitmap("b");
    const factory = makeFactory({ a, b });
    const invoke = ipcReturning({
      1: { format: "png", dataBase64: btoa("a"), widthPx: 1, heightPx: 1 },
      2: { format: "png", dataBase64: btoa("b"), widthPx: 1, heightPx: 1 },
    });
    const { result, rerender } = renderHook(
      ({ refs }: { refs: ImageRef[] }) =>
        useTerminalImages("t-1", refs, { invoke, createImageBitmap: factory }),
      { initialProps: { refs: [ref(1)] } },
    );
    await waitFor(() => expect(result.current.size).toBe(1));
    expect(invoke).toHaveBeenCalledTimes(1);
    rerender({ refs: [ref(1), ref(2)] });
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.current.get(2)).toBe(b);
  });
});
