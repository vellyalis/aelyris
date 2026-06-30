import { describe, expect, it } from "vitest";
import {
  agentRunStatusToLegacyStatus,
  mapBackendAgentFleetSessions,
  mergeAgentFleetSessions,
} from "../shared/lib/agentFleet";
import type { AgentSession } from "../shared/types/agent";
import type { InteractiveSession } from "../shared/types/interactiveAgent";

describe("agent fleet projection", () => {
  it("normalizes canonical run statuses for legacy UI consumers", () => {
    expect(agentRunStatusToLegacyStatus("waiting_approval")).toBe("waiting");
    expect(agentRunStatusToLegacyStatus("running_tests")).toBe("coding");
    expect(agentRunStatusToLegacyStatus("spawning")).toBe("thinking");
  });

  it("merges headless and interactive sessions into a single newest-first fleet", () => {
    const headless: AgentSession = {
      id: "h1",
      name: "Headless",
      status: "thinking",
      model: "sonnet",
      prompt: "implement",
      startedAt: 10,
      logs: [],
      cost: 1,
      tokensUsed: 20,
      workspaceScope: "C:/repo",
    };
    const interactive: InteractiveSession = {
      id: "i1",
      pty_id: "pty-1",
      backend: "sidecar",
      cli: "codex",
      status: "waiting",
      model: "codex",
      initial_prompt: "review",
      approval_prompt: "Bash(rm -rf dist) · Do you want to proceed?",
      cwd: "C:/repo",
      worktree_path: "C:/repo-agent",
      cost: 0,
      tokens_used: 0,
      started_at: 20,
    };

    const fleet = mergeAgentFleetSessions([headless], [interactive]);

    expect(fleet.map((session) => session.id)).toEqual(["i1", "h1"]);
    expect(fleet[0]).toMatchObject({
      runtime: "interactive",
      status: "waiting",
      runStatus: "waiting_approval",
      workspaceScope: "C:/repo-agent",
      ptyId: "pty-1",
      approvalPrompt: "Bash(rm -rf dist) · Do you want to proceed?",
    });
    expect(fleet[1]).toMatchObject({
      runtime: "headless",
      status: "thinking",
      runStatus: "thinking",
      workspaceScope: "C:/repo",
    });
  });

  it("maps backend unified DTOs into fleet sessions", () => {
    const fleet = mapBackendAgentFleetSessions([
      {
        id: "u1",
        run_mode: "interactive",
        status: "waiting_approval",
        model: "codex",
        prompt: null,
        cwd: "C:/repo",
        workspace_scope: "C:/repo-agent",
        cost: 0,
        tokens_used: 0,
        started_at: 30,
        cli: "codex",
        backend: "sidecar",
        pty_id: "pty-1",
      },
    ]);

    expect(fleet[0]).toMatchObject({
      id: "u1",
      runtime: "interactive",
      status: "waiting",
      runStatus: "waiting_approval",
      prompt: "",
      ptyId: "pty-1",
    });
  });

  it("preserves headless telemetry detail fields in the unified fleet", () => {
    const headless: AgentSession = {
      id: "h2",
      name: "Detail",
      status: "coding",
      model: "sonnet",
      prompt: "build",
      startedAt: 5,
      logs: [{ timestamp: 1, type: "text", content: "hello" }],
      cost: 2,
      tokensUsed: 100,
      filesChanged: 3,
      watchdog: "auto-approve",
      finalReport: { status: "ready", title: "Done" },
      closeState: "collectable",
      blockedReason: "needs review",
      nextActor: "human",
      permissionMode: "edit",
    };

    const [fleet] = mergeAgentFleetSessions([headless], []);

    expect(fleet).toMatchObject({
      runtime: "headless",
      logs: [{ timestamp: 1, type: "text", content: "hello" }],
      filesChanged: 3,
      watchdog: "auto-approve",
      finalReport: { status: "ready", title: "Done" },
      closeState: "collectable",
      blockedReason: "needs review",
      nextActor: "human",
      permissionMode: "edit",
    });
  });

  it("exposes an empty log array for interactive sessions so UIs can map safely", () => {
    const interactive: InteractiveSession = {
      id: "i2",
      pty_id: "pty-2",
      backend: "sidecar",
      cli: "codex",
      status: "coding",
      model: "codex",
      initial_prompt: "review",
      cwd: "C:/repo",
      cost: 0,
      tokens_used: 0,
      started_at: 1,
    };

    const [fleet] = mergeAgentFleetSessions([], [interactive]);

    expect(fleet.runtime).toBe("interactive");
    expect(fleet.logs).toEqual([]);
  });
});
