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
      status: "waiting_approval",
      uiStatus: "waiting",
      workspaceScope: "C:/repo-agent",
      ptyId: "pty-1",
    });
    expect(fleet[1]).toMatchObject({
      runtime: "headless",
      status: "thinking",
      uiStatus: "thinking",
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
      status: "waiting_approval",
      uiStatus: "waiting",
      prompt: "",
      ptyId: "pty-1",
    });
  });
});
