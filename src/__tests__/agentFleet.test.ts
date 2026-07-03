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
    expect(agentRunStatusToLegacyStatus("summarizing")).toBe("coding");
    expect(agentRunStatusToLegacyStatus("spawning")).toBe("thinking");
    expect(agentRunStatusToLegacyStatus("retiring")).toBe("thinking");
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
      logical_session_id: "logical-i1",
      last_activity: 21,
      turn_count: 3,
      context_remaining: {
        pct: 12,
        used_pct: 88,
        confidence: "parsed",
        source: "claude_grid_context_left",
        updated_at: 21,
        warn: true,
        hard: false,
      },
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
      logicalSessionId: "logical-i1",
      lastActivity: 21,
      turnCount: 3,
      contextRemaining: expect.objectContaining({ usedPct: 88, confidence: "parsed" }),
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
        logical_session_id: "logical-u1",
        last_activity: 35,
        turn_count: 4,
        context_remaining: {
          pct: 5,
          used_pct: 95,
          confidence: "parsed",
          source: "claude_grid_context_left",
          updated_at: 35,
          warn: true,
          hard: true,
        },
        cli: "codex",
        backend: "sidecar",
        pty_id: "pty-1",
        short_id: 7,
        approval_prompt: "Bash(git push origin main) · Do you want to proceed?",
        predecessor_session_id: "logical-parent",
        lineage: [
          {
            logical_session_id: "logical-parent",
            checkpoint_seq: 2,
            pty_id: "pty-parent",
            status: "retiring",
            updated_at: 20,
          },
          {
            logical_session_id: "logical-u1",
            checkpoint_seq: 3,
            pty_id: "pty-1",
            status: "waiting_approval",
            predecessor_session_id: "logical-parent",
            updated_at: 35,
          },
        ],
        recycle_status: {
          predecessor_id: "logical-parent",
          successor_id: "logical-u1",
          handoff_seq: 1,
          state: "predecessor_retired",
          correlation_id: "session-handoff-logical-parent-1",
          updated_at: 36,
        },
      },
    ]);

    expect(fleet[0]).toMatchObject({
      id: "u1",
      runtime: "interactive",
      status: "waiting",
      runStatus: "waiting_approval",
      prompt: "",
      ptyId: "pty-1",
      shortId: 7,
      // The Decision Inbox only surfaces a waiting_approval gate when the
      // captured menu rides the unified fleet DTO — dropping it here breaks
      // Approve/Deny end-to-end (live-caught regression).
      approvalPrompt: "Bash(git push origin main) · Do you want to proceed?",
      logicalSessionId: "logical-u1",
      predecessorSessionId: "logical-parent",
      handoffFrom: "logical-parent",
      lastActivity: 35,
      turnCount: 4,
      contextRemaining: expect.objectContaining({ usedPct: 95, hard: true }),
      lineage: [
        expect.objectContaining({ logicalSessionId: "logical-parent", checkpointSeq: 2 }),
        expect.objectContaining({ logicalSessionId: "logical-u1", predecessorSessionId: "logical-parent" }),
      ],
      recycleStatus: expect.objectContaining({
        predecessorId: "logical-parent",
        successorId: "logical-u1",
        state: "predecessor_retired",
        handoffSeq: 1,
      }),
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
