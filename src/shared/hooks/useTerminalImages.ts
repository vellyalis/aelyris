import { useEffect, useMemo, useRef, useState } from "react";

import type { ImageRef } from "../types/terminal";

/**
 * Adapter so tests can inject a fake invoke-style callable without
 * pulling in the real Tauri bridge. Production passes through to
 * `@tauri-apps/api/core`.
 */
export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

const defaultInvoke: Invoke = async (cmd, args) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(cmd, args) as Promise<never>;
};

/** Wire shape returned by the Rust `term_image_data` IPC. */
interface RawImageData {
  format: "png" | "rgba8";
  dataBase64: string;
  widthPx: number;
  heightPx: number;
}

/** Test-injectable factory mirroring the browser global of the same name. */
export type CreateImageBitmap = (
  source: ImageBitmapSource,
  options?: ImageBitmapOptions,
) => Promise<ImageBitmap>;

export interface UseTerminalImagesOptions {
  invoke?: Invoke;
  /** Override the global `createImageBitmap` (jsdom lacks it). */
  createImageBitmap?: CreateImageBitmap;
}

/**
 * Resolve every `ImageRef` in `images` to a paint-ready `ImageBitmap`,
 * keyed by `id` within the active terminal. Backend `ImageStore` ids
 * restart at 0 for each terminal session, so a terminal switch is a
 * cache boundary; otherwise a newly selected pane can paint another
 * pane's same-numbered bitmap.
 *
 * Entries vanish from the returned map when the snapshot stops
 * reporting them (image scrolled into history, or the engine evicted
 * it past the 50 MiB cap). Sprint 3's paint pass treats a missing
 * `id` in the map as "not yet ready / not retrievable" and skips it
 * silently — the same graceful degradation as the backend's
 * `term_image_data -> None` path.
 */
export function useTerminalImages(
  terminalId: string | null,
  images: ImageRef[] | undefined,
  options: UseTerminalImagesOptions = {},
): Map<number, ImageBitmap> {
  const { invoke = defaultInvoke } = options;
  const factoryOverride = options.createImageBitmap;
  const [bitmaps, setBitmaps] = useState<Map<number, ImageBitmap>>(() => new Map());
  // Inflight set keyed by id so we don't double-fetch while the
  // first request is still in flight. Lives across renders without
  // forcing re-renders of its own — that's React's escape hatch ref.
  const inflight = useRef<Set<number>>(new Set());
  const lastTerminalIdRef = useRef<string | null>(null);

  // Stabilise the image set by id-only key. The producer (applyDiff in
  // useTerminalSnapshot) returns a fresh `images` array on every full=true
  // diff and on every partial whose image set changed, so consumers that
  // only care about the *id set* (this hook does — position/size lives in
  // the snapshot, not in our cache key) would otherwise re-run their
  // effect on every full=true frame. That triggers a fetch-cancel-fetch
  // storm: the cleanup sets `cancelled=true`, the .then early-returns and
  // deletes its inflight marker, but the new effect cycle has already
  // iterated images and skipped the fetch (inflight was still set when it
  // ran). The image then never appears until a frame with no inflight
  // collision happens to land. Stabilising by id-set keeps the deps array
  // identity-stable across position-only changes, so the effect only
  // re-runs when the set actually changes.
  const idsKey = useMemo(
    () => (images ? images.map((i) => i.id).sort((a, b) => a - b).join(",") : ""),
    [images],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableImages = useMemo(() => images, [idsKey]);

  useEffect(() => {
    const terminalChanged = lastTerminalIdRef.current !== terminalId;
    lastTerminalIdRef.current = terminalId;

    if (!terminalId || !stableImages || stableImages.length === 0) {
      // Nothing visible — drop everything. ImageBitmap.close() releases
      // the underlying GPU/CPU buffer; without it long-running sessions
      // with many transient images grow unboundedly.
      setBitmaps((prev) => {
        if (prev.size === 0) return prev;
        prev.forEach((bmp) => bmp.close?.());
        return new Map();
      });
      inflight.current.clear();
      return;
    }

    if (terminalChanged) {
      setBitmaps((prev) => {
        if (prev.size === 0) return prev;
        prev.forEach((bmp) => bmp.close?.());
        return new Map();
      });
      inflight.current.clear();
    }

    const visibleIds = new Set(stableImages.map((img) => img.id));

    // GC: drop bitmaps for ids no longer in the snapshot.
    setBitmaps((prev) => {
      let mutated = false;
      const next = new Map(prev);
      for (const [id, bmp] of prev) {
        if (!visibleIds.has(id)) {
          bmp.close?.();
          next.delete(id);
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });

    // Fetch new ones.
    const factory: CreateImageBitmap | undefined =
      factoryOverride ??
      (typeof globalThis.createImageBitmap === "function"
        ? globalThis.createImageBitmap.bind(globalThis)
        : undefined);
    if (!factory) {
      // jsdom or any environment without ImageBitmap support — paint
      // pass will run the cell-only fallback. Don't even fetch IPC,
      // there's nothing to do with the bytes.
      return;
    }

    let cancelled = false;
    for (const ref of stableImages) {
      if ((!terminalChanged && bitmaps.has(ref.id)) || inflight.current.has(ref.id)) continue;
      inflight.current.add(ref.id);

      void invoke<RawImageData | null>("term_image_data", {
        id: terminalId,
        imageId: ref.id,
      })
        .then(async (raw) => {
          // Cleanup wiped `inflight` for *this* cycle (see the cleanup
          // comment below). When cancelled, we therefore must NOT touch
          // `inflight` here: doing so would race against the next cycle
          // and could remove a marker that the next cycle has already
          // claimed for its own freshly-issued fetch (most importantly
          // when the same id appears in both the old and new id-sets).
          if (cancelled) return;
          if (!raw) {
            inflight.current.delete(ref.id);
            return;
          }
          const bytes = decodeBase64(raw.dataBase64);
          const bitmap = await materialiseBitmap(raw, bytes, factory);
          if (cancelled) {
            bitmap.close?.();
            return;
          }
          setBitmaps((prev) => {
            // If the snapshot no longer mentions this id (it scrolled
            // off while we were fetching), don't add it just to be
            // GC'd next render.
            if (!visibleIds.has(ref.id)) {
              bitmap.close?.();
              return prev;
            }
            const next = new Map(prev);
            next.set(ref.id, bitmap);
            return next;
          });
          inflight.current.delete(ref.id);
        })
        .catch(() => {
          // Same rule as the .then path: only this cycle owns the
          // inflight slot until cleanup clears it. Once cancelled, leave
          // inflight alone so the next cycle's marker is preserved.
          if (!cancelled) inflight.current.delete(ref.id);
        });
    }

    return () => {
      cancelled = true;
      // Drop all inflight markers belonging to this cycle. Without this,
      // an id that appears in both the old and new id-sets would be
      // skipped by the new cycle's iteration (`inflight.has(id)` was
      // still true from the old fetch) and the cancelled old `.then`
      // would `delete` it only after the new cycle had finished
      // iterating — leaving the image permanently un-fetched. The
      // cancelled `.then` is taught above to refrain from touching
      // `inflight`, so clearing here is safe even when stale callbacks
      // resolve later.
      inflight.current.clear();
    };
    // We deliberately read `bitmaps` inside the effect but don't list
    // it as a dep — adding it would re-run the fetch loop on every
    // bitmap arrival, defeating the cache. The `setBitmaps` updater
    // form gives us the live value without depending on it. We also
    // depend on `stableImages` (id-set-stable) instead of raw `images`
    // to avoid re-running on position-only changes — see the comment
    // on the `useMemo` block above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId, stableImages, invoke, factoryOverride]);

  return bitmaps;
}

function decodeBase64(b64: string): Uint8Array {
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  // Node-style fallback (jsdom builds with a Buffer global).
  const Buf = (globalThis as unknown as { Buffer?: { from: (b: string, e: string) => Uint8Array } })
    .Buffer;
  if (Buf) return Buf.from(b64, "base64");
  throw new Error("base64 decode unavailable");
}

async function materialiseBitmap(
  raw: RawImageData,
  bytes: Uint8Array,
  factory: CreateImageBitmap,
): Promise<ImageBitmap> {
  if (raw.format === "png") {
    const blob = new Blob([bytes], { type: "image/png" });
    return factory(blob);
  }
  // RGBA8: wrap in ImageData. Some browsers (Firefox older) reject
  // a zero-length buffer; bail out early so the fetch path doesn't
  // throw asynchronously inside React's commit.
  if (raw.widthPx === 0 || raw.heightPx === 0) {
    throw new Error("rgba payload has zero dimension");
  }
  const buffer = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const imageData = new ImageData(buffer, raw.widthPx, raw.heightPx);
  return factory(imageData);
}
