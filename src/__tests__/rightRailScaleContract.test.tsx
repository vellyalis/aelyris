import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewQueuePanel } from "../features/review/ReviewQueuePanel";
import { deriveAiCliLaunchPlan } from "../shared/lib/aiCliLaunchPlanner";
import { deriveRightRailActions, type RightRailActionId } from "../shared/lib/rightRailAdvisor";
import { buildWorkstationGraph } from "../shared/lib/workstationGraph";
import type { AgentSession } from "../shared/types/agent";
import type { InteractiveSession } from "../shared/types/interactiveAgent";

afterEach(() => cleanup());

const ACTION_DERIVE_BUDGET_MS = 120;
const REVIEW_RENDER_BUDGET_MS = 2500;

function emitScaleCheck(name: string, value: Record<string, unknown>) {
  console.log(`AETHER_RIGHT_RAIL_SCALE_CHECK ${JSON.stringify({ name, value })}`);
}

function session(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    name: `Agent ${id}`,
    status: "coding",
    model: "claude-sonnet",
    prompt: "work",
    startedAt: 1,
    logs: [],
    cost: 0,
    tokensUsed: 10_000,
    changedFileDetails: [],
    ...overrides,
  };
}

function interactiveSession(overrides: Partial<InteractiveSession> = {}): InteractiveSession {
  return {
    id: "pty-1",
    pty_id: "pty-1",
    backend: "sidecar",
    cli: "codex",
    status: "running",
    model: "gpt-5.5",
    cwd: "C:/repo",
    cost: 0,
    tokens_used: 0,
    started_at: 0,
    ...overrides,
  };
}

function realCliEvidence() {
  return {
    ok: true,
    status: "pass",
    finishedAt: "2026-05-19T10:26:48.565Z",
    checks: {
      commandSessionCapability: true,
      clis: [
        {
          cli: "codex",
          status: "pass",
          discovery: { preferred: { name: "codex.cmd" } },
          markerSeen: true,
          commandNotFound: false,
          versionLike: true,
          outputSample: "codex-cli 0.130.0",
        },
      ],
    },
  };
}

describe("right rail scale and edge contracts", () => {
  it("covers at least twelve real product states with ranked actions", () => {
    const launchPlanNow = Date.parse("2026-05-19T10:30:00.000Z");
    const cases: Array<{
      name: string;
      expected: RightRailActionId;
      input: Parameters<typeof deriveRightRailActions>[0];
    }> = [
      {
        name: "high context handoff",
        expected: "handoff-context",
        input: {
          sessions: [session("long", { name: "Long Runner", tokensUsed: 190_000 })],
          interactiveSessionCount: 0,
          changedFilesCount: 0,
          contextWarnPct: 85,
          currentMode: "command",
        },
      },
      {
        name: "approval gate",
        expected: "resolve-approvals",
        input: {
          sessions: [],
          interactiveSessionCount: 0,
          changedFilesCount: 0,
          contextWarnPct: 85,
          currentMode: "observe",
          pendingDecisionCount: 2,
        },
      },
      {
        name: "blocked run",
        expected: "recover-attention",
        input: {
          sessions: [session("blocked", { status: "waiting", blockedReason: "owner gate" })],
          interactiveSessionCount: 0,
          changedFilesCount: 0,
          contextWarnPct: 85,
          currentMode: "command",
        },
      },
      {
        name: "release risk",
        expected: "inspect-risk",
        input: {
          sessions: [],
          interactiveSessionCount: 0,
          changedFilesCount: 0,
          contextWarnPct: 85,
          currentMode: "command",
          workstationGraph: buildWorkstationGraph({
            workspaceId: "C:/repo",
            risks: [{ id: "risk-1", title: "missing proof", status: "open" }],
          }),
        },
      },
      {
        name: "native fallback",
        expected: "inspect-cli-boundary",
        input: {
          sessions: [],
          interactiveSessionCount: 1,
          interactiveNativeFallbackCount: 1,
          changedFilesCount: 0,
          contextWarnPct: 85,
          currentMode: "command",
        },
      },
      {
        name: "blocked launch gate",
        expected: "plan-cli-launch",
        input: {
          sessions: [],
          interactiveSessionCount: 0,
          changedFilesCount: 0,
          contextWarnPct: 85,
          currentMode: "command",
          aiCliLaunchPlan: deriveAiCliLaunchPlan({
            evidence: realCliEvidence(),
            interactiveSessions: [interactiveSession({ backend: "native" })],
            currentTimeMs: launchPlanNow,
          }),
        },
      },
      {
        name: "focused test review",
        expected: "focused-review",
        input: {
          sessions: [],
          interactiveSessionCount: 0,
          changedFilesCount: 3,
          contextWarnPct: 85,
          currentMode: "command",
          selectedPane: { role: "test", title: "Validation" },
        },
      },
      {
        name: "final report collection",
        expected: "collect-final-report",
        input: {
          sessions: [session("done", { finalReport: { status: "ready" }, closeState: "collectable" })],
          interactiveSessionCount: 0,
          changedFilesCount: 0,
          contextWarnPct: 85,
          currentMode: "command",
        },
      },
      {
        name: "provenance trace",
        expected: "trace-provenance",
        input: {
          sessions: [
            session("owner", {
              changedFileDetails: [{ path: "src/App.tsx", action: "edit", toolName: "Edit", timestamp: 1 }],
            }),
          ],
          interactiveSessionCount: 0,
          changedFilesCount: 0,
          contextWarnPct: 85,
          currentMode: "command",
          workstationGraph: buildWorkstationGraph({
            workspaceId: "C:/repo",
            sessions: [
              session("owner", {
                changedFileDetails: [{ path: "src/App.tsx", action: "edit", toolName: "Edit", timestamp: 1 }],
              }),
            ],
          }),
        },
      },
      {
        name: "plain review queue",
        expected: "review-queue",
        input: {
          sessions: [],
          interactiveSessionCount: 0,
          changedFilesCount: 4,
          contextWarnPct: 85,
          currentMode: "observe",
        },
      },
      {
        name: "context pack during run",
        expected: "inspect-context",
        input: {
          sessions: [session("runner")],
          interactiveSessionCount: 0,
          changedFilesCount: 0,
          contextWarnPct: 85,
          currentMode: "command",
          workstationGraph: buildWorkstationGraph({
            workspaceId: "C:/repo",
            contextPacks: [{ id: "ctx-1", title: "handoff", status: "attached", agentId: "runner" }],
          }),
        },
      },
      {
        name: "selected live pane",
        expected: "track-selected",
        input: {
          sessions: [session("runner")],
          interactiveSessionCount: 0,
          changedFilesCount: 0,
          contextWarnPct: 85,
          currentMode: "command",
          selectedPane: { role: "agent", title: "Codex worker" },
        },
      },
      {
        name: "parallel run",
        expected: "parallel-run",
        input: {
          sessions: [session("a"), session("b")],
          interactiveSessionCount: 0,
          changedFilesCount: 0,
          contextWarnPct: 85,
          currentMode: "command",
        },
      },
      {
        name: "topology",
        expected: "open-conductor",
        input: {
          sessions: [
            session("impl", { status: "done", role: "implementer" }),
            session("review", { status: "done", role: "reviewer", handoffFrom: "impl" }),
          ],
          interactiveSessionCount: 0,
          changedFilesCount: 0,
          contextWarnPct: 85,
          currentMode: "command",
        },
      },
      {
        name: "idle command",
        expected: "ready-command",
        input: {
          sessions: [],
          interactiveSessionCount: 0,
          changedFilesCount: 0,
          contextWarnPct: 85,
          currentMode: "observe",
        },
      },
    ];

    const observed = cases.map((item) => {
      const actions = deriveRightRailActions(item.input);
      expect(actions[0]?.id, item.name).toBe(item.expected);
      for (const action of actions) {
        expect(action.why.length, `${item.name} why`).toBeGreaterThan(12);
        expect(action.nextStep.length, `${item.name} next step`).toBeGreaterThan(12);
        expect(action.execution.expectedResult.length, `${item.name} expected result`).toBeGreaterThan(24);
      }
      return { name: item.name, topAction: actions[0]?.id, actionCount: actions.length };
    });

    emitScaleCheck("actionStateCoverage", {
      required: 12,
      covered: observed.length,
      distinctTopActions: new Set(observed.map((item) => item.topAction)).size,
      observed,
    });
  });

  it("keeps twenty live sessions readable as a small ranked action stack", () => {
    const sessions = Array.from({ length: 20 }, (_, index) =>
      session(`agent-${index}`, {
        role: index % 2 === 0 ? "implementer" : "reviewer",
        handoffFrom: index === 0 ? undefined : `agent-${index - 1}`,
      }),
    );

    const startedAt = performance.now();
    const actions = deriveRightRailActions({
      sessions,
      interactiveSessionCount: 0,
      changedFilesCount: 0,
      contextWarnPct: 85,
      currentMode: "command",
    });
    const deriveMs = performance.now() - startedAt;

    expect(deriveMs).toBeLessThan(ACTION_DERIVE_BUDGET_MS);
    expect(actions.length).toBeLessThanOrEqual(5);
    expect(actions.map((action) => action.id)).toContain("parallel-run");
    expect(actions.map((action) => action.id)).toContain("open-conductor");

    emitScaleCheck("twentySessionStress", {
      sessions: sessions.length,
      actionCount: actions.length,
      actionIds: actions.map((action) => action.id),
      deriveMs,
      thresholdMs: ACTION_DERIVE_BUDGET_MS,
    });
  });

  it("keeps a five hundred file review queue bounded and actionable", () => {
    const changedFiles = Array.from({ length: 500 }, (_, index) => ({
      path: `src/generated/review-scale-${String(index).padStart(3, "0")}.ts`,
      status: "modified",
      additions: (index % 17) + 1,
      deletions: index % 5,
      generated: index % 19 === 0,
    }));

    const startedAt = performance.now();
    const { container } = render(
      <ReviewQueuePanel
        activeSessionId={null}
        changedFiles={changedFiles}
        sessions={[]}
        onOpenDiff={() => {}}
        onSelectSession={() => {}}
      />,
    );
    const renderMs = performance.now() - startedAt;

    expect(renderMs).toBeLessThan(REVIEW_RENDER_BUDGET_MS);
    expect(screen.getByLabelText("AI review queue")).toBeTruthy();
    expect(screen.getByText("+494 more files in SCM")).toBeTruthy();
    expect(container.querySelectorAll("button[title^='src/generated/review-scale']").length).toBe(6);

    emitScaleCheck("reviewQueueScale", {
      files: changedFiles.length,
      visibleRows: container.querySelectorAll("button[title^='src/generated/review-scale']").length,
      hiddenFiles: 494,
      renderMs,
      thresholdMs: REVIEW_RENDER_BUDGET_MS,
    });
  });
});
