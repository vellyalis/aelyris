import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentFleetSession } from "../shared/lib/agentFleet";
import type { AgentRunStatus } from "../shared/types/agentStatus";
import { useAgentFleetToasts } from "../shared/hooks/useAgentFleetToasts";

const notifyMock = vi.hoisted(() => ({ sendWindowsNotification: vi.fn() }));
vi.mock("../shared/hooks/useTerminalNotifications", () => ({
  sendWindowsNotification: notifyMock.sendWindowsNotification,
}));

function session(id: string, runStatus: AgentRunStatus): AgentFleetSession {
  return {
    id,
    name: `Agent ${id}`,
    status: "coding",
    model: "claude-sonnet",
    prompt: "work",
    startedAt: 1_000,
    logs: [],
    cost: 0,
    tokensUsed: 0,
    runtime: "headless",
    runStatus,
    cwd: "/repo",
  };
}

describe("useAgentFleetToasts", () => {
  beforeEach(() => {
    notifyMock.sendWindowsNotification.mockReset();
  });

  it("does not toast for the initial (seeded) snapshot", () => {
    renderHook((props: { sessions: AgentFleetSession[] }) => useAgentFleetToasts(props.sessions), {
      initialProps: { sessions: [session("a", "waiting_approval"), session("b", "done")] },
    });
    expect(notifyMock.sendWindowsNotification).not.toHaveBeenCalled();
  });

  it("toasts once on a transition into waiting_approval, with the session name", () => {
    const { rerender } = renderHook((props: { sessions: AgentFleetSession[] }) => useAgentFleetToasts(props.sessions), {
      initialProps: { sessions: [session("a", "coding")] },
    });
    rerender({ sessions: [session("a", "waiting_approval")] });
    expect(notifyMock.sendWindowsNotification).toHaveBeenCalledTimes(1);
    expect(notifyMock.sendWindowsNotification.mock.calls[0][1]).toContain("Agent a");
  });

  it("toasts on a transition into blocked (operator-attention state)", () => {
    const { rerender } = renderHook((props: { sessions: AgentFleetSession[] }) => useAgentFleetToasts(props.sessions), {
      initialProps: { sessions: [session("a", "coding")] },
    });
    rerender({ sessions: [session("a", "blocked")] });
    expect(notifyMock.sendWindowsNotification).toHaveBeenCalledTimes(1);
  });

  it("does not toast for sessions that first appear after the initial snapshot (async restore)", () => {
    // The first snapshot is legitimately empty before session restore lands;
    // sessions added later — even already-done/errored ones — must be recorded
    // silently, never toasted.
    const { rerender } = renderHook((props: { sessions: AgentFleetSession[] }) => useAgentFleetToasts(props.sessions), {
      initialProps: { sessions: [] as AgentFleetSession[] },
    });
    rerender({ sessions: [session("a", "done"), session("b", "error"), session("c", "waiting_approval")] });
    expect(notifyMock.sendWindowsNotification).not.toHaveBeenCalled();
  });

  it("toasts on transitions into done and error", () => {
    const { rerender } = renderHook((props: { sessions: AgentFleetSession[] }) => useAgentFleetToasts(props.sessions), {
      initialProps: { sessions: [session("a", "coding"), session("b", "coding")] },
    });
    rerender({ sessions: [session("a", "done"), session("b", "error")] });
    expect(notifyMock.sendWindowsNotification).toHaveBeenCalledTimes(2);
  });

  it("does not toast for transitions into non-watched statuses", () => {
    const { rerender } = renderHook((props: { sessions: AgentFleetSession[] }) => useAgentFleetToasts(props.sessions), {
      initialProps: { sessions: [session("a", "coding")] },
    });
    rerender({ sessions: [session("a", "thinking")] });
    expect(notifyMock.sendWindowsNotification).not.toHaveBeenCalled();
  });

  it("does not re-toast when the status is unchanged across renders", () => {
    const { rerender } = renderHook((props: { sessions: AgentFleetSession[] }) => useAgentFleetToasts(props.sessions), {
      initialProps: { sessions: [session("a", "coding")] },
    });
    rerender({ sessions: [session("a", "done")] });
    rerender({ sessions: [session("a", "done")] });
    expect(notifyMock.sendWindowsNotification).toHaveBeenCalledTimes(1);
  });

  it("keys transitions by session id so two sessions each toast", () => {
    const { rerender } = renderHook((props: { sessions: AgentFleetSession[] }) => useAgentFleetToasts(props.sessions), {
      initialProps: { sessions: [session("a", "coding"), session("b", "coding")] },
    });
    rerender({ sessions: [session("a", "done"), session("b", "waiting_approval")] });
    expect(notifyMock.sendWindowsNotification).toHaveBeenCalledTimes(2);
    const bodies = notifyMock.sendWindowsNotification.mock.calls.map((c) => c[1]);
    expect(bodies.some((b) => b.includes("Agent a"))).toBe(true);
    expect(bodies.some((b) => b.includes("Agent b"))).toBe(true);
  });
});
