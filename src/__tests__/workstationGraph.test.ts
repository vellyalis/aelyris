import { describe, expect, it } from "vitest";
import {
  buildRunGraph,
  buildWorkstationGraph,
  filterWorkstationGraph,
  listWorkstationGraphAgentIds,
  listWorkstationGraphChangedFiles,
  listWorkstationGraphPaneIds,
  listWorkstationGraphRiskIds,
  listWorkstationGraphTerminalIds,
  traceAgentImpact,
} from "../shared/lib/workstationGraph";
import type { AgentSession } from "../shared/types/agent";

function session(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
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
    changedFileDetails: [],
    ...overrides,
  };
}

describe("buildRunGraph", () => {
  it("tracks handoff lineage, role coverage, context, and children", () => {
    const graph = buildRunGraph([
      session("root", {
        name: "Builder",
        role: "implementer",
        tokensUsed: 40_000,
        logs: [{ timestamp: 2_000, type: "tool_use", content: "Edit(src/App.tsx)" }],
      }),
      session("child", {
        name: "Reviewer",
        role: "reviewer",
        handoffFrom: "root",
        tokensUsed: 80_000,
        changedFileDetails: [{ path: "src/App.tsx", action: "edit", toolName: "Edit", timestamp: 3_000 }],
      }),
    ]);

    expect(graph.edgeCount).toBe(1);
    expect(graph.roleCount).toBe(2);
    expect(graph.roleCoveragePct).toBe(100);
    expect(graph.maxRoleFanout).toBe(1);
    expect(graph.maxDepth).toBe(1);
    expect(graph.peakContextPct).toBe(40);
    expect(graph.nodes.find((node) => node.id === "root")).toMatchObject({
      childCount: 1,
      latestTool: "Edit",
      depth: 0,
    });
    expect(graph.nodes.find((node) => node.id === "child")).toMatchObject({
      parentName: "Builder",
      depth: 1,
      filesChanged: 1,
    });
  });

  it("prioritizes blocked and live nodes before completed work", () => {
    const graph = buildRunGraph([
      session("done", { status: "done", startedAt: 3_000 }),
      session("blocked", { status: "waiting", startedAt: 1_000 }),
      session("live", { status: "coding", startedAt: 2_000 }),
    ]);

    expect(graph.blockedCount).toBe(1);
    expect(graph.liveCount).toBe(1);
    expect(graph.nodes.map((node) => node.id)).toEqual(["blocked", "live", "done"]);
  });

  it("reports role coverage and fanout for sub-agent orchestration", () => {
    const graph = buildRunGraph([session("a", { role: "reviewer" }), session("b", { role: "reviewer" }), session("c")]);

    expect(graph.roleCoveragePct).toBe(67);
    expect(graph.maxRoleFanout).toBe(2);
  });

  it("keeps orphan handoffs visible for audit", () => {
    const graph = buildRunGraph([session("child", { handoffFrom: "missing-parent" })]);

    expect(graph.orphanCount).toBe(1);
    expect(graph.rootCount).toBe(1);
    expect(graph.nodes[0]).toMatchObject({
      parentId: "missing-parent",
      depth: 0,
    });
  });

  it("tracks owner, workspace scope, write set, final report, and collectable completed runs", () => {
    const graph = buildRunGraph([
      session("complete", {
        status: "done",
        owner: "review-lead",
        workspaceScope: "C:/Users/owner/Aether_Terminal",
        writeSet: ["src/App.tsx", "src/App.tsx", "src/shared/types/agent.ts"],
        finalReport: { status: "ready", title: "Agent report" },
        tokensUsed: 120_000,
      }),
    ]);

    expect(graph.doneCount).toBe(1);
    expect(graph.collectableCount).toBe(1);
    expect(graph.finalReportCount).toBe(1);
    expect(graph.nodes[0]).toMatchObject({
      owner: "review-lead",
      workspaceScope: "C:/Users/owner/Aether_Terminal",
      writeSet: ["src/App.tsx", "src/shared/types/agent.ts"],
      finalReportStatus: "ready",
      closeState: "collectable",
      contextBand: "warn",
    });
  });

  it("classifies stale live runs and blocked policy actors without changing task lineage", () => {
    const graph = buildRunGraph(
      [
        session("stale", {
          status: "coding",
          startedAt: 1_000,
          logs: [{ timestamp: 1_000, type: "text", content: "still running" }],
        }),
        session("blocked", {
          status: "waiting",
          blockedReason: "permission required for Bash",
          nextActor: "human",
          logs: [
            {
              timestamp: 2_000,
              type: "system",
              content: "Needs approval",
              metadata: {
                event: "watchdog_decision",
                decision: "manual",
                toolName: "Bash",
              },
            },
          ],
        }),
      ],
      { now: 20 * 60 * 1000, staleAfterMs: 15 * 60 * 1000 },
    );

    expect(graph.staleCount).toBe(1);
    expect(graph.blockedCount).toBe(1);
    expect(graph.nodes.map((node) => node.id)).toEqual(["blocked", "stale"]);
    expect(graph.nodes.find((node) => node.id === "blocked")).toMatchObject({
      state: "blocked",
      blockedReason: "permission required for Bash",
      nextActor: "human",
    });
    expect(graph.nodes.find((node) => node.id === "stale")).toMatchObject({ state: "stale" });
  });
});

describe("buildWorkstationGraph", () => {
  it("creates typed workspace, thread, pane, agent, file, test, risk, and report nodes", () => {
    const graph = buildWorkstationGraph({
      workspaceId: "C:/repo",
      threadId: "thread-1",
      panes: [{ paneId: "pane-1", terminalId: "pty-1", processId: 42, title: "build", role: "build" }],
      sessions: [
        session("agent-a", {
          name: "Builder",
          role: "implementer",
          changedFileDetails: [{ path: "src/App.tsx", action: "edit", toolName: "Edit", timestamp: 2_000 }],
          logs: [{ timestamp: 2_100, type: "tool_use", content: 'Edit({"file_path":"src/App.tsx"})' }],
        }),
      ],
      tests: [{ id: "vitest-app", name: "App tests", status: "pass", filePath: "src/App.tsx", agentId: "agent-a" }],
      risks: [
        {
          id: "risk-app",
          title: "App surface risk",
          status: "open",
          severity: "medium",
          filePath: "src/App.tsx",
          agentId: "agent-a",
        },
      ],
      blockers: [
        {
          id: "blocker-a",
          title: "Needs validation",
          kind: "validation_failed",
          status: "blocked",
          agentId: "agent-a",
        },
      ],
      notifications: [{ id: "notification-a", title: "Needs attention", status: "delivered", agentId: "agent-a" }],
      finalReports: [{ id: "report-a", title: "Final report", status: "draft", agentId: "agent-a" }],
      contextPacks: [{ id: "pack-a", title: "Context pack", status: "ready", agentId: "agent-a" }],
    });

    expect(graph.nodeCountByKind).toMatchObject({
      workspace: 1,
      thread: 1,
      pane: 1,
      terminal: 1,
      process: 1,
      agent: 1,
      file: 1,
      tool: 1,
      test: 1,
      risk: 1,
      blocker: 1,
      notification: 1,
      final_report: 1,
      context_pack: 1,
    });
    expect(graph.edgeCountByKind).toMatchObject({
      owns: expect.any(Number),
      attached_to: 1,
      changed: expect.any(Number),
      tested: 2,
      blocked_by: 3,
      reports_to: 3,
      used_tool: 1,
    });
    expect(graph.integrity.danglingEdgeCount).toBe(0);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "agent:agent-a", target: "file:src/App.tsx", kind: "changed" }),
        expect.objectContaining({ source: "file:src/App.tsx", target: "test:vitest-app", kind: "tested" }),
        expect.objectContaining({ source: "file:src/App.tsx", target: "risk:risk-app", kind: "blocked_by" }),
      ]),
    );
  });

  it("returns an agent-to-file-test-risk trace for review and handoff surfaces", () => {
    const graph = buildWorkstationGraph({
      workspaceId: "C:/repo",
      sessions: [
        session("agent-a", {
          changedFileDetails: [{ path: ".\\src\\secure\\auth.ts", action: "edit", toolName: "Edit", timestamp: 2_000 }],
        }),
      ],
      tests: [{ id: "auth-test", name: "auth test", status: "fail", filePath: "src/secure/auth.ts" }],
      risks: [
        { id: "risk-auth", title: "Auth change", status: "open", severity: "high", filePath: "src/secure/auth.ts" },
      ],
      notifications: [{ id: "notification-a", title: "Review ready", agentId: "agent-a" }],
      finalReports: [{ id: "report-a", title: "Agent report", agentId: "agent-a" }],
      contextPacks: [{ id: "pack-a", title: "Handoff pack", agentId: "agent-a" }],
    });

    expect(traceAgentImpact(graph, "agent-a")).toEqual({
      agentId: "agent-a",
      files: ["src/secure/auth.ts"],
      tests: ["test:auth-test"],
      risks: ["risk:risk-auth"],
      blockers: [],
      notifications: ["notification:notification-a"],
      finalReports: ["final_report:report-a"],
      contextPacks: ["context_pack:pack-a"],
    });
  });

  it("keeps orphan handoffs owned by the workspace without dangling edges", () => {
    const graph = buildWorkstationGraph({
      workspaceId: "C:/repo",
      sessions: [session("child", { handoffFrom: "missing-parent" })],
    });

    expect(graph.integrity.danglingEdgeCount).toBe(0);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "workspace:C:/repo",
          target: "agent:child",
          kind: "owns",
          metadata: expect.objectContaining({ relationship: "orphan_handoff", handoffFrom: "missing-parent" }),
        }),
      ]),
    );
    expect(graph.edges.some((edge) => edge.source === "agent:missing-parent")).toBe(false);
  });

  it("filters a graph to the selected rail entity and lists graph-backed changed files", () => {
    const graph = buildWorkstationGraph({
      workspaceId: "C:/repo",
      panes: [{ paneId: "pane-a", terminalId: "pty-a", role: "review" }],
      sessions: [
        session("agent-a", {
          changedFileDetails: [{ path: "src/App.tsx", action: "edit", toolName: "Edit", timestamp: 2_000 }],
        }),
        session("agent-b", {
          changedFileDetails: [{ path: "src/Other.tsx", action: "edit", toolName: "Edit", timestamp: 2_100 }],
        }),
      ],
    });

    const filtered = filterWorkstationGraph(graph, { agentId: "agent-a" });

    expect(filtered.integrity.danglingEdgeCount).toBe(0);
    expect(listWorkstationGraphChangedFiles(filtered)).toEqual([{ path: "src/App.tsx", status: "edit" }]);
  });

  it("lists typed graph entity ids for right rail filtered snapshots", () => {
    const graph = buildWorkstationGraph({
      workspaceId: "C:/repo",
      panes: [{ paneId: "pane-a", terminalId: "pty-a", processId: 42, role: "review" }],
      sessions: [session("agent-a")],
      risks: [{ id: "audit-7", title: "Audit warning", status: "open" }],
    });

    expect(listWorkstationGraphAgentIds(graph)).toEqual(["agent-a"]);
    expect(listWorkstationGraphPaneIds(graph)).toEqual(["pane-a"]);
    expect(listWorkstationGraphTerminalIds(graph)).toEqual(["pty-a"]);
    expect(listWorkstationGraphRiskIds(graph)).toEqual(["audit-7"]);
  });
});
