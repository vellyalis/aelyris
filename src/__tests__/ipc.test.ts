import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

import { invokeIpc, ipcEvents } from "../shared/lib/ipc";

describe("typed IPC facade", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.invoke.mockResolvedValue({ active: true });
  });

  it("preserves native terminal input command names and typed argument keys", async () => {
    await invokeIpc("native_terminal_input_focus", {
      terminalId: "term-1",
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      caretInset: 5,
    });
    await invokeIpc("native_terminal_input_commit", {
      terminalId: "term-1",
      data: "hello",
      source: "test",
    });
    await invokeIpc("native_terminal_input_drain");

    expect(mocks.invoke.mock.calls).toEqual([
      ["native_terminal_input_focus", { terminalId: "term-1", x: 1, y: 2, width: 3, height: 4, caretInset: 5 }],
      ["native_terminal_input_commit", { terminalId: "term-1", data: "hello", source: "test" }],
      ["native_terminal_input_drain", undefined],
    ]);
  });

  it("owns the frontend projection of backend terminal and agent event names", () => {
    expect(ipcEvents.agentSessionsUpdated).toBe("agent-sessions-updated");
    expect(ipcEvents.agentFleetUpdated).toBe("agent-fleet-updated");
    expect(ipcEvents.terminalOutput("term-1")).toBe("pty-output-term-1");
    expect(ipcEvents.terminalExit("term-1")).toBe("pty-exit-term-1");
    expect(ipcEvents.terminalDiff("term-1")).toBe("term:diff-term-1");
    expect(ipcEvents.terminalPromptMark("term-1")).toBe("term:prompt-mark-term-1");
    expect(ipcEvents.terminalLag("term-1")).toBe("term:lag-term-1");
    expect(ipcEvents.snapshotCaptured("term-1")).toBe("snapshot:captured-term-1");
    expect(ipcEvents.agentOutput("agent-1")).toBe("agent-output-agent-1");
    expect(ipcEvents.watchdogDecision("agent-1")).toBe("watchdog-decision-agent-1");
    expect(ipcEvents.agentExit("agent-1")).toBe("agent-exit-agent-1");
    expect(ipcEvents.chatStream("chat-1")).toBe("chat-stream-chat-1");
    expect(ipcEvents.chatSessionId("chat-1")).toBe("chat-session-id-chat-1");
    expect(ipcEvents.chatComplete("chat-1")).toBe("chat-complete-chat-1");
  });
});
