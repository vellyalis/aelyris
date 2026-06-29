import { describe, expect, it } from "vitest";
import {
  deriveFinalGoalRequirementProofs,
  deriveFinalGoalResidualRisk,
  deriveFinalGoalSafeGate,
  deriveReleaseQualityGoalInputs,
  parseFinalGoalAuditReport,
  parseFinalGoalSafeSummaryReport,
  parseReleaseQualityReport,
} from "../shared/lib/releaseQuality";

function score(id: string, points = 1, max = 1, blockers: string[] = []) {
  return { id, label: id, points, max, detail: "ok", blockers };
}

const REQUIRED_PASSING_SCORES = [
  "mux-performance",
  "scrollback",
  "native-ime",
  "terminal-core-edge",
  "interactive-ai-cli-sidecar-boundary",
  "live-ai-cli-post-launch-chaos",
  "command-center-scenario",
  "right-rail-goal-track",
  "ai-cli-launch-planner",
  "theme-customization-guard",
  "authenticated-ai-cli-prompt-smoke",
].map((id) => score(id));

describe("release quality goal inputs", () => {
  it("parses release-quality-score and keeps the authenticated prompt blocker live", () => {
    const report = parseReleaseQualityReport(
      JSON.stringify({
        generatedAt: "2026-05-20T00:00:00.000Z",
        localDate: "2026-05-21",
        timeZone: "Asia/Tokyo",
        score: 96,
        total: 229,
        max: 239,
        grade: "A",
        releaseCandidateReady: false,
        scores: [
          ...REQUIRED_PASSING_SCORES.filter((entry) => entry.id !== "authenticated-ai-cli-prompt-smoke"),
          score("authenticated-ai-cli-prompt-smoke", 0, 10, [
            "authenticated AI CLI prompt smoke requires explicit token-spend consent",
          ]),
        ],
        blockers: [
          {
            area: "authenticated-ai-cli-prompt-smoke",
            blocker: "authenticated AI CLI prompt smoke requires explicit token-spend consent",
          },
        ],
      }),
    );

    const inputs = deriveReleaseQualityGoalInputs(report, { nowMs: Date.parse("2026-05-20T00:10:00.000Z") });

    expect(inputs.source).toBe("release-quality-score");
    expect(inputs.evidenceStatus).toBe("fresh");
    expect(inputs.evidenceDetail).toBe("96% A · 229/239 · 2026-05-21 Asia/Tokyo");
    expect(inputs.localDate).toBe("2026-05-21");
    expect(inputs.timeZone).toBe("Asia/Tokyo");
    expect(inputs.authenticatedPromptConsentRequired).toBe(true);
    expect(inputs.releaseBlockers).toEqual([
      "authenticated-ai-cli-prompt-smoke: authenticated AI CLI prompt smoke requires explicit token-spend consent",
    ]);
    expect(inputs.terminalCoreReady).toBe(true);
    expect(inputs.commandCenterScenarioReady).toBe(true);
    expect(inputs.themeCustomizationReady).toBe(true);
  });

  it("clears the prompt blocker once the authenticated prompt smoke is actually proven", () => {
    const report = parseReleaseQualityReport(
      JSON.stringify({
        generatedAt: "2026-05-20T00:00:00.000Z",
        score: 100,
        total: 239,
        max: 239,
        grade: "S",
        releaseCandidateReady: true,
        scores: REQUIRED_PASSING_SCORES,
        blockers: [],
      }),
    );

    const inputs = deriveReleaseQualityGoalInputs(report, { nowMs: Date.parse("2026-05-20T00:10:00.000Z") });

    expect(inputs.releaseCandidateReady).toBe(true);
    expect(inputs.authenticatedPromptConsentRequired).toBe(false);
    expect(inputs.releaseBlockers).toEqual([]);
    expect(inputs.terminalCoreReady).toBe(true);
    expect(inputs.commandCenterScenarioReady).toBe(true);
    expect(inputs.themeCustomizationReady).toBe(true);
  });

  it("turns stale release-quality-score evidence into an explicit release blocker", () => {
    const report = parseReleaseQualityReport(
      JSON.stringify({
        generatedAt: "2026-05-20T00:00:00.000Z",
        score: 100,
        total: 239,
        max: 239,
        grade: "S",
        releaseCandidateReady: true,
        scores: REQUIRED_PASSING_SCORES,
        blockers: [],
      }),
    );

    const inputs = deriveReleaseQualityGoalInputs(report, {
      nowMs: Date.parse("2026-05-20T02:00:01.000Z"),
      staleAfterMs: 60 * 60 * 1000,
    });

    expect(inputs.evidenceStatus).toBe("stale");
    expect(inputs.releaseCandidateReady).toBe(false);
    expect(inputs.terminalCoreReady).toBe(false);
    expect(inputs.commandCenterScenarioReady).toBe(false);
    expect(inputs.themeCustomizationReady).toBe(false);
    expect(inputs.releaseBlockers[0]).toBe("Release quality score stale; run pnpm verify:quality-score");
  });

  it("falls back to an explicit unavailable proof blocker when the score cannot be read", () => {
    const inputs = deriveReleaseQualityGoalInputs(parseReleaseQualityReport("{"));

    expect(inputs.source).toBe("unavailable");
    expect(inputs.evidenceStatus).toBe("unavailable");
    expect(inputs.authenticatedPromptConsentRequired).toBe(true);
    expect(inputs.releaseBlockers).toEqual(["Release quality score unavailable; run pnpm verify:quality-score"]);
  });

  it("parses final-goal-audit residual risk into a visible implementation-vs-consent summary", () => {
    const report = parseFinalGoalAuditReport(
      JSON.stringify({
        status: "blocked-by-explicit-consent",
        goalComplete: false,
        evidenceComplete: true,
        requirements: [
          {
            id: "rust-native-terminal-core",
            label: "Rust native terminal core",
            status: "proved",
            detail: "Rust-owned input is proven.",
            evidence: [".codex-auto/quality/native-boundary-contract.json"],
          },
        ],
        missingRequirements: [],
        residualRiskRegister: {
          state: "blocked-only-by-explicit-token-consent",
          implementationFixableCount: 0,
          policyBlockedCount: 1,
          implementationFixable: [],
          policyBlocked: [
            {
              area: "authenticated-ai-cli-prompt-smoke",
              blocker: "authenticated AI CLI prompt smoke requires explicit token-spend consent",
              requiredAction: "User must explicitly approve token spend.",
            },
          ],
          canContinueWithoutTokenSpend: true,
          completionClaimAllowed: false,
        },
      }),
    );

    const residual = deriveFinalGoalResidualRisk(report);
    const proofs = deriveFinalGoalRequirementProofs(report);

    expect(residual.source).toBe("final-goal-audit");
    expect(residual.state).toBe("blocked-only-by-explicit-token-consent");
    expect(residual.label).toBe("Implementation risks clear");
    expect(residual.detail).toBe("0 fixable · 1 consent gate");
    expect(residual.implementationFixableCount).toBe(0);
    expect(residual.policyBlocked).toEqual([
      "authenticated-ai-cli-prompt-smoke: authenticated AI CLI prompt smoke requires explicit token-spend consent",
    ]);
    expect(residual.canContinueWithoutTokenSpend).toBe(true);
    expect(residual.completionClaimAllowed).toBe(false);
    expect(proofs).toEqual([
      {
        id: "rust-native-terminal-core",
        label: "Rust native terminal core",
        status: "proved",
        detail: "Rust-owned input is proven.",
        evidence: [".codex-auto/quality/native-boundary-contract.json"],
      },
    ]);
  });

  it("turns missing final-goal-audit evidence into an explicit implementation risk", () => {
    const residual = deriveFinalGoalResidualRisk(parseFinalGoalAuditReport("{"));

    expect(residual.source).toBe("unavailable");
    expect(residual.state).toBe("unavailable");
    expect(residual.implementationFixableCount).toBe(1);
    expect(residual.implementationFixable).toEqual(["Final goal audit unavailable; run pnpm verify:final-goal-audit"]);
    expect(deriveFinalGoalRequirementProofs(null)).toEqual([
      {
        id: "final-goal-audit-unavailable",
        label: "Final audit unavailable",
        status: "missing",
        detail: "Run pnpm verify:final-goal-audit",
        evidence: [".codex-auto/quality/final-goal-audit.json"],
      },
    ]);
  });

  it("parses the final safe gate summary into a visible non-token gate status", () => {
    const report = parseFinalGoalSafeSummaryReport(
      JSON.stringify({
        generatedAt: "2026-05-20T00:00:00.000Z",
        localDate: "2026-05-21",
        timeZone: "Asia/Tokyo",
        ok: true,
        status: "blocked-by-explicit-consent",
        tokenSpendingPromptExecuted: false,
        steps: [
          { id: "authenticated-provider-guard", label: "Provider guard", ok: true, exitCode: 0 },
          { id: "quality-score-post-audit", label: "Quality score", ok: true, exitCode: 0 },
        ],
        failedSteps: [],
        coverage: {
          provedRequirementCount: 8,
          totalRequirementCount: 8,
          nonTokenRequirementsProved: true,
          consentBlockerCount: 1,
          nonConsentBlockerCount: 0,
          proofArtifactPassCount: 7,
          proofArtifactCount: 7,
        },
        invariants: {
          noTokenPromptSent: true,
          noFailedSafeSteps: true,
          noNonConsentBlockers: true,
          implementationFixableCountZero: true,
          exactlyOnePolicyConsentGate: true,
          finalAuditEvidenceComplete: true,
          finalAuditRequirementsProved: true,
          proofArtifactsPassed: true,
          releaseHygieneClean: true,
          supplyChainAuditClean: true,
          terminalChunkedOscLivePassed: true,
          nativeTerminalInputHostPassed: true,
          nativeHwndPasteLivePassed: true,
          gitFinalizationReadinessPassed: true,
          rightRailGoalTrackSemanticFreshness: true,
          rightRailGoalTrackCycleBoundaryExplained: true,
        },
        nextRequiredAction:
          "Set QUORUM_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS and run pnpm verify:terminal:authenticated-ai-cli-prompt if token-spend validation is desired.",
      }),
    );

    const safeGate = deriveFinalGoalSafeGate(report);

    expect(safeGate.source).toBe("final-goal-safe-summary");
    expect(safeGate.status).toBe("blocked-by-explicit-consent");
    expect(safeGate.label).toBe("Safe gate consent-gated");
    expect(safeGate.detail).toBe(
      "2 checks green · 8/8 requirements · 7/7 artifacts · core: hygiene/supply chain/inline image/native input/native paste/git handoff",
    );
    expect(safeGate.failedStepCount).toBe(0);
    expect(safeGate.proofRequirementPassCount).toBe(8);
    expect(safeGate.proofRequirementCount).toBe(8);
    expect(safeGate.proofArtifactPassCount).toBe(7);
    expect(safeGate.proofArtifactCount).toBe(7);
    expect(safeGate.consentBlockerCount).toBe(1);
    expect(safeGate.nonConsentBlockerCount).toBe(0);
    expect(safeGate.noTokenPromptSent).toBe(true);
    expect(safeGate.tokenSpendingPromptExecuted).toBe(false);
    expect(safeGate.releaseHygieneClean).toBe(true);
    expect(safeGate.supplyChainAuditClean).toBe(true);
    expect(safeGate.terminalChunkedOscLivePassed).toBe(true);
    expect(safeGate.nativeTerminalInputHostPassed).toBe(true);
    expect(safeGate.nativeHwndPasteLivePassed).toBe(true);
    expect(safeGate.gitFinalizationReadinessPassed).toBe(true);
    expect(safeGate.semanticFreshness).toBe("current-contract");
    expect(safeGate.cycleBoundary).toBe("right-rail-safe-gate-mutual-proof");
    expect(safeGate.localDate).toBe("2026-05-21");
    expect(safeGate.timeZone).toBe("Asia/Tokyo");
  });

  it("keeps the right-rail self-cycle visible without downgrading native core proof detail", () => {
    const report = parseFinalGoalSafeSummaryReport(
      JSON.stringify({
        generatedAt: "2026-05-21T15:11:12.290Z",
        localDate: "2026-05-22",
        timeZone: "Asia/Tokyo",
        ok: false,
        status: "blocked",
        tokenSpendingPromptExecuted: false,
        steps: [
          { id: "authenticated-provider-guard", label: "Provider guard", ok: true, exitCode: 0 },
          { id: "right-rail-goal-track-tauri", label: "Right rail Goal Track", ok: true, exitCode: 0 },
        ],
        failedSteps: [],
        coverage: {
          provedRequirementCount: 8,
          totalRequirementCount: 8,
          nonTokenRequirementsProved: true,
          consentBlockerCount: 1,
          nonConsentBlockerCount: 0,
          proofArtifactPassCount: 14,
          proofArtifactCount: 15,
        },
        invariants: {
          noTokenPromptSent: true,
          noFailedSafeSteps: true,
          noNonConsentBlockers: true,
          implementationFixableCountZero: true,
          exactlyOnePolicyConsentGate: true,
          finalAuditEvidenceComplete: true,
          finalAuditRequirementsProved: true,
          proofArtifactsPassed: false,
          releaseHygieneClean: true,
          supplyChainAuditClean: true,
          terminalChunkedOscLivePassed: true,
          nativeTerminalInputHostPassed: true,
          nativeHwndPasteLivePassed: true,
          rightRailGoalTrackSemanticFreshness: false,
          rightRailGoalTrackCycleBoundaryExplained: true,
        },
        nextRequiredAction:
          "Fix failed safe-gate steps, non-consent blockers, or implementation-fixable residual risks.",
      }),
    );

    const safeGate = deriveFinalGoalSafeGate(report);

    expect(safeGate.status).toBe("blocked");
    expect(safeGate.detail).toBe(
      "2 checks green · 8/8 requirements · 14/15 artifacts · core: hygiene/supply chain/inline image/native input/native paste",
    );
    expect(safeGate.nextRequiredAction).toBe(
      "Refresh the right rail Goal Track Tauri proof; non-token implementation proofs are green.",
    );
    expect(safeGate.semanticFreshness).toBe("stale-or-incomplete");
    expect(safeGate.cycleBoundary).toBe("right-rail-safe-gate-mutual-proof");
  });

  it("turns missing final safe gate evidence into an explicit goal-track blocker", () => {
    const safeGate = deriveFinalGoalSafeGate(null);

    expect(safeGate.source).toBe("unavailable");
    expect(safeGate.status).toBe("unavailable");
    expect(safeGate.releaseHygieneClean).toBe(false);
    expect(safeGate.supplyChainAuditClean).toBe(false);
    expect(safeGate.terminalChunkedOscLivePassed).toBe(false);
    expect(safeGate.nativeTerminalInputHostPassed).toBe(false);
    expect(safeGate.nativeHwndPasteLivePassed).toBe(false);
    expect(safeGate.semanticFreshness).toBe("unavailable");
    expect(safeGate.cycleBoundary).toBe("none");
    expect(safeGate.nextRequiredAction).toBe("Run pnpm verify:goal:safe");
  });
});
