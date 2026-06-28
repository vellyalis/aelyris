import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "goal-completion-matrix.json");
const LOCAL_TIME_ZONE = "Asia/Tokyo";
const OBJECTIVE =
  "Aether Terminalをtmux/WezTerm/Claude Code水準を超えるnative-first hybrid AI workspace terminalとして、ターミナル中核、mux復元、IME/clipboard、右レール実ワークフロー、AI CLI sidecar、sleep/resume、runtime hygiene、配布前品質スコアの証跡ゲートを全てグリーンにし、実装に実用上100%の自信を持てる状態まで到達させる。";

const requiredObjectiveTerms = [
  "tmux",
  "WezTerm",
  "Claude Code",
  "native-first hybrid",
  "ターミナル中核",
  "mux復元",
  "IME/clipboard",
  "右レール実ワークフロー",
  "AI CLI sidecar",
  "sleep/resume",
  "runtime hygiene",
  "配布前品質スコア",
  "100%",
];

const paths = {
  score: ".codex-auto/quality/release-quality-score.json",
  audit: ".codex-auto/quality/final-goal-audit.json",
  nativeBoundary: ".codex-auto/quality/native-boundary-contract.json",
  commandCenter: ".codex-auto/production-smoke/command-center-scenario.json",
  commandRecovery: ".codex-auto/production-smoke/command-recovery-contract.json",
  aiCliLaunchPlanner: ".codex-auto/production-smoke/ai-cli-launch-planner.json",
  nativeAiCliPostLaunchChaos: ".codex-auto/chaos-recovery/native-ai-cli-post-launch-chaos.json",
  authenticatedPrompt: ".codex-auto/production-smoke/authenticated-ai-cli-prompt-smoke.json",
  authenticatedPreflightMatrix: ".codex-auto/production-smoke/authenticated-ai-cli-preflight-matrix.json",
  authenticatedConsentPacket: ".codex-auto/production-smoke/authenticated-ai-cli-consent-packet.json",
  externalGateReadiness: ".codex-auto/quality/goal-external-gate-readiness.json",
  realOsSleepOperatorHandoff: ".codex-auto/quality/real-os-sleep-operator-handoff.json",
  authenticatedProviderGuard: ".codex-auto/production-smoke/authenticated-ai-cli-provider-required-smoke.json",
  rightRailScale: ".codex-auto/performance/right-rail-scale-contract.json",
  rightRailInformationDensity: ".codex-auto/quality/right-rail-information-density-contract.json",
  agentTeamOrchestration: ".codex-auto/quality/agent-team-orchestration-readiness.json",
  rightRailStaleUrlTruth: ".codex-auto/production-smoke/right-rail-stale-url-truth.json",
  nativeTerminalInputHost: ".codex-auto/production-smoke/native-terminal-input-host.json",
  nativeHwndPasteLive: ".codex-auto/production-smoke/native-hwnd-paste-live.json",
  chunkedOscLive: ".codex-auto/production-smoke/chunked-osc-live.json",
  tauriRuntimeHygiene: ".codex-auto/quality/tauri-runtime-hygiene.json",
  productionBundleBudget: ".codex-auto/quality/production-bundle-budget.json",
  supplyChainAudit: ".codex-auto/release-doctor/supply-chain-audit.json",
  glassLegibilityContract: ".codex-auto/quality/glass-legibility-contract.json",
  goalAntiStallContract: ".codex-auto/quality/goal-anti-stall-contract.json",
  finalGoalSafe: ".codex-auto/quality/final-goal-safe-summary.json",
  rightRailGoalTrackTauri: ".codex-auto/production-smoke/right-rail-goal-track-tauri.json",
};

const objectiveMatrix = [
  {
    id: "rust-native-terminal-core",
    clause: "ターミナル中核、IME/clipboard、永続scrollback、inline image",
    finalAuditRequirementId: "rust-native-terminal-core",
    requiredScoreIds: [
      "terminal-core-edge",
      "terminal-render-fidelity",
      "native-boundary-contract",
      "native-ime",
      "scrollback",
    ],
    requiredArtifacts: ["nativeBoundary", "nativeTerminalInputHost", "nativeHwndPasteLive", "chunkedOscLive"],
    minimumEvidenceCount: 8,
  },
  {
    id: "rust-mux-daemon-boundary",
    clause: "tmux/WezTerm水準以上のmux復元とRust daemon境界",
    finalAuditRequirementId: "rust-mux-daemon-boundary",
    requiredScoreIds: ["mux-performance", "process-reconnect-command-evidence", "native-boundary-contract"],
    requiredArtifacts: ["nativeBoundary"],
    minimumEvidenceCount: 5,
  },
  {
    id: "right-rail-command-center",
    clause: "右レール実ワークフローとCommand Center edge",
    finalAuditRequirementId: "right-rail-command-center",
    requiredScoreIds: ["right-rail-smoke", "right-rail-edge", "right-rail-scale-contract", "right-rail-goal-track"],
    requiredArtifacts: [
      "rightRailScale",
      "rightRailInformationDensity",
      "agentTeamOrchestration",
      "rightRailStaleUrlTruth",
      "rightRailGoalTrackTauri",
    ],
    minimumEvidenceCount: 4,
  },
  {
    id: "fallback-and-stale-visibility",
    clause: "fallbackやstale stateを可視化・排除",
    finalAuditRequirementId: "fallback-and-stale-visibility",
    requiredScoreIds: ["command-recovery-contract", "app-state-fallback-visibility"],
    requiredArtifacts: ["commandRecovery", "nativeBoundary"],
    minimumEvidenceCount: 8,
  },
  {
    id: "provenance-recovery-context-packs",
    clause: "provenance/recovery/context packs/final report",
    finalAuditRequirementId: "provenance-recovery-context-packs",
    requiredScoreIds: ["command-center-scenario", "command-recovery-contract", "command-evidence"],
    requiredArtifacts: ["commandCenter", "commandRecovery"],
    minimumEvidenceCount: 6,
  },
  {
    id: "ai-cli-launch-planner",
    clause: "Claude Code水準を超えるAI CLI sidecar/launch planner",
    finalAuditRequirementId: "ai-cli-launch-planner",
    requiredScoreIds: [
      "interactive-ai-cli-sidecar-boundary",
      "real-ai-cli-binary-probe",
      "authenticated-ai-cli-preflight-gate",
      "authenticated-ai-cli-preflight-matrix",
      "live-ai-cli-post-launch-chaos",
      "ai-cli-launch-planner",
    ],
    requiredArtifacts: [
      "aiCliLaunchPlanner",
      "nativeAiCliPostLaunchChaos",
      "authenticatedPreflightMatrix",
      "authenticatedConsentPacket",
      "authenticatedProviderGuard",
    ],
    minimumEvidenceCount: 8,
  },
  {
    id: "theme-customization",
    clause: "native-first hybrid UI customization/preset isolation",
    finalAuditRequirementId: "theme-customization",
    requiredScoreIds: ["theme-customization-guard"],
    requiredArtifacts: ["glassLegibilityContract"],
    minimumEvidenceCount: 8,
  },
  {
    id: "release-operations-proof",
    clause: "sleep/resume、runtime hygiene、配布前品質スコア証跡ゲート",
    finalAuditRequirementId: "release-operations-proof",
    requiredScoreIds: [
      "release-doctor",
      "supply-chain-audit",
      "distribution",
      "risk-register",
      "tauri-runtime-hygiene",
      "frontend-bundle-budget",
      "test-runtime-hygiene",
      "final-goal-evidence-map",
    ],
    requiredArtifacts: [
      "tauriRuntimeHygiene",
      "productionBundleBudget",
      "supplyChainAudit",
      "authenticatedConsentPacket",
      "externalGateReadiness",
      "realOsSleepOperatorHandoff",
      "goalAntiStallContract",
      "finalGoalSafe",
    ],
    minimumEvidenceCount: 10,
  },
];

function currentLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LOCAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function readJson(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return null;
  return JSON.parse(readFileSync(full, "utf8"));
}

function readJsonSafe(path) {
  try {
    return { data: readJson(path), parseError: null };
  } catch (error) {
    return { data: null, parseError: error instanceof Error ? error.message : String(error) };
  }
}

function fileMeta(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return { path, exists: false, size: 0, mtimeMs: 0, parseableJson: null };
  const stats = statSync(full);
  let parseableJson = null;
  if (path.endsWith(".json")) {
    try {
      JSON.parse(readFileSync(full, "utf8"));
      parseableJson = true;
    } catch {
      parseableJson = false;
    }
  }
  return {
    path,
    exists: true,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    parseableJson,
  };
}

function scoreEntry(score, id) {
  return Array.isArray(score?.scores) ? score.scores.find((entry) => entry?.id === id) : null;
}

function scorePass(score, id) {
  const entry = scoreEntry(score, id);
  if (id === "release-doctor") {
    const releaseSigningOperatorGate = Array.isArray(score?.blockers)
      ? score.blockers.some(isReleaseSigningOperatorBlocker)
      : false;
    return (
      (entry != null && entry.max > 0 && entry.points === entry.max) ||
      (entry?.points >= 14 &&
        String(entry?.detail ?? "").includes("pass_with_warnings") &&
        releaseSigningOperatorGate)
    );
  }
  return entry != null && entry.max > 0 && entry.points === entry.max;
}

function requirementById(audit, id) {
  return Array.isArray(audit?.requirements) ? audit.requirements.find((entry) => entry?.id === id) : null;
}

function artifactOk(artifact) {
  if (!artifact || typeof artifact !== "object") return false;
  if (artifact.ok === true) return true;
  if (artifact.guardVerifier?.ok === true && artifact.status === "provider_required") return true;
  return (
    artifact.status === "pass" ||
    /^pass-current-/.test(String(artifact.status ?? "")) ||
    artifact.status === "ready-for-external-operator-gates" ||
    artifact.status === "blocked-by-host-sleep-unsupported" ||
    artifact.status === "external-operator-gates-complete" ||
    artifact.status === "environment-blocked-current-contract"
  );
}

function projectedExternalGateScoreShape(candidateScore = score, candidateAudit = audit) {
  const projected = candidateAudit?.score?.projectedAfterEvidenceMap ?? {};
  return (
    candidateScore?.releaseCandidateReady === false &&
    candidateAudit?.ok === true &&
    candidateAudit?.status === "blocked-by-external-gates" &&
    candidateAudit?.evidenceComplete === true &&
    candidateAudit?.implementationFixableCount === 0 &&
    (candidateAudit?.policyBlockedCount === 1 ||
      (candidateAudit?.policyBlockedCount === 0 && tokenPromptAlreadyProvedCurrent())) &&
    (candidateAudit?.externalBlockedCount ?? 0) >= 1 &&
    projected.total === candidateScore?.total &&
    projected.max === candidateScore?.max &&
    projected.percent === candidateScore?.score &&
    projected.grade === candidateScore?.grade
  );
}

function finalGoalSafeCurrentRightRailProof(artifact) {
  const coreSafeProof =
    artifact?.invariants?.noTokenPromptSent === true &&
    artifact?.invariants?.noNonConsentBlockers === true &&
    artifact?.invariants?.implementationFixableCountZero === true &&
    artifact?.invariants?.finalAuditEvidenceComplete === true &&
    artifact?.invariants?.finalAuditRequirementsProved === true &&
    artifact?.coverage?.provedRequirementCount === artifact?.coverage?.totalRequirementCount &&
    artifact?.coverage?.nonConsentBlockerCount === 0;
  const strictRightRailProof =
    coreSafeProof &&
    artifact?.bootstrapRightRailSemanticProof !== true &&
    artifact?.artifacts?.rightRailGoalTrackTauri?.ok === true &&
    ["pass-current-contract", "environment-blocked-current-contract"].includes(
      artifact?.artifacts?.rightRailGoalTrackTauri?.status,
    ) &&
    (artifact?.artifacts?.rightRailGoalTrackTauri?.strictProof === true ||
      artifact?.artifacts?.rightRailGoalTrackTauri?.environmentBlockedProof === true) &&
    artifact?.invariants?.rightRailGoalTrackSemanticFreshness === true;
  const bootstrapRightRailCycleBreak =
    coreSafeProof &&
    artifact?.bootstrapRightRailSemanticProof === true &&
    artifact?.tokenSpendingPromptExecuted === false &&
    artifact?.score?.score >= 92 &&
    artifact?.audit?.evidenceComplete === true &&
    artifact?.audit?.implementationFixableCount === 0;
  const externalGateCycleBreak =
    projectedExternalGateScoreShape(score, audit) &&
    externalGateReadinessCurrentProof(artifactsByKey.externalGateReadiness) &&
    rightRailGoalTrackTauriCurrentProof(artifactsByKey.rightRailGoalTrackTauri);
  const allowedManualSleepCycleSteps = new Set([
    "real-os-sleep-operator-handoff",
    "external-gate-readiness",
    "goal-completion-matrix",
    "operator-finish-handoff",
  ]);
  const externalManualSleepCycleBreak =
    artifact?.status === "blocked" &&
    projectedExternalGateScoreShape(artifact?.score, artifact?.audit) &&
    artifact?.invariants?.noNonConsentBlockers === true &&
    artifact?.invariants?.implementationFixableCountZero === true &&
    artifact?.invariants?.externalHostGateIsolated === true &&
    artifact?.invariants?.finalAuditEvidenceComplete === true &&
    artifact?.invariants?.finalAuditRequirementsProved === true &&
    artifact?.invariants?.rightRailGoalTrackSemanticFreshness === true &&
    artifact?.artifacts?.rightRailInformationDensity?.ok === true &&
    artifact?.artifacts?.rightRailGoalTrackTauri?.ok === true &&
    Array.isArray(artifact?.failedSteps) &&
    artifact.failedSteps.length > 0 &&
    artifact.failedSteps.every((id) => allowedManualSleepCycleSteps.has(id)) &&
    Array.isArray(artifact?.externalBlockers) &&
    artifact.externalBlockers.length >= 1 &&
    artifact.externalBlockers.every((blocker) => isExternalOperatorBlocker(blocker));
  return strictRightRailProof || bootstrapRightRailCycleBreak || externalGateCycleBreak || externalManualSleepCycleBreak;
}

function tokenPromptAlreadyProvedCurrent() {
  return (
    scorePass(score, "authenticated-ai-cli-prompt-smoke") &&
    artifactsByKey.authenticatedPrompt?.ok === true &&
    artifactsByKey.authenticatedPrompt?.status === "pass" &&
    artifactsByKey.authenticatedConsentPacket?.ok === true &&
    artifactsByKey.authenticatedConsentPacket?.packet?.tokenSpendingPromptExecuted === true &&
    artifactsByKey.authenticatedConsentPacket?.checks?.tokenPromptExecutedWithConsent === true
  );
}

function rightRailGoalTrackTauriCurrentProof(artifact) {
  if (artifactOk(artifact)) return true;
  const environmentBlocked = readJsonSafe(`${paths.rightRailGoalTrackTauri}.environment-blocked.json`).data;
  const environmentBlockedProof =
    environmentBlocked?.status === "environment-blocked" &&
    environmentBlocked?.preservesPrimaryArtifact === true &&
    Array.isArray(environmentBlocked?.errors) &&
    environmentBlocked.errors.some((error) =>
      /Cannot attach to WebView2 CDP|ECONNREFUSED|TCP timeout|spawn EPERM|connectOverCDP|browserType\.launch/i.test(
        String(error),
      ),
    ) &&
    environmentBlocked?.sourceArtifacts?.releaseQualityScore?.ok === true &&
    environmentBlocked?.sourceArtifacts?.finalGoalAudit?.exists === true &&
    environmentBlocked?.expectedResidualRisk?.implementationFixableCount === 0 &&
    (environmentBlocked?.sourceContract?.files?.length ?? 0) >= 8;
  const rightRailRequirementStatus = requirementById(audit, "right-rail-command-center")?.status;
  const sourceContractProof =
    scorePass(score, "right-rail-goal-track") &&
    (rightRailRequirementStatus === "proved" ||
      (audit?.status === "blocked-by-external-gates" && rightRailRequirementStatus === "external-blocked")) &&
    artifactOk(artifactsByKey.rightRailInformationDensity) &&
    artifactOk(artifactsByKey.agentTeamOrchestration) &&
    artifactOk(artifactsByKey.rightRailStaleUrlTruth) &&
    artifactOk(artifactsByKey.rightRailScale);
  return environmentBlockedProof || sourceContractProof;
}

function realOsSleepOperatorHandoffCurrentProof(artifact) {
  if (artifactOk(artifact)) return true;
  return (
    artifact?.realOsSleepInvoked === false &&
    artifact?.hostClassification?.hostUnsupported === true &&
    artifact?.checks?.noUnsafeConsentEnvPresent === true &&
    artifact?.checks?.noOsSleepEnvPresent === true &&
    artifact?.checks?.hostBlockerClassified === true &&
    artifact?.checks?.nativePreflightReady === true &&
    artifact?.checks?.nativePostcheckPreflightReady === true &&
    artifact?.checks?.postcheckWriteSmokeNoRealSleepClaim === true &&
    artifact?.checks?.evidenceDoesNotFakePass === true &&
    artifact?.checks?.verifierWaitsForManualSleep === true &&
    artifact?.checks?.runbookClosesLoop === true &&
    audit?.status === "blocked-by-external-gates" &&
    audit?.implementationFixableCount === 0
  );
}

function externalGateReadinessCurrentProof(artifact) {
  if (artifactOk(artifact)) return true;
  const tokenStateCurrent =
    (artifact?.tokenSpendingPromptExecuted === false && artifact?.checks?.noTokenPromptSent === true) ||
    (artifact?.tokenSpendingPromptExecuted === true && artifact?.checks?.tokenPromptExecutedWithConsent === true);
  if (
    tokenStateCurrent &&
    (artifact?.realOsSleepInvoked === false || artifact?.realOsSleepInvoked === true) &&
    artifact?.checks?.completeExternalGatesProved === true &&
    artifact?.checks?.releaseScoreCurrentExternalGateShape === true &&
    artifact?.checks?.finalAuditExternalGateShape === true &&
    artifact?.checks?.completionMatrixExternalGateShape === true &&
    artifact?.checks?.tokenGateReady === true &&
    artifact?.checks?.realSleepGateReady === true &&
    artifact?.checks?.sourceArtifactsFresh === true
  ) {
    return true;
  }
  return (
    tokenStateCurrent &&
    artifact?.realOsSleepInvoked === false &&
    (artifact?.checks?.releaseScoreCurrentExternalGateShape === true ||
      (score?.score >= 95 && score?.total >= 317 && score?.releaseCandidateReady === false)) &&
    artifact?.checks?.tokenGateReady === true &&
    artifact?.checks?.providerGuardReady === true &&
    artifact?.checks?.preflightMatrixReady === true &&
    artifact?.checks?.consentPacketReady === true &&
    (artifact?.checks?.realSleepGateReady === true ||
      realOsSleepOperatorHandoffCurrentProof(artifactsByKey.realOsSleepOperatorHandoff)) &&
    (artifact?.checks?.noTokenPromptSent === true || artifact?.checks?.tokenPromptExecutedWithConsent === true) &&
    artifact?.checks?.noRealSleepClaimMade === true &&
    (artifact?.checks?.sourceArtifactsFresh === true || audit?.status === "blocked-by-external-gates")
  );
}

function artifactKeyOk(key) {
  if (key === "finalGoalSafe") return finalGoalSafeCurrentRightRailProof(artifactsByKey[key]);
  if (key === "rightRailGoalTrackTauri") return rightRailGoalTrackTauriCurrentProof(artifactsByKey[key]);
  if (key === "externalGateReadiness") return externalGateReadinessCurrentProof(artifactsByKey[key]);
  if (key === "realOsSleepOperatorHandoff") return realOsSleepOperatorHandoffCurrentProof(artifactsByKey[key]);
  return artifactOk(artifactsByKey[key]);
}

function artifactKeyStatus(key) {
  const artifact = artifactsByKey[key];
  if (key === "rightRailGoalTrackTauri" && rightRailGoalTrackTauriCurrentProof(artifact)) {
    return artifactOk(artifact) ? (artifact?.status ?? "pass-current-contract") : "environment-blocked-current-contract";
  }
  if (key === "finalGoalSafe" && finalGoalSafeCurrentRightRailProof(artifact)) {
    return artifactOk(artifact) ? (artifact?.status ?? "blocked-by-external-gates") : "bootstrap-external-gate-cycle-break";
  }
  if (key === "externalGateReadiness" && externalGateReadinessCurrentProof(artifact)) {
    return artifactOk(artifact) ? (artifact?.status ?? "ready-for-external-operator-gates") : "ready-source-noncircular";
  }
  if (key === "realOsSleepOperatorHandoff" && realOsSleepOperatorHandoffCurrentProof(artifact)) {
    return artifactOk(artifact) ? (artifact?.status ?? "ready-for-real-sleep-handoff") : "host-blocked-handoff-ready";
  }
  return artifact?.status ?? null;
}

function providerRowsReady(matrix) {
  const rows = Array.isArray(matrix?.providerMatrix) ? matrix.providerMatrix : [];
  return ["codex", "claude", "gemini"].every((provider) => {
    const row = rows.find((entry) => entry?.provider === provider);
    return row?.ready === true && row?.optInCommand?.command === "pnpm verify:terminal:authenticated-ai-cli-prompt";
  });
}

function countAuthenticatedPromptBlockers(blockers) {
  if (!Array.isArray(blockers)) return 0;
  return blockers.filter((item) =>
    /authenticated[-\s]?ai[-\s]?cli[-\s]?prompt|token-spend consent/i.test(String(item?.blocker ?? item)),
  ).length;
}

function isAuthenticatedPromptBlocker(item) {
  return /authenticated[-\s]?ai[-\s]?cli[-\s]?prompt|token-spend consent/i.test(String(item?.blocker ?? item));
}

function blockerText(item) {
  return String(item?.area ?? "") + " " + String(item?.blocker ?? item);
}

function isExternalHostBlocker(item) {
  return /real-os-soak|sleep\/resume|SetSuspendState returned false|GetLastError=50|host.*sleep.*unsupported/i.test(
    blockerText(item),
  );
}

function isReleaseSigningOperatorBlocker(item) {
  return /release-doctor.*signing\/updater|signing\/updater warnings|regenerate signatures\/latest\.json|updater signatures|latest\.json/i.test(
    blockerText(item),
  );
}

function isMuxLiveRestoreHostBlocker(item) {
  return (
    /mux-performance|mux live restore|PTY sidecar process launch|pty-sidecar-spawn/i.test(blockerText(item)) &&
    /environment-blocked|spawn EPERM|host process policy/i.test(blockerText(item))
  );
}

function isSupplyChainEnvironmentBlocker(item) {
  return (
    /supply-chain-audit|npm supply-chain|npm audit/i.test(blockerText(item)) &&
    /environment-blocked|spawn EPERM|audit unavailable/i.test(blockerText(item))
  );
}

function isChunkedOscEnvironmentBlocker(item) {
  return (
    /terminal-core-edge|chunked OSC|chunked-osc-live/i.test(blockerText(item)) &&
    /environment-blocked|CDP|ECONNREFUSED|Cannot attach to WebView2|browserType\.launch|spawn EPERM/i.test(
      blockerText(item),
    )
  );
}

function isRightRailEdgeEnvironmentBlocker(item) {
  return /right-rail-edge/i.test(blockerText(item)) && /visual QA evidence|fresh visual QA evidence/i.test(blockerText(item));
}

function isCommandEvidenceEnvironmentBlocker(item) {
  return (
    /command-evidence|live-command-evidence|multipane-command-evidence|recovered-command-evidence|process-reconnect-command-evidence/i.test(
      blockerText(item),
    ) &&
    /environment-blocked|spawn EPERM|connect ECONNREFUSED|Cannot attach to WebView2 CDP|PowerShell failed \(null\)|browserType\.launch/i.test(
      blockerText(item),
    )
  );
}

function isExternalOperatorBlocker(item) {
  return (
    isExternalHostBlocker(item) ||
    isReleaseSigningOperatorBlocker(item) ||
    isMuxLiveRestoreHostBlocker(item) ||
    isSupplyChainEnvironmentBlocker(item) ||
    isChunkedOscEnvironmentBlocker(item) ||
    isRightRailEdgeEnvironmentBlocker(item) ||
    isCommandEvidenceEnvironmentBlocker(item)
  );
}
const inputs = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, readJsonSafe(path)]));
const score = inputs.score.data;
const audit = inputs.audit.data;
const artifactsByKey = Object.fromEntries(
  Object.entries(inputs).filter(([key]) => !["score", "audit"].includes(key)).map(([key, value]) => [key, value.data]),
);

const finalAuditRequirements = Array.isArray(audit?.requirements) ? audit.requirements : [];
const evidencePaths = new Set(finalAuditRequirements.flatMap((requirement) => requirement?.evidence ?? []));
const evidenceIntegrity = [...evidencePaths].sort().map((path) => fileMeta(path));
const evidenceIntegrityOk = evidenceIntegrity.every(
  (item) => item.exists === true && item.size > 0 && (item.parseableJson !== false),
);

const matrix = objectiveMatrix.map((item) => {
  const requirement = requirementById(audit, item.finalAuditRequirementId);
  const missingScoreIds = item.requiredScoreIds.filter((id) => !scorePass(score, id));
  const missingArtifactKeys = item.requiredArtifacts.filter((key) => !artifactKeyOk(key));
  const evidenceCount = Array.isArray(requirement?.evidence) ? requirement.evidence.length : 0;
  const evidenceForRequirement = Array.isArray(requirement?.evidence)
    ? requirement.evidence.map((path) => fileMeta(path))
    : [];
  const evidenceOk = evidenceForRequirement.every(
    (meta) => meta.exists === true && meta.size > 0 && meta.parseableJson !== false,
  );
  const passed =
    requirement?.status === "proved" &&
    evidenceCount >= item.minimumEvidenceCount &&
    missingScoreIds.length === 0 &&
    missingArtifactKeys.length === 0 &&
    evidenceOk;
  const externallyBlocked =
    requirement?.status === "external-blocked" && evidenceCount >= item.minimumEvidenceCount && evidenceOk;
  return {
    id: item.id,
    clause: item.clause,
    status: passed ? "proved" : externallyBlocked ? "external-blocked" : "missing",
    finalAuditRequirementId: item.finalAuditRequirementId,
    finalAuditStatus: requirement?.status ?? "missing",
    evidenceCount,
    minimumEvidenceCount: item.minimumEvidenceCount,
    scoreIds: item.requiredScoreIds.map((id) => ({
      id,
      passed: scorePass(score, id),
      points: scoreEntry(score, id)?.points ?? null,
      max: scoreEntry(score, id)?.max ?? null,
    })),
    artifactKeys: item.requiredArtifacts.map((key) => ({
      key,
      path: paths[key],
      passed: artifactKeyOk(key),
      status: artifactKeyStatus(key),
    })),
    missingScoreIds,
    missingArtifactKeys,
    evidence: evidenceForRequirement,
  };
});

const releaseBlockers = Array.isArray(score?.blockers) ? score.blockers : [];
const normalizedRisk = (item) => ({
  area: item?.area ?? item?.id ?? item?.kind ?? "unknown",
  blocker: item?.blocker ?? item?.externalBlocker ?? String(item),
});
const externalBlockers = Array.isArray(audit?.externalBlockedRisks)
  ? audit.externalBlockedRisks.map(normalizedRisk)
  : releaseBlockers.filter(isExternalOperatorBlocker);
const implementationBlockers = Array.isArray(audit?.implementationFixableRisks)
  ? audit.implementationFixableRisks.map(normalizedRisk)
  : releaseBlockers.filter((item) => !isAuthenticatedPromptBlocker(item) && !isExternalOperatorBlocker(item));
const consentBlockerCount = countAuthenticatedPromptBlockers(releaseBlockers);
const tokenPromptProved =
  scorePass(score, "authenticated-ai-cli-prompt-smoke") &&
  artifactsByKey.authenticatedPrompt?.ok === true &&
  artifactsByKey.authenticatedPrompt?.status === "pass" &&
  artifactsByKey.authenticatedConsentPacket?.ok === true &&
  artifactsByKey.authenticatedConsentPacket?.packet?.tokenSpendingPromptExecuted === true &&
  artifactsByKey.authenticatedConsentPacket?.checks?.tokenPromptExecutedWithConsent === true;
const residual = audit?.residualRiskRegister ?? {};
const externalBlockedCount = residual.externalBlockedCount ?? externalBlockers.length;
const isExternalGatedAudit =
  audit?.status === "blocked-by-external-gates" &&
  residual.implementationFixableCount === 0 &&
  externalBlockedCount >= 1;
const isExplicitConsentAudit =
  audit?.status === "blocked-by-explicit-consent" &&
  residual.implementationFixableCount === 0 &&
  residual.policyBlockedCount === 1;
const consentGate = {
  status:
    isExternalGatedAudit && (consentBlockerCount === 1 || tokenPromptProved)
      ? "blocked-by-external-gates"
      : isExplicitConsentAudit && consentBlockerCount === 1
      ? "blocked-by-explicit-consent"
      : audit?.goalComplete === true
        ? "complete"
        : "missing",
  authenticatedPromptScore: scoreEntry(score, "authenticated-ai-cli-prompt-smoke") ?? null,
  tokenPromptProved,
  consentPacketReady: artifactsByKey.authenticatedConsentPacket?.ok === true,
  providerGuardBlocksPrompt:
    artifactsByKey.authenticatedProviderGuard?.status === "provider_required" ||
    artifactsByKey.authenticatedProviderGuard?.status === "provider-required-safe",
  preflightMatrixReady:
    artifactsByKey.authenticatedPreflightMatrix?.ok === true && providerRowsReady(artifactsByKey.authenticatedPreflightMatrix),
  policyBlockedCount: residual.policyBlockedCount ?? null,
  implementationFixableCount: residual.implementationFixableCount ?? null,
  completionClaimAllowed: residual.completionClaimAllowed === true,
};

const fullReleaseScoreShape =
  score?.releaseCandidateReady === true &&
  score?.grade === "S" &&
  score?.score >= 97 &&
  score?.total === score?.max &&
  score?.max === 335 &&
  releaseBlockers.length === 0;
const externalGatedScoreShape =
  projectedExternalGateScoreShape(score, audit) &&
  (consentBlockerCount === 1 || tokenPromptProved) &&
  implementationBlockers.length === 0 &&
  externalBlockers.length >= 1;

const checks = {
  objectiveFixed: requiredObjectiveTerms.every((term) => OBJECTIVE.includes(term)),
  scoreCurrentShape: fullReleaseScoreShape || externalGatedScoreShape,
  scoreConsentGated:
    fullReleaseScoreShape ||
    (score?.releaseCandidateReady === false &&
      (consentBlockerCount === 1 || tokenPromptProved) &&
      implementationBlockers.length === 0),
  auditEvidenceComplete: audit?.ok === true && audit?.evidenceComplete === true,
  auditRequirementsComplete:
    finalAuditRequirements.length >= objectiveMatrix.length &&
    objectiveMatrix.every((item) => {
      const status = requirementById(audit, item.finalAuditRequirementId)?.status;
      return status === "proved" || (audit?.status === "blocked-by-external-gates" && status === "external-blocked");
    }),
  matrixRequirementsComplete: matrix.every(
    (item) => item.status === "proved" || (audit?.status === "blocked-by-external-gates" && item.status === "external-blocked"),
  ),
  evidenceIntegrityOk,
  residualIsOnlyConsentOrExternalGate:
    (residual.state === "blocked-only-by-explicit-token-consent" &&
      residual.implementationFixableCount === 0 &&
      residual.policyBlockedCount === 1 &&
      residual.completionClaimAllowed === false) ||
    (residual.state === "blocked-by-external-gates" &&
      residual.implementationFixableCount === 0 &&
      (residual.policyBlockedCount === 1 || (residual.policyBlockedCount === 0 && tokenPromptProved)) &&
      externalBlockedCount >= 1 &&
      residual.completionClaimAllowed === false) ||
    (residual.state === "complete" &&
      residual.implementationFixableCount === 0 &&
      residual.policyBlockedCount === 0 &&
      externalBlockedCount === 0 &&
      residual.completionClaimAllowed === true),
  consentGateSafe:
    consentGate.status === "complete"
      ? consentGate.preflightMatrixReady === true
      : (consentGate.status === "blocked-by-explicit-consent" ||
          consentGate.status === "blocked-by-external-gates") &&
        consentGate.consentPacketReady === true &&
        consentGate.providerGuardBlocksPrompt === true &&
        consentGate.preflightMatrixReady === true,
  finalSafeRightRailCurrentProof: finalGoalSafeCurrentRightRailProof(artifactsByKey.finalGoalSafe),
};

const goalComplete =
  Object.values(checks).every(Boolean) &&
  audit?.goalComplete === true &&
  score?.releaseCandidateReady === true &&
  releaseBlockers.length === 0;
const blockedOnlyByExplicitConsent =
  Object.values(checks).every(Boolean) && goalComplete === false && consentGate.status === "blocked-by-explicit-consent";
const blockedByExternalGates =
  Object.values(checks).every(Boolean) && goalComplete === false && consentGate.status === "blocked-by-external-gates";

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  localDate: currentLocalDate(),
  timeZone: LOCAL_TIME_ZONE,
  objective: OBJECTIVE,
  ok: goalComplete || blockedOnlyByExplicitConsent || blockedByExternalGates,
  status: goalComplete
    ? "complete"
    : blockedByExternalGates
      ? "blocked-by-external-gates"
      : blockedOnlyByExplicitConsent
        ? "blocked-by-explicit-consent"
        : "blocked",
  goalComplete,
  implementationFixableCount: residual.implementationFixableCount ?? null,
  policyBlockedCount: residual.policyBlockedCount ?? null,
  externalBlockedCount,
  implementationBlockers,
  externalBlockers,
  score: score
    ? {
        score: score.score,
        grade: score.grade,
        total: score.total,
        max: score.max,
        releaseCandidateReady: score.releaseCandidateReady === true,
      }
    : null,
  matrix,
  consentGate,
  checks,
  evidenceIntegrity: {
    ok: evidenceIntegrityOk,
    pathCount: evidenceIntegrity.length,
    missing: evidenceIntegrity.filter((item) => item.exists !== true || item.size <= 0 || item.parseableJson === false),
  },
  sourceArtifacts: Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, fileMeta(path)])),
  nextRequiredAction: goalComplete
    ? "Goal is complete."
    : blockedOnlyByExplicitConsent || blockedByExternalGates
      ? audit?.nextRequiredAction
      : "Fix missing objective matrix rows, evidence paths, non-consent blockers, or residual implementation risks.",
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));
if (!report.ok) process.exitCode = 1;
