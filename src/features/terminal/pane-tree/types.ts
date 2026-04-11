import type { ShellType } from "../../../App";

/** A leaf node — a single terminal instance */
export interface TerminalLeaf {
  type: "terminal";
  id: string;
  shell: ShellType;
  cwd?: string;
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

/** Direction in which to split a pane */
export type SplitDirection = "right" | "down" | "left" | "up";

/** Maps split direction to tree direction + child placement */
export function splitDirectionToTree(dir: SplitDirection): { direction: "horizontal" | "vertical"; newFirst: boolean } {
  switch (dir) {
    case "right": return { direction: "horizontal", newFirst: false };
    case "left":  return { direction: "horizontal", newFirst: true };
    case "down":  return { direction: "vertical", newFirst: false };
    case "up":    return { direction: "vertical", newFirst: true };
  }
}
