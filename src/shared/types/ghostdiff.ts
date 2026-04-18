/**
 * Phase 3C-1a — types for the Ghost Diff Overlay.
 *
 * Mirrors `src-tauri/src/ghostdiff/{layer,registry}.rs` and
 * `src-tauri/src/ipc/ghostdiff_commands.rs`.
 */

export interface LayerTint {
  roleColor: string;
  roleLabel: string;
}

export type LayerSource = {
  kind: "worktree";
  path: string;
  branch: string;
  repoPath: string;
};

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
