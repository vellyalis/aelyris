import { invoke as tauriInvoke } from "@tauri-apps/api/core";

type NativeTerminalInputFocusArgs = {
  terminalId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  caretInset?: number | null;
};

type NativeTerminalInputCommitArgs = {
  terminalId: string;
  data: string;
  source?: string | null;
};

export function invokeIpc<T>(command: "native_terminal_input_status"): Promise<T>;
export function invokeIpc<T>(command: "native_terminal_input_preedit"): Promise<T>;
export function invokeIpc<T>(command: "native_terminal_input_drain"): Promise<T>;
export function invokeIpc<T>(command: "native_terminal_input_focus", args: NativeTerminalInputFocusArgs): Promise<T>;
export function invokeIpc<T>(command: "native_terminal_input_paste", args: { terminalId: string }): Promise<T>;
export function invokeIpc<T>(command: "native_terminal_input_commit", args: NativeTerminalInputCommitArgs): Promise<T>;
export function invokeIpc<T>(
  command:
    | "native_terminal_input_status"
    | "native_terminal_input_preedit"
    | "native_terminal_input_drain"
    | "native_terminal_input_focus"
    | "native_terminal_input_paste"
    | "native_terminal_input_commit",
  args?: Record<string, unknown>,
): Promise<T> {
  return tauriInvoke<T>(command, args);
}

export const ipcEvents = {
  agentSessionsUpdated: "agent-sessions-updated",
  agentFleetUpdated: "agent-fleet-updated",
  terminalOutput: (terminalId: string) => `pty-output-${terminalId}`,
  terminalExit: (terminalId: string) => `pty-exit-${terminalId}`,
  terminalDiff: (terminalId: string) => `term:diff-${terminalId}`,
  terminalPromptMark: (terminalId: string) => `term:prompt-mark-${terminalId}`,
  terminalLag: (terminalId: string) => `term:lag-${terminalId}`,
  snapshotCaptured: (terminalId: string) => `snapshot:captured-${terminalId}`,
  agentOutput: (sessionId: string) => `agent-output-${sessionId}`,
  watchdogDecision: (sessionId: string) => `watchdog-decision-${sessionId}`,
  agentExit: (sessionId: string) => `agent-exit-${sessionId}`,
  chatStream: (conversationId: string) => `chat-stream-${conversationId}`,
  chatSessionId: (conversationId: string) => `chat-session-id-${conversationId}`,
  chatComplete: (conversationId: string) => `chat-complete-${conversationId}`,
} as const;
