import type { ShellType } from "../../../shared/types/terminalPane";

export const PANE_ROLES = ["work", "plan", "build", "test", "review", "agent", "logs"] as const;

export type PaneRole = (typeof PANE_ROLES)[number];

export const PANE_LIFECYCLE_STATES = [
  "layout-only",
  "detached",
  "orphaned",
  "starting",
  "live",
  "exited",
  "crashed",
  "restarting",
] as const;

export type PaneLifecycleState = (typeof PANE_LIFECYCLE_STATES)[number];

export const PANE_ATTACH_STATES = ["attached", "detached", "orphaned", "ended", "restarting"] as const;

export type PaneAttachState = (typeof PANE_ATTACH_STATES)[number];

export const PANE_HEALTH_STATES = ["unknown", "healthy", "degraded", "exited", "crashed"] as const;

export type PaneHealthState = (typeof PANE_HEALTH_STATES)[number];

export const VISIBLE_AGENT_PANE_BACKENDS = ["sidecar", "native"] as const;

export type VisibleAgentPaneBackend = (typeof VISIBLE_AGENT_PANE_BACKENDS)[number];

export const VISIBLE_AGENT_PANE_DURABILITY_STATES = ["tmux-durable", "degraded"] as const;

export type VisibleAgentPaneDurability = (typeof VISIBLE_AGENT_PANE_DURABILITY_STATES)[number];

export const VISIBLE_AGENT_PANE_STATUSES = ["running", "done", "error"] as const;

export type VisibleAgentPaneStatus = (typeof VISIBLE_AGENT_PANE_STATUSES)[number];

export interface PaneScrollbackCheckpoint {
  terminalId?: string;
  cursorRow?: number;
  cursorCol?: number;
  visibleRows?: number;
  scrollbackRows?: number;
  byteCount?: number;
  capturedAt?: string;
}

export interface PaneSessionIntent {
  paneId: string;
  sessionId?: string;
  terminalId?: string;
  processId?: number;
  cwd?: string;
  branch?: string;
  command?: string;
  role?: PaneRole;
  name?: string;
  layoutId?: string;
  attachState?: PaneAttachState;
  health?: PaneHealthState;
  lifecycle?: PaneLifecycleState;
  createdAt?: string;
  lastActiveAt?: string;
  scrollbackCheckpoint?: PaneScrollbackCheckpoint;
}

export interface VisibleAgentPaneBinding {
  paneId: string;
  terminalId: string;
  model: string;
  backend: VisibleAgentPaneBackend;
  durability: VisibleAgentPaneDurability;
  status: VisibleAgentPaneStatus;
  taskId?: string;
  roleId?: string;
  sessionId?: string;
  cwd?: string;
  branchName?: string;
  spawnedAt: string;
  updatedAt?: string;
}

/** A leaf node — a single terminal instance */
export interface TerminalLeaf {
  type: "terminal";
  id: string;
  shell: ShellType;
  cwd?: string;
  title?: string;
  role?: PaneRole;
}

/** A split node — divides space between two children */
export interface SplitNode {
  type: "split";
  id: string;
  direction: "horizontal" | "vertical";
  ratio: number;
  first: PaneNode;
  second: PaneNode;
}

/** A node in the pane tree — either a terminal or a split */
export type PaneNode = TerminalLeaf | SplitNode;

/** A compact, serializable view of a live pane for command routing / switchers. */
export interface PaneRegistryEntry {
  paneId: string;
  terminalId: string | null;
  lifecycle?: PaneLifecycleState;
  index: number;
  shell: ShellType;
  cwd?: string;
  title?: string;
  role?: PaneRole;
}

/** Direction in which to split a pane */
export type SplitDirection = "right" | "down" | "left" | "up";

/** Maps split direction to tree direction + child placement */
export function splitDirectionToTree(dir: SplitDirection): { direction: "horizontal" | "vertical"; newFirst: boolean } {
  switch (dir) {
    case "right":
      return { direction: "horizontal", newFirst: false };
    case "left":
      return { direction: "horizontal", newFirst: true };
    case "down":
      return { direction: "vertical", newFirst: false };
    case "up":
      return { direction: "vertical", newFirst: true };
  }
}
