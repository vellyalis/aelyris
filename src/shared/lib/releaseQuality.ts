export interface ReleaseQualityScoreEntry {
  id: string;
  label: string;
  points: number;
  max: number;
  detail?: string;
  blockers?: string[];
}

export interface ReleaseQualityBlocker {
  area?: string;
  blocker?: string;
}

export interface ReleaseQualityReport {
  generatedAt?: string;
  localDate?: string;
  timeZone?: string;
  score?: number;
  total?: number;
  max?: number;
  grade?: string;
  releaseCandidateReady?: boolean;
  scores: ReleaseQualityScoreEntry[];
  blockers: ReleaseQualityBlocker[];
}

export interface ReleaseQualityGoalInputs {
  source: "release-quality-score" | "unavailable";
  evidenceStatus: "fresh" | "stale" | "unavailable";
  evidenceLabel: string;
  evidenceDetail: string;
  generatedAt?: string;
  localDate?: string;
  timeZone?: string;
  ageMs?: number;
  releaseCandidateReady: boolean;
  terminalCoreReady: boolean;
  commandCenterScenarioReady: boolean;
  themeCustomizationReady: boolean;
  authenticatedPromptConsentRequired: boolean;
  releaseBlockers: string[];
}

export interface FinalGoalResidualRisk {
  source: "final-goal-audit" | "unavailable";
  state:
    | "complete"
    | "blocked-only-by-explicit-token-consent"
    | "blocked-by-external-gates"
    | "implementation-risk-open"
    | "unavailable";
  label: string;
  detail: string;
  implementationFixableCount: number;
  policyBlockedCount: number;
  externalBlockedCount: number;
  implementationFixable: string[];
  policyBlocked: string[];
  externalBlocked: string[];
  canContinueWithoutTokenSpend: boolean;
  completionClaimAllowed: boolean;
}

export interface FinalGoalRequirementProof {
  id: string;
  label: string;
  status: "proved" | "missing" | "unknown";
  detail: string;
  evidence: string[];
}

export interface FinalGoalAuditReport {
  localDate?: string;
  timeZone?: string;
  status?: string;
  goalComplete: boolean;
  evidenceComplete: boolean;
  requirements: FinalGoalRequirementProof[];
  missingRequirements: string[];
  residualRiskRegister?: {
    state?: string;
    implementationFixableCount: number;
    policyBlockedCount: number;
    externalBlockedCount?: number;
    implementationFixable: string[];
    policyBlocked: string[];
    externalBlocked?: string[];
    canContinueWithoutTokenSpend: boolean;
    completionClaimAllowed: boolean;
  };
}

export interface FinalGoalSafeSummaryStep {
  id: string;
  label: string;
  ok: boolean;
  exitCode?: number | null;
}

export interface FinalGoalSafeSummaryReport {
  generatedAt?: string;
  localDate?: string;
  timeZone?: string;
  ok: boolean;
  status?: string;
  tokenSpendingPromptExecuted: boolean;
  steps: FinalGoalSafeSummaryStep[];
  failedSteps: string[];
  coverage?: {
    provedRequirementCount: number;
    totalRequirementCount: number;
    nonTokenRequirementsProved: boolean;
    consentBlockerCount: number;
    nonConsentBlockerCount: number;
    externalBlockerCount?: number;
    proofArtifactPassCount: number;
    proofArtifactCount: number;
  };
  invariants?: {
    noTokenPromptSent: boolean;
    noFailedSafeSteps: boolean;
    noNonConsentBlockers: boolean;
    implementationFixableCountZero: boolean;
    exactlyOnePolicyConsentGate: boolean;
    externalHostGateIsolated?: boolean;
    finalAuditEvidenceComplete: boolean;
    finalAuditRequirementsProved: boolean;
    proofArtifactsPassed: boolean;
    releaseHygieneClean: boolean;
    supplyChainAuditClean: boolean;
    terminalChunkedOscLivePassed: boolean;
    nativeTerminalInputHostPassed: boolean;
    nativeHwndPasteLivePassed: boolean;
    gitFinalizationReadinessPassed?: boolean;
    rightRailGoalTrackSemanticFreshness: boolean;
    rightRailGoalTrackCycleBoundaryExplained: boolean;
  };
  nextRequiredAction?: string;
}

export interface FinalGoalSafeGate {
  source: "final-goal-safe-summary" | "unavailable";
  status: "pass" | "blocked-by-explicit-consent" | "blocked-by-external-gates" | "blocked" | "unavailable";
  label: string;
  detail: string;
  ok: boolean;
  stepCount: number;
  failedStepCount: number;
  proofRequirementPassCount: number;
  proofRequirementCount: number;
  proofArtifactPassCount: number;
  proofArtifactCount: number;
  consentBlockerCount: number;
  nonConsentBlockerCount: number;
  externalBlockerCount: number;
  noTokenPromptSent: boolean;
  tokenSpendingPromptExecuted: boolean;
  releaseHygieneClean: boolean;
  supplyChainAuditClean: boolean;
  terminalChunkedOscLivePassed: boolean;
  nativeTerminalInputHostPassed: boolean;
  nativeHwndPasteLivePassed: boolean;
  gitFinalizationReadinessPassed: boolean;
  semanticFreshness: "current-contract" | "stale-or-incomplete" | "unavailable";
  cycleBoundary: "right-rail-safe-gate-mutual-proof" | "none";
  localDate?: string;
  timeZone?: string;
  nextRequiredAction: string;
}

export interface ReleaseQualityGoalInputOptions {
  nowMs?: number;
  staleAfterMs?: number;
}

const DEFAULT_RELEASE_QUALITY_STALE_AFTER_MS = 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseScoreEntry(value: unknown): ReleaseQualityScoreEntry | null {
  if (!isRecord(value)) return null;
  const id = stringOrEmpty(value.id);
  if (!id) return null;
  const blockers = Array.isArray(value.blockers)
    ? value.blockers.filter((item): item is string => typeof item === "string")
    : [];
  return {
    id,
    label: stringOrEmpty(value.label) || id,
    points: numberOrZero(value.points),
    max: numberOrZero(value.max),
    detail: typeof value.detail === "string" ? value.detail : undefined,
    blockers,
  };
}

function parseBlocker(value: unknown): ReleaseQualityBlocker | null {
  if (!isRecord(value)) return null;
  const area = typeof value.area === "string" ? value.area : undefined;
  const blocker = typeof value.blocker === "string" ? value.blocker : undefined;
  if (!area && !blocker) return null;
  return { area, blocker };
}

function riskItemText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return null;
  const area = typeof value.area === "string" ? value.area : "";
  const blocker = typeof value.blocker === "string" ? value.blocker : "";
  const action = typeof value.requiredAction === "string" ? value.requiredAction : "";
  if (value.canAutoResolve === true && action) return [area, action].filter(Boolean).join(": ");
  const head = [area, blocker].filter(Boolean).join(": ");
  return head || action || null;
}

function parseRiskList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => riskItemText(item)).filter((item): item is string => Boolean(item));
}

function parseEvidenceList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function parseFinalGoalRequirementProof(value: unknown): FinalGoalRequirementProof | null {
  if (!isRecord(value)) return null;
  const id = stringOrEmpty(value.id);
  if (!id) return null;
  const rawStatus = stringOrEmpty(value.status);
  const status = rawStatus === "proved" || rawStatus === "missing" ? rawStatus : "unknown";
  return {
    id,
    label: stringOrEmpty(value.label) || id,
    status,
    detail: stringOrEmpty(value.detail),
    evidence: parseEvidenceList(value.evidence),
  };
}

export function parseReleaseQualityReport(text: string): ReleaseQualityReport | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return null;
    return {
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : undefined,
      localDate: typeof parsed.localDate === "string" ? parsed.localDate : undefined,
      timeZone: typeof parsed.timeZone === "string" ? parsed.timeZone : undefined,
      score: typeof parsed.score === "number" ? parsed.score : undefined,
      total: typeof parsed.total === "number" ? parsed.total : undefined,
      max: typeof parsed.max === "number" ? parsed.max : undefined,
      grade: typeof parsed.grade === "string" ? parsed.grade : undefined,
      releaseCandidateReady: parsed.releaseCandidateReady === true,
      scores: Array.isArray(parsed.scores)
        ? parsed.scores
            .map((entry) => parseScoreEntry(entry))
            .filter((entry): entry is ReleaseQualityScoreEntry => entry != null)
        : [],
      blockers: Array.isArray(parsed.blockers)
        ? parsed.blockers
            .map((entry) => parseBlocker(entry))
            .filter((entry): entry is ReleaseQualityBlocker => entry != null)
        : [],
    };
  } catch {
    return null;
  }
}

export function parseFinalGoalAuditReport(text: string): FinalGoalAuditReport | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return null;
    const residual = isRecord(parsed.residualRiskRegister) ? parsed.residualRiskRegister : null;
    return {
      localDate: typeof parsed.localDate === "string" ? parsed.localDate : undefined,
      timeZone: typeof parsed.timeZone === "string" ? parsed.timeZone : undefined,
      status: typeof parsed.status === "string" ? parsed.status : undefined,
      goalComplete: parsed.goalComplete === true,
      evidenceComplete: parsed.evidenceComplete === true,
      requirements: Array.isArray(parsed.requirements)
        ? parsed.requirements
            .map((entry) => parseFinalGoalRequirementProof(entry))
            .filter((entry): entry is FinalGoalRequirementProof => entry != null)
        : [],
      missingRequirements: Array.isArray(parsed.missingRequirements)
        ? parsed.missingRequirements.filter((entry): entry is string => typeof entry === "string")
        : [],
      residualRiskRegister: residual
        ? {
            state: typeof residual.state === "string" ? residual.state : undefined,
            implementationFixableCount: numberOrZero(residual.implementationFixableCount),
            policyBlockedCount: numberOrZero(residual.policyBlockedCount),
            externalBlockedCount: numberOrZero(residual.externalBlockedCount),
            implementationFixable: parseRiskList(residual.implementationFixable),
            policyBlocked: parseRiskList(residual.policyBlocked),
            externalBlocked: parseRiskList(residual.externalBlocked),
            canContinueWithoutTokenSpend: residual.canContinueWithoutTokenSpend === true,
            completionClaimAllowed: residual.completionClaimAllowed === true,
          }
        : undefined,
    };
  } catch {
    return null;
  }
}

export function deriveFinalGoalRequirementProofs(report: FinalGoalAuditReport | null): FinalGoalRequirementProof[] {
  if (!report || report.requirements.length === 0) {
    return [
      {
        id: "final-goal-audit-unavailable",
        label: "Final audit unavailable",
        status: "missing",
        detail: "Run pnpm verify:final-goal-audit",
        evidence: [".codex-auto/quality/final-goal-audit.json"],
      },
    ];
  }
  return report.requirements.map((requirement) => ({
    id: requirement.id,
    label: requirement.label,
    status: requirement.status,
    detail: requirement.detail,
    evidence: [...requirement.evidence],
  }));
}

function parseSafeStep(value: unknown): FinalGoalSafeSummaryStep | null {
  if (!isRecord(value)) return null;
  const id = stringOrEmpty(value.id);
  if (!id) return null;
  return {
    id,
    label: stringOrEmpty(value.label) || id,
    ok: value.ok === true,
    exitCode: typeof value.exitCode === "number" ? value.exitCode : null,
  };
}

export function parseFinalGoalSafeSummaryReport(text: string): FinalGoalSafeSummaryReport | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return null;
    return {
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : undefined,
      localDate: typeof parsed.localDate === "string" ? parsed.localDate : undefined,
      timeZone: typeof parsed.timeZone === "string" ? parsed.timeZone : undefined,
      ok: parsed.ok === true,
      status: typeof parsed.status === "string" ? parsed.status : undefined,
      tokenSpendingPromptExecuted: parsed.tokenSpendingPromptExecuted === true,
      steps: Array.isArray(parsed.steps)
        ? parsed.steps
            .map((entry) => parseSafeStep(entry))
            .filter((entry): entry is FinalGoalSafeSummaryStep => entry != null)
        : [],
      failedSteps: Array.isArray(parsed.failedSteps)
        ? parsed.failedSteps.filter((entry): entry is string => typeof entry === "string")
        : [],
      coverage: isRecord(parsed.coverage)
        ? {
            provedRequirementCount: numberOrZero(parsed.coverage.provedRequirementCount),
            totalRequirementCount: numberOrZero(parsed.coverage.totalRequirementCount),
            nonTokenRequirementsProved: parsed.coverage.nonTokenRequirementsProved === true,
            consentBlockerCount: numberOrZero(parsed.coverage.consentBlockerCount),
            nonConsentBlockerCount: numberOrZero(parsed.coverage.nonConsentBlockerCount),
            externalBlockerCount: numberOrZero(parsed.coverage.externalBlockerCount),
            proofArtifactPassCount: numberOrZero(parsed.coverage.proofArtifactPassCount),
            proofArtifactCount: numberOrZero(parsed.coverage.proofArtifactCount),
          }
        : undefined,
      invariants: isRecord(parsed.invariants)
        ? {
            noTokenPromptSent: parsed.invariants.noTokenPromptSent === true,
            noFailedSafeSteps: parsed.invariants.noFailedSafeSteps === true,
            noNonConsentBlockers: parsed.invariants.noNonConsentBlockers === true,
            implementationFixableCountZero: parsed.invariants.implementationFixableCountZero === true,
            exactlyOnePolicyConsentGate: parsed.invariants.exactlyOnePolicyConsentGate === true,
            externalHostGateIsolated:
              typeof parsed.invariants.externalHostGateIsolated === "boolean"
                ? parsed.invariants.externalHostGateIsolated
                : undefined,
            finalAuditEvidenceComplete: parsed.invariants.finalAuditEvidenceComplete === true,
            finalAuditRequirementsProved: parsed.invariants.finalAuditRequirementsProved === true,
            proofArtifactsPassed: parsed.invariants.proofArtifactsPassed === true,
            releaseHygieneClean: parsed.invariants.releaseHygieneClean === true,
            supplyChainAuditClean: parsed.invariants.supplyChainAuditClean === true,
            terminalChunkedOscLivePassed: parsed.invariants.terminalChunkedOscLivePassed === true,
            nativeTerminalInputHostPassed: parsed.invariants.nativeTerminalInputHostPassed === true,
            nativeHwndPasteLivePassed: parsed.invariants.nativeHwndPasteLivePassed === true,
            gitFinalizationReadinessPassed:
              typeof parsed.invariants.gitFinalizationReadinessPassed === "boolean"
                ? parsed.invariants.gitFinalizationReadinessPassed
                : undefined,
            rightRailGoalTrackSemanticFreshness: parsed.invariants.rightRailGoalTrackSemanticFreshness === true,
            rightRailGoalTrackCycleBoundaryExplained:
              parsed.invariants.rightRailGoalTrackCycleBoundaryExplained === true,
          }
        : undefined,
      nextRequiredAction: typeof parsed.nextRequiredAction === "string" ? parsed.nextRequiredAction : undefined,
    };
  } catch {
    return null;
  }
}

function parsedTimeMs(value?: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scoreById(report: ReleaseQualityReport, id: string): ReleaseQualityScoreEntry | null {
  return report.scores.find((entry) => entry.id === id) ?? null;
}

function scoreClosed(report: ReleaseQualityReport, id: string): boolean {
  const entry = scoreById(report, id);
  return Boolean(entry && entry.max > 0 && entry.points >= entry.max && (entry.blockers?.length ?? 0) === 0);
}

function blockerText(blocker: ReleaseQualityBlocker): string {
  if (blocker.area && blocker.blocker) return `${blocker.area}: ${blocker.blocker}`;
  return blocker.blocker ?? blocker.area ?? "";
}

function hasAuthenticatedPromptConsentBlocker(report: ReleaseQualityReport): boolean {
  const authScore = scoreById(report, "authenticated-ai-cli-prompt-smoke");
  const authOpen = !scoreClosed(report, "authenticated-ai-cli-prompt-smoke");
  const blockerOpen = report.blockers.some((entry) => {
    const text = blockerText(entry).toLowerCase();
    return text.includes("authenticated-ai-cli-prompt-smoke") || text.includes("token-spend consent");
  });
  return authOpen || blockerOpen || authScore == null;
}

export function deriveFinalGoalResidualRisk(report: FinalGoalAuditReport | null): FinalGoalResidualRisk {
  const residual = report?.residualRiskRegister;
  if (!report || !residual) {
    return {
      source: "unavailable",
      state: "unavailable",
      label: "Final audit unavailable",
      detail: "Run pnpm verify:final-goal-audit",
      implementationFixableCount: 1,
      policyBlockedCount: 0,
      externalBlockedCount: 0,
      implementationFixable: ["Final goal audit unavailable; run pnpm verify:final-goal-audit"],
      policyBlocked: [],
      externalBlocked: [],
      canContinueWithoutTokenSpend: false,
      completionClaimAllowed: false,
    };
  }

  const state =
    residual.state === "complete" ||
    residual.state === "blocked-only-by-explicit-token-consent" ||
    residual.state === "blocked-by-external-gates" ||
    residual.state === "implementation-risk-open"
      ? residual.state
      : "implementation-risk-open";
  const label =
    state === "complete"
      ? "Residual risk clear"
      : state === "blocked-only-by-explicit-token-consent"
        ? "Implementation risks clear"
        : state === "blocked-by-external-gates"
          ? "External gate open"
          : "Implementation risks open";
  const detail =
    state === "blocked-only-by-explicit-token-consent"
      ? `${residual.implementationFixableCount} fixable · ${residual.policyBlockedCount} consent gate`
      : state === "blocked-by-external-gates"
        ? `${residual.implementationFixableCount} fixable · ${residual.policyBlockedCount} consent · ${
            residual.externalBlockedCount ?? 0
          } external`
        : state === "complete"
          ? "No implementation or policy blocker remains"
          : `${residual.implementationFixableCount} fixable · ${residual.policyBlockedCount} policy`;

  return {
    source: "final-goal-audit",
    state,
    label,
    detail,
    implementationFixableCount: residual.implementationFixableCount,
    policyBlockedCount: residual.policyBlockedCount,
    externalBlockedCount: residual.externalBlockedCount ?? 0,
    implementationFixable: residual.implementationFixable,
    policyBlocked: residual.policyBlocked,
    externalBlocked: residual.externalBlocked ?? [],
    canContinueWithoutTokenSpend: residual.canContinueWithoutTokenSpend,
    completionClaimAllowed: residual.completionClaimAllowed,
  };
}

export function deriveFinalGoalSafeGate(report: FinalGoalSafeSummaryReport | null): FinalGoalSafeGate {
  if (!report) {
    return {
      source: "unavailable",
      status: "unavailable",
      label: "Safe gate unavailable",
      detail: "Run pnpm verify:goal:safe",
      ok: false,
      stepCount: 0,
      failedStepCount: 1,
      proofRequirementPassCount: 0,
      proofRequirementCount: 0,
      proofArtifactPassCount: 0,
      proofArtifactCount: 0,
      consentBlockerCount: 0,
      nonConsentBlockerCount: 1,
      externalBlockerCount: 0,
      noTokenPromptSent: false,
      tokenSpendingPromptExecuted: false,
      releaseHygieneClean: false,
      supplyChainAuditClean: false,
      terminalChunkedOscLivePassed: false,
      nativeTerminalInputHostPassed: false,
      nativeHwndPasteLivePassed: false,
      gitFinalizationReadinessPassed: false,
      semanticFreshness: "unavailable",
      cycleBoundary: "none",
      localDate: undefined,
      timeZone: undefined,
      nextRequiredAction: "Run pnpm verify:goal:safe",
    };
  }

  const failedStepCount = report.failedSteps.length || report.steps.filter((step) => !step.ok).length;
  const rightRailSelfCycleOnly =
    report.ok === false &&
    report.status === "blocked" &&
    failedStepCount === 0 &&
    report.coverage?.provedRequirementCount === report.coverage?.totalRequirementCount &&
    (report.coverage?.proofArtifactPassCount ?? 0) + 1 === (report.coverage?.proofArtifactCount ?? 0) &&
    report.coverage?.consentBlockerCount === 1 &&
    report.coverage?.nonConsentBlockerCount === 0 &&
    report.invariants?.noTokenPromptSent === true &&
    report.tokenSpendingPromptExecuted === false &&
    report.invariants?.releaseHygieneClean === true &&
    report.invariants?.supplyChainAuditClean === true &&
    report.invariants?.terminalChunkedOscLivePassed === true &&
    report.invariants?.nativeTerminalInputHostPassed === true &&
    report.invariants?.nativeHwndPasteLivePassed === true &&
    (report.invariants?.gitFinalizationReadinessPassed === true ||
      report.invariants?.gitFinalizationReadinessPassed == null) &&
    report.invariants?.rightRailGoalTrackCycleBoundaryExplained === true &&
    report.invariants?.rightRailGoalTrackSemanticFreshness === false;
  const status =
    report.ok && report.status === "complete"
      ? "pass"
      : report.ok && report.status === "blocked-by-external-gates"
        ? "blocked-by-external-gates"
        : report.ok && report.status === "blocked-by-explicit-consent"
          ? "blocked-by-explicit-consent"
          : report.ok
            ? "pass"
            : "blocked";
  const label =
    status === "pass"
      ? "Safe gate green"
      : status === "blocked-by-external-gates"
        ? "Safe gate external-gated"
        : status === "blocked-by-explicit-consent"
          ? "Safe gate operator token-gated"
          : "Safe gate blocked";
  const requirementProof = report.coverage?.totalRequirementCount
    ? `${report.coverage.provedRequirementCount}/${report.coverage.totalRequirementCount} requirements`
    : null;
  const artifactProof = report.coverage?.proofArtifactCount
    ? `${report.coverage.proofArtifactPassCount}/${report.coverage.proofArtifactCount} artifacts`
    : null;
  const safeProofDetail = [requirementProof, artifactProof].filter(Boolean).join(" · ") || "prompt not sent";
  const coreProofDetail = [
    report.invariants?.releaseHygieneClean === true ? "hygiene" : "",
    report.invariants?.supplyChainAuditClean === true ? "supply chain" : "",
    report.invariants?.terminalChunkedOscLivePassed === true ? "inline image" : "",
    report.invariants?.nativeTerminalInputHostPassed === true ? "native input" : "",
    report.invariants?.nativeHwndPasteLivePassed === true ? "native paste" : "",
    report.invariants?.gitFinalizationReadinessPassed === true ? "git handoff" : "",
  ]
    .filter(Boolean)
    .join("/");
  const proofDetail = coreProofDetail ? `${safeProofDetail} · core: ${coreProofDetail}` : safeProofDetail;
  const detail =
    status === "blocked-by-explicit-consent" || status === "blocked-by-external-gates" || rightRailSelfCycleOnly
      ? `${report.steps.length} checks green · ${proofDetail}`
      : status === "pass"
        ? `${report.steps.length} checks green${coreProofDetail ? ` · core: ${coreProofDetail}` : ""}`
        : `${failedStepCount} failed · run pnpm verify:goal:safe`;
  const semanticFreshness =
    report.invariants?.rightRailGoalTrackSemanticFreshness === true ? "current-contract" : "stale-or-incomplete";
  const cycleBoundary =
    report.invariants?.rightRailGoalTrackCycleBoundaryExplained === true ? "right-rail-safe-gate-mutual-proof" : "none";

  return {
    source: "final-goal-safe-summary",
    status,
    label,
    detail,
    ok: report.ok,
    stepCount: report.steps.length,
    failedStepCount,
    proofRequirementPassCount: report.coverage?.provedRequirementCount ?? 0,
    proofRequirementCount: report.coverage?.totalRequirementCount ?? 0,
    proofArtifactPassCount: report.coverage?.proofArtifactPassCount ?? 0,
    proofArtifactCount: report.coverage?.proofArtifactCount ?? 0,
    consentBlockerCount: report.coverage?.consentBlockerCount ?? 0,
    nonConsentBlockerCount: report.coverage?.nonConsentBlockerCount ?? 0,
    externalBlockerCount: report.coverage?.externalBlockerCount ?? 0,
    noTokenPromptSent: report.invariants?.noTokenPromptSent === true,
    tokenSpendingPromptExecuted: report.tokenSpendingPromptExecuted,
    releaseHygieneClean: report.invariants?.releaseHygieneClean === true,
    supplyChainAuditClean: report.invariants?.supplyChainAuditClean === true,
    terminalChunkedOscLivePassed: report.invariants?.terminalChunkedOscLivePassed === true,
    nativeTerminalInputHostPassed: report.invariants?.nativeTerminalInputHostPassed === true,
    nativeHwndPasteLivePassed: report.invariants?.nativeHwndPasteLivePassed === true,
    gitFinalizationReadinessPassed: report.invariants?.gitFinalizationReadinessPassed === true,
    semanticFreshness,
    cycleBoundary,
    localDate: report.localDate,
    timeZone: report.timeZone,
    nextRequiredAction: rightRailSelfCycleOnly
      ? "Refresh the right rail Goal Track Tauri proof; non-token implementation proofs are green."
      : (report.nextRequiredAction ?? "Run pnpm verify:goal:safe"),
  };
}

export function deriveReleaseQualityGoalInputs(
  report: ReleaseQualityReport | null,
  options: ReleaseQualityGoalInputOptions = {},
): ReleaseQualityGoalInputs {
  const nowMs = options.nowMs ?? Date.now();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_RELEASE_QUALITY_STALE_AFTER_MS;
  if (!report) {
    return {
      source: "unavailable",
      evidenceStatus: "unavailable",
      evidenceLabel: "Quality proof unavailable",
      evidenceDetail: "Run pnpm verify:quality-score",
      releaseCandidateReady: false,
      terminalCoreReady: false,
      commandCenterScenarioReady: false,
      themeCustomizationReady: false,
      authenticatedPromptConsentRequired: true,
      releaseBlockers: ["Release quality score unavailable; run pnpm verify:quality-score"],
    };
  }

  const generatedAtMs = parsedTimeMs(report.generatedAt);
  const ageMs = generatedAtMs == null ? undefined : Math.max(0, nowMs - generatedAtMs);
  const stale = ageMs == null || ageMs > staleAfterMs;
  const fresh = !stale;
  const releaseBlockers = report.blockers.map(blockerText).filter((value) => value.length > 0);
  if (stale) {
    releaseBlockers.unshift("Release quality score stale; run pnpm verify:quality-score");
  }
  const terminalCoreIds = [
    "mux-performance",
    "scrollback",
    "native-ime",
    "terminal-core-edge",
    "interactive-ai-cli-sidecar-boundary",
    "live-ai-cli-post-launch-chaos",
  ];
  return {
    source: "release-quality-score",
    evidenceStatus: stale ? "stale" : "fresh",
    evidenceLabel: stale ? "Quality proof stale" : "Quality proof fresh",
    evidenceDetail:
      report.score != null && report.grade
        ? [
            `${report.score}% ${report.grade} · ${report.total ?? "?"}/${report.max ?? "?"}`,
            report.localDate && report.timeZone ? `${report.localDate} ${report.timeZone}` : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : "Score artifact parsed without full score metadata",
    generatedAt: report.generatedAt,
    localDate: report.localDate,
    timeZone: report.timeZone,
    ageMs,
    releaseCandidateReady: !stale && report.releaseCandidateReady === true,
    terminalCoreReady: fresh && terminalCoreIds.every((id) => scoreClosed(report, id)),
    commandCenterScenarioReady:
      fresh &&
      scoreClosed(report, "command-center-scenario") &&
      scoreClosed(report, "right-rail-goal-track") &&
      scoreClosed(report, "ai-cli-launch-planner"),
    themeCustomizationReady: fresh && scoreClosed(report, "theme-customization-guard"),
    authenticatedPromptConsentRequired: hasAuthenticatedPromptConsentBlocker(report),
    releaseBlockers,
  };
}
