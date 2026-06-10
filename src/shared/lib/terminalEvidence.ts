export const TERMINAL_COMMAND_EVIDENCE_EVENT = "aether:terminal-command-evidence";

export interface TerminalCommandEvidenceDetail {
  terminalId: string;
  sequence?: number | null;
  historySize?: number | null;
  screenLine?: number | null;
}
