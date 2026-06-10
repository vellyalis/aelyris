import type { AgentCliType, InteractiveSession } from "../types/interactiveAgent";
import type { ModelProvider } from "../types/model";

export type AiCliLaunchStatus = "ready" | "degraded" | "blocked" | "unknown";
export type AiCliLaunchRole = "implement" | "review" | "test" | "research" | "release-check";

export interface AiCliProbePreferred {
  name?: string;
  path?: string;
}

export interface AiCliProbeDiscovery {
  cli?: string;
  found?: boolean;
  preferred?: AiCliProbePreferred;
}

export interface AiCliProbeEntry {
  cli?: string;
  status?: string;
  backend?: string;
  program?: string;
  launcher?: string;
  launcherArgs?: string[];
  executablePath?: string;
  attemptCount?: number;
  retried?: boolean;
  attempts?: Array<{ cli?: string; attempt?: number; executablePath?: string; status?: string }>;
  discovery?: AiCliProbeDiscovery;
  markerSeen?: boolean;
  commandNotFound?: boolean;
  versionLike?: boolean;
  usageLike?: boolean;
  fatalLaunchError?: boolean;
  outputSample?: string;
  passed?: boolean;
}

export interface AiCliProbeEvidence {
  ok?: boolean;
  status?: string;
  startedAt?: string;
  finishedAt?: string;
  maxAttempts?: number;
  checks?: {
    commandSessionCapability?: boolean;
    clis?: AiCliProbeEntry[];
    discovery?: AiCliProbeDiscovery[];
    passCount?: number;
    missingCount?: number;
  };
}

export interface AiCliLaunchCliPlan {
  provider: ModelProvider;
  status: "ready" | "missing" | "failed" | "unknown";
  launcher: string;
  executablePath: string;
  attemptCount: number;
  retried: boolean;
  version: string;
  evidence: string;
}

export interface AiCliLaunchCheck {
  id: string;
  label: string;
  status: AiCliLaunchStatus;
  detail: string;
}

export interface AiCliLaunchContextPackContract {
  id?: string;
  title?: string;
  summary?: string;
  source?: "context-panel" | "workstation-graph" | "workflow" | "smoke" | "manual";
  generatedAt?: string;
  include?: readonly string[];
  exclude?: readonly string[];
  changedFiles?: readonly string[];
  redactionCount?: number;
}

export interface AiCliLaunchPreflightEvidence {
  nativeInputHost?: {
    status?: string;
    checks?: Array<{ id?: string; status?: string; detail?: string }>;
  } | null;
  ime?: {
    status?: string;
    checks?: string[];
  } | null;
  processReconnect?: {
    ok?: boolean;
    checks?: Record<string, unknown>;
  } | null;
  interactiveBoundary?: {
    ok?: boolean;
    checks?: {
      commandSessionCapability?: boolean;
      clis?: Array<{
        cli?: string;
        backend?: string;
        inputRoundtrip?: boolean;
        streamReceivedMarker?: boolean;
        closed?: boolean;
      }>;
    };
  } | null;
}

export interface AiCliLaunchPromptContract {
  objective?: string;
  contextSummary?: string;
  contextPack?: AiCliLaunchContextPackContract | null;
  expectedOutput?: string;
  doneCriteria?: string[];
  guardrails?: string[];
  artifacts?: string[];
}

export interface AiCliLaunchContextPackTrace {
  id: string;
  title: string;
  source: string;
  summary: string;
  generatedAt: string;
  includeCount: number;
  excludeCount: number;
  changedFileCount: number;
  redactionCount: number;
}

export interface AiCliLaunchTrace {
  schemaVersion: 1;
  kind: "ai-cli-launch-plan";
  status: AiCliLaunchStatus;
  grade: AiCliLaunchPlan["grade"];
  recommendedProvider: ModelProvider;
  recommendedRole: AiCliLaunchRole;
  recommendedBackend: AiCliLaunchPlan["recommendedBackend"];
  selectedLauncher: string;
  selectedVersion: string;
  actionLabel: string;
  detail: string;
  evidence: string;
  guardrailLabel: string;
  guardrailDetail: string;
  selectedExecutablePath: string;
  selectedAttemptCount: number;
  cliMatrix: Array<
    Pick<
      AiCliLaunchCliPlan,
      "provider" | "status" | "launcher" | "executablePath" | "attemptCount" | "retried" | "version"
    >
  >;
  checks: AiCliLaunchCheck[];
  preflightChecks: AiCliLaunchCheck[];
  promptContractChecks: AiCliLaunchCheck[];
  contextPack: AiCliLaunchContextPackTrace | null;
  warnings: string[];
  expectedArtifacts: string[];
}

export interface AiCliLaunchPlan {
  status: AiCliLaunchStatus;
  grade: "S" | "A" | "B" | "C";
  recommendedProvider: ModelProvider;
  recommendedRole: AiCliLaunchRole;
  recommendedBackend: "sidecar-command-session" | "sidecar" | "native-fallback";
  actionLabel: string;
  detail: string;
  why: string;
  nextStep: string;
  evidence: string;
  guardrailLabel: string;
  guardrailDetail: string;
  cliPlans: AiCliLaunchCliPlan[];
  checks: AiCliLaunchCheck[];
  preflightChecks: AiCliLaunchCheck[];
  promptContractChecks: AiCliLaunchCheck[];
  warnings: string[];
  expectedArtifacts: string[];
  trace: AiCliLaunchTrace;
}

export interface AiCliLaunchPlanInput {
  evidence?: AiCliProbeEvidence | null;
  interactiveSessions?: InteractiveSession[];
  preferredProvider?: ModelProvider | AgentCliType | string;
  changedFilesCount?: number;
  pendingDecisionCount?: number;
  selectedPaneRole?: string | null;
  currentTimeMs?: number;
  maxEvidenceAgeMs?: number;
  preflight?: AiCliLaunchPreflightEvidence | null;
  requirePreflight?: boolean;
  promptContract?: AiCliLaunchPromptContract | null;
  requirePromptContract?: boolean;
}

const CORE_PROVIDERS: ModelProvider[] = ["claude", "codex", "gemini"];
const LIVE_STATUSES = new Set(["idle", "thinking", "coding", "running", "waiting"]);
const DEFAULT_MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;

function normalizeProvider(value: string | undefined | null): ModelProvider | null {
  const lower = String(value ?? "").toLowerCase();
  if (lower.startsWith("claude")) return "claude";
  if (lower.startsWith("codex")) return "codex";
  if (lower.startsWith("gemini")) return "gemini";
  return null;
}

function providerLabel(provider: ModelProvider): string {
  if (provider === "claude") return "Claude";
  if (provider === "codex") return "Codex";
  return "Gemini";
}

function providerLauncher(provider: ModelProvider): string {
  if (provider === "claude") return "claude";
  if (provider === "codex") return "codex";
  return "gemini";
}

function latestEvidenceTimeMs(evidence: AiCliProbeEvidence | null | undefined): number {
  const finishedAt = Date.parse(evidence?.finishedAt ?? "");
  if (Number.isFinite(finishedAt)) return finishedAt;
  const startedAt = Date.parse(evidence?.startedAt ?? "");
  return Number.isFinite(startedAt) ? startedAt : 0;
}

function isEvidenceFresh(input: AiCliLaunchPlanInput): boolean {
  if (!input.evidence) return false;
  const observedAt = latestEvidenceTimeMs(input.evidence);
  if (observedAt <= 0) return false;
  const now = input.currentTimeMs ?? Date.now();
  const maxAge = input.maxEvidenceAgeMs ?? DEFAULT_MAX_EVIDENCE_AGE_MS;
  return now - observedAt >= 0 && now - observedAt <= maxAge;
}

function isLiveInteractiveSession(session: InteractiveSession): boolean {
  return LIVE_STATUSES.has(String(session.status ?? "").toLowerCase());
}

function entryForProvider(entries: readonly AiCliProbeEntry[], provider: ModelProvider): AiCliProbeEntry | undefined {
  return entries.find((entry) => normalizeProvider(entry.cli) === provider);
}

function discoveryForProvider(
  discoveries: readonly AiCliProbeDiscovery[],
  provider: ModelProvider,
): AiCliProbeDiscovery | undefined {
  return discoveries.find((entry) => normalizeProvider(entry.cli) === provider);
}

function launcherFromEntry(entry: AiCliProbeEntry | undefined, discovery: AiCliProbeDiscovery | undefined): string {
  return (
    entry?.discovery?.preferred?.name ??
    discovery?.preferred?.name ??
    entry?.program ??
    entry?.launcherArgs?.[2]?.match(/\b(?:claude|codex|gemini)(?:\.(?:exe|cmd|bat))?/i)?.[0] ??
    entry?.launcher ??
    ""
  );
}

function executablePathFromEntry(
  entry: AiCliProbeEntry | undefined,
  discovery: AiCliProbeDiscovery | undefined,
): string {
  return entry?.executablePath ?? entry?.discovery?.preferred?.path ?? discovery?.preferred?.path ?? "";
}

function attemptCountFromEntry(entry: AiCliProbeEntry | undefined): number {
  if (typeof entry?.attemptCount === "number" && Number.isFinite(entry.attemptCount) && entry.attemptCount > 0) {
    return Math.floor(entry.attemptCount);
  }
  if (entry) return 1;
  return 0;
}

function cliPlanFromEvidence(
  provider: ModelProvider,
  entries: readonly AiCliProbeEntry[],
  discoveries: readonly AiCliProbeDiscovery[],
): AiCliLaunchCliPlan {
  const entry = entryForProvider(entries, provider);
  const discovery = discoveryForProvider(discoveries, provider) ?? entry?.discovery;
  const launcher = launcherFromEntry(entry, discovery) || providerLauncher(provider);
  const executablePath = executablePathFromEntry(entry, discovery);
  const attemptCount = attemptCountFromEntry(entry);
  const retried = entry?.retried === true || attemptCount > 1;
  const passed =
    entry?.status === "pass" &&
    entry?.markerSeen === true &&
    entry?.commandNotFound === false &&
    entry?.fatalLaunchError !== true &&
    (entry?.versionLike === true || entry?.usageLike === true);

  if (passed) {
    return {
      provider,
      status: "ready",
      launcher,
      executablePath,
      attemptCount,
      retried,
      version: String(entry?.outputSample ?? "version output observed"),
      evidence: `${providerLabel(provider)} launched through sidecar PTY from ${executablePath || launcher}`,
    };
  }

  if (entry?.commandNotFound === true || discovery?.found === false) {
    return {
      provider,
      status: "missing",
      launcher,
      executablePath,
      attemptCount,
      retried,
      version: "",
      evidence: `${providerLabel(provider)} launcher was not found`,
    };
  }

  if (entry) {
    return {
      provider,
      status: "failed",
      launcher,
      executablePath,
      attemptCount,
      retried,
      version: String(entry.outputSample ?? ""),
      evidence: `${providerLabel(provider)} launcher did not pass the real CLI probe`,
    };
  }

  return {
    provider,
    status: "unknown",
    launcher,
    executablePath,
    attemptCount,
    retried,
    version: "",
    evidence: `${providerLabel(provider)} has not been probed in this workspace`,
  };
}

function chooseRole(input: AiCliLaunchPlanInput): AiCliLaunchRole {
  const paneRole = String(input.selectedPaneRole ?? "").toLowerCase();
  if (paneRole === "test") return "test";
  if (paneRole === "review") return "review";
  if ((input.changedFilesCount ?? 0) > 0) return "review";
  return "implement";
}

function chooseProvider(preferred: ModelProvider, plans: readonly AiCliLaunchCliPlan[]): ModelProvider {
  const preferredPlan = plans.find((plan) => plan.provider === preferred);
  if (preferredPlan?.status === "ready") return preferred;
  return plans.find((plan) => plan.status === "ready")?.provider ?? preferred;
}

function gradeFor(status: AiCliLaunchStatus, readyCount: number): AiCliLaunchPlan["grade"] {
  if (status === "ready" && readyCount === CORE_PROVIDERS.length) return "S";
  if (status === "ready") return "A";
  if (status === "degraded") return "B";
  return "C";
}

function hasNativeInputCheck(input: AiCliLaunchPlanInput, id: string): boolean {
  const nativeInputHost = input.preflight?.nativeInputHost;
  const status = nativeInputHost?.status;
  return (
    (status === "pass" || status === "blocked") &&
    Array.isArray(nativeInputHost?.checks) &&
    nativeInputHost.checks.some((check) => check.id === id && check.status === "passed")
  );
}

function hasImeCheck(input: AiCliLaunchPlanInput, pattern: RegExp): boolean {
  return (
    input.preflight?.ime?.status === "pass" &&
    Array.isArray(input.preflight.ime.checks) &&
    input.preflight.ime.checks.some((check) => pattern.test(check))
  );
}

function hasPromptText(value: string | undefined, minLength = 8): boolean {
  return String(value ?? "").trim().length >= minLength;
}

function hasContextPackContract(pack: AiCliLaunchContextPackContract | null | undefined): boolean {
  if (!pack) return false;
  const hasIdentity = hasPromptText(pack.id, 3) || hasPromptText(pack.title, 6);
  const hasSummary = hasPromptText(pack.summary, 12);
  const hasScope =
    (Array.isArray(pack.include) && pack.include.some((item) => hasPromptText(item, 2))) ||
    (Array.isArray(pack.changedFiles) && pack.changedFiles.some((item) => hasPromptText(item, 2)));
  const hasExclusions = Array.isArray(pack.exclude) && pack.exclude.some((item) => hasPromptText(item, 2));
  return hasIdentity && hasSummary && hasScope && hasExclusions && typeof pack.redactionCount === "number";
}

function contextPackDetail(contract: AiCliLaunchPromptContract | null): string {
  if (!hasPromptText(contract?.contextSummary, 12)) return "context summary is missing";
  if (!contract?.contextPack) return "machine-readable context pack is missing";
  if (!hasContextPackContract(contract.contextPack)) {
    return "context pack must include identity, summary, included scope, exclusions, and redaction count";
  }
  return "context summary and machine-readable pack are attached before launch";
}

function derivePreflightChecks(input: AiCliLaunchPlanInput): AiCliLaunchCheck[] {
  const nativeImeHostReady =
    hasNativeInputCheck(input, "frontend-native-default") &&
    hasNativeInputCheck(input, "composition-surface") &&
    hasNativeInputCheck(input, "surface-ime-preedit-hidden") &&
    hasNativeInputCheck(input, "surface-custom-hwnd-runway") &&
    hasNativeInputCheck(input, "commit-command");
  const cdpImeReady =
    hasImeCheck(input, /Long Japanese preedit/i) && hasImeCheck(input, /native input surface geometry inside canvas/i);
  const nativeImeReady = nativeImeHostReady || cdpImeReady;
  const clipboardReady =
    hasNativeInputCheck(input, "commit-command") &&
    (hasNativeInputCheck(input, "behavioral-native-hwnd-paste-live") ||
      hasNativeInputCheck(input, "surface-paste-guard") ||
      hasImeCheck(input, /LF paste submitted/i));
  const reconnectChecks = input.preflight?.processReconnect?.checks ?? {};
  const reconnectReady =
    input.preflight?.processReconnect?.ok === true &&
    reconnectChecks.sidecarRetainedTerminal === true &&
    reconnectChecks.sidecarRetainedSplitTerminal === true &&
    reconnectChecks.terminalAdoptedAfterRestart === true &&
    reconnectChecks.splitTerminalAdoptedAfterRestart === true;
  const cliEntries = Array.isArray(input.preflight?.interactiveBoundary?.checks?.clis)
    ? (input.preflight?.interactiveBoundary?.checks?.clis ?? [])
    : [];
  const cliBoundaryReady =
    input.preflight?.interactiveBoundary?.ok === true &&
    input.preflight?.interactiveBoundary?.checks?.commandSessionCapability === true &&
    ["codex", "claude", "gemini"].every((cli) =>
      cliEntries.some(
        (entry) =>
          entry.cli === cli &&
          entry.backend === "sidecar-command-session" &&
          entry.streamReceivedMarker === true &&
          entry.inputRoundtrip === true &&
          entry.closed === true,
      ),
    );

  return [
    {
      id: "native-ime",
      label: "Native IME",
      status: nativeImeReady ? "ready" : input.preflight ? "blocked" : "unknown",
      detail: nativeImeReady
        ? "Japanese preedit is proven through the native HWND surface or live CDP geometry"
        : "Japanese preedit or native input geometry proof is missing",
    },
    {
      id: "clipboard-text",
      label: "Clipboard text",
      status: clipboardReady ? "ready" : input.preflight ? "blocked" : "unknown",
      detail: clipboardReady
        ? "text paste is guarded and submitted through the native input surface"
        : "native text paste proof is missing",
    },
    {
      id: "process-reconnect",
      label: "Pane reconnect",
      status: reconnectReady ? "ready" : input.preflight ? "blocked" : "unknown",
      detail: reconnectReady
        ? "base and split sidecar terminals reconnect after process restart"
        : "process reconnect proof is missing",
    },
    {
      id: "interactive-cli-boundary",
      label: "CLI input boundary",
      status: cliBoundaryReady ? "ready" : input.preflight ? "blocked" : "unknown",
      detail: cliBoundaryReady
        ? "Codex, Claude, and Gemini accept input through command-session"
        : "interactive AI CLI input roundtrip proof is missing",
    },
  ];
}

function derivePromptContractChecks(input: AiCliLaunchPlanInput): AiCliLaunchCheck[] {
  const contract = input.promptContract ?? null;
  const objectiveReady = hasPromptText(contract?.objective, 12);
  const contextReady = hasPromptText(contract?.contextSummary, 12) && hasContextPackContract(contract?.contextPack);
  const expectedOutputReady = hasPromptText(contract?.expectedOutput, 12);
  const doneCriteriaReady =
    Array.isArray(contract?.doneCriteria) && contract.doneCriteria.some((item) => hasPromptText(item));
  const guardrailsReady =
    Array.isArray(contract?.guardrails) && contract.guardrails.some((item) => hasPromptText(item));
  const missingStatus: AiCliLaunchStatus = contract ? "blocked" : "unknown";

  return [
    {
      id: "prompt-objective",
      label: "Objective",
      status: objectiveReady ? "ready" : missingStatus,
      detail: objectiveReady ? "launch objective is explicit" : "launch objective is missing",
    },
    {
      id: "prompt-context",
      label: "Context pack",
      status: contextReady ? "ready" : missingStatus,
      detail: contextPackDetail(contract),
    },
    {
      id: "prompt-output",
      label: "Expected output",
      status: expectedOutputReady ? "ready" : missingStatus,
      detail: expectedOutputReady ? "expected result is explicit" : "expected output contract is missing",
    },
    {
      id: "prompt-done",
      label: "Done criteria",
      status: doneCriteriaReady ? "ready" : missingStatus,
      detail: doneCriteriaReady ? "completion criteria are explicit" : "done criteria are missing",
    },
    {
      id: "prompt-guardrails",
      label: "Guardrails",
      status: guardrailsReady ? "ready" : missingStatus,
      detail: guardrailsReady ? "launch guardrails are explicit" : "launch guardrails are missing",
    },
  ];
}

function buildContextPackTrace(
  contract: AiCliLaunchPromptContract | null | undefined,
): AiCliLaunchContextPackTrace | null {
  const pack = contract?.contextPack;
  if (!hasContextPackContract(pack)) return null;
  return {
    id: String(pack?.id || pack?.title || "context-pack"),
    title: String(pack?.title || pack?.id || "Context pack"),
    source: String(pack?.source ?? "manual"),
    summary: String(pack?.summary ?? ""),
    generatedAt: String(pack?.generatedAt ?? ""),
    includeCount: pack?.include?.length ?? 0,
    excludeCount: pack?.exclude?.length ?? 0,
    changedFileCount: pack?.changedFiles?.length ?? 0,
    redactionCount: pack?.redactionCount ?? 0,
  };
}

function buildAiCliLaunchTrace(
  plan: Omit<AiCliLaunchPlan, "trace">,
  selectedCli: AiCliLaunchCliPlan | undefined,
  promptContract: AiCliLaunchPromptContract | null | undefined,
): AiCliLaunchTrace {
  return {
    schemaVersion: 1,
    kind: "ai-cli-launch-plan",
    status: plan.status,
    grade: plan.grade,
    recommendedProvider: plan.recommendedProvider,
    recommendedRole: plan.recommendedRole,
    recommendedBackend: plan.recommendedBackend,
    selectedLauncher: selectedCli?.launcher || providerLauncher(plan.recommendedProvider),
    selectedExecutablePath: selectedCli?.executablePath ?? "",
    selectedAttemptCount: selectedCli?.attemptCount ?? 0,
    selectedVersion: selectedCli?.version ?? "",
    actionLabel: plan.actionLabel,
    detail: plan.detail,
    evidence: plan.evidence,
    guardrailLabel: plan.guardrailLabel,
    guardrailDetail: plan.guardrailDetail,
    cliMatrix: plan.cliPlans.map((cli) => ({
      provider: cli.provider,
      status: cli.status,
      launcher: cli.launcher,
      executablePath: cli.executablePath,
      attemptCount: cli.attemptCount,
      retried: cli.retried,
      version: cli.version,
    })),
    checks: plan.checks,
    preflightChecks: plan.preflightChecks,
    promptContractChecks: plan.promptContractChecks,
    contextPack: buildContextPackTrace(promptContract),
    warnings: plan.warnings,
    expectedArtifacts: plan.expectedArtifacts,
  };
}

export function deriveAiCliLaunchPlan(input: AiCliLaunchPlanInput = {}): AiCliLaunchPlan {
  const evidence = input.evidence ?? null;
  const entries = Array.isArray(evidence?.checks?.clis) ? evidence.checks.clis : [];
  const discoveries = Array.isArray(evidence?.checks?.discovery) ? evidence.checks.discovery : [];
  const cliPlans = CORE_PROVIDERS.map((provider) => cliPlanFromEvidence(provider, entries, discoveries));
  const readyCount = cliPlans.filter((plan) => plan.status === "ready").length;
  const preferredProvider = normalizeProvider(String(input.preferredProvider ?? "")) ?? "claude";
  const recommendedProvider = chooseProvider(preferredProvider, cliPlans);
  const liveInteractiveSessions = (input.interactiveSessions ?? []).filter(isLiveInteractiveSession);
  const nativeFallbackCount = liveInteractiveSessions.filter((session) => session.backend === "native").length;
  const evidenceFresh = isEvidenceFresh(input);
  const commandSessionReady = evidence?.checks?.commandSessionCapability === true;
  const pendingDecisionCount = input.pendingDecisionCount ?? 0;
  const warnings: string[] = [];
  const checks: AiCliLaunchCheck[] = [];
  const preflightChecks = derivePreflightChecks(input);
  const failedPreflightChecks = preflightChecks.filter((check) => check.status !== "ready");
  const promptContractChecks = derivePromptContractChecks(input);
  const failedPromptContractChecks = promptContractChecks.filter((check) => check.status !== "ready");

  let status: AiCliLaunchStatus = "unknown";
  let detail = "Runtime check required · sidecar first";
  let evidenceText = "No fresh real CLI probe is attached to this planner run.";

  if (nativeFallbackCount > 0) {
    status = "blocked";
    detail = `${nativeFallbackCount} native fallback · sidecar blocked`;
    evidenceText = "A live interactive AI CLI session is using native fallback.";
    warnings.push("Restart fallback sessions after the sidecar is healthy.");
  } else if (pendingDecisionCount > 0) {
    status = "blocked";
    detail = `${pendingDecisionCount} decision gate · launch paused`;
    evidenceText = "A human decision gate should be resolved before launching new work.";
    warnings.push("Resolve pending decisions before starting another agent run.");
  } else if (evidence) {
    if (input.requirePreflight && failedPreflightChecks.length > 0) {
      status = "blocked";
      detail = `${failedPreflightChecks.length} preflight gate${failedPreflightChecks.length === 1 ? "" : "s"} blocked`;
      evidenceText = "Launch preflight evidence is missing or incomplete for real interactive terminal behavior.";
      warnings.push(`Resolve launch preflight gates: ${failedPreflightChecks.map((check) => check.label).join(", ")}.`);
    } else if (input.requirePromptContract && failedPromptContractChecks.length > 0) {
      status = "blocked";
      detail = `${failedPromptContractChecks.length} prompt gate${failedPromptContractChecks.length === 1 ? "" : "s"} blocked`;
      evidenceText = "Launch prompt contract is missing or incomplete before the first prompt is sent.";
      warnings.push(
        `Resolve launch prompt contract gates: ${failedPromptContractChecks.map((check) => check.label).join(", ")}.`,
      );
    } else if (!evidenceFresh) {
      status = "degraded";
      detail = `${readyCount}/${CORE_PROVIDERS.length} CLIs proven · evidence stale`;
      evidenceText = "Real CLI probe exists but is older than the freshness window.";
      warnings.push("Refresh the real CLI probe before treating the launch plan as release proof.");
    } else if (!commandSessionReady) {
      status = "blocked";
      detail = "sidecar command-session not proven";
      evidenceText = "The daemon contract did not prove command-session capability.";
      warnings.push("Fix sidecar command-session capability before starting interactive AI CLI work.");
    } else if (readyCount === 0) {
      status = "blocked";
      detail = "0/3 CLIs proven · launch blocked";
      evidenceText = "No AI CLI binary passed the real sidecar PTY probe.";
      warnings.push("Install or repair at least one supported AI CLI binary.");
    } else if (readyCount < CORE_PROVIDERS.length || recommendedProvider !== preferredProvider) {
      status = "degraded";
      detail = `${readyCount}/${CORE_PROVIDERS.length} CLIs proven · ${providerLabel(recommendedProvider)} selected`;
      evidenceText = "Fresh real CLI probe is usable, but not every provider is clean.";
      warnings.push("Use a proven provider or refresh/repair the failed launcher before launch.");
    } else {
      status = "ready";
      detail = `${readyCount}/${CORE_PROVIDERS.length} CLIs proven · sidecar first`;
      evidenceText = "Fresh real CLI probe proves Codex, Claude, and Gemini through the sidecar PTY.";
    }
  } else if (liveInteractiveSessions.length > 0) {
    status = "degraded";
    detail = `${liveInteractiveSessions.length} live sidecar CLI · probe missing`;
    evidenceText = "Live AI CLI provenance exists, but no fresh launch probe is attached.";
    warnings.push("Capture a real CLI launch probe before calling this release-grade evidence.");
  }

  const recommendedBackend =
    nativeFallbackCount > 0 ? "native-fallback" : evidence ? "sidecar-command-session" : "sidecar";
  const recommendedRole = chooseRole(input);
  const selectedCli = cliPlans.find((plan) => plan.provider === recommendedProvider);
  const actionLabel =
    status === "ready"
      ? "Plan AI launch"
      : status === "blocked"
        ? "Fix launch gate"
        : status === "degraded"
          ? "Check CLI setup"
          : "Prepare AI launch";
  const nextStep =
    status === "blocked"
      ? "Open Health, clear the blocked launcher or decision gate, then retry the launch plan."
      : status === "ready"
        ? "Open Toolkit, confirm role/context/worktree, then launch through the sidecar boundary."
        : "Open Toolkit or Health, refresh launcher proof, and choose a proven provider before spending tokens.";

  checks.push({
    id: "sidecar-boundary",
    label: "Sidecar boundary",
    status: commandSessionReady || liveInteractiveSessions.length > 0 ? "ready" : evidence ? "blocked" : "unknown",
    detail: commandSessionReady
      ? "command-session capability proven"
      : liveInteractiveSessions.length > 0
        ? "live sidecar provenance observed"
        : "command-session proof missing",
  });
  checks.push({
    id: "real-cli-probe",
    label: "Real CLI probe",
    status: evidenceFresh && readyCount > 0 ? (readyCount === CORE_PROVIDERS.length ? "ready" : "degraded") : "unknown",
    detail: `${readyCount}/${CORE_PROVIDERS.length} providers ready`,
  });
  checks.push({
    id: "provider-choice",
    label: "Provider choice",
    status: selectedCli?.status === "ready" ? "ready" : status === "blocked" ? "blocked" : "degraded",
    detail: `${providerLabel(recommendedProvider)} via ${selectedCli?.launcher || providerLauncher(recommendedProvider)}`,
  });

  const plan: Omit<AiCliLaunchPlan, "trace"> = {
    status,
    grade: gradeFor(status, readyCount),
    recommendedProvider,
    recommendedRole,
    recommendedBackend,
    actionLabel,
    detail,
    why: "Aether should launch AI CLI work from an auditable plan instead of blind prompt-pasting.",
    nextStep,
    evidence: evidenceText,
    guardrailLabel: status === "ready" ? "Launch proof" : "Launch guard",
    guardrailDetail: `${providerLabel(recommendedProvider)} · ${recommendedRole} · ${recommendedBackend}`,
    cliPlans,
    checks,
    preflightChecks,
    promptContractChecks,
    warnings,
    expectedArtifacts: [
      "run trace with provider, role, backend, and launcher",
      "executable path and bounded retry provenance for every AI CLI",
      "machine-readable context pack trace with inclusion, exclusion, redaction, and changed-file counts",
      "worktree or pane owner",
      "expected output contract before the first prompt is sent",
      "native IME, clipboard, reconnect, and AI CLI input-boundary preflight",
      "prompt contract with objective, context pack, output, done criteria, and guardrails",
    ],
  };

  return {
    ...plan,
    trace: buildAiCliLaunchTrace(plan, selectedCli, input.promptContract),
  };
}
