/**
 * Phase 3A-1 — types for the auto-repair pipeline.
 *
 * Mirrors `src-tauri/src/watchdog/auto_repair.rs` and
 * `src-tauri/src/ipc/repair_commands.rs`.
 */

export type RepairPhase =
  | { kind: "creatingWorktree" }
  | { kind: "runningAgent" }
  | { kind: "runningTests" }
  | { kind: "succeeded" }
  | { kind: "failed"; message: string };

export interface RepairJobInfo {
  id: string;
  phase: RepairPhase;
  branch: string;
  errorLine: string;
  elapsedSecs: number;
}

export interface RepairNotification {
  job_id: string;
  message: string;
  is_success: boolean;
}

export interface AutoRepairConfig {
  enabled: boolean;
  pattern: string;
}

/** User-facing label for a RepairPhase. */
export function repairPhaseLabel(phase: RepairPhase): string {
  switch (phase.kind) {
    case "creatingWorktree":
      return "Creating worktree";
    case "runningAgent":
      return "AI fixing";
    case "runningTests":
      return "Running tests";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return `Failed: ${phase.message}`;
  }
}

/** Whether a phase is still making progress (not yet in a terminal state). */
export function isPhaseActive(phase: RepairPhase): boolean {
  return phase.kind !== "succeeded" && phase.kind !== "failed";
}
