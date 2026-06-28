import { describe, expect, it } from "vitest";
import { type AiCliProbeEvidence, deriveAiCliLaunchPlan } from "../shared/lib/aiCliLaunchPlanner";
import type { InteractiveSession } from "../shared/types/interactiveAgent";

const NOW = Date.parse("2026-05-19T10:30:00.000Z");

function realCliEvidence(overrides: Partial<AiCliProbeEvidence> = {}): AiCliProbeEvidence {
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
          discovery: { preferred: { name: "codex.cmd", path: "C:/Users/example/AppData/Roaming/npm/codex.cmd" } },
          executablePath: "C:/Users/example/AppData/Roaming/npm/codex.cmd",
          attemptCount: 1,
          retried: false,
          attempts: [{ cli: "codex", attempt: 1, executablePath: "C:/Users/example/AppData/Roaming/npm/codex.cmd" }],
          markerSeen: true,
          commandNotFound: false,
          versionLike: true,
          outputSample: "codex-cli 0.130.0",
        },
        {
          cli: "claude",
          status: "pass",
          discovery: { preferred: { name: "claude.exe", path: "C:/Users/example/.local/bin/claude.exe" } },
          executablePath: "C:/Users/example/.local/bin/claude.exe",
          attemptCount: 1,
          retried: false,
          attempts: [{ cli: "claude", attempt: 1, executablePath: "C:/Users/example/.local/bin/claude.exe" }],
          markerSeen: true,
          commandNotFound: false,
          versionLike: true,
          outputSample: "2.1.142 (Claude Code)",
        },
        {
          cli: "gemini",
          status: "pass",
          discovery: { preferred: { name: "gemini.cmd", path: "C:/Users/example/AppData/Roaming/npm/gemini.cmd" } },
          executablePath: "C:/Users/example/AppData/Roaming/npm/gemini.cmd",
          attemptCount: 1,
          retried: false,
          attempts: [{ cli: "gemini", attempt: 1, executablePath: "C:/Users/example/AppData/Roaming/npm/gemini.cmd" }],
          markerSeen: true,
          commandNotFound: false,
          versionLike: true,
          outputSample: "0.42.0",
        },
      ],
      passCount: 3,
      missingCount: 0,
    },
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
    model: "codex-mini",
    cwd: "C:/repo",
    cost: 0,
    tokens_used: 0,
    started_at: 0,
    ...overrides,
  };
}

function preflightEvidence() {
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
      checks: [
        "Long Japanese preedit handoff uses native input surface",
        "native input surface geometry inside canvas; surface=378x666, canvas=378x666",
        "LF paste submitted through native input surface",
      ],
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
        clis: ["codex", "claude", "gemini"].map((cli) => ({
          cli,
          backend: "sidecar-command-session",
          streamReceivedMarker: true,
          inputRoundtrip: true,
          closed: true,
        })),
      },
    },
  };
}

function muxLiveProcessPreservationEvidence() {
  return {
    ok: true,
    status: "passed",
    currentCapability: "daemon-live-detach-reattach-same-process",
    requiredCapability: "same-process-or-broker-preserved-reconnect",
    checks: [
      { id: "graph-live-binding-carries-process-id", ok: true },
      { id: "integration-test-proves-same-process-detach-reattach", ok: true },
      { id: "restart-restore-still-clears-stale-live-identity", ok: true },
    ],
  };
}

function promptContract() {
  return {
    objective: "Review the current workspace changes and report the safest next implementation step.",
    contextSummary: "Use the prepared context pack and avoid unrelated files outside the active workspace.",
    contextPack: {
      id: "ctx-launch-1",
      title: "Launch context",
      summary: "Prepared handoff pack with current task, changed files, validation, and residual risks.",
      source: "context-panel" as const,
      generatedAt: "2026-05-19T10:29:00.000Z",
      include: ["src/shared/lib/aiCliLaunchPlanner.ts", "src/shared/lib/contextPack.ts"],
      exclude: ["node_modules", "target", ".env"],
      changedFiles: ["src/shared/lib/aiCliLaunchPlanner.ts"],
      redactionCount: 2,
    },
    expectedOutput: "Return a concise engineering report with changed files, validation, and residual risks.",
    doneCriteria: ["Summarize the implementation result and validation evidence."],
    guardrails: ["Do not mutate files outside the selected worktree or bypass the sidecar command-session boundary."],
    artifacts: ["right-rail audit trace"],
  };
}

describe("deriveAiCliLaunchPlan", () => {
  it("promotes fresh real Codex/Claude/Gemini sidecar evidence into a ready launch plan", () => {
    const plan = deriveAiCliLaunchPlan({
      evidence: realCliEvidence(),
      preferredProvider: "codex",
      currentTimeMs: NOW,
    });

    expect(plan).toMatchObject({
      status: "ready",
      grade: "S",
      recommendedProvider: "codex",
      recommendedBackend: "sidecar-command-session",
      actionLabel: "Plan AI launch",
      detail: "3/3 CLIs proven · sidecar first",
      guardrailLabel: "Launch proof",
    });
    expect(plan.cliPlans.map((cli) => [cli.provider, cli.status, cli.launcher])).toEqual([
      ["claude", "ready", "claude.exe"],
      ["codex", "ready", "codex.cmd"],
      ["gemini", "ready", "gemini.cmd"],
    ]);
    expect(plan.expectedArtifacts).toContain(
      "machine-readable context pack trace with inclusion, exclusion, redaction, and changed-file counts",
    );
    expect(plan.preflightChecks.map((check) => check.status)).toEqual(["unknown", "unknown", "unknown", "unknown"]);
    expect(plan.trace).toMatchObject({
      schemaVersion: 1,
      kind: "ai-cli-launch-plan",
      recommendedProvider: "codex",
      recommendedBackend: "sidecar-command-session",
      selectedLauncher: "codex.cmd",
      selectedExecutablePath: "C:/Users/example/AppData/Roaming/npm/codex.cmd",
      selectedAttemptCount: 1,
      selectedVersion: "codex-cli 0.130.0",
    });
    expect(plan.trace.cliMatrix).toEqual([
      {
        provider: "claude",
        status: "ready",
        launcher: "claude.exe",
        executablePath: "C:/Users/example/.local/bin/claude.exe",
        attemptCount: 1,
        retried: false,
        version: "2.1.142 (Claude Code)",
      },
      {
        provider: "codex",
        status: "ready",
        launcher: "codex.cmd",
        executablePath: "C:/Users/example/AppData/Roaming/npm/codex.cmd",
        attemptCount: 1,
        retried: false,
        version: "codex-cli 0.130.0",
      },
      {
        provider: "gemini",
        status: "ready",
        launcher: "gemini.cmd",
        executablePath: "C:/Users/example/AppData/Roaming/npm/gemini.cmd",
        attemptCount: 1,
        retried: false,
        version: "0.42.0",
      },
    ]);
  });

  it("keeps a ready launch plan when required terminal preflight evidence is complete", () => {
    const plan = deriveAiCliLaunchPlan({
      evidence: realCliEvidence(),
      preflight: preflightEvidence(),
      requirePreflight: true,
      preferredProvider: "claude",
      currentTimeMs: NOW,
    });

    expect(plan.status).toBe("ready");
    expect(plan.preflightChecks.map((check) => [check.id, check.status])).toEqual([
      ["native-ime", "ready"],
      ["clipboard-text", "ready"],
      ["process-reconnect", "ready"],
      ["interactive-cli-boundary", "ready"],
    ]);
    expect(plan.trace.preflightChecks.every((check) => check.status === "ready")).toBe(true);
    expect(plan.expectedArtifacts).toContain("native IME, clipboard, reconnect, and AI CLI input-boundary preflight");
  });

  it("accepts daemon-live mux process preservation when process restart proof is unavailable", () => {
    const plan = deriveAiCliLaunchPlan({
      evidence: realCliEvidence(),
      preflight: {
        ...preflightEvidence(),
        processReconnect: { ok: false, checks: {} },
        muxLiveProcessPreservation: muxLiveProcessPreservationEvidence(),
      },
      requirePreflight: true,
      preferredProvider: "claude",
      currentTimeMs: NOW,
    });

    const reconnect = plan.preflightChecks.find((check) => check.id === "process-reconnect");
    expect(plan.status).toBe("ready");
    expect(reconnect).toMatchObject({ status: "ready" });
    expect(reconnect?.detail).toContain("daemon-live detach/reattach");
    expect(reconnect?.detail).toContain("restart restore remains a separate release gate");
  });

  it("accepts native HWND IME and paste evidence when live CDP IME proof is unavailable", () => {
    const preflight = preflightEvidence();
    const plan = deriveAiCliLaunchPlan({
      evidence: realCliEvidence(),
      preflight: {
        ...preflight,
        nativeInputHost: {
          status: "pass",
          checks: [
            { id: "frontend-native-default", status: "passed" },
            { id: "composition-surface", status: "passed" },
            { id: "surface-ime-preedit-hidden", status: "passed" },
            { id: "surface-custom-hwnd-runway", status: "passed" },
            { id: "commit-command", status: "passed" },
            { id: "behavioral-native-hwnd-paste-live", status: "passed" },
          ],
        },
        ime: { status: "environment-blocked", checks: [] },
      },
      requirePreflight: true,
      preferredProvider: "claude",
      currentTimeMs: NOW,
    });

    expect(plan.preflightChecks.map((check) => [check.id, check.status])).toEqual([
      ["native-ime", "ready"],
      ["clipboard-text", "ready"],
      ["process-reconnect", "ready"],
      ["interactive-cli-boundary", "ready"],
    ]);
    expect(plan.status).toBe("ready");
  });

  it("keeps a ready launch plan when required prompt contract evidence is complete", () => {
    const plan = deriveAiCliLaunchPlan({
      evidence: realCliEvidence(),
      preflight: preflightEvidence(),
      requirePreflight: true,
      promptContract: promptContract(),
      requirePromptContract: true,
      preferredProvider: "claude",
      currentTimeMs: NOW,
    });

    expect(plan.status).toBe("ready");
    expect(plan.promptContractChecks.map((check) => [check.id, check.status])).toEqual([
      ["prompt-objective", "ready"],
      ["prompt-context", "ready"],
      ["prompt-output", "ready"],
      ["prompt-done", "ready"],
      ["prompt-guardrails", "ready"],
    ]);
    expect(plan.trace.promptContractChecks.every((check) => check.status === "ready")).toBe(true);
    expect(plan.expectedArtifacts).toContain(
      "prompt contract with objective, context pack, output, done criteria, and guardrails",
    );
    expect(plan.trace.contextPack).toMatchObject({
      id: "ctx-launch-1",
      title: "Launch context",
      source: "context-panel",
      includeCount: 2,
      excludeCount: 3,
      changedFileCount: 1,
      redactionCount: 2,
    });
  });

  it("blocks prompt launch when the context summary exists but the machine-readable context pack is missing", () => {
    const contractWithoutPack = { ...promptContract(), contextPack: null };
    const plan = deriveAiCliLaunchPlan({
      evidence: realCliEvidence(),
      preflight: preflightEvidence(),
      requirePreflight: true,
      promptContract: contractWithoutPack,
      requirePromptContract: true,
      preferredProvider: "codex",
      currentTimeMs: NOW,
    });

    expect(plan.status).toBe("blocked");
    expect(plan.detail).toBe("1 prompt gate blocked");
    expect(plan.promptContractChecks.find((check) => check.id === "prompt-context")).toMatchObject({
      status: "blocked",
      detail: "machine-readable context pack is missing",
    });
    expect(plan.trace.contextPack).toBeNull();
  });

  it("blocks launch when required terminal preflight evidence is incomplete", () => {
    const plan = deriveAiCliLaunchPlan({
      evidence: realCliEvidence(),
      preflight: { ...preflightEvidence(), ime: { status: "failed", checks: [] } },
      requirePreflight: true,
      preferredProvider: "claude",
      currentTimeMs: NOW,
    });

    expect(plan.status).toBe("blocked");
    expect(plan.detail).toBe("2 preflight gates blocked");
    expect(plan.warnings[0]).toContain("Native IME");
    expect(plan.warnings[0]).toContain("Clipboard text");
  });

  it("blocks launch when required prompt contract evidence is incomplete", () => {
    const plan = deriveAiCliLaunchPlan({
      evidence: realCliEvidence(),
      preflight: preflightEvidence(),
      requirePreflight: true,
      promptContract: {
        ...promptContract(),
        expectedOutput: "",
        doneCriteria: [],
      },
      requirePromptContract: true,
      preferredProvider: "claude",
      currentTimeMs: NOW,
    });

    expect(plan.status).toBe("blocked");
    expect(plan.detail).toBe("2 prompt gates blocked");
    expect(plan.warnings[0]).toContain("Expected output");
    expect(plan.warnings[0]).toContain("Done criteria");
  });

  it("selects a proven provider when the requested provider has a broken launcher", () => {
    const evidence = realCliEvidence({
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
          {
            cli: "claude",
            status: "fail",
            discovery: { preferred: { name: "claude.cmd" } },
            markerSeen: false,
            commandNotFound: false,
            outputSample: "SyntaxError",
          },
        ],
      },
    });

    const plan = deriveAiCliLaunchPlan({
      evidence,
      preferredProvider: "claude",
      currentTimeMs: NOW,
    });

    expect(plan.status).toBe("degraded");
    expect(plan.recommendedProvider).toBe("codex");
    expect(plan.detail).toBe("1/3 CLIs proven · Codex selected");
    expect(plan.trace.selectedLauncher).toBe("codex.cmd");
    expect(plan.warnings).toContain("Use a proven provider or refresh/repair the failed launcher before launch.");
  });

  it("does not treat fatal launcher output as a proven real CLI", () => {
    const evidence = realCliEvidence({
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
          {
            cli: "gemini",
            status: "pass",
            discovery: { preferred: { name: "gemini.cmd" } },
            markerSeen: true,
            commandNotFound: false,
            fatalLaunchError: true,
            versionLike: false,
            usageLike: false,
            outputSample: "Fatal error: Failed to relaunch the CLI process.\nError: spawn EPERM",
          },
        ],
      },
    });

    const plan = deriveAiCliLaunchPlan({
      evidence,
      preferredProvider: "gemini",
      currentTimeMs: NOW,
    });

    expect(plan.status).toBe("degraded");
    expect(plan.recommendedProvider).toBe("codex");
    expect(plan.trace.cliMatrix.find((entry) => entry.provider === "gemini")?.status).toBe("failed");
  });

  it("blocks launch planning while a live interactive session is on native fallback", () => {
    const plan = deriveAiCliLaunchPlan({
      evidence: realCliEvidence(),
      interactiveSessions: [interactiveSession({ backend: "native", cli: "claude" })],
      currentTimeMs: NOW,
    });

    expect(plan).toMatchObject({
      status: "blocked",
      recommendedBackend: "native-fallback",
      actionLabel: "Fix launch gate",
    });
    expect(plan.detail).toBe("1 native fallback · sidecar blocked");
    expect(plan.trace).toMatchObject({
      status: "blocked",
      recommendedBackend: "native-fallback",
      guardrailLabel: "Launch guard",
    });
  });

  it("does not treat missing probe evidence as release-grade launch confidence", () => {
    const plan = deriveAiCliLaunchPlan({
      interactiveSessions: [interactiveSession()],
      currentTimeMs: NOW,
    });

    expect(plan.status).toBe("degraded");
    expect(plan.detail).toBe("1 live sidecar CLI · probe missing");
    expect(plan.evidence).toContain("no fresh launch probe");
  });
});
