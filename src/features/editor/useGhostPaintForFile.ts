/**
 * Phase 3C-1b — wire ghost layers into a mounted Monaco editor.
 *
 * `useGhostLayers()` already surfaces `LayerSummary` records + a lazy
 * `getFile()` fetch for the full `FileDelta`. This hook turns that stream
 * into actual Monaco decorations/view zones for the currently-open file,
 * skipping hunks that conflict with the user's in-flight edits.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { useGhostLayers } from "../../shared/hooks/useGhostLayers";
import type { FileDelta, LayerSummary } from "../../shared/types/ghostdiff";

import { detectHunkConflicts, type LineRange } from "./ghostConflict";
import {
  installGhostPaint,
  type GhostEditor,
  type GhostPaintHandle,
  type MonacoNs,
} from "./ghostPaint";

interface UseGhostPaintArgs {
  editor: GhostEditor | null;
  monaco: MonacoNs | null;
  filePath: string | null;
  projectPath?: string | null;
  /**
   * Optional: a listener registrar that mirrors Monaco's
   * `editor.onDidChangeModelContent`. Provided by `EditorPanel` so dirty
   * line ranges can be tracked without leaking Monaco-specific typing
   * into this hook's call site.
   */
  subscribeToModelChanges?: (
    listener: (ranges: LineRange[]) => void,
  ) => () => void;
}

export interface UseGhostPaintResult {
  /** Total hunks hidden because they overlap user edits. */
  conflictCount: number;
  /** Total mixed-kind hunks that retreated to a gutter icon. */
  deferredCount: number;
  /** Distinct layers currently painting on this file. */
  layerCount: number;
}

/** Normalize a Windows/Unix absolute path to forward slashes + no trailing "/". */
function toPosix(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Compute the repo-relative path used by `FileDelta.path`. Returns `null`
 * when the file sits outside `projectPath` (in which case no ghost layers
 * can apply to it).
 */
export function computeRelativePath(
  filePath: string | null,
  projectPath: string | null | undefined,
): string | null {
  if (!filePath) return null;
  const file = toPosix(filePath);
  if (!projectPath) return file.replace(/^\/+/, "");
  const base = toPosix(projectPath);
  if (!base) return file.replace(/^\/+/, "");
  if (file === base) return "";
  const prefix = base.endsWith("/") ? base : base + "/";
  if (file.toLowerCase().startsWith(prefix.toLowerCase())) {
    return file.slice(prefix.length);
  }
  return null;
}

function layersForFile(
  layers: LayerSummary[],
  relativePath: string | null,
): LayerSummary[] {
  if (!relativePath) return [];
  return layers.filter((l) => l.filePaths.includes(relativePath));
}

/**
 * Primary wiring. The hook internally calls `useGhostLayers()` so callers
 * only pass the editor handle and the open file's coordinates.
 */
export function useGhostPaintForFile(
  args: UseGhostPaintArgs,
): UseGhostPaintResult {
  const { editor, monaco, filePath, projectPath, subscribeToModelChanges } =
    args;
  const { layers, getFile } = useGhostLayers();

  const relativePath = useMemo(
    () => computeRelativePath(filePath, projectPath ?? null),
    [filePath, projectPath],
  );

  const relevantLayers = useMemo(
    () => layersForFile(layers, relativePath),
    [layers, relativePath],
  );

  // Stable signature that changes when a matching layer's content does —
  // triggers a FileDelta refetch.
  const fetchSignature = useMemo(
    () =>
      relevantLayers
        .map((l) => `${l.id}:${l.fileCount}:${l.hunkCount}:${l.isComplete ? 1 : 0}`)
        .join("|"),
    [relevantLayers],
  );

  const [deltasById, setDeltasById] = useState<Map<string, FileDelta>>(
    new Map(),
  );

  // Dirty-range tracking. Subscribe re-binds on filePath so any stale
  // model-change event from the previous editor's unmount flush cannot
  // leak ranges into the fresh file's state.
  const dirtyRangesRef = useRef<LineRange[]>([]);
  const [dirtyVersion, setDirtyVersion] = useState(0);

  useEffect(() => {
    dirtyRangesRef.current = [];
    setDirtyVersion((v) => v + 1);
    if (!subscribeToModelChanges) return;
    const unsub = subscribeToModelChanges((ranges) => {
      if (ranges.length === 0) return;
      dirtyRangesRef.current = [...dirtyRangesRef.current, ...ranges];
      setDirtyVersion((v) => v + 1);
    });
    return unsub;
  }, [filePath, subscribeToModelChanges]);

  // Fetch FileDelta for every layer that touches the open file. A monotonic
  // sequence guard makes sure a late-arriving older batch cannot overwrite a
  // newer one when fetchSignature flips twice in quick succession.
  const fetchSeqRef = useRef(0);
  useEffect(() => {
    if (!relativePath || relevantLayers.length === 0) {
      setDeltasById(new Map());
      return;
    }
    const mySeq = ++fetchSeqRef.current;
    let cancelled = false;
    (async () => {
      const next = new Map<string, FileDelta>();
      await Promise.all(
        relevantLayers.map(async (layer) => {
          const delta = await getFile(layer.id, relativePath);
          if (!cancelled && delta) next.set(layer.id, delta);
        }),
      );
      // Drop our result if another batch has since started — prevents a
      // slow first batch from overwriting a faster second batch.
      if (!cancelled && mySeq === fetchSeqRef.current) setDeltasById(next);
    })();
    return () => {
      cancelled = true;
    };
    // `fetchSignature` encodes everything that should trigger a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relativePath, fetchSignature, getFile]);

  // Install / reinstall painters whenever deltas, dirty state, or editor change.
  const paintHandlesRef = useRef<GhostPaintHandle[]>([]);
  const [paintSummary, setPaintSummary] = useState({
    conflictCount: 0,
    deferredCount: 0,
    layerCount: 0,
  });

  useEffect(() => {
    // Always dispose prior paint before considering a reinstall.
    for (const h of paintHandlesRef.current) h.dispose();
    paintHandlesRef.current = [];

    if (!editor || !monaco) {
      setPaintSummary({ conflictCount: 0, deferredCount: 0, layerCount: 0 });
      return;
    }

    let conflictCount = 0;
    let deferredCount = 0;
    let layerCount = 0;

    // Paint in layer order so newer layers sit on top of older ones.
    const ordered = relevantLayers.filter((l) => deltasById.has(l.id));
    for (const layer of ordered) {
      const delta = deltasById.get(layer.id);
      if (!delta || delta.hunks.length === 0) continue;
      const conflicts = detectHunkConflicts(
        dirtyRangesRef.current,
        delta.hunks,
      );
      const handle = installGhostPaint(editor, monaco, {
        hunks: delta.hunks,
        tint: layer.tint,
        skipHunkIndices: conflicts,
        layerId: layer.id,
      });
      paintHandlesRef.current.push(handle);
      conflictCount += conflicts.size;
      deferredCount += handle.deferredIndices.length;
      layerCount += 1;
    }

    setPaintSummary({ conflictCount, deferredCount, layerCount });

    return () => {
      for (const h of paintHandlesRef.current) h.dispose();
      paintHandlesRef.current = [];
    };
  }, [editor, monaco, relevantLayers, deltasById, dirtyVersion]);

  return paintSummary;
}
