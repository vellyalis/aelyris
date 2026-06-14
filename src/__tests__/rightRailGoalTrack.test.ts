import { describe, expect, it } from "vitest";
import { deriveRightRailGoalTrack, type RightRailGoalTrackEdgeItem } from "../shared/lib/rightRailGoalTrack";

const PASSING_EDGE_ITEMS: RightRailGoalTrackEdgeItem[] = [
  {
    id: "decision",
    label: "Decision",
    status: "pass",
    score: 24,
    max: 25,
    detail: "No blocking owner gate",
    actionLabel: "Inspect inbox",
  },
  {
    id: "evidence",
    label: "Evidence",
    status: "pass",
    score: 25,
    max: 25,
    detail: "4 files · 2 audits · 0 risks",
    actionLabel: "Open review",
  },
  {
    id: "recovery",
    label: "Recovery",
    status: "pass",
    score: 25,
    max: 25,
    detail: "3 guided actions",
    actionLabel: "Open recovery",
  },
  {
    id: "live",
    label: "Live",
    status: "pass",
    score: 22,
    max: 25,
    detail: "1 live run",
    actionLabel: "Watch live",
  },
];

const READY_CONSENT_PACKET = {
  status: "ready" as const,
  label: "Consent packet ready",
  detail: "codex preflight green · prompt blocked until explicit consent",
  provider: "codex",
  command: "pnpm verify:terminal:authenticated-ai-cli-prompt",
  requiredEnv: "AETHER_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS",
  preflightReady: true,
  safeNoPromptSent: true,
  wouldSpendTokens: true,
  providerReadiness: [
    {
      provider: "codex",
      status: "ready" as const,
      failedChecks: [],
      command: "pnpm verify:terminal:authenticated-ai-cli-prompt",
      requiredEnv: "AETHER_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS AETHER_AUTH_PROMPT_PROVIDER=codex",
    },
    {
      provider: "claude",
      status: "ready" as const,
      failedChecks: [],
      command: "pnpm verify:terminal:authenticated-ai-cli-prompt",
      requiredEnv: "AETHER_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS AETHER_AUTH_PROMPT_PROVIDER=claude",
    },
    {
      provider: "gemini",
      status: "ready" as const,
      failedChecks: [],
      command: "pnpm verify:terminal:authenticated-ai-cli-prompt",
      requiredEnv: "AETHER_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS AETHER_AUTH_PROMPT_PROVIDER=gemini",
    },
  ],
  artifactReadiness: [
    {
      id: "ime",
      path: ".codex-auto/production-smoke/verify-ime.json",
      exists: true,
      fresh: true,
      blockingReason: "",
      refreshCommand: "node scripts/verify-ime.mjs",
      expiresAt: "2026-05-22T00:00:00.000Z",
    },
  ],
  artifactFreshness: {
    status: "green" as const,
    label: "Proof freshness radar",
    detail: "All no-token proofs fresh · next ime · node scripts/verify-ime.mjs",
    freshCount: 1,
    staleCount: 0,
    totalCount: 1,
    nextRefresh: {
      id: "ime",
      path: ".codex-auto/production-smoke/verify-ime.json",
      expiresAt: "2026-05-22T00:00:00.000Z",
      refreshCommand: "node scripts/verify-ime.mjs",
      refreshReason: "Refreshes the Japanese IME and paste-position proof without running a prompt.",
      costClass: "no-token",
      fresh: true,
    },
  },
};

const READY_SAFE_GATE = {
  source: "final-goal-safe-summary" as const,
  status: "blocked-by-explicit-consent" as const,
  label: "Safe gate consent-gated",
  detail: "11 checks green · 8/8 requirements · 10/10 artifacts",
  ok: true,
  stepCount: 11,
  failedStepCount: 0,
  proofRequirementPassCount: 8,
  proofRequirementCount: 8,
  proofArtifactPassCount: 10,
  proofArtifactCount: 10,
  consentBlockerCount: 1,
  nonConsentBlockerCount: 0,
  noTokenPromptSent: true,
  tokenSpendingPromptExecuted: false,
  releaseHygieneClean: true,
  supplyChainAuditClean: true,
  terminalChunkedOscLivePassed: true,
  nativeTerminalInputHostPassed: true,
  nativeHwndPasteLivePassed: true,
  gitFinalizationReadinessPassed: true,
  semanticFreshness: "current-contract" as const,
  cycleBoundary: "right-rail-safe-gate-mutual-proof" as const,
  localDate: "2026-05-21",
  timeZone: "Asia/Tokyo",
  nextRequiredAction:
    "Set AETHER_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS and AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini, then run pnpm verify:terminal:authenticated-ai-cli-prompt if token-spend validation is desired.",
};

const READY_REQUIREMENT_PROOFS = [
  {
    id: "rust-native-terminal-core",
    label: "Rust native terminal core",
    status: "proved" as const,
    detail: "Rust-owned input and native IME are proven.",
    evidence: [".codex-auto/quality/native-boundary-contract.json"],
  },
  {
    id: "right-rail-command-center",
    label: "Right rail Command Center edge",
    status: "proved" as const,
    detail: "Ranked actions and Goal Track are proven.",
    evidence: [".codex-auto/performance/right-rail-scale-contract.json"],
  },
];

describe("deriveRightRailGoalTrack", () => {
  it("keeps the final goal blocked until the authenticated prompt smoke is explicitly consented", () => {
    const track = deriveRightRailGoalTrack({
      edgeScore: 96,
      edgeGrade: "A",
      edgeItems: PASSING_EDGE_ITEMS,
      qualityEvidenceStatus: "fresh",
      qualityEvidenceLabel: "Quality proof fresh",
      qualityEvidenceDetail: "96% A · 229/239 · 2026-05-21 Asia/Tokyo",
      qualityEvidenceLocalDate: "2026-05-21",
      qualityEvidenceTimeZone: "Asia/Tokyo",
      terminalCoreReady: true,
      commandCenterScenarioReady: true,
      themeCustomizationReady: true,
      aiCliLaunchPlanStatus: "ready",
      interactiveSessionCount: 1,
      interactiveNativeFallbackCount: 0,
      changedFilesCount: 4,
      pendingDecisionCount: 0,
      graphRiskCount: 0,
      authenticatedPromptConsentRequired: true,
      authenticatedPromptConsentPacket: READY_CONSENT_PACKET,
      safeGate: READY_SAFE_GATE,
      requirementProofs: READY_REQUIREMENT_PROOFS,
      residualRisk: {
        source: "final-goal-audit",
        state: "blocked-only-by-explicit-token-consent",
        label: "Implementation risks clear",
        detail: "0 fixable · 1 consent gate",
        implementationFixableCount: 0,
        policyBlockedCount: 1,
        implementationFixable: [],
        policyBlocked: ["authenticated-ai-cli-prompt-smoke: explicit token-spend consent"],
        canContinueWithoutTokenSpend: true,
        completionClaimAllowed: false,
      },
    });

    expect(track.status).toBe("blocked");
    expect(track.confidenceLabel).toBe("Consent gate");
    expect(track.label).toBe("Goal consent gated");
    expect(track.detail).toBe("Non-token implementation proved · explicit token consent pending");
    expect(track.percent).toBe(99);
    expect(track.doneCount).toBe(3);
    expect(track.activeMilestoneId).toBe("release-proof");
    expect(track.qualityEvidence).toEqual({
      status: "fresh",
      label: "Quality proof fresh",
      detail: "96% A · 229/239 · 2026-05-21 Asia/Tokyo",
      localDate: "2026-05-21",
      timeZone: "Asia/Tokyo",
    });
    expect(track.blockers).toContain("Authenticated AI CLI prompt smoke still requires explicit token consent");
    expect(track.remainingItems).toEqual(["Authenticated AI CLI prompt smoke still requires explicit token consent"]);
    expect(track.nextAction).toBe("Copy verified run command");
    expect(track.consentRunAction).toMatchObject({
      label: "Copy verified run command",
      provider: "codex",
      command: "pnpm verify:terminal:authenticated-ai-cli-prompt",
      requiredEnv: "AETHER_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS",
      providerEnv: "AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini",
      defaultProvider: "codex",
      requiresExplicitConsent: true,
    });
    expect(track.consentRunAction?.powershellSnippet).toBe(
      [
        '$env:AETHER_AUTH_PROMPT_CONSENT="I_UNDERSTAND_THIS_MAY_SPEND_TOKENS"',
        '$env:AETHER_AUTH_PROMPT_PROVIDER="codex"',
        "pnpm verify:terminal:authenticated-ai-cli-prompt",
      ].join("\n"),
    );
    expect(track.consentRunActions).toHaveLength(3);
    expect(track.consentRunActions.map((action) => action.provider)).toEqual(["codex", "claude", "gemini"]);
    expect(track.consentRunActions[1]).toMatchObject({
      label: "Copy claude run command",
      provider: "claude",
      defaultProvider: "codex",
      requiresExplicitConsent: true,
    });
    expect(track.consentRunActions[1]?.powershellSnippet).toContain('$env:AETHER_AUTH_PROMPT_PROVIDER="claude"');
    expect(track.consentRunActions[2]?.powershellSnippet).toContain('$env:AETHER_AUTH_PROMPT_PROVIDER="gemini"');
    expect(track.consentPacket).toMatchObject({
      status: "ready",
      provider: "codex",
      preflightReady: true,
      safeNoPromptSent: true,
      artifactFreshness: {
        status: "green",
        staleCount: 0,
        nextRefresh: {
          id: "ime",
          refreshCommand: "node scripts/verify-ime.mjs",
        },
      },
    });
    expect(track.refreshActions).toEqual([
      {
        id: "ime",
        label: "Refresh next proof",
        detail: "Refreshes the Japanese IME and paste-position proof without running a prompt.",
        path: ".codex-auto/production-smoke/verify-ime.json",
        command: "node scripts/verify-ime.mjs",
        reason: "Refreshes the Japanese IME and paste-position proof without running a prompt.",
        expiresAt: "2026-05-22T00:00:00.000Z",
        costClass: "no-token",
        fresh: true,
        requiresExplicitConsent: false,
      },
    ]);
    expect(track.residualRisk).toMatchObject({
      state: "blocked-only-by-explicit-token-consent",
      implementationFixableCount: 0,
      policyBlockedCount: 1,
    });
    expect(track.safeGate).toMatchObject({
      source: "final-goal-safe-summary",
      status: "blocked-by-explicit-consent",
      failedStepCount: 0,
      proofArtifactPassCount: 10,
      proofArtifactCount: 10,
      proofRequirementPassCount: 8,
      proofRequirementCount: 8,
      nonConsentBlockerCount: 0,
      noTokenPromptSent: true,
      tokenSpendingPromptExecuted: false,
      localDate: "2026-05-21",
      timeZone: "Asia/Tokyo",
    });
    expect(track.requirementProofs).toEqual(READY_REQUIREMENT_PROOFS);
    expect(track.boundaryProofs).toEqual([
      {
        id: "native-input-host",
        label: "Native input",
        status: "proved",
        detail: "Rust input host owns focus, commit routing, and IME composition.",
        source: "final-goal-safe-summary",
        artifactPath: ".codex-auto/production-smoke/native-terminal-input-host.json",
        refreshCommand: "pnpm verify:terminal:native-input",
        costClass: "no-token",
      },
      {
        id: "native-hwnd-paste",
        label: "HWND paste",
        status: "proved",
        detail: "Real WM_PASTE is guarded before PTY write.",
        source: "final-goal-safe-summary",
        artifactPath: ".codex-auto/production-smoke/native-hwnd-paste-live.json",
        refreshCommand: "pnpm verify:terminal:native-hwnd-paste",
        costClass: "no-token",
      },
      {
        id: "chunked-osc-inline-image",
        label: "Inline image",
        status: "proved",
        detail: "Chunked OSC image path is live for PowerShell and Git Bash.",
        source: "final-goal-safe-summary",
        artifactPath: ".codex-auto/production-smoke/chunked-osc-live.json",
        refreshCommand: "pnpm verify:terminal:chunked-osc-live",
        costClass: "no-token",
      },
      {
        id: "release-hygiene",
        label: "Hygiene",
        status: "proved",
        detail: "Release sources contain no diagnostic or stray debug-probe leaks.",
        source: "final-goal-safe-summary",
        artifactPath: ".codex-auto/quality/release-hygiene-contract.json",
        refreshCommand: "pnpm verify:release:hygiene",
        costClass: "no-token",
      },
      {
        id: "supply-chain-audit",
        label: "Supply chain",
        status: "proved",
        detail: "npm and Rust dependency audits report zero known vulnerabilities.",
        source: "final-goal-safe-summary",
        artifactPath: ".codex-auto/release-doctor/supply-chain-audit.json",
        refreshCommand: "pnpm verify:supply-chain",
        costClass: "no-token",
      },
      {
        id: "git-finalization",
        label: "Git handoff",
        status: "proved",
        detail: "Commit and merge readiness is explicit; repository metadata permission blockers cannot hide.",
        source: "final-goal-safe-summary",
        artifactPath: ".codex-auto/quality/git-finalization-readiness.json",
        refreshCommand: "pnpm verify:goal:git-finalization",
        costClass: "no-token",
      },
      {
        id: "safe-proof-chain",
        label: "Proof chain",
        status: "proved",
        detail: "10/10 artifacts · 11 steps",
        source: "final-goal-safe-summary",
        artifactPath: ".codex-auto/quality/final-goal-safe-summary.json",
        refreshCommand: "pnpm verify:goal:safe",
        costClass: "no-token",
      },
    ]);
    expect(track.milestones.find((item) => item.id === "release-proof")?.detail).toBe(
      "Safe gate is green; token-spending proof is gated by explicit consent",
    );
  });

  it("treats the right-rail safe-gate self-cycle as a Goal Track refresh boundary", () => {
    const track = deriveRightRailGoalTrack({
      edgeScore: 97,
      edgeGrade: "S",
      edgeItems: PASSING_EDGE_ITEMS,
      qualityEvidenceStatus: "fresh",
      qualityEvidenceLabel: "Quality proof fresh",
      qualityEvidenceDetail: "97% S · 315/325 · 2026-05-22 Asia/Tokyo",
      qualityEvidenceLocalDate: "2026-05-22",
      qualityEvidenceTimeZone: "Asia/Tokyo",
      terminalCoreReady: true,
      commandCenterScenarioReady: true,
      themeCustomizationReady: true,
      aiCliLaunchPlanStatus: "ready",
      interactiveSessionCount: 1,
      interactiveNativeFallbackCount: 0,
      changedFilesCount: 470,
      pendingDecisionCount: 0,
      graphRiskCount: 0,
      authenticatedPromptConsentRequired: true,
      authenticatedPromptConsentPacket: READY_CONSENT_PACKET,
      safeGate: {
        ...READY_SAFE_GATE,
        status: "blocked",
        label: "Safe gate blocked",
        detail:
          "15 checks green · 8/8 requirements · 14/15 artifacts · core: hygiene/supply chain/inline image/native input/native paste",
        ok: false,
        stepCount: 15,
        proofArtifactPassCount: 14,
        proofArtifactCount: 15,
        semanticFreshness: "stale-or-incomplete",
        localDate: "2026-05-22",
        nextRequiredAction: "Refresh the right rail Goal Track Tauri proof; non-token implementation proofs are green.",
      },
      requirementProofs: READY_REQUIREMENT_PROOFS,
      residualRisk: {
        source: "final-goal-audit",
        state: "blocked-only-by-explicit-token-consent",
        label: "Implementation risks clear",
        detail: "0 fixable · 1 consent gate",
        implementationFixableCount: 0,
        policyBlockedCount: 1,
        implementationFixable: [],
        policyBlocked: ["authenticated-ai-cli-prompt-smoke: explicit token-spend consent"],
        canContinueWithoutTokenSpend: true,
        completionClaimAllowed: false,
      },
    });

    expect(track.label).toBe("Goal consent gated");
    expect(track.percent).toBe(99);
    expect(track.remainingItems).toEqual(["Authenticated AI CLI prompt smoke still requires explicit token consent"]);
    expect(track.blockers).toEqual(["Authenticated AI CLI prompt smoke still requires explicit token consent"]);
    expect(track.boundaryProofs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "safe-proof-chain",
          status: "proved",
          detail: "14/15 artifacts · 15 steps",
        }),
      ]),
    );
    expect(track.milestones.find((item) => item.id === "release-proof")?.detail).toBe(
      "Safe gate is waiting only for this Goal Track proof; token-spending proof is gated by explicit consent",
    );
  });

  it("deduplicates release-score authenticated prompt blockers into one Goal Track action", () => {
    const track = deriveRightRailGoalTrack({
      edgeScore: 96,
      edgeGrade: "A",
      edgeItems: PASSING_EDGE_ITEMS,
      qualityEvidenceStatus: "fresh",
      terminalCoreReady: true,
      commandCenterScenarioReady: true,
      themeCustomizationReady: true,
      aiCliLaunchPlanStatus: "ready",
      interactiveSessionCount: 1,
      interactiveNativeFallbackCount: 0,
      changedFilesCount: 4,
      pendingDecisionCount: 0,
      graphRiskCount: 0,
      authenticatedPromptConsentRequired: true,
      authenticatedPromptConsentPacket: READY_CONSENT_PACKET,
      safeGate: READY_SAFE_GATE,
      releaseBlockers: [
        "authenticated-ai-cli-prompt-smoke: authenticated AI CLI prompt smoke requires explicit token-spend consent",
      ],
    });

    const promptItems = track.remainingItems.filter((item) => /authenticated.*prompt/i.test(item));
    expect(promptItems).toEqual(["Authenticated AI CLI prompt smoke still requires explicit token consent"]);
    expect(track.blockers).toEqual(["Authenticated AI CLI prompt smoke still requires explicit token consent"]);
  });

  it("keeps the authenticated prompt action visible when stale audit artifacts are being refreshed", () => {
    const track = deriveRightRailGoalTrack({
      edgeScore: 84,
      edgeGrade: "A",
      edgeItems: [
        ...PASSING_EDGE_ITEMS.slice(0, 3),
        {
          id: "live",
          label: "Live",
          status: "watch",
          score: 18,
          max: 25,
          detail: "Open processes",
          actionLabel: "Open processes",
        },
      ],
      qualityEvidenceStatus: "fresh",
      aiCliLaunchPlanStatus: "ready",
      interactiveSessionCount: 1,
      interactiveNativeFallbackCount: 0,
      changedFilesCount: 4,
      pendingDecisionCount: 0,
      graphRiskCount: 0,
      authenticatedPromptConsentRequired: true,
      authenticatedPromptConsentPacket: READY_CONSENT_PACKET,
      safeGate: READY_SAFE_GATE,
      releaseBlockers: [
        "authenticated-ai-cli-prompt-smoke: authenticated AI CLI prompt smoke requires explicit token-spend consent",
        "right-rail-goal-track: right rail Tauri goal-track artifact does not prove fresh quality source and ready consent packet",
        "final-goal-evidence-map: final goal audit artifact is missing, stale, or not evidence-complete",
      ],
    });

    expect(track.remainingItems[0]).toBe("Authenticated AI CLI prompt smoke still requires explicit token consent");
    expect(track.remainingItems).not.toEqual(
      expect.arrayContaining([expect.stringContaining("right-rail-goal-track")]),
    );
    expect(track.remainingItems).not.toEqual(
      expect.arrayContaining([expect.stringContaining("final-goal-evidence-map")]),
    );
  });

  it("does not count right-rail smoke self-refresh blockers as remaining product work", () => {
    const track = deriveRightRailGoalTrack({
      edgeScore: 96,
      edgeGrade: "A",
      edgeItems: PASSING_EDGE_ITEMS,
      qualityEvidenceStatus: "fresh",
      terminalCoreReady: true,
      commandCenterScenarioReady: true,
      themeCustomizationReady: true,
      aiCliLaunchPlanStatus: "ready",
      interactiveSessionCount: 1,
      interactiveNativeFallbackCount: 0,
      changedFilesCount: 4,
      pendingDecisionCount: 0,
      graphRiskCount: 0,
      authenticatedPromptConsentRequired: true,
      authenticatedPromptConsentPacket: READY_CONSENT_PACKET,
      safeGate: READY_SAFE_GATE,
      residualRisk: {
        source: "final-goal-audit",
        state: "blocked-only-by-explicit-token-consent",
        label: "Implementation risks clear",
        detail: "0 fixable · 1 consent gate",
        implementationFixableCount: 0,
        policyBlockedCount: 1,
        implementationFixable: [],
        policyBlocked: ["authenticated-ai-cli-prompt-smoke: explicit token-spend consent"],
        canContinueWithoutTokenSpend: true,
        completionClaimAllowed: false,
      },
      releaseBlockers: [
        "right-rail-smoke: right rail smoke suite is missing or failing",
        "right-rail-smoke: missing required smoke: scale-contract",
        "right-rail-smoke: missing required smoke: stale-url-truth",
        "right-rail-smoke: missing required smoke: goal-track-tauri",
      ],
    });

    expect(track.percent).toBe(99);
    expect(track.remainingItems).toEqual(["Authenticated AI CLI prompt smoke still requires explicit token consent"]);
    expect(track.blockers).toEqual(["Authenticated AI CLI prompt smoke still requires explicit token consent"]);
  });

  it("surfaces the user-initiated native sleep cycle as the next external gate action", () => {
    const sleepBlocker =
      "real OS sleep/resume could not complete on this host (aether-native: SetSuspendState returned false; GetLastError=50); rerun native sleep/resume on a Windows host or user-initiated sleep cycle that emits power events";
    const track = deriveRightRailGoalTrack({
      edgeScore: 96,
      edgeGrade: "A",
      edgeItems: PASSING_EDGE_ITEMS,
      qualityEvidenceStatus: "fresh",
      terminalCoreReady: true,
      commandCenterScenarioReady: true,
      themeCustomizationReady: true,
      aiCliLaunchPlanStatus: "ready",
      interactiveSessionCount: 1,
      interactiveNativeFallbackCount: 0,
      changedFilesCount: 4,
      pendingDecisionCount: 0,
      graphRiskCount: 0,
      authenticatedPromptConsentRequired: true,
      authenticatedPromptConsentPacket: READY_CONSENT_PACKET,
      safeGate: {
        ...READY_SAFE_GATE,
        status: "blocked-by-external-gates",
        label: "Safe gate externally gated",
        detail: "17 checks green · 8/8 requirements · 17/17 artifacts",
        proofArtifactPassCount: 17,
        proofArtifactCount: 17,
        nextRequiredAction:
          "Run pnpm verify:production:suspend:native-user-cycle on this host and manually put Windows to sleep while the verifier waits.",
      },
      residualRisk: {
        source: "final-goal-audit",
        state: "blocked-by-external-gates",
        label: "Implementation risks clear",
        detail: "0 fixable · 1 consent · 1 external",
        implementationFixableCount: 0,
        policyBlockedCount: 1,
        externalBlockedCount: 1,
        implementationFixable: [],
        policyBlocked: ["authenticated-ai-cli-prompt-smoke: explicit token-spend consent"],
        externalBlocked: [sleepBlocker],
        canContinueWithoutTokenSpend: false,
        completionClaimAllowed: false,
      },
      releaseBlockers: [sleepBlocker, "authenticated AI CLI prompt smoke requires explicit token-spend consent"],
    });

    expect(track.status).toBe("blocked");
    expect(track.percent).toBe(96);
    expect(track.nextAction).toBe("Copy native sleep proof");
    expect(track.remainingItems).toEqual([
      "Authenticated AI CLI prompt smoke still requires explicit token consent",
      sleepBlocker,
    ]);
    expect(track.externalGateActions).toEqual([
      {
        id: "native-user-sleep-cycle",
        label: "Copy native sleep proof",
        detail: "No-token real Windows sleep/resume proof · requires manual sleep/wake",
        command: "pnpm verify:production:suspend:native-user-cycle",
        followUpCommands: ["pnpm verify:goal:operator-finish", "pnpm verify:goal:finalize", "pnpm verify:goal:safe", "pnpm verify:goal:closeout"],
        powershellSnippet: [
          "pnpm verify:production:suspend:native-user-cycle",
          "# manually sleep and wake Windows while the verifier waits",
          "pnpm verify:goal:operator-finish",
          "pnpm verify:goal:finalize",
          "pnpm verify:goal:safe",
          "pnpm verify:goal:closeout",
        ].join("\n"),
        requiresExplicitConsent: false,
        requiresUserAction: true,
        manualAction:
          "Leave the verifier running, put Windows to sleep manually, wake it, then let post-resume probes finish.",
        costClass: "no-token-user-host-action",
      },
    ]);
  });

  it("makes terminal fallback, human gates, and graph risks explicit release blockers", () => {
    const track = deriveRightRailGoalTrack({
      edgeScore: 78,
      edgeGrade: "B",
      edgeItems: [
        ...PASSING_EDGE_ITEMS.slice(0, 1),
        {
          id: "evidence",
          label: "Evidence",
          status: "gap",
          score: 8,
          max: 25,
          detail: "0 files · 0 audits · 2 risks",
          actionLabel: "Open risks",
        },
      ],
      aiCliLaunchPlanStatus: "blocked",
      interactiveSessionCount: 2,
      interactiveNativeFallbackCount: 1,
      changedFilesCount: 0,
      pendingDecisionCount: 2,
      graphRiskCount: 2,
      graphRiskSummaries: [
        { id: "risk:tests", label: "Missing regression proof", status: "open", severity: "high", source: "release" },
        { id: "blocker:approval", label: "Approval gate", status: "open", severity: "warn", source: "release" },
      ],
      qaRiskCount: 1,
      qaRiskSummaries: [
        {
          id: "risk:qa-missing-diff",
          label: "QA missing diff fixture",
          status: "open",
          severity: "warn",
          source: "qa-fixture",
        },
      ],
      authenticatedPromptConsentRequired: true,
      authenticatedPromptConsentPacket: READY_CONSENT_PACKET,
      safeGate: READY_SAFE_GATE,
    });

    expect(track.status).toBe("blocked");
    expect(track.activeMilestoneId).toBe("terminal-core");
    expect(track.milestones.find((item) => item.id === "terminal-core")).toMatchObject({
      status: "blocked",
      remaining: "Restart fallback sessions on the sidecar command-session path",
    });
    expect(track.blockers).toEqual(
      expect.arrayContaining([
        "1 AI CLI session still on native fallback",
        "2 human decision gates open",
        "2 risk or blocker nodes open: Missing regression proof, Approval gate",
        "Authenticated AI CLI prompt smoke still requires explicit token consent",
      ]),
    );
    expect(track.riskEvidence).toEqual([
      { id: "risk:tests", label: "Missing regression proof", status: "open", severity: "high", source: "release" },
      { id: "blocker:approval", label: "Approval gate", status: "open", severity: "warn", source: "release" },
    ]);
    expect(track.qaRiskEvidence).toEqual([
      {
        id: "risk:qa-missing-diff",
        label: "QA missing diff fixture",
        status: "open",
        severity: "warn",
        source: "qa-fixture",
      },
    ]);
  });

  it("keeps QA fixture risks visible without turning them into release blockers", () => {
    const track = deriveRightRailGoalTrack({
      edgeScore: 98,
      edgeGrade: "S",
      edgeItems: PASSING_EDGE_ITEMS,
      qualityEvidenceStatus: "fresh",
      terminalCoreReady: true,
      commandCenterScenarioReady: true,
      themeCustomizationReady: true,
      aiCliLaunchPlanStatus: "ready",
      interactiveSessionCount: 0,
      interactiveNativeFallbackCount: 0,
      changedFilesCount: 0,
      pendingDecisionCount: 0,
      graphRiskCount: 0,
      qaRiskCount: 2,
      qaRiskSummaries: [
        { id: "risk:qa-1", label: "QA missing diff fixture", source: "qa-fixture" },
        { id: "risk:qa-2", label: "QA stale pane fixture", source: "qa-fixture" },
      ],
      authenticatedPromptConsentRequired: false,
      safeGate: READY_SAFE_GATE,
    });

    expect(track.status).toBe("done");
    expect(track.blockers).not.toEqual(expect.arrayContaining([expect.stringContaining("risk or blocker node")]));
    expect(track.qaRiskEvidence.map((item) => item.label)).toEqual([
      "QA missing diff fixture",
      "QA stale pane fixture",
    ]);
  });

  it("promotes runtime fallback telemetry into Goal Track release blockers", () => {
    const track = deriveRightRailGoalTrack({
      edgeScore: 98,
      edgeGrade: "S",
      edgeItems: PASSING_EDGE_ITEMS,
      qualityEvidenceStatus: "fresh",
      terminalCoreReady: true,
      commandCenterScenarioReady: true,
      themeCustomizationReady: true,
      aiCliLaunchPlanStatus: "ready",
      interactiveSessionCount: 1,
      interactiveNativeFallbackCount: 0,
      changedFilesCount: 0,
      pendingDecisionCount: 0,
      graphRiskCount: 0,
      runtimeFallbackCount: 2,
      runtimeFallbackSummaries: [
        {
          id: "runtime-fallback:terminal.clipboard",
          label: "terminal.clipboard.read_clipboard_text_browser_fallback",
          status: "warning",
          severity: "warning",
          source: "runtime",
        },
        {
          id: "runtime-fallback:app-store.persist_wallpaper",
          label: "app-store.persist_wallpaper_settings",
          status: "error",
          severity: "error",
          source: "runtime",
        },
      ],
      authenticatedPromptConsentRequired: false,
      safeGate: READY_SAFE_GATE,
    });

    expect(track.status).toBe("blocked");
    expect(track.activeMilestoneId).toBe("release-proof");
    expect(track.blockers).toContain(
      "2 runtime fallback events visible: terminal.clipboard.read_clipboard_text_browser_fallback, app-store.persist_wallpaper_settings",
    );
    expect(track.remainingItems).toContain(
      "2 runtime fallback events visible: terminal.clipboard.read_clipboard_text_browser_fallback, app-store.persist_wallpaper_settings",
    );
    expect(track.runtimeFallbackEvidence).toEqual([
      {
        id: "runtime-fallback:terminal.clipboard",
        label: "terminal.clipboard.read_clipboard_text_browser_fallback",
        status: "warning",
        severity: "warning",
        source: "runtime",
      },
      {
        id: "runtime-fallback:app-store.persist_wallpaper",
        label: "app-store.persist_wallpaper_settings",
        status: "error",
        severity: "error",
        source: "runtime",
      },
    ]);
    expect(track.confidenceLabel).toBe("Blocked");
    expect(track.nextAction).toBe(
      "2 runtime fallback events visible: terminal.clipboard.read_clipboard_text_browser_fallback, app-store.persist_wallpaper_settings",
    );
  });

  it("blocks release proof when authenticated prompt consent preflight is unavailable", () => {
    const track = deriveRightRailGoalTrack({
      edgeScore: 96,
      edgeGrade: "A",
      edgeItems: PASSING_EDGE_ITEMS,
      qualityEvidenceStatus: "fresh",
      terminalCoreReady: true,
      commandCenterScenarioReady: true,
      themeCustomizationReady: true,
      aiCliLaunchPlanStatus: "ready",
      interactiveSessionCount: 1,
      interactiveNativeFallbackCount: 0,
      changedFilesCount: 0,
      pendingDecisionCount: 0,
      graphRiskCount: 0,
      authenticatedPromptConsentRequired: true,
      authenticatedPromptConsentPacket: null,
      safeGate: READY_SAFE_GATE,
    });

    expect(track.status).toBe("blocked");
    expect(track.consentPacket).toBeNull();
    expect(track.consentRunAction).toBeNull();
    expect(track.consentRunActions).toEqual([]);
    expect(track.refreshActions).toEqual([]);
    expect(track.blockers).toContain(
      "Authenticated prompt consent packet unavailable; run pnpm verify:terminal:authenticated-ai-cli-prompt without consent",
    );
  });

  it("marks token-spending refresh commands as explicit-consent actions", () => {
    const track = deriveRightRailGoalTrack({
      edgeScore: 96,
      edgeGrade: "A",
      edgeItems: PASSING_EDGE_ITEMS,
      qualityEvidenceStatus: "fresh",
      terminalCoreReady: true,
      commandCenterScenarioReady: true,
      themeCustomizationReady: true,
      aiCliLaunchPlanStatus: "ready",
      interactiveSessionCount: 1,
      interactiveNativeFallbackCount: 0,
      changedFilesCount: 0,
      pendingDecisionCount: 0,
      graphRiskCount: 0,
      authenticatedPromptConsentRequired: true,
      authenticatedPromptConsentPacket: {
        ...READY_CONSENT_PACKET,
        artifactReadiness: [
          {
            id: "authenticated-prompt",
            path: ".codex-auto/production-smoke/authenticated-ai-cli-prompt-smoke.json",
            exists: true,
            fresh: false,
            blockingReason: "explicit token-spend proof is stale",
            refreshCommand: "pnpm verify:terminal:authenticated-ai-cli-prompt",
            expiresAt: "2026-05-21T00:00:00.000Z",
          },
        ],
        artifactFreshness: {
          status: "attention",
          label: "Proof freshness needs refresh",
          detail: "1/1 stale · authenticated-prompt · pnpm verify:terminal:authenticated-ai-cli-prompt",
          freshCount: 0,
          staleCount: 1,
          totalCount: 1,
          nextRefresh: {
            id: "authenticated-prompt",
            path: ".codex-auto/production-smoke/authenticated-ai-cli-prompt-smoke.json",
            expiresAt: "2026-05-21T00:00:00.000Z",
            refreshCommand: "pnpm verify:terminal:authenticated-ai-cli-prompt",
            refreshReason: "Runs a token-spending authenticated prompt proof.",
            costClass: "requires-explicit-consent-token-spend",
            fresh: false,
          },
        },
      },
      safeGate: READY_SAFE_GATE,
    });

    expect(track.refreshActions).toEqual([
      expect.objectContaining({
        id: "authenticated-prompt",
        command: "pnpm verify:terminal:authenticated-ai-cli-prompt",
        costClass: "requires-explicit-consent-token-spend",
        requiresExplicitConsent: true,
      }),
    ]);
  });

  it("keeps stale release-quality proof visible as a release blocker", () => {
    const track = deriveRightRailGoalTrack({
      edgeScore: 98,
      edgeGrade: "S",
      edgeItems: PASSING_EDGE_ITEMS,
      qualityEvidenceStatus: "stale",
      qualityEvidenceLabel: "Quality proof stale",
      qualityEvidenceDetail: "100% S · generated 2h ago",
      aiCliLaunchPlanStatus: "ready",
      interactiveSessionCount: 1,
      interactiveNativeFallbackCount: 0,
      changedFilesCount: 0,
      pendingDecisionCount: 0,
      graphRiskCount: 0,
      authenticatedPromptConsentRequired: false,
      safeGate: READY_SAFE_GATE,
    });

    expect(track.status).toBe("blocked");
    expect(track.qualityEvidence.status).toBe("stale");
    expect(track.blockers).toContain("Release quality score stale; run pnpm verify:quality-score");
    expect(track.nextAction).toBe("Release quality score stale; run pnpm verify:quality-score");
  });

  it("does not treat omitted readiness flags as done even with a fresh quality proof", () => {
    const track = deriveRightRailGoalTrack({
      edgeScore: 98,
      edgeGrade: "S",
      edgeItems: PASSING_EDGE_ITEMS,
      qualityEvidenceStatus: "fresh",
      aiCliLaunchPlanStatus: "ready",
      interactiveSessionCount: 1,
      interactiveNativeFallbackCount: 0,
      changedFilesCount: 0,
      pendingDecisionCount: 0,
      graphRiskCount: 0,
      authenticatedPromptConsentRequired: false,
      safeGate: READY_SAFE_GATE,
    });

    expect(track.status).toBe("active");
    expect(track.doneCount).toBe(0);
    expect(track.milestones.find((item) => item.id === "terminal-core")?.status).toBe("active");
    expect(track.milestones.find((item) => item.id === "customization")?.status).toBe("active");
  });

  it("does not silently pass when release-quality proof is unavailable", () => {
    const track = deriveRightRailGoalTrack({
      edgeScore: 98,
      edgeGrade: "S",
      edgeItems: PASSING_EDGE_ITEMS,
      qualityEvidenceStatus: "unavailable",
      aiCliLaunchPlanStatus: "ready",
      interactiveSessionCount: 1,
      interactiveNativeFallbackCount: 0,
      changedFilesCount: 0,
      pendingDecisionCount: 0,
      graphRiskCount: 0,
      authenticatedPromptConsentRequired: false,
      safeGate: READY_SAFE_GATE,
    });

    expect(track.status).toBe("blocked");
    expect(track.qualityEvidence.status).toBe("unavailable");
    expect(track.blockers).toContain("Release quality score unavailable; run pnpm verify:quality-score");
  });

  it("does not silently pass when final safe gate evidence is unavailable", () => {
    const track = deriveRightRailGoalTrack({
      edgeScore: 98,
      edgeGrade: "S",
      edgeItems: PASSING_EDGE_ITEMS,
      qualityEvidenceStatus: "fresh",
      aiCliLaunchPlanStatus: "ready",
      interactiveSessionCount: 1,
      interactiveNativeFallbackCount: 0,
      changedFilesCount: 0,
      pendingDecisionCount: 0,
      graphRiskCount: 0,
      authenticatedPromptConsentRequired: false,
      safeGate: null,
    });

    expect(track.status).toBe("blocked");
    expect(track.blockers).toContain("Final safe gate unavailable; run pnpm verify:goal:safe");
    expect(track.remainingItems).toContain("Final safe gate unavailable; run pnpm verify:goal:safe");
    expect(track.boundaryProofs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "native-input-host", status: "unknown", source: "unavailable" }),
        expect.objectContaining({ id: "safe-proof-chain", status: "unknown", source: "unavailable" }),
      ]),
    );
  });

  it("turns broken terminal boundary proofs into visible missing evidence", () => {
    const track = deriveRightRailGoalTrack({
      edgeScore: 98,
      edgeGrade: "S",
      edgeItems: PASSING_EDGE_ITEMS,
      qualityEvidenceStatus: "fresh",
      terminalCoreReady: true,
      commandCenterScenarioReady: true,
      themeCustomizationReady: true,
      aiCliLaunchPlanStatus: "ready",
      interactiveSessionCount: 1,
      interactiveNativeFallbackCount: 0,
      changedFilesCount: 0,
      pendingDecisionCount: 0,
      graphRiskCount: 0,
      authenticatedPromptConsentRequired: false,
      safeGate: {
        ...READY_SAFE_GATE,
        nativeTerminalInputHostPassed: false,
        nativeHwndPasteLivePassed: false,
        proofArtifactPassCount: 9,
      },
    });

    expect(track.boundaryProofs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "native-input-host", status: "missing" }),
        expect.objectContaining({ id: "native-hwnd-paste", status: "missing" }),
        expect.objectContaining({ id: "safe-proof-chain", status: "missing", detail: "9/10 artifacts · 11 steps" }),
      ]),
    );
  });

  it("promotes the track to a release candidate when every milestone and proof gate is closed", () => {
    const track = deriveRightRailGoalTrack({
      edgeScore: 98,
      edgeGrade: "S",
      edgeItems: PASSING_EDGE_ITEMS,
      qualityEvidenceStatus: "fresh",
      terminalCoreReady: true,
      commandCenterScenarioReady: true,
      themeCustomizationReady: true,
      aiCliLaunchPlanStatus: "ready",
      interactiveSessionCount: 1,
      interactiveNativeFallbackCount: 0,
      changedFilesCount: 0,
      pendingDecisionCount: 0,
      graphRiskCount: 0,
      authenticatedPromptConsentRequired: false,
      safeGate: READY_SAFE_GATE,
    });

    expect(track.status).toBe("done");
    expect(track.confidenceLabel).toBe("Release candidate");
    expect(track.consentRunAction).toBeNull();
    expect(track.consentRunActions).toEqual([]);
    expect(track.percent).toBe(100);
    expect(track.doneCount).toBe(4);
    expect(track.remainingItems).toEqual([]);
    expect(track.nextAction).toBe("Promote release candidate");
  });

  it("keeps final-audit implementation risks visible as release blockers", () => {
    const track = deriveRightRailGoalTrack({
      edgeScore: 98,
      edgeGrade: "S",
      edgeItems: PASSING_EDGE_ITEMS,
      qualityEvidenceStatus: "fresh",
      aiCliLaunchPlanStatus: "ready",
      interactiveSessionCount: 1,
      interactiveNativeFallbackCount: 0,
      changedFilesCount: 0,
      pendingDecisionCount: 0,
      graphRiskCount: 0,
      authenticatedPromptConsentRequired: false,
      safeGate: READY_SAFE_GATE,
      residualRisk: {
        source: "final-goal-audit",
        state: "implementation-risk-open",
        label: "Implementation risks open",
        detail: "1 fixable · 0 policy",
        implementationFixableCount: 1,
        policyBlockedCount: 0,
        implementationFixable: ["right rail residual risk display missing"],
        policyBlocked: [],
        canContinueWithoutTokenSpend: false,
        completionClaimAllowed: false,
      },
    });

    expect(track.status).toBe("blocked");
    expect(track.blockers).toContain("right rail residual risk display missing");
    expect(track.remainingItems).toContain("right rail residual risk display missing");
    expect(track.residualRisk?.label).toBe("Implementation risks open");
  });
});
