export const RIGHT_RAIL_COMPATIBILITY_CLIENT = {
  schema: "aether.react.right-rail-compatibility-client.v1",
  surface: "right-rail-goal-track",
  primarySurface: "aether-native",
  compatibilityRole: "legacy-tauri-react-client",
  productTruthOwner: "rust-native-command-center",
  nativeContract: "aether.native.right-rail-demotion-proof.v1",
  reactOwnsProductTruth: false,
  webviewDispatchRequired: false,
} as const;

export type RightRailGoalMilestoneId = "terminal-core" | "command-center" | "customization" | "release-proof";

export type RightRailGoalMilestoneStatus = "done" | "active" | "blocked" | "next";

export interface RightRailGoalTrackEdgeItem {
  id: string;
  label: string;
  status: "pass" | "watch" | "gap";
  score: number;
  max: number;
  detail: string;
  actionLabel: string;
}

export interface RightRailGoalMilestone {
  id: RightRailGoalMilestoneId;
  label: string;
  status: RightRailGoalMilestoneStatus;
  detail: string;
  evidence: string;
  remaining: string;
}

export interface RightRailGoalConsentPacket {
  status: "ready" | "missing" | "incomplete" | "pass" | "failed";
  label: string;
  detail: string;
  provider: string;
  command: string;
  requiredEnv: string;
  preflightReady: boolean;
  safeNoPromptSent: boolean;
  wouldSpendTokens: boolean;
  providerReadiness?: readonly {
    provider: string;
    status: "ready" | "blocked";
    failedChecks: readonly string[];
    command: string;
    requiredEnv: string;
  }[];
  artifactReadiness?: readonly {
    id: string;
    path: string;
    exists: boolean;
    fresh: boolean;
    blockingReason: string;
    refreshCommand: string;
    expiresAt: string;
  }[];
  artifactFreshness?: {
    status: "green" | "attention" | "unavailable";
    label: string;
    detail: string;
    freshCount: number;
    staleCount: number;
    totalCount: number;
    nextRefresh: {
      id: string;
      path: string;
      expiresAt: string;
      refreshCommand: string;
      refreshReason: string;
      costClass: string;
      fresh: boolean;
    } | null;
  };
}

export interface RightRailGoalConsentRunAction {
  label: string;
  detail: string;
  provider: string;
  command: string;
  requiredEnv: string;
  providerEnv: string;
  defaultProvider: string;
  powershellSnippet: string;
  requiresExplicitConsent: boolean;
}

export interface RightRailGoalRefreshAction {
  id: string;
  label: string;
  detail: string;
  path: string;
  command: string;
  reason: string;
  expiresAt: string;
  costClass: string;
  fresh: boolean;
  requiresExplicitConsent: boolean;
}

export interface RightRailGoalExternalGateAction {
  id: "native-user-sleep-cycle";
  label: string;
  detail: string;
  command: string;
  followUpCommands: readonly string[];
  powershellSnippet: string;
  requiresExplicitConsent: boolean;
  requiresUserAction: boolean;
  manualAction: string;
  costClass: "no-token-user-host-action";
}

export interface RightRailGoalRiskSummary {
  id: string;
  label: string;
  status?: string;
  severity?: string;
  source?: "release" | "qa-fixture" | "runtime";
}

export interface RightRailGoalResidualRisk {
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
  externalBlockedCount?: number;
  implementationFixable: readonly string[];
  policyBlocked: readonly string[];
  externalBlocked?: readonly string[];
  canContinueWithoutTokenSpend: boolean;
  completionClaimAllowed: boolean;
}

export interface RightRailGoalRequirementProof {
  id: string;
  label: string;
  status: "proved" | "missing" | "unknown";
  detail: string;
  evidence: readonly string[];
}

export interface RightRailGoalBoundaryProof {
  id:
    | "native-input-host"
    | "native-hwnd-paste"
    | "chunked-osc-inline-image"
    | "release-hygiene"
    | "supply-chain-audit"
    | "git-finalization"
    | "safe-proof-chain";
  label: string;
  status: "proved" | "missing" | "unknown";
  detail: string;
  source: "final-goal-safe-summary" | "unavailable";
  artifactPath: string;
  refreshCommand: string;
  costClass: "no-token";
}

export interface RightRailGoalSafeGate {
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
  externalBlockerCount?: number;
  noTokenPromptSent: boolean;
  tokenSpendingPromptExecuted: boolean;
  releaseHygieneClean: boolean;
  supplyChainAuditClean: boolean;
  terminalChunkedOscLivePassed: boolean;
  nativeTerminalInputHostPassed: boolean;
  nativeHwndPasteLivePassed: boolean;
  gitFinalizationReadinessPassed?: boolean;
  semanticFreshness: "current-contract" | "stale-or-incomplete" | "unavailable";
  cycleBoundary: "right-rail-safe-gate-mutual-proof" | "none";
  localDate?: string;
  timeZone?: string;
  nextRequiredAction: string;
}

export interface RightRailGoalTrackInput {
  edgeScore: number;
  edgeGrade: string;
  edgeItems: readonly RightRailGoalTrackEdgeItem[];
  qualityEvidenceStatus?: "fresh" | "stale" | "unavailable";
  qualityEvidenceLabel?: string;
  qualityEvidenceDetail?: string;
  qualityEvidenceLocalDate?: string;
  qualityEvidenceTimeZone?: string;
  aiCliLaunchPlanStatus?: string | null;
  interactiveSessionCount: number;
  interactiveNativeFallbackCount: number;
  changedFilesCount: number;
  pendingDecisionCount: number;
  graphRiskCount: number;
  graphRiskSummaries?: readonly RightRailGoalRiskSummary[];
  runtimeFallbackCount?: number;
  runtimeFallbackSummaries?: readonly RightRailGoalRiskSummary[];
  qaRiskCount?: number;
  qaRiskSummaries?: readonly RightRailGoalRiskSummary[];
  terminalCoreReady?: boolean;
  commandCenterScenarioReady?: boolean;
  themeCustomizationReady?: boolean;
  authenticatedPromptConsentRequired?: boolean;
  authenticatedPromptConsentPacket?: RightRailGoalConsentPacket | null;
  releaseBlockers?: readonly string[];
  residualRisk?: RightRailGoalResidualRisk | null;
  safeGate?: RightRailGoalSafeGate | null;
  requirementProofs?: readonly RightRailGoalRequirementProof[];
}

export interface RightRailGoalTrack {
  label: string;
  detail: string;
  status: RightRailGoalMilestoneStatus;
  confidenceLabel: string;
  qualityEvidence: {
    status: "fresh" | "stale" | "unavailable";
    label: string;
    detail: string;
    localDate?: string;
    timeZone?: string;
  };
  consentPacket: RightRailGoalConsentPacket | null;
  consentRunAction: RightRailGoalConsentRunAction | null;
  consentRunActions: RightRailGoalConsentRunAction[];
  refreshActions: RightRailGoalRefreshAction[];
  externalGateActions: RightRailGoalExternalGateAction[];
  residualRisk: RightRailGoalResidualRisk | null;
  safeGate: RightRailGoalSafeGate | null;
  requirementProofs: RightRailGoalRequirementProof[];
  boundaryProofs: RightRailGoalBoundaryProof[];
  riskEvidence: RightRailGoalRiskSummary[];
  runtimeFallbackEvidence: RightRailGoalRiskSummary[];
  qaRiskEvidence: RightRailGoalRiskSummary[];
  percent: number;
  doneCount: number;
  totalCount: number;
  activeMilestoneId: RightRailGoalMilestoneId;
  nextAction: string;
  blockers: string[];
  remainingItems: string[];
  milestones: RightRailGoalMilestone[];
}

const STATUS_WEIGHT: Record<RightRailGoalMilestoneStatus, number> = {
  done: 1,
  active: 0.68,
  blocked: 0.38,
  next: 0.28,
};

function statusSortValue(status: RightRailGoalMilestoneStatus): number {
  if (status === "blocked") return 0;
  if (status === "active") return 1;
  if (status === "next") return 2;
  return 3;
}

function edgeGapCount(edgeItems: readonly RightRailGoalTrackEdgeItem[]): number {
  return edgeItems.filter((item) => item.status === "gap").length;
}

function firstEdgeGap(edgeItems: readonly RightRailGoalTrackEdgeItem[]): RightRailGoalTrackEdgeItem | undefined {
  return edgeItems.find((item) => item.status === "gap") ?? edgeItems.find((item) => item.status === "watch");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function formatRiskBlocker(count: number, summaries: readonly RightRailGoalRiskSummary[]): string {
  if (count <= 0) return "";
  const base = `${count} risk or blocker node${count === 1 ? "" : "s"} open`;
  const labels = summaries
    .slice(0, 3)
    .map((item) => item.label.trim())
    .filter(Boolean);
  if (labels.length === 0) return base;
  const hidden = Math.max(0, count - labels.length);
  return `${base}: ${labels.join(", ")}${hidden > 0 ? `, +${hidden}` : ""}`;
}

function formatRuntimeFallbackBlocker(count: number, summaries: readonly RightRailGoalRiskSummary[]): string {
  if (count <= 0) return "";
  const base = `${count} runtime fallback event${count === 1 ? "" : "s"} visible`;
  const labels = summaries
    .slice(0, 3)
    .map((item) => item.label.trim())
    .filter(Boolean);
  if (labels.length === 0) return base;
  const hidden = Math.max(0, count - labels.length);
  return `${base}: ${labels.join(", ")}${hidden > 0 ? `, +${hidden}` : ""}`;
}

function isAuthenticatedPromptConsentBlocker(value: string): boolean {
  return /authenticated[-\s]?ai[-\s]?cli[-\s]?prompt|authenticated AI CLI prompt|token-spend consent/i.test(value);
}

function isHostSleepExternalBlocker(value: string): boolean {
  return /real-os-soak|sleep\/resume|SetSuspendState returned false|GetLastError=50|host.*sleep.*unsupported/i.test(
    value,
  );
}

function isGoalTrackAuditBlocker(value: string): boolean {
  return (
    /right-rail-goal-track|final-goal-evidence-map/i.test(value) ||
    /right-rail-smoke|right rail smoke suite|missing required smoke:\s*(?:scale-contract|stale-url-truth|goal-track-tauri)/i.test(
      value,
    )
  );
}

function milestone({ id, label, status, detail, evidence, remaining }: RightRailGoalMilestone): RightRailGoalMilestone {
  return { id, label, status, detail, evidence, remaining };
}

function consentProviders(packet: RightRailGoalConsentPacket | null): string[] {
  const providers = packet?.providerReadiness
    ?.map((entry) => entry.provider.trim())
    .filter((provider) => provider.length > 0);
  if (providers && providers.length > 0) return unique(providers);
  const provider = packet?.provider.trim();
  if (provider && provider.length > 0) return [provider];
  return ["codex", "claude", "gemini"];
}

function defaultConsentProvider(packet: RightRailGoalConsentPacket | null, providers: readonly string[]): string {
  const preferred = packet?.provider.trim();
  if (preferred && providers.includes(preferred)) return preferred;
  return providers[0] ?? "codex";
}

function buildConsentRunActions(
  packet: RightRailGoalConsentPacket | null,
  authenticatedPromptConsentRequired: boolean,
): RightRailGoalConsentRunAction[] {
  if (!authenticatedPromptConsentRequired || !packet) return [];
  if (packet.status !== "ready" && packet.status !== "pass") return [];
  const providers = consentProviders(packet);
  const defaultProvider = defaultConsentProvider(packet, providers);
  const command = packet.command || "pnpm verify:terminal:authenticated-ai-cli-prompt";
  const requiredEnv = packet.requiredEnv || "AETHER_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS";
  const providerEnv = `AETHER_AUTH_PROMPT_PROVIDER=${providers.join("|")}`;
  return providers.map((provider) => {
    const powershellSnippet = [
      `$env:AETHER_AUTH_PROMPT_CONSENT="I_UNDERSTAND_THIS_MAY_SPEND_TOKENS"`,
      `$env:AETHER_AUTH_PROMPT_PROVIDER="${provider}"`,
      command,
    ].join("\n");
    return {
      label: provider === defaultProvider ? "Copy verified run command" : `Copy ${provider} run command`,
      detail: `${provider}${provider === defaultProvider ? " default" : ""} · token-spend consent required`,
      provider,
      command,
      requiredEnv,
      providerEnv,
      defaultProvider,
      powershellSnippet,
      requiresExplicitConsent: packet.wouldSpendTokens,
    };
  });
}

function buildRefreshActions(packet: RightRailGoalConsentPacket | null): RightRailGoalRefreshAction[] {
  if (!packet) return [];
  const actions = new Map<string, RightRailGoalRefreshAction>();
  const requiresConsentForRefresh = (command: string, costClass: string): boolean => {
    if (/no-token|guarded-no-token/i.test(costClass)) return false;
    if (/requires[-\s]?consent|explicit[-\s]?consent|token[-\s]?spend/i.test(costClass)) return true;
    return /authenticated[-:]ai[-:]cli[-:]prompt|authenticated-ai-cli-prompt/i.test(command);
  };
  const add = (entry: {
    id?: string;
    path?: string;
    fresh?: boolean;
    blockingReason?: string;
    refreshCommand?: string;
    refreshReason?: string;
    expiresAt?: string;
    costClass?: string;
  }) => {
    const command = entry.refreshCommand?.trim();
    if (!command) return;
    const id = entry.id?.trim() || command;
    const key = `${id}:${command}`;
    const tokenPrompt = /authenticated[-:]ai[-:]cli[-:]prompt|authenticated-ai-cli-prompt/i.test(command);
    const costClass = entry.costClass ?? (tokenPrompt ? "guarded-no-token-unless-consent-env-is-set" : "no-token");
    const nextAction: RightRailGoalRefreshAction = {
      id,
      label: entry.fresh === false ? `Refresh ${id}` : `Refresh next proof`,
      detail: entry.fresh === false ? entry.blockingReason || "stale proof" : entry.refreshReason || "proof refresh",
      path: entry.path ?? "",
      command,
      reason: entry.refreshReason || entry.blockingReason || "Refresh proof artifact",
      expiresAt: entry.expiresAt ?? "",
      costClass,
      fresh: entry.fresh !== false,
      requiresExplicitConsent: requiresConsentForRefresh(command, costClass),
    };
    const existing = actions.get(key);
    if (existing) {
      if (!existing.requiresExplicitConsent && nextAction.requiresExplicitConsent) actions.set(key, nextAction);
      return;
    }
    actions.set(key, nextAction);
  };

  for (const entry of packet.artifactReadiness ?? []) {
    if (!entry.fresh) add(entry);
  }
  if (packet.artifactFreshness?.nextRefresh) add(packet.artifactFreshness.nextRefresh);

  return [...actions.values()].slice(0, 5);
}

function buildExternalGateActions(
  safeGate: RightRailGoalSafeGate | null,
  residualRisk: RightRailGoalResidualRisk | null,
  externalBlockers: readonly string[],
): RightRailGoalExternalGateAction[] {
  const hostSleepBlocked =
    safeGate?.status === "blocked-by-external-gates" ||
    residualRisk?.state === "blocked-by-external-gates" ||
    externalBlockers.some(isHostSleepExternalBlocker);
  if (!hostSleepBlocked) return [];
  const command = "pnpm verify:production:suspend:native-user-cycle";
  const followUpCommands = ["pnpm verify:goal:operator-finish", "pnpm verify:goal:finalize", "pnpm verify:goal:safe", "pnpm verify:goal:closeout"];
  const manualAction =
    "Leave the verifier running, put Windows to sleep manually, wake it, then let post-resume probes finish.";
  return [
    {
      id: "native-user-sleep-cycle",
      label: "Copy native sleep proof",
      detail: "No-token real Windows sleep/resume proof · requires manual sleep/wake",
      command,
      followUpCommands,
      powershellSnippet: [
        command,
        "# manually sleep and wake Windows while the verifier waits",
        ...followUpCommands,
      ].join("\n"),
      requiresExplicitConsent: false,
      requiresUserAction: true,
      manualAction,
      costClass: "no-token-user-host-action",
    },
  ];
}

function boundaryStatus(
  pass: boolean | undefined,
  safeGate: RightRailGoalSafeGate | null,
): RightRailGoalBoundaryProof["status"] {
  if (!safeGate || safeGate.source === "unavailable") return "unknown";
  return pass === true ? "proved" : "missing";
}

function isRightRailSafeGateSelfCycle(safeGate: RightRailGoalSafeGate | null): boolean {
  return (
    safeGate?.source === "final-goal-safe-summary" &&
    safeGate.status === "blocked" &&
    safeGate.failedStepCount === 0 &&
    safeGate.proofRequirementPassCount === safeGate.proofRequirementCount &&
    safeGate.proofArtifactPassCount + 1 === safeGate.proofArtifactCount &&
    safeGate.consentBlockerCount === 1 &&
    safeGate.nonConsentBlockerCount === 0 &&
    safeGate.noTokenPromptSent === true &&
    safeGate.tokenSpendingPromptExecuted === false &&
    safeGate.releaseHygieneClean === true &&
    safeGate.supplyChainAuditClean === true &&
    safeGate.terminalChunkedOscLivePassed === true &&
    safeGate.nativeTerminalInputHostPassed === true &&
    safeGate.nativeHwndPasteLivePassed === true &&
    (safeGate.gitFinalizationReadinessPassed === true || safeGate.gitFinalizationReadinessPassed == null) &&
    safeGate.semanticFreshness === "stale-or-incomplete" &&
    safeGate.cycleBoundary === "right-rail-safe-gate-mutual-proof"
  );
}

function buildBoundaryProofs(safeGate: RightRailGoalSafeGate | null): RightRailGoalBoundaryProof[] {
  const source = safeGate?.source ?? "unavailable";
  const rightRailSelfCycleOnly = isRightRailSafeGateSelfCycle(safeGate);
  const safeProofChainPassed =
    rightRailSelfCycleOnly ||
    (safeGate?.ok === true &&
      safeGate.failedStepCount === 0 &&
      safeGate.proofRequirementPassCount === safeGate.proofRequirementCount &&
      safeGate.proofArtifactPassCount === safeGate.proofArtifactCount &&
      safeGate.noTokenPromptSent === true &&
      safeGate.tokenSpendingPromptExecuted === false);

  return [
    {
      id: "native-input-host",
      label: "Native input",
      status: boundaryStatus(safeGate?.nativeTerminalInputHostPassed, safeGate),
      detail: "Rust input host owns focus, commit routing, and IME composition.",
      source,
      artifactPath: ".codex-auto/production-smoke/native-terminal-input-host.json",
      refreshCommand: "pnpm verify:terminal:native-input",
      costClass: "no-token",
    },
    {
      id: "native-hwnd-paste",
      label: "HWND paste",
      status: boundaryStatus(safeGate?.nativeHwndPasteLivePassed, safeGate),
      detail: "Real WM_PASTE is guarded before PTY write.",
      source,
      artifactPath: ".codex-auto/production-smoke/native-hwnd-paste-live.json",
      refreshCommand: "pnpm verify:terminal:native-hwnd-paste",
      costClass: "no-token",
    },
    {
      id: "chunked-osc-inline-image",
      label: "Inline image",
      status: boundaryStatus(safeGate?.terminalChunkedOscLivePassed, safeGate),
      detail: "Chunked OSC image path is live for PowerShell and Git Bash.",
      source,
      artifactPath: ".codex-auto/production-smoke/chunked-osc-live.json",
      refreshCommand: "pnpm verify:terminal:chunked-osc-live",
      costClass: "no-token",
    },
    {
      id: "release-hygiene",
      label: "Hygiene",
      status: boundaryStatus(safeGate?.releaseHygieneClean, safeGate),
      detail: "Release sources contain no diagnostic or stray debug-probe leaks.",
      source,
      artifactPath: ".codex-auto/quality/release-hygiene-contract.json",
      refreshCommand: "pnpm verify:release:hygiene",
      costClass: "no-token",
    },
    {
      id: "supply-chain-audit",
      label: "Supply chain",
      status: boundaryStatus(safeGate?.supplyChainAuditClean, safeGate),
      detail: "npm and Rust dependency audits report zero known vulnerabilities.",
      source,
      artifactPath: ".codex-auto/release-doctor/supply-chain-audit.json",
      refreshCommand: "pnpm verify:supply-chain",
      costClass: "no-token",
    },
    {
      id: "git-finalization",
      label: "Git handoff",
      status: boundaryStatus(safeGate?.gitFinalizationReadinessPassed, safeGate),
      detail: "Commit and merge readiness is explicit; repository metadata permission blockers cannot hide.",
      source,
      artifactPath: ".codex-auto/quality/git-finalization-readiness.json",
      refreshCommand: "pnpm verify:goal:git-finalization",
      costClass: "no-token",
    },
    {
      id: "safe-proof-chain",
      label: "Proof chain",
      status: boundaryStatus(safeProofChainPassed, safeGate),
      detail: safeGate
        ? `${safeGate.proofArtifactPassCount}/${safeGate.proofArtifactCount} artifacts · ${safeGate.stepCount} steps`
        : "Final safe gate unavailable.",
      source,
      artifactPath: ".codex-auto/quality/final-goal-safe-summary.json",
      refreshCommand: "pnpm verify:goal:safe",
      costClass: "no-token",
    },
  ];
}

export function deriveRightRailGoalTrack(input: RightRailGoalTrackInput): RightRailGoalTrack {
  const terminalFallbackBlocked = input.interactiveNativeFallbackCount > 0;
  const qualityEvidenceStatus = input.qualityEvidenceStatus ?? "unavailable";
  const qualityEvidenceFresh = qualityEvidenceStatus === "fresh";
  const terminalCoreReady = qualityEvidenceFresh && input.terminalCoreReady === true;
  const commandCenterScenarioReady = qualityEvidenceFresh && input.commandCenterScenarioReady === true;
  const themeCustomizationReady = qualityEvidenceFresh && input.themeCustomizationReady === true;
  const authenticatedPromptConsentRequired = input.authenticatedPromptConsentRequired ?? true;
  const consentPacket = input.authenticatedPromptConsentPacket ?? null;
  const consentPacketReady =
    consentPacket?.status === "ready" || consentPacket?.status === "pass" || !authenticatedPromptConsentRequired;
  const consentRunActions = buildConsentRunActions(consentPacket, authenticatedPromptConsentRequired);
  const consentRunAction = consentRunActions[0] ?? null;
  const refreshActions = buildRefreshActions(consentPacket);
  const residualRisk = input.residualRisk ?? null;
  const safeGate = input.safeGate ?? null;
  const requirementProofs = [...(input.requirementProofs ?? [])].slice(0, 8);
  const boundaryProofs = buildBoundaryProofs(safeGate);
  const qualityEvidence = {
    status: qualityEvidenceStatus,
    label: input.qualityEvidenceLabel ?? "Quality proof unavailable",
    detail: input.qualityEvidenceDetail ?? "Run pnpm verify:quality-score",
    localDate: input.qualityEvidenceLocalDate,
    timeZone: input.qualityEvidenceTimeZone,
  };
  const riskEvidence = [...(input.graphRiskSummaries ?? [])].slice(0, 3);
  const runtimeFallbackEvidence = [...(input.runtimeFallbackSummaries ?? [])].slice(0, 3);
  const qaRiskEvidence = [...(input.qaRiskSummaries ?? [])].slice(0, 3);
  const edgeGaps = edgeGapCount(input.edgeItems);
  const weakestEdgeItem = firstEdgeGap(input.edgeItems);
  const launchPlanReady = input.aiCliLaunchPlanStatus === "ready" || input.aiCliLaunchPlanStatus === "degraded";
  const commandCenterReady = commandCenterScenarioReady && input.edgeScore >= 85 && edgeGaps === 0;
  const releaseBlockers = ((input.releaseBlockers ?? []) as string[]).filter(
    (blocker) =>
      !isGoalTrackAuditBlocker(blocker) &&
      !(authenticatedPromptConsentRequired && isAuthenticatedPromptConsentBlocker(blocker)) &&
      !isHostSleepExternalBlocker(blocker),
  );
  const externalReleaseBlockers = ((input.releaseBlockers ?? []) as string[]).filter((blocker) =>
    isHostSleepExternalBlocker(blocker),
  );
  const externalGateActions = buildExternalGateActions(safeGate, residualRisk, externalReleaseBlockers);
  const residualImplementationBlockers =
    residualRisk && residualRisk.state !== "complete" ? [...residualRisk.implementationFixable] : [];
  const residualExternalBlockers =
    residualRisk && residualRisk.state === "blocked-by-external-gates" ? [...(residualRisk.externalBlocked ?? [])] : [];
  const rightRailSelfCycleOnly = isRightRailSafeGateSelfCycle(safeGate);

  const blockers = unique([
    ...releaseBlockers,
    ...externalReleaseBlockers,
    ...residualImplementationBlockers,
    ...residualExternalBlockers,
    terminalFallbackBlocked
      ? `${input.interactiveNativeFallbackCount} AI CLI session${
          input.interactiveNativeFallbackCount === 1 ? "" : "s"
        } still on native fallback`
      : "",
    input.pendingDecisionCount > 0
      ? `${input.pendingDecisionCount} human decision gate${input.pendingDecisionCount === 1 ? "" : "s"} open`
      : "",
    formatRiskBlocker(input.graphRiskCount, riskEvidence),
    formatRuntimeFallbackBlocker(input.runtimeFallbackCount ?? 0, runtimeFallbackEvidence),
    qualityEvidenceStatus === "stale" ? "Release quality score stale; run pnpm verify:quality-score" : "",
    qualityEvidenceStatus === "unavailable" ? "Release quality score unavailable; run pnpm verify:quality-score" : "",
    !safeGate || safeGate.source === "unavailable"
      ? "Final safe gate unavailable; run pnpm verify:goal:safe"
      : (safeGate.status === "blocked" && !rightRailSelfCycleOnly) || safeGate.failedStepCount > 0
        ? safeGate.nextRequiredAction || "Final safe gate blocked; run pnpm verify:goal:safe"
        : "",
    authenticatedPromptConsentRequired && !consentPacket
      ? "Authenticated prompt consent packet unavailable; run pnpm verify:terminal:authenticated-ai-cli-prompt without consent"
      : "",
    authenticatedPromptConsentRequired && consentPacket && !consentPacketReady
      ? `Authenticated prompt consent packet ${consentPacket.status}; refresh non-token preflight`
      : "",
    authenticatedPromptConsentRequired ? "Authenticated AI CLI prompt smoke still requires explicit token consent" : "",
  ]);

  const terminalStatus: RightRailGoalMilestoneStatus = terminalFallbackBlocked
    ? "blocked"
    : terminalCoreReady
      ? "done"
      : "active";
  const commandCenterStatus: RightRailGoalMilestoneStatus = commandCenterReady
    ? "done"
    : input.edgeScore >= 70 || launchPlanReady
      ? "active"
      : "next";
  const customizationStatus: RightRailGoalMilestoneStatus = themeCustomizationReady ? "done" : "active";
  const releaseProofStatus: RightRailGoalMilestoneStatus =
    blockers.length === 0 &&
    terminalStatus === "done" &&
    commandCenterStatus === "done" &&
    customizationStatus === "done"
      ? "done"
      : blockers.length > 0
        ? "blocked"
        : "active";

  const milestones: RightRailGoalMilestone[] = [
    milestone({
      id: "terminal-core",
      label: "Terminal core",
      status: terminalStatus,
      detail: terminalFallbackBlocked
        ? `${input.interactiveNativeFallbackCount} fallback path visible`
        : terminalCoreReady
          ? "Native input, sidecar PTY, reconnect, and scrollback are guarded"
          : "Native terminal boundary still needs proof",
      evidence:
        input.interactiveSessionCount > 0 ? `${input.interactiveSessionCount} interactive session` : "core gates",
      remaining: terminalFallbackBlocked
        ? "Restart fallback sessions on the sidecar command-session path"
        : "Keep live CLI evidence fresh",
    }),
    milestone({
      id: "command-center",
      label: "Command Center",
      status: commandCenterStatus,
      detail: `${input.edgeScore}/${input.edgeGrade} edge score`,
      evidence: weakestEdgeItem ? `${weakestEdgeItem.label}: ${weakestEdgeItem.detail}` : "all axes covered",
      remaining: commandCenterReady
        ? "Dogfood with real authenticated prompt output"
        : weakestEdgeItem
          ? weakestEdgeItem.actionLabel
          : "Raise every right-rail axis above watch",
    }),
    milestone({
      id: "customization",
      label: "Customization",
      status: customizationStatus,
      detail: themeCustomizationReady
        ? "Per-preset material, opacity, wallpaper, and Sakura isolation are guarded"
        : "Theme and wallpaper controls need release proof",
      evidence: "theme customization guard",
      remaining: themeCustomizationReady
        ? "Keep visual QA fresh after theme edits"
        : "Finish per-preset controls and persistence",
    }),
    milestone({
      id: "release-proof",
      label: "Release proof",
      status: releaseProofStatus,
      detail:
        releaseProofStatus === "done"
          ? "No release blocker is open"
          : safeGate?.status === "blocked-by-explicit-consent" &&
              residualRisk?.state === "blocked-only-by-explicit-token-consent"
            ? "Safe gate is green; token-spending proof is gated by explicit consent"
            : safeGate?.status === "blocked-by-external-gates" && residualRisk?.state === "blocked-by-external-gates"
              ? "Implementation risks are closed; real OS sleep proof is host-gated"
              : rightRailSelfCycleOnly
                ? "Safe gate is waiting only for this Goal Track proof; token-spending proof is gated by explicit consent"
                : residualRisk?.state === "blocked-only-by-explicit-token-consent"
                  ? "Implementation risks are closed; token-spending proof is gated by explicit consent"
                  : authenticatedPromptConsentRequired
                    ? consentPacketReady
                      ? "Token-spending live prompt proof is gated with a ready consent packet"
                      : "Token-spending live prompt proof is gated and consent packet proof is missing"
                    : `${blockers.length} blocker${blockers.length === 1 ? "" : "s"} before release candidate`,
      evidence: `${input.changedFilesCount} changed files, ${input.graphRiskCount} release risks, ${
        input.runtimeFallbackCount ?? 0
      } runtime fallbacks, ${
        input.qaRiskCount ?? 0
      } QA risks, ${input.pendingDecisionCount} decisions, safe gate ${safeGate?.status ?? "unavailable"}`,
      remaining:
        releaseProofStatus === "done"
          ? "Promote release candidate"
          : (blockers[0] ?? "Run final live prompt, final report, cleanup, and recovery proof"),
    }),
  ];

  const doneCount = milestones.filter((item) => item.status === "done").length;
  const totalCount = milestones.length;
  const rawPercent = Math.round(
    (milestones.reduce((sum, item) => sum + STATUS_WEIGHT[item.status], 0) / totalCount) * 100,
  );
  const consentGateOnly =
    blockers.length === 1 &&
    isAuthenticatedPromptConsentBlocker(blockers[0] ?? "") &&
    consentPacketReady &&
    residualRisk?.state === "blocked-only-by-explicit-token-consent" &&
    residualRisk.implementationFixableCount === 0;
  const externalGateOnly =
    blockers.length > 0 &&
    blockers.every((item) => isHostSleepExternalBlocker(item) || isAuthenticatedPromptConsentBlocker(item)) &&
    residualRisk?.state === "blocked-by-external-gates" &&
    residualRisk.implementationFixableCount === 0;
  const percent = consentGateOnly ? Math.max(rawPercent, 99) : externalGateOnly ? Math.max(rawPercent, 96) : rawPercent;
  const activeMilestone = [...milestones].sort(
    (left, right) => statusSortValue(left.status) - statusSortValue(right.status),
  )[0];
  const rawRemainingItems = unique([
    ...blockers.filter((item) => isAuthenticatedPromptConsentBlocker(item)),
    ...residualImplementationBlockers,
    ...blockers.filter((item) => !isAuthenticatedPromptConsentBlocker(item)),
    ...milestones.filter((item) => item.status !== "done").map((item) => item.remaining),
  ]);
  const remainingItems = consentGateOnly
    ? rawRemainingItems.filter((item) => isAuthenticatedPromptConsentBlocker(item))
    : externalGateOnly
      ? rawRemainingItems.filter(
          (item) => isHostSleepExternalBlocker(item) || isAuthenticatedPromptConsentBlocker(item),
        )
      : rawRemainingItems;
  const nextAction =
    consentGateOnly && consentRunAction
      ? consentRunAction.label
      : (externalGateActions[0]?.label ?? remainingItems[0] ?? "Promote release candidate");

  const status = activeMilestone?.status ?? "next";
  const confidenceLabel =
    status === "done"
      ? "Release candidate"
      : consentGateOnly
        ? "Consent gate"
        : status === "blocked"
          ? "Blocked"
          : percent >= 80
            ? "Near final proof"
            : "In progress";

  return {
    label:
      status === "done"
        ? "Goal ready"
        : consentGateOnly
          ? "Goal consent gated"
          : status === "blocked"
            ? "Goal blocked"
            : "Goal in progress",
    detail: consentGateOnly
      ? "Non-token implementation proved · explicit token consent pending"
      : `${doneCount}/${totalCount} milestones closed · ${remainingItems.length} remaining`,
    status,
    confidenceLabel,
    qualityEvidence,
    consentPacket,
    consentRunAction,
    consentRunActions,
    refreshActions,
    externalGateActions,
    residualRisk,
    safeGate,
    requirementProofs,
    boundaryProofs,
    riskEvidence,
    runtimeFallbackEvidence,
    qaRiskEvidence,
    percent,
    doneCount,
    totalCount,
    activeMilestoneId: activeMilestone?.id ?? "release-proof",
    nextAction,
    blockers,
    remainingItems,
    milestones,
  };
}
