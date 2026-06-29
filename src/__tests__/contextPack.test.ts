import { describe, expect, it } from "vitest";
import {
  buildContextPack,
  buildContextPackMarkdown,
  type ContextPackInput,
  redactSensitiveText,
} from "../shared/lib/contextPack";
import { buildWorkstationGraph } from "../shared/lib/workstationGraph";
import type { AgentSession } from "../shared/types/agent";
import type { AuditEventRecord } from "../shared/types/audit";

const REDACTION_TEST_OPENAI_KEY = `sk-${"REDACTION_TEST_OPENAI_KEY"}`;
const REDACTION_TEST_BEARER = "REDACTION" + "TESTBEARERTOKEN";
const REDACTION_TEST_FLAG_SECRET = "REDACTION_TEST_FLAG_SECRET";
const REDACTION_TEST_DASHBOARD_TOKEN = "REDACTION_TEST_DASHBOARD_TOKEN";

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "agent-a",
    name: "Builder",
    status: "coding",
    model: "claude-sonnet",
    prompt: "Implement the context pack",
    startedAt: 1,
    logs: [
      {
        timestamp: 2,
        type: "text",
        content: `Implemented generator with OPENAI_API_KEY=${REDACTION_TEST_OPENAI_KEY} in the local shell.`,
      },
      {
        timestamp: 3,
        type: "tool_result",
        content: `pnpm test passed with Authorization: Bearer ${REDACTION_TEST_BEARER}`,
      },
    ],
    cost: 0.4,
    tokensUsed: 44_000,
    changedFileDetails: [
      { path: "src/shared/lib/contextPack.ts", action: "create", toolName: "apply_patch", timestamp: 4 },
    ],
    ...overrides,
  };
}

function audit(overrides: Partial<AuditEventRecord>): AuditEventRecord {
  return {
    id: 1,
    timestamp: "2026-05-05T10:00:00.000Z",
    category: "agent",
    action: "progress",
    severity: "info",
    entityType: "agent",
    entityId: "agent-a",
    summary: "Progress updated",
    metadata: {},
    ...overrides,
  };
}

function baseInput(overrides: Partial<ContextPackInput> = {}): ContextPackInput {
  const sessions = [session()];
  const workstationGraph = buildWorkstationGraph({
    workspaceId: "C:/repo",
    threadId: "thread-1",
    sessions,
    changedFiles: [{ path: "src/App.tsx", status: "modified" }],
    finalReports: [{ id: "report-1", title: "Final report", status: "ready", agentId: "agent-a" }],
    contextPacks: [{ id: "pack-1", title: "Context pack", status: "ready", agentId: "agent-a" }],
  });
  return {
    generatedAt: "2026-05-05T12:00:00.000Z",
    workspace: { name: "Aelyris", path: "C:/repo", branch: "main", threadId: "thread-1" },
    activeTask: {
      id: "P1-07",
      title: "Context Pack Builder",
      status: "doing",
      parentRoadmapId: "P1-07",
      reason: "blocker-decomposition",
      nextAction: "Run focused context pack validation.",
    },
    sessions,
    changedFiles: [{ path: "src/features/context/ContextPanel.tsx", status: "modified" }],
    panes: [{ paneId: "pane-1", terminalId: "term-1", title: "PowerShell", role: "work", status: "live" }],
    commandsRun: [
      {
        command: `pnpm test -- --token ${REDACTION_TEST_FLAG_SECRET}`,
        result: "pass",
      },
    ],
    validations: [{ command: "pnpm exec vitest contextPack.test.ts", result: "pass", evidence: "1 file passed" }],
    blockers: [{ id: "blocker-1", kind: "timeout", status: "resolved", reason: "Previous turn timed out" }],
    decisions: [{ id: "decision-1", decision: "Use a frontend state builder", rationale: "Keep the slice narrow" }],
    risks: [{ id: "risk-1", title: "Live Tauri smoke gap", severity: "low", status: "open" }],
    diffSummary: "2 files changed, 120 insertions",
    finalReport: {
      title: "P1-06 final report",
      summary: "Aelyris run completed with focused validation.",
      markdown: "Final report body",
    },
    dashboardState: { status: "running", token: REDACTION_TEST_DASHBOARD_TOKEN, fileContent: "raw source should not leak" },
    workstationGraph,
    ...overrides,
  };
}

describe("buildContextPack", () => {
  it("generates markdown, machine-readable json, and a thread summary from handoff inputs", () => {
    const pack = buildContextPack(baseInput());

    expect(pack.threadSummary).toContain("P1-07 Context Pack Builder");
    expect(pack.threadSummary).toContain("Final report included: yes");
    expect(pack.markdown).toContain("# Context Pack: Aelyris");
    expect(pack.markdown).toContain("## Agent Transcripts");
    expect(pack.markdown).toContain("Aelyris run completed with focused validation.");
    expect(pack.markdown).toContain("src/features/context/ContextPanel.tsx");
    expect(pack.markdown).toContain("pnpm exec vitest contextPack.test.ts");
    expect(pack.json.summary.nextActions).toContain("Run focused context pack validation.");
    expect(pack.json.finalReport?.summary).toBe("Aelyris run completed with focused validation.");
    expect(pack.json.workstationGraph.nodeCount).toBeGreaterThan(0);
  });

  it("redacts tokens, authorization headers, command secrets, dashboard payloads, and transcript secrets", () => {
    const pack = buildContextPack(baseInput());
    const serialized = JSON.stringify(pack);

    expect(serialized).not.toContain(REDACTION_TEST_OPENAI_KEY);
    expect(serialized).not.toContain(REDACTION_TEST_BEARER);
    expect(serialized).not.toContain(REDACTION_TEST_FLAG_SECRET);
    expect(serialized).not.toContain(REDACTION_TEST_DASHBOARD_TOKEN);
    expect(serialized).not.toContain("raw source should not leak");
    expect(pack.json.summary.redactionCount).toBeGreaterThanOrEqual(5);
  });

  it("auto-includes final report evidence from audit events when no explicit report is supplied", () => {
    const pack = buildContextPack(
      baseInput({
        finalReport: null,
        auditEvents: [
          audit({
            id: 9,
            action: "final_report_written",
            summary: "P1-07 completed and ready for handoff",
            metadata: { path: ".codex-auto/final-report.md" },
          }),
        ],
      }),
    );

    expect(pack.json.finalReport?.summary).toBe("P1-07 completed and ready for handoff");
    expect(pack.markdown).toContain("P1-07 completed and ready for handoff");
    expect(pack.threadSummary).toContain("Final report included: yes");
  });

  it("keeps the markdown fixture reproducible from the json payload", () => {
    const pack = buildContextPack(baseInput());
    expect(buildContextPackMarkdown(pack.json)).toBe(pack.markdown);
    expect(pack.json.changedFiles.map((file) => file.path)).toEqual([
      "src/App.tsx",
      "src/features/context/ContextPanel.tsx",
      "src/shared/lib/contextPack.ts",
    ]);
  });

  it("exports the redaction primitive for focused fixtures", () => {
    const text = redactSensitiveText(`Authorization: Bearer ${REDACTION_TEST_BEARER} --api-key ${REDACTION_TEST_OPENAI_KEY} token=plain-secret`);
    expect(text).not.toContain(REDACTION_TEST_BEARER);
    expect(text).not.toContain(REDACTION_TEST_OPENAI_KEY);
    expect(text).not.toContain("plain-secret");
    expect(text).toContain("[redacted]");
  });
});
