/**
 * Phase 3C-1b — Monaco inline ghost paint.
 *
 * Installs Monaco decorations + view zones for the hunks in a single
 * `FileDelta`, tinted with the layer's role color. Pure-add hunks become
 * phantom view zones; pure-delete hunks become strikethrough decorations;
 * mixed hunks fall back to a gutter icon and are counted as "deferred" so
 * the caller can show them in a popover (3C-1c).
 *
 * The Monaco surface is referenced through a narrow structural interface
 * so unit tests can drive the painter without pulling `monaco-editor` in.
 */

import type { DiffHunk, HunkLine, LayerTint } from "../../shared/types/ghostdiff";

/** Subset of `monaco.editor.IStandaloneCodeEditor` used by the painter. */
export interface GhostEditor {
  deltaDecorations(oldIds: string[], newDecorations: DeltaDecoration[]): string[];
  changeViewZones(cb: (accessor: ViewZoneAccessor) => void): void;
}

/** Subset of `monaco.editor.IViewZoneChangeAccessor`. */
export interface ViewZoneAccessor {
  addZone(zone: ViewZone): string;
  removeZone(id: string): void;
}

/** Subset of `monaco.Range`-shaped value the painter needs. */
export interface RangeLike {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface DeltaDecoration {
  range: RangeLike;
  options: {
    isWholeLine?: boolean;
    className?: string;
    linesDecorationsClassName?: string;
    glyphMarginClassName?: string;
    hoverMessage?: { value: string };
  };
}

export interface ViewZone {
  afterLineNumber: number;
  heightInLines: number;
  domNode: HTMLElement;
  suppressMouseDown?: boolean;
}

/** Subset of the `monaco` namespace. */
export interface MonacoNs {
  Range: new (startLine: number, startColumn: number, endLine: number, endColumn: number) => RangeLike;
}

export interface GhostPaintOptions {
  hunks: DiffHunk[];
  tint: LayerTint;
  /** Hunk indices that conflict with user edits — skipped inline, counted for the badge. */
  skipHunkIndices?: ReadonlySet<number>;
  /** Stable id used as a DOM data attribute — helps tests / debugging. */
  layerId: string;
}

export interface GhostPaintHandle {
  /** Hunk indices that were rendered inline (add / delete / mixed-gutter). */
  paintedIndices: number[];
  /** Hunk indices that landed on the gutter because they mix add+delete. */
  deferredIndices: number[];
  /** Tear down every decoration + view zone the painter installed. */
  dispose(): void;
}

export type HunkKind = "add" | "delete" | "mixed" | "empty";

/** Classify a hunk by its line composition. */
export function classifyHunk(hunk: DiffHunk): HunkKind {
  let hasAdd = false;
  let hasRemove = false;
  for (const line of hunk.lines) {
    if (line.kind === "add") hasAdd = true;
    else if (line.kind === "remove") hasRemove = true;
  }
  if (hasAdd && hasRemove) return "mixed";
  if (hasAdd) return "add";
  if (hasRemove) return "delete";
  return "empty";
}

function addedText(lines: HunkLine[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.kind === "add") out.push(line.text);
  }
  return out;
}

/** Safely clamp a Monaco line number to `>= 1`. */
function clampLine(n: number): number {
  return n < 1 ? 1 : Math.floor(n);
}

/**
 * Install ghost decorations on `editor`. Returns a handle that callers keep
 * alive for the lifetime of the painted view; `dispose()` removes every
 * decoration and view zone this call produced.
 */
export function installGhostPaint(editor: GhostEditor, monaco: MonacoNs, options: GhostPaintOptions): GhostPaintHandle {
  const { hunks, tint, layerId } = options;
  const skip = options.skipHunkIndices ?? new Set<number>();

  const deltaDecorations: DeltaDecoration[] = [];
  const zoneIds: string[] = [];
  const paintedIndices: number[] = [];
  const deferredIndices: number[] = [];

  editor.changeViewZones((accessor) => {
    for (let i = 0; i < hunks.length; i++) {
      if (skip.has(i)) continue;
      const hunk = hunks[i];
      const kind = classifyHunk(hunk);

      if (kind === "add") {
        const adds = addedText(hunk.lines);
        if (adds.length === 0) continue;
        const domNode = buildAddZoneNode(adds, tint, layerId, i);
        // Pure-add hunks have baseLen === 0 and baseStart pointing to the
        // line *after which* the insertion happens. Monaco's
        // `afterLineNumber` uses the same convention; `0` anchors to the
        // top of the file.
        const afterLineNumber = Math.max(0, hunk.baseStart);
        const id = accessor.addZone({
          afterLineNumber,
          heightInLines: adds.length,
          domNode,
          suppressMouseDown: true,
        });
        zoneIds.push(id);
        paintedIndices.push(i);
      } else if (kind === "delete") {
        const startLine = clampLine(hunk.baseStart);
        const endLine = clampLine(hunk.baseStart + Math.max(hunk.baseLen, 1) - 1);
        deltaDecorations.push({
          range: new monaco.Range(startLine, 1, endLine, Number.MAX_SAFE_INTEGER),
          options: {
            isWholeLine: true,
            className: "aether-ghost-delete-line",
            linesDecorationsClassName: "aether-ghost-delete-gutter",
            hoverMessage: {
              value: `Ghost delete (${tint.roleLabel})`,
            },
          },
        });
        paintedIndices.push(i);
      } else if (kind === "mixed") {
        const anchor = clampLine(hunk.baseStart);
        deltaDecorations.push({
          range: new monaco.Range(anchor, 1, anchor, 1),
          options: {
            isWholeLine: true,
            linesDecorationsClassName: "aether-ghost-modify-gutter",
            hoverMessage: {
              value: `Ghost change (${tint.roleLabel}) — open panel to review`,
            },
          },
        });
        deferredIndices.push(i);
      }
      // "empty" hunks contribute nothing.
    }
  });

  const decorationIds = deltaDecorations.length > 0 ? editor.deltaDecorations([], deltaDecorations) : [];

  let disposed = false;
  return {
    paintedIndices,
    deferredIndices,
    dispose() {
      if (disposed) return;
      disposed = true;
      // The editor may already be torn down (file switch remounts Monaco).
      // Guard both calls so the cleanup never throws on a closed instance.
      try {
        if (decorationIds.length > 0) {
          editor.deltaDecorations(decorationIds, []);
        }
      } catch {
        /* editor already disposed */
      }
      try {
        if (zoneIds.length > 0) {
          editor.changeViewZones((accessor) => {
            for (const id of zoneIds) accessor.removeZone(id);
          });
        }
      } catch {
        /* editor already disposed */
      }
    },
  };
}

function buildAddZoneNode(lines: string[], tint: LayerTint, layerId: string, hunkIndex: number): HTMLElement {
  const root = document.createElement("div");
  root.className = "aether-ghost-add-zone";
  root.dataset.aetherLayer = layerId;
  root.dataset.aetherHunk = String(hunkIndex);
  root.style.setProperty("--aether-ghost-tint", tint.roleColor);
  for (const line of lines) {
    const row = document.createElement("div");
    row.className = "aether-ghost-add-line";
    // Non-breaking space for empty add lines so the row keeps its height.
    row.textContent = line.length === 0 ? "\u00a0" : line;
    root.appendChild(row);
  }
  return root;
}
