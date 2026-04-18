/**
 * Phase 3C-1a / 3C-2 / 3C-3 — types for the Ghost Diff Overlay.
 *
 * Mirrors `src-tauri/src/ghostdiff/{layer,registry}.rs` and
 * `src-tauri/src/ipc/ghostdiff_commands.rs`.
 */

import type { GridSnapshot } from "./terminal";

export interface LayerTint {
  roleColor: string;
  roleLabel: string;
}

export type LayerSource =
  | {
      kind: "worktree";
      path: string;
      branch: string;
      repoPath: string;
    }
  | {
      kind: "branchComparison";
      repoPath: string;
      baseBranch: string;
      headBranch: string;
    }
  | {
      kind: "snapshot";
      sessionId: string;
      snapshotId: string;
      capturedAt: number;
    };

/** `true` when Tab / Shift+Tab accept must be disabled for this layer. */
export function isReadOnlyLayer(src: LayerSource): boolean {
  return src.kind === "branchComparison" || src.kind === "snapshot";
}

export interface LayerSummary {
  id: string;
  source: LayerSource;
  tint: LayerTint;
  isComplete: boolean;
  createdAt: number;
  fileCount: number;
  hunkCount: number;
  filePaths: string[];
}

export type HunkLine =
  | { kind: "context"; text: string }
  | { kind: "add"; text: string }
  | { kind: "remove"; text: string };

export interface DiffHunk {
  baseStart: number;
  baseLen: number;
  headStart: number;
  headLen: number;
  lines: HunkLine[];
}

export interface FileDelta {
  path: string;
  hunks: DiffHunk[];
  baseContent: string;
  headContent: string;
}

/**
 * Layer content — Diff (hunks per file) or TerminalState (a captured grid
 * for time-travel overlays, Phase 3C-3b). The wire tag is `kind`.
 */
export type LayerContent =
  | {
      kind: "diff";
      baseRevision: string;
      files: FileDelta[];
    }
  | {
      kind: "terminalState";
      grid: GridSnapshot;
    };
