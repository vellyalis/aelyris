// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { mkdirSync, writeFileSync } from "node:fs";
// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { type AiCliLaunchPreflightEvidence, deriveAiCliLaunchPlan } from "../shared/lib/aiCliLaunchPlanner";
import { buildContextPack } from "../shared/lib/contextPack";
import {
  buildRightRailActionAuditPayload,
  deriveRightRailActions,
  type RightRailAction,
} from "../shared/lib/rightRailAdvisor";
import {
  buildWorkstationGraph,
  traceAgentImpact,
  traceFileProvenance,
  type WorkstationGraphCommandBlock,
} from "../shared/lib/workstationGraph";
import type { AgentSession } from "../shared/types/agent";

declare const process: { cwd(): string; env: Record<string, string | undefined> };

const NOW = Date.parse("2026-05-19T15:00:00.000Z");
const WORKSPACE = "C:/repo/aether-terminal";
const TARGET_FILE = "src/features/terminal/NativeTerminalArea.tsx";

const ACTION_PHASE: Record<string, "Plan" | "Run" | "Observe" | "Route" | "Review" | "Preserve" | "Recover"> = {
  "plan-cli-launch": "Plan",
  "ready-command": "Run",
  "track-run": "Observe",
  "inspect-cli-boundary": "Observe",
  "parallel-run": "Route",
  "open-conductor": "Route",
  "review-queue": "Review",
  "trace-provenance": "Review",
  "collect-final-report": "Preserve",
  "handoff-context": "Preserve",
  "recover-attention": "Recover",
  "resolve-approvals": "Recover",
  "inspect-risk": "Recover",
};

function session(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    name: `Agent ${id}`,
    status: "coding",
    model: "gpt-5.5",
    prompt: "Command Center scenario",
    startedAt: NOW,
    logs: [],
    cost: 0,
    tokensUsed: 24_000,
    changedFileDetails: [],
    ...overrides,
  };
}

function realCliEvidence() {
  return {
    ok: true,
    status: "pass",
    finishedAt: "2026-05-19T14:55:00.000Z",
    checks: {
      commandSessionCapability: true,
      passCount: 3,
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
        {
          cli: "claude",
          status: "pass",
          discovery: { preferred: { name: "claude.exe" } },
          markerSeen: true,
          commandNotFound: false,
          versionLike: true,
          outputSample: "2.1.142 (Claude Code)",
        },
        {
          cli: "gemini",
          status: "pass",
          discovery: { preferred: { name: "gemini.cmd" } },
          markerSeen: true,
          commandNotFound: false,
          versionLike: true,
          outputSample: "0.42.0",
        },
      ],
    },
  };
}

function preflightEvidence(): AiCliLaunchPreflightEvidence {
  return {
    nativeInputHost: {
      status: "pass",
      checks: [
        { id: "frontend-native-default", status: "passed" },
        { id: "composition-surface", status: "passed" },
        { id: "surface-ime-preedit-hidden", status: "passed" },
        { id: "commit-command", status: "passed" },
      ],
    },
    ime: {
      status: "pass",
      checks: ["Long Japanese preedit survived", "native input surface geometry inside canvas", "LF paste submitted"],
    },
    processReconnect: {
      ok: true,
      checks: {
        sidecarRetainedTerminal: true,
        sidecarRetainedSplitTerminal: true,
        terminalAdoptedAfterRestart: true,
        splitTerminalAdoptedAfterRestart: true,
      },
    },
    interactiveBoundary: {
      ok: true,
      checks: {
        commandSessionCapability: true,
        clis: [
          {
            cli: "codex",
            backend: "sidecar-command-session",
            inputRoundtrip: true,
            streamReceivedMarker: true,
            closed: true,
          },
          {
            cli: "claude",
            backend: "sidecar-command-session",
            inputRoundtrip: true,
            streamReceivedMarker: true,
            closed: true,
          },
          {
            cli: "gemini",
            backend: "sidecar-command-session",
            inputRoundtrip: true,
            streamReceivedMarker: true,
            closed: true,
          },
        ],
      },
    },
  };
}

function commandBlock(overrides: Partial<WorkstationGraphCommandBlock> = {}): WorkstationGraphCommandBlock {
  return {
    id: "cmd-typecheck-native-terminal",
    command: "pnpm exec tsc --noEmit --pretty false",
    cwd: WORKSPACE,
    status: "passed",
    exitCode: 0,
    shell: "powershell",
    paneId: "pane-impl",
    terminalId: "term-impl",
    processId: 4242,
    agentId: "impl",
    filePaths: [TARGET_FILE],
    validationKind: "typecheck",
    commandSequence: 12,
    outputSequence: 13,
    endSequence: 14,
    commandHistorySize: 80,
    outputHistorySize: 82,
    endHistorySize: 86,
    commandScreenLine: 4,
    outputScreenLine: 5,
    endScreenLine: 12,
    ...overrides,
  };
}

function writeScenarioArtifact(report: Record<string, unknown>): void {
  const out =
    process.env.AETHER_COMMAND_CENTER_SCENARIO_OUT ??
    join(process.cwd(), ".codex-auto", "production-smoke", "command-center-scenario.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), ...report }, null, 2)}\n`);
}

function requireActions(actions: readonly RightRailAction[], ids: readonly RightRailAction["id"][]) {
  const seen = new Set(actions.map((action) => action.id));
  for (const id of ids) expect(seen.has(id), `missing right rail action ${id}`).toBe(true);
}

describe("Command Center end-to-end scenario", () => {
  it("connects launch planning, live run control, provenance, review, handoff, and recovery without spending tokens", () => {
    const launchPlan = deriveAiCliLaunchPlan({
      evidence: realCliEvidence(),
      preflight: preflightEvidence(),
      requirePreflight: true,
      promptContract: {
        objective: "Open a sidecar-backed AI CLI run for a native terminal hardening task.",
        contextSummary: "Use the prepared command-center context pack and keep provenance attached to the run.",
        contextPack: {
          id: "command-center-scenario-pack",
          title: "Command Center Scenario Context",
          source: "smoke",
          generatedAt: "2026-05-19T14:59:00.000Z",
          summary: "Non-token context pack for launch planning, review provenance, and recovery routing.",
          include: ["src/shared/lib/rightRailAdvisor.ts", "src/shared/lib/workstationGraph.ts", TARGET_FILE],
          exclude: ["node_modules", "src-tauri/target", ".env"],
          changedFiles: [TARGET_FILE],
          redactionCount: 0,
        },
        expectedOutput: "Return changed files, validation evidence, final report, and residual risks.",
        doneCriteria: [
          "Changed file has command evidence",
          "Final report is collectable",
          "Recovery actions are visible",
        ],
        guardrails: ["Use sidecar-command-session only", "Do not submit a paid prompt in this smoke"],
        artifacts: ["command-center-scenario trace"],
      },
      requirePromptContract: true,
      preferredProvider: "codex",
      currentTimeMs: NOW,
    });

    const planActions = deriveRightRailActions({
      sessions: [],
      interactiveSessionCount: 0,
      changedFilesCount: 0,
      contextWarnPct: 85,
      currentMode: "observe",
      aiCliLaunchPlan: launchPlan,
    });

    const implementer = session("impl", {
      name: "Native Terminal Implementer",
      status: "done",
      role: "implementer",
      owner: "aether",
      workspaceScope: WORKSPACE,
      worktree: {
        name: "native-terminal-edge",
        path: `${WORKSPACE}/.aether/worktrees/native-terminal-edge`,
        branch: "codex/native-terminal-edge",
        is_main: false,
        head_sha: "abc123",
        status: "Modified",
      },
      tokensUsed: 172_000,
      changedFileDetails: [{ path: TARGET_FILE, action: "edit", toolName: "apply_patch", timestamp: NOW + 100 }],
      logs: [{ timestamp: NOW + 200, type: "tool_use", content: `Edit({"file_path":"${TARGET_FILE}"})` }],
      finalReport: {
        status: "ready",
        title: "Native terminal edge final report",
        path: ".codex-auto/final/native-terminal-edge.md",
        summary: "Native terminal hardening completed with typecheck evidence.",
      },
      closeState: "collectable",
    });
    const reviewer = session("reviewer", {
      name: "Review Runner",
      status: "coding",
      role: "reviewer",
      handoffFrom: "impl",
      tokensUsed: 36_000,
    });
    const recovery = session("recover", {
      name: "Recovery Watch",
      status: "waiting",
      role: "tester",
      blockedReason: "PowerShell prompt readiness needs owner confirmation",
      nextActor: "human",
      tokensUsed: 22_000,
    });

    const graph = buildWorkstationGraph({
      workspaceId: WORKSPACE,
      threadId: "thread-command-center",
      panes: [
        {
          paneId: "pane-impl",
          terminalId: "term-impl",
          processId: 4242,
          title: "PowerShell",
          role: "work",
          status: "live",
        },
        { paneId: "pane-review", terminalId: "term-review", title: "Review", role: "review", status: "live" },
      ],
      sessions: [implementer, reviewer, recovery],
      changedFiles: [{ path: TARGET_FILE, status: "modified" }],
      commandBlocks: [commandBlock()],
      tests: [
        {
          id: "typecheck-native",
          name: "TypeScript typecheck",
          status: "pass",
          filePath: TARGET_FILE,
          agentId: "impl",
        },
      ],
      risks: [
        {
          id: "prompt-readiness-risk",
          title: "Prompt readiness can regress after restart",
          status: "open",
          severity: "medium",
          filePath: TARGET_FILE,
          agentId: "recover",
        },
      ],
      blockers: [
        {
          id: "owner-gate",
          title: "Owner decision required for recovery",
          kind: "approval",
          status: "open",
          agentId: "recover",
          riskId: "prompt-readiness-risk",
        },
      ],
      finalReports: [
        { id: "final-native-edge", title: "Native terminal edge final report", status: "ready", agentId: "impl" },
      ],
      contextPacks: [
        { id: "handoff-native-edge", title: "Native terminal handoff pack", status: "ready", agentId: "impl" },
      ],
    });

    const runActions = deriveRightRailActions({
      sessions: [reviewer],
      interactiveSessionCount: 1,
      changedFilesCount: 0,
      contextWarnPct: 85,
      currentMode: "command",
      workstationGraph: graph,
      selectedPane: { role: "agent", title: "Review Runner" },
    });
    const observeActions = deriveRightRailActions({
      sessions: [reviewer],
      interactiveSessionCount: 1,
      changedFilesCount: 0,
      contextWarnPct: 85,
      currentMode: "command",
    });
    const topologyActions = deriveRightRailActions({
      sessions: [
        session("live-impl", { name: "Live Implementer", status: "coding", role: "implementer" }),
        session("live-review", { name: "Live Reviewer", status: "coding", role: "reviewer", handoffFrom: "live-impl" }),
      ],
      interactiveSessionCount: 0,
      changedFilesCount: 0,
      contextWarnPct: 85,
      currentMode: "command",
    });
    const reviewActions = deriveRightRailActions({
      sessions: [implementer, reviewer],
      interactiveSessionCount: 0,
      changedFilesCount: 1,
      contextWarnPct: 85,
      currentMode: "command",
      guardrailProfile: "Release",
      workstationGraph: graph,
      selectedPane: { role: "review", title: "Review rail" },
    });
    const recoveryActions = deriveRightRailActions({
      sessions: [recovery],
      interactiveSessionCount: 0,
      changedFilesCount: 0,
      contextWarnPct: 85,
      currentMode: "command",
      pendingDecisionCount: 1,
      guardrailProfile: "Conservative",
      workstationGraph: graph,
    });

    const allActions = [
      ...planActions,
      ...runActions,
      ...observeActions,
      ...topologyActions,
      ...reviewActions,
      ...recoveryActions,
    ];
    requireActions(allActions, [
      "plan-cli-launch",
      "ready-command",
      "track-run",
      "inspect-cli-boundary",
      "parallel-run",
      "open-conductor",
      "review-queue",
      "trace-provenance",
      "collect-final-report",
      "handoff-context",
      "recover-attention",
      "resolve-approvals",
      "inspect-risk",
    ]);

    const provenance = traceFileProvenance(graph, TARGET_FILE);
    const impact = traceAgentImpact(graph, "impl");
    const pack = buildContextPack({
      generatedAt: "2026-05-19T15:00:00.000Z",
      workspace: { name: "Aether Terminal", path: WORKSPACE, branch: "main", threadId: "thread-command-center" },
      activeTask: {
        id: "edge-command-center",
        title: "Native terminal command center scenario",
        status: "review-ready",
        nextAction: "Collect report, review provenance, and resolve the recovery gate.",
      },
      sessions: [implementer, reviewer, recovery],
      panes: [
        { paneId: "pane-impl", terminalId: "term-impl", title: "PowerShell", role: "work", status: "live" },
        { paneId: "pane-review", terminalId: "term-review", title: "Review", role: "review", status: "live" },
      ],
      changedFiles: [{ path: TARGET_FILE, status: "modified", validation: "passed", coverage: "covered" }],
      commandsRun: [{ command: "pnpm exec tsc --noEmit --pretty false", result: "pass", source: "term-impl" }],
      validations: [
        {
          command: "pnpm exec tsc --noEmit --pretty false",
          result: "pass",
          evidence: "command block cmd-typecheck-native-terminal exited 0",
        },
      ],
      blockers: [
        {
          id: "owner-gate",
          kind: "approval",
          status: "open",
          reason: "Recovery path should be owner-routed, not silently retried.",
          nextAction: "Resolve approval from Decision Inbox.",
        },
      ],
      risks: [
        {
          id: "prompt-readiness-risk",
          title: "Prompt readiness can regress after restart",
          status: "open",
          severity: "medium",
          mitigation: "Keep post-launch chaos and prompt-readiness gates green.",
        },
      ],
      finalReport: {
        title: "Native terminal edge final report",
        summary: "Native terminal hardening completed with typecheck evidence and recovery gate visibility.",
        path: ".codex-auto/final/native-terminal-edge.md",
      },
      workstationGraph: graph,
    });

    const auditPayloads = allActions.map((action) => buildRightRailActionAuditPayload(action, "command"));
    const phases = new Set(allActions.map((action) => ACTION_PHASE[action.id]).filter(Boolean));
    const checks = {
      launchPlanReady:
        launchPlan.status === "ready" &&
        launchPlan.recommendedBackend === "sidecar-command-session" &&
        launchPlan.trace.contextPack?.id === "command-center-scenario-pack",
      loopPhasesCovered: ["Plan", "Run", "Observe", "Route", "Review", "Preserve", "Recover"].every((phase) =>
        phases.has(phase as never),
      ),
      provenanceReady:
        provenance.hasEvidence &&
        provenance.owners.some((owner) => owner.id === "impl") &&
        provenance.commands.some(
          (command) =>
            command.id === "command_block:cmd-typecheck-native-terminal" &&
            command.terminalId === "term-impl" &&
            command.endSequence === 14,
        ) &&
        provenance.tests.some((test) => test.status === "pass") &&
        provenance.worktrees.includes(`${WORKSPACE}/.aether/worktrees/native-terminal-edge`),
      finalReportAndContextReady:
        impact.finalReports.includes("final_report:final-native-edge") &&
        impact.contextPacks.includes("context_pack:handoff-native-edge") &&
        pack.json.summary.finalReportIncluded === true &&
        pack.json.workstationGraph.nodeCount > 0,
      recoveryReady:
        recoveryActions[0]?.id === "resolve-approvals" &&
        recoveryActions.some((action) => action.id === "recover-attention") &&
        recoveryActions.some((action) => action.id === "inspect-risk") &&
        recoveryActions.every(
          (action) => action.execution.recoveryStep && action.execution.auditEvent.startsWith("right_rail."),
        ),
      auditPayloadsComplete: auditPayloads.every(
        (payload) => payload.evidence && payload.nextStep && payload.target && payload.expectedResult,
      ),
    };

    expect(checks).toEqual({
      launchPlanReady: true,
      loopPhasesCovered: true,
      provenanceReady: true,
      finalReportAndContextReady: true,
      recoveryReady: true,
      auditPayloadsComplete: true,
    });

    writeScenarioArtifact({
      ok: true,
      checks,
      actionIds: [...new Set(allActions.map((action) => action.id))].sort(),
      phases: [...phases].sort(),
      provenance: {
        path: provenance.path,
        ownerIds: provenance.owners.map((owner) => owner.id),
        commandIds: provenance.commands.map((command) => command.id),
        testIds: provenance.tests.map((test) => test.id),
        worktrees: provenance.worktrees,
      },
      impact,
      contextPackSummary: pack.json.summary,
      launchTrace: launchPlan.trace,
      auditPayloadCount: auditPayloads.length,
    });
  });
});
