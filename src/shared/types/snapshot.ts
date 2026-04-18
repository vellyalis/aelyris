/**
 * Phase 3C-3a types — mirror of `src-tauri/src/snapshot/{types,store}.rs`.
 *
 * These travel over Tauri IPC as plain JSON. `GridSnapshot` is reused from
 * `./terminal.ts` so the timeline UI and the live terminal renderer share
 * the exact same cell / cursor shape.
 */

import type { GridSnapshot } from "./terminal";

/**
 * Snapshot id — backend uses a UUID string. Kept as a plain string here so
 * callers don't have to unwrap; the newtype exists only on the Rust side.
 */
export type SnapshotId = string;

/**
 * Why a snapshot was captured. The Rust enum uses
 * `#[serde(tag = "kind", rename_all = "camelCase")]`, so the wire shape
 * matches the discriminated union below.
 */
export type SnapshotTrigger =
  | { kind: "userSubmitted" }
  | { kind: "userMarked"; label?: string }
  | { kind: "promptDetected" };

/** Full snapshot including grid cells. Heavy — avoid listing these. */
export interface TerminalSnapshot {
  id: SnapshotId;
  sessionId: string;
  capturedAt: number;
  trigger: SnapshotTrigger;
  grid: GridSnapshot;
}

/**
 * Lightweight list entry. The timeline renders hundreds of these so we keep
 * the payload small (no cell data).
 */
export interface SnapshotSummary {
  id: SnapshotId;
  sessionId: string;
  capturedAt: number;
  trigger: SnapshotTrigger;
  cols: number;
  rows: number;
}

/**
 * Event payload for `snapshot:captured-{sessionId}`. The frontend listens to
 * this to refresh the timeline without polling.
 */
export interface SnapshotCapturedEvent {
  snapshotId: SnapshotId;
  sessionId: string;
}

/** Human-readable label for a trigger — used in timeline tooltips. */
export function triggerLabel(trigger: SnapshotTrigger): string {
  switch (trigger.kind) {
    case "userSubmitted":
      return "Enter";
    case "userMarked":
      return trigger.label ? `Marked: ${trigger.label}` : "Marked";
    case "promptDetected":
      return "Prompt";
  }
}
