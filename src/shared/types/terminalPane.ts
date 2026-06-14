import type { PaneSwitcherEntry } from "../../features/terminal/pane-tree";

export type ShellType = "powershell" | "cmd" | "gitbash" | "wsl";

export const SHELL_LABELS: Record<ShellType, string> = {
  powershell: "PowerShell",
  cmd: "CMD",
  gitbash: "Git Bash",
  wsl: "WSL",
};

export interface TerminalPaneTarget extends PaneSwitcherEntry {
  tabId: string;
  tabLabel: string;
  tabShell: ShellType;
  tabCwd?: string;
}
