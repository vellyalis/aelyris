/**
 * Phase 3C-1b — wire ghost layers into a mounted Monaco editor.
 *
 * `useGhostLayers()` already surfaces `LayerSummary` records + a lazy
 * `getFile()` fetch for the full `FileDelta`. This hook turns that stream
 * into actual Monaco decorations/view zones for the currently-open file,
 * skipping hunks that conflict with the user's in-flight edits.
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useGhostLayers } from "../../shared/hooks/useGhostLayers";
import type { FileDelta, LayerSummary } from "../../shared/types/ghostdiff";

import { isReadOnlyLayer } from "../../shared/types/ghostdiff";
import { detectHunkConflicts, hunkBaseRange, type LineRange } from "./ghostConflict";
import { type GhostEditor, type GhostPaintHandle, installGhostPaint, type MonacoNs } from "./ghostPaint";

interface ApplyHunkResult {
  updatedContent: string;
  filePath: string;
  remainingHunks: number;
}

/** Per-layer hunk metadata used to find a hunk at a given editor line. */
export interface HunkAnchor {
  layerId: string;
  hunkIndex: number;
  baseStart: number;
  baseLen: number;
}

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
  subscribeToModelChanges?: (listener: (ranges: LineRange[]) => void) => () => void;
  /**
   * When `true`, paint layers that are still in progress (Phase 3C-1d
   * live-mode flag). Default `false` — only agent-completed layers paint.
   */
  liveMode?: boolean;
}

export interface UseGhostPaintResult {
  /** Total hunks hidden because they overlap user edits. */
  conflictCount: number;
  /** Total mixed-kind hunks that retreated to a gutter icon. */
  deferredCount: number;
  /** Distinct layers currently painting on this file. */
  layerCount: number;
  /** `true` when at least one hunk overlaps `line`. */
  hasHunkAtLine: (line: number) => boolean;
  /** Every hunk anchor covering `line`, newest layer first. */
  hunksAtLine: (line: number) => HunkAnchor[];
  /**
   * Apply the first accepted hunk at `line` back to main. Returns the main
   * file's updated content on success (so the editor can replace its model
   * value), or `null` when nothing was at the line.
   */
  acceptHunkAtLine: (line: number) => Promise<string | null>;
  /** Accept every non-conflicting hunk for the open file. */
  acceptAllInFile: () => Promise<string | null>;
  /** Dismiss every layer currently painting the open file. */
  dismissFileLayers: () => Promise<number>;
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
export function computeRelativePath(filePath: string | null, projectPath: string | null | undefined): string | null {
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

function layersForFile(layers: LayerSummary[], relativePath: string | null, liveMode: boolean): LayerSummary[] {
  if (!relativePath) return [];
  // Default (live=false): only paint layers whose agent has finished. Live
  // mode (Phase 3C-1d flag) lets the user opt into in-progress diffs too.
  return layers.filter((l) => l.filePaths.includes(relativePath) && (liveMode || l.isComplete));
}

/**
 * Primary wiring. The hook internally calls `useGhostLayers()` so callers
 * only pass the editor handle and the open file's coordinates.
 */
export function useGhostPaintForFile(args: UseGhostPaintArgs): UseGhostPaintResult {
  const { editor, monaco, filePath, projectPath, subscribeToModelChanges, liveMode = false } = args;
  const { layers, getFile } = useGhostLayers();

  const relativePath = useMemo(() => computeRelativePath(filePath, projectPath ?? null), [filePath, projectPath]);

  const relevantLayers = useMemo(() => layersForFile(layers, relativePath, liveMode), [layers, relativePath, liveMode]);

  // Stable signature that changes when a matching layer's content does —
  // triggers a FileDelta refetch.
  const fetchSignature = useMemo(
    () => relevantLayers.map((l) => `${l.id}:${l.fileCount}:${l.hunkCount}:${l.isComplete ? 1 : 0}`).join("|"),
    [relevantLayers],
  );

  const [deltasById, setDeltasById] = useState<Map<string, FileDelta>>(new Map());

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

  // Hunk anchors used by Tab / Shift+Tab / Esc for cursor-line lookups.
  // Populated after each paint pass; newest layer last so "newest first"
  // iteration in acceptHunkAtLine walks the array in reverse.
  const [hunkAnchors, setHunkAnchors] = useState<HunkAnchor[]>([]);

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
    const anchors: HunkAnchor[] = [];

    // Paint in layer order so newer layers sit on top of older ones.
    const ordered = relevantLayers.filter((l) => deltasById.has(l.id));
    for (const layer of ordered) {
      const delta = deltasById.get(layer.id);
      if (!delta || delta.hunks.length === 0) continue;
      const conflicts = detectHunkConflicts(dirtyRangesRef.current, delta.hunks);
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

      // Phase 3C-2: branch-comparison (read-only) layers paint just like
      // agent-owned layers but must not feed accept anchors — Tab / Shift+Tab
      // stay disarmed so Monaco's default indent keeps working and no IPC
      // round-trip is wasted on a layer the backend will reject.
      if (isReadOnlyLayer(layer.source)) continue;

      // Anchor every non-conflicting hunk for cursor-based accept. Conflicts
      // stay hidden so we deliberately exclude them.
      for (let i = 0; i < delta.hunks.length; i++) {
        if (conflicts.has(i)) continue;
        const hunk = delta.hunks[i];
        anchors.push({
          layerId: layer.id,
          hunkIndex: i,
          baseStart: hunk.baseStart,
          baseLen: hunk.baseLen,
        });
      }
    }

    setPaintSummary({ conflictCount, deferredCount, layerCount });
    setHunkAnchors(anchors);

    return () => {
      for (const h of paintHandlesRef.current) h.dispose();
      paintHandlesRef.current = [];
    };
  }, [editor, monaco, relevantLayers, deltasById, dirtyVersion]);

  // ─── cursor-line lookups ────────────────────────────────────────────────

  const hunksAtLine = useCallback(
    (line: number): HunkAnchor[] => {
      const hits: HunkAnchor[] = [];
      for (const a of hunkAnchors) {
        const range = hunkBaseRange({
          baseStart: a.baseStart,
          baseLen: a.baseLen,
          headStart: a.baseStart,
          headLen: a.baseLen,
          lines: [],
        });
        if (line >= range.start && line <= range.end) hits.push(a);
      }
      // Reverse so the newest (last-painted) layer wins.
      hits.reverse();
      return hits;
    },
    [hunkAnchors],
  );

  const hasHunkAtLine = useCallback((line: number): boolean => hunksAtLine(line).length > 0, [hunksAtLine]);

  // ─── accept / dismiss actions ───────────────────────────────────────────

  const layersRef = useRef(relevantLayers);
  layersRef.current = relevantLayers;
  const relativePathRef = useRef(relativePath);
  relativePathRef.current = relativePath;

  // In-flight lock — blocks Tab / Shift+Tab bursts from racing past the
  // backend's `remove_hunk` mutation and accidentally applying the next
  // hunk (indexes shift left after a remove). See code-review H1 + H2.
  const applyInFlightRef = useRef(false);

  const acceptHunkAtLine = useCallback(
    async (line: number): Promise<string | null> => {
      if (applyInFlightRef.current) return null;
      const hits = hunksAtLine(line);
      if (hits.length === 0) return null;
      const target = hits[0];
      const rel = relativePathRef.current;
      if (!rel) return null;
      applyInFlightRef.current = true;
      try {
        const result = await invoke<ApplyHunkResult>("apply_ghost_hunk", {
          layerId: target.layerId,
          filePath: rel,
          hunkIndex: target.hunkIndex,
        });
        return result.updatedContent;
      } finally {
        applyInFlightRef.current = false;
      }
    },
    [hunksAtLine],
  );

  const acceptAllInFile = useCallback(async (): Promise<string | null> => {
    if (applyInFlightRef.current) return null;
    const rel = relativePathRef.current;
    if (!rel) return null;
    // Skip read-only layers (branch comparison) — the backend would
    // refuse them anyway; silently ignoring keeps Shift+Tab from dumping
    // "Apply-all failed" toasts when a branch comparison is the only layer.
    const layersNow = layersRef.current.filter((l) => !isReadOnlyLayer(l.source));
    if (layersNow.length === 0) return null;
    applyInFlightRef.current = true;
    // Apply the newest layer last so its head_content wins if multiple
    // layers touch the same file. `apply_ghost_file` overwrites main, so
    // sequencing matters.
    let latest: string | null = null;
    try {
      for (const layer of layersNow) {
        try {
          const result = await invoke<ApplyHunkResult>("apply_ghost_file", {
            layerId: layer.id,
            filePath: rel,
          });
          latest = result.updatedContent;
        } catch (e) {
          console.warn(`apply_ghost_file failed for ${layer.id}:`, e);
        }
      }
    } finally {
      applyInFlightRef.current = false;
    }
    return latest;
  }, []);

  const dismissFileLayers = useCallback(async (): Promise<number> => {
    const layersNow = layersRef.current;
    const rel = relativePathRef.current;
    if (!rel) return 0;
    // Drop only this file from each layer — `dismiss_ghost_layer` would wipe
    // the layer wholesale, killing ghost paint on the layer's other files
    // too. Plan calls for "現ファイルの ghost 全 dismiss (他ファイル・他 layer には触れない)".
    let dismissed = 0;
    for (const layer of layersNow) {
      try {
        const cleared = await invoke<boolean>("dismiss_ghost_file", {
          layerId: layer.id,
          filePath: rel,
        });
        if (cleared) dismissed += 1;
      } catch (e) {
        // Backend may have already removed the layer, but log so genuine
        // failures (registry lock poisoned, etc.) are at least visible in
        // the console instead of silently eaten.
        console.warn(`dismiss_ghost_file failed for ${layer.id}:`, e);
      }
    }
    return dismissed;
  }, []);

  return {
    ...paintSummary,
    hasHunkAtLine,
    hunksAtLine,
    acceptHunkAtLine,
    acceptAllInFile,
    dismissFileLayers,
  };
}
