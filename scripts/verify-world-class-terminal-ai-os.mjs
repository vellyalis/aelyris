import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "world-class-terminal-ai-os.json");

const ARTIFACTS = {
  currentReadiness: ".codex-auto/quality/current-readiness-source.json",
  releaseQuality: ".codex-auto/quality/release-quality-score.json",
  antiDebt: ".codex-auto/quality/anti-debt-claim-contract.json",
  modularity: ".codex-auto/quality/modularity-boundary-contract.json",
  agentTeam: ".codex-auto/quality/agent-team-orchestration-readiness.json",
  durableMerge: ".codex-auto/quality/durable-merge-unification.json",
  securityMerge: ".codex-auto/quality/security-merge-intent-binding.json",
  sharedBrain: ".codex-auto/quality/shared-brain-ownership-persistence-contract.json",
  sharedBrainRestart: ".codex-auto/quality/shared-brain-restart-replay.json",
  muxWindowSession: ".codex-auto/quality/mux-window-session-model.json",
  muxTmux: ".codex-auto/quality/mux-tmux-grade-contract.json",
  muxMultiClient: ".codex-auto/quality/mux-multiclient-attach-contract.json",
  muxFallback: ".codex-auto/quality/mux-fallback-blocker-contract.json",
  muxLiveRestore: ".codex-auto/performance/mux-live-restore-smoke.json",
  muxLiveProcessPreservation: ".codex-auto/quality/mux-live-process-preservation.json",
  nativeBoundary: ".codex-auto/quality/native-boundary-contract.json",
  nativeTextShaping: ".codex-auto/quality/native-text-shaping-fallback.json",
  nativeDailyDriver: ".codex-auto/quality/native-daily-driver-terminal.json",
  nativeVisualRegression: ".codex-auto/quality/native-visual-regression.json",
};

const SOURCE_PATHS = [
  "package.json",
  "scripts/verify-world-class-terminal-ai-os.mjs",
  "scripts/verify-current-readiness-source.mjs",
  "scripts/verify-anti-debt-claim-contract.mjs",
  "scripts/verify-modularity-boundary-contract.mjs",
  "scripts/score-release-quality.mjs",
  "scripts/verify-agent-team-orchestration-readiness.mjs",
  "scripts/verify-durable-merge-unification.mjs",
  "scripts/verify-security-mcp-merge-intent-binding.mjs",
  "scripts/verify-shared-brain-ownership-persistence-contract.mjs",
  "scripts/verify-mux-window-session-model.mjs",
  "scripts/verify-mux-tmux-grade-contract.mjs",
  "scripts/verify-mux-multiclient-attach.mjs",
  "scripts/verify-mux-fallback-blocker.mjs",
  "scripts/verify-mux-live-process-preservation.mjs",
  "scripts/verify-native-boundary-contract.mjs",
  "scripts/verify-native-daily-driver-terminal.mjs",
  "scripts/verify-native-text-shaping-fallback.mjs",
  "scripts/verify-native-visual-regression.mjs",
  "docs/specs/QUORUM_GAP_CLOSURE_DESIGN_2026-06-25.md",
];

function pathOf(path) {
  return join(ROOT, path);
}

function mtime(path) {
  const full = pathOf(path);
  return existsSync(full) ? statSync(full).mtimeMs : 0;
}

function readJson(path) {
  const full = pathOf(path);
  if (!existsSync(full)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(full, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

function artifactMeta(id, path) {
  const artifact = readJson(path);
  const artifactMtime = mtime(path);
  return {
    id,
    path,
    exists: artifact !== null,
    mtimeMs: artifactMtime,
    freshAgainstOwnSourceCutoff: artifactSelfFresh(path, artifact),
    ok: artifact?.ok ?? null,
    status: artifact?.status ?? null,
    generatedAt: artifact?.generatedAt ?? null,
    summary: artifact?.summary ?? null,
  };
}

function artifactSelfFresh(path, artifact = readJson(path)) {
  const artifactMtime = mtime(path);
  if (artifactMtime <= 0) return false;
  if (typeof artifact?.sourceCutoffMs === "number") {
    return artifactMtime >= artifact.sourceCutoffMs;
  }
  return typeof artifact?.generatedAt === "string";
}

function hasKnownGaps(artifact) {
  return Array.isArray(artifact?.knownGaps) && artifact.knownGaps.length > 0;
}

function component(id, path, status, reason, extra = {}) {
  return { id, path, status, reason, ...extra };
}

function statusFromComponents(components) {
  if (components.some((item) => item.status === "block")) {
    return "block";
  }
  if (components.some((item) => item.status === "external-blocked")) {
    return "external-blocked";
  }
  if (components.some((item) => item.status === "review")) {
    return "review";
  }
  return "pass";
}

function claim(label, components) {
  const status = statusFromComponents(components);
  return {
    label,
    status,
    blockers: components
      .filter((item) => item.status === "block" || item.status === "external-blocked")
      .map((item) => item.reason),
    externalBlockers: components.filter((item) => item.status === "external-blocked").map((item) => item.reason),
    reviewItems: components.filter((item) => item.status === "review").map((item) => item.reason),
    components,
  };
}

function artifactStatusPass(artifact) {
  return artifact?.ok === true || artifact?.status === "passed" || artifact?.status === "pass";
}

function artifactStatusFail(artifact) {
  return (
    artifact === null ||
    artifact?.ok === false ||
    ["environment-blocked", "environment-blocked-current-contract", "blocked", "failed", "fail", "block"].includes(
      artifact?.status,
    )
  );
}

function artifactExternalBlocked(artifact) {
  return (
    artifact?.externalBlocked === true ||
    artifact?.hostBlocked === true ||
    ["environment-blocked", "environment-blocked-current-contract", "blocked-by-external-gates"].includes(
      artifact?.status,
    )
  );
}

function blockerText(item) {
  return `${item?.area ?? ""} ${item?.blocker ?? item ?? ""}`;
}

function isExternalOrPolicyReleaseBlocker(item) {
  const text = blockerText(item);
  return /authenticated AI CLI prompt|explicit token|token-spend consent|signing\/updater|regenerate signatures|latest\.json|npm supply-chain|npm audit|environment-blocked|spawn EPERM|mux live restore|PTY sidecar|chunked OSC|CDP|ECONNREFUSED|WebView2|right rail visual QA|real OS sleep\/resume|SetSuspendState|GetLastError=50|live command evidence|multi-pane command evidence|recovered command evidence|process reconnect command evidence|world-class terminal AI OS aggregate gate is externally blocked|world-class claim blocked: .*external-blocked|final goal audit status is blocked-by-external-gates|external host gates/i.test(
    text,
  );
}

function isWorldClassSelfReferenceBlocker(item) {
  const text = blockerText(item);
  return /world-class-terminal-ai-os|world-class claim blocked|world-class terminal AI OS aggregate/i.test(text);
}

function isFinalGoalEvidenceMapSelfReferenceBlocker(item) {
  const text = blockerText(item);
  return /final-goal-evidence-map|final goal audit|projected score|residual risks|consent command/i.test(text);
}

function releaseQualityOnlyExternalOrPolicyBlockers(releaseQuality, upstreamClaims = []) {
  const blockers = Array.isArray(releaseQuality?.blockers) ? releaseQuality.blockers : [];
  const upstreamHasNoImplementationBlock =
    upstreamClaims.length > 0 && upstreamClaims.every((claim) => claim?.status !== "block");
  return (
    releaseQuality?.releaseCandidateReady !== true &&
    blockers.length > 0 &&
    blockers.every(
      (item) =>
        isExternalOrPolicyReleaseBlocker(item) ||
        (upstreamHasNoImplementationBlock && isWorldClassSelfReferenceBlocker(item)) ||
        isFinalGoalEvidenceMapSelfReferenceBlocker(item),
    )
  );
}
const sourceCutoffMs = Math.max(...SOURCE_PATHS.map(mtime));
const data = Object.fromEntries(Object.entries(ARTIFACTS).map(([id, path]) => [id, readJson(path)]));
const artifactList = Object.entries(ARTIFACTS).map(([id, path]) => artifactMeta(id, path));

const tmuxClaim = claim("tmux-grade mux", [
  component(
    "mux-window-session-model",
    ARTIFACTS.muxWindowSession,
    data.muxWindowSession?.ok === true ? (hasKnownGaps(data.muxWindowSession) ? "review" : "pass") : "block",
    data.muxWindowSession?.ok === true
      ? "backend-owned mux window/session model is contract-covered with recorded live-restore gaps"
      : "mux window/session model contract is missing or failing",
    { knownGaps: data.muxWindowSession?.knownGaps ?? [] },
  ),
  component(
    "mux-tmux-grade-contract",
    ARTIFACTS.muxTmux,
    data.muxTmux?.ok === true ? (hasKnownGaps(data.muxTmux) ? "review" : "pass") : "block",
    data.muxTmux?.ok === true
      ? "tmux-style mux contract passes with recorded review gaps"
      : "tmux-style mux contract is missing or failing",
    { knownGaps: data.muxTmux?.knownGaps ?? [] },
  ),
  component(
    "mux-multiclient-attach",
    ARTIFACTS.muxMultiClient,
    data.muxMultiClient?.ok === true ? "pass" : "block",
    data.muxMultiClient?.ok === true
      ? "multi-client attach, read-only streams, replay, and leases are contract-covered"
      : "multi-client attach contract is missing or failing",
  ),
  component(
    "mux-fallback-blocker",
    ARTIFACTS.muxFallback,
    data.muxFallback?.ok === true ? "pass" : "block",
    data.muxFallback?.ok === true
      ? "fallback cannot unlock tmux-grade claims"
      : "fallback blocker contract is missing or failing",
  ),
  component(
    "mux-live-restore",
    ARTIFACTS.muxLiveRestore,
    data.muxLiveRestore?.status === "passed"
      ? "pass"
      : data.muxLiveRestore?.status === "environment-blocked" || data.muxLiveRestore?.hostBlocked === true
        ? "external-blocked"
        : "block",
    data.muxLiveRestore?.status === "passed"
      ? "live restore proof is current"
      : data.muxLiveRestore?.status === "environment-blocked" || data.muxLiveRestore?.status === "blocked"
        ? `live mux restore proof is environment-blocked: ${data.muxLiveRestore?.blockers?.[0]?.message ?? "host capability unavailable"}`
        : "live mux restore proof is missing, stale, or failing",
    { blockers: data.muxLiveRestore?.blockers ?? [] },
  ),
  component(
    "mux-live-process-preservation",
    ARTIFACTS.muxLiveProcessPreservation,
    data.muxLiveProcessPreservation?.status === "passed" ? "pass" : "block",
    data.muxLiveProcessPreservation?.status === "passed"
      ? "same-process mux preservation is proven"
      : "same-process mux preservation is not implemented or proven",
    { blockers: data.muxLiveProcessPreservation?.blockers ?? [] },
  ),
]);

const bridgespaceClaim = claim("BridgeSpace/control plane", [
  component(
    "durable-merge-unification",
    ARTIFACTS.durableMerge,
    data.durableMerge?.ok === true ? (hasKnownGaps(data.durableMerge) ? "review" : "pass") : "block",
    data.durableMerge?.ok === true
      ? "durable merge path is unified with recorded review gaps"
      : "durable merge unification is missing or failing",
    { knownGaps: data.durableMerge?.knownGaps ?? [] },
  ),
  component(
    "security-merge-intent-binding",
    ARTIFACTS.securityMerge,
    data.securityMerge?.ok === true ? "pass" : "block",
    data.securityMerge?.ok === true
      ? "security merge intent binding is contract-covered"
      : "security merge intent binding is missing or failing",
  ),
  component(
    "shared-brain-ownership-persistence",
    ARTIFACTS.sharedBrain,
    data.sharedBrain?.ok === true ? (hasKnownGaps(data.sharedBrain) ? "review" : "pass") : "block",
    data.sharedBrain?.ok === true
      ? "shared brain and ownership persistence are contract-covered with recorded review gaps"
      : "shared brain ownership persistence is missing or failing",
    { knownGaps: data.sharedBrain?.knownGaps ?? [] },
  ),
  component(
    "shared-brain-restart-replay",
    ARTIFACTS.sharedBrainRestart,
    artifactStatusPass(data.sharedBrainRestart)
      ? "pass"
      : artifactExternalBlocked(data.sharedBrainRestart)
        ? "external-blocked"
        : "block",
    artifactStatusPass(data.sharedBrainRestart)
      ? "shared brain restart replay is proven"
      : data.sharedBrainRestart?.status === "environment-blocked"
        ? `shared brain restart replay is environment-blocked: ${data.sharedBrainRestart?.blockers?.[0]?.message ?? "host capability unavailable"}`
        : "shared brain restart replay proof is missing or not green",
    { blockers: data.sharedBrainRestart?.blockers ?? [] },
  ),
  component(
    "agent-team-orchestration",
    ARTIFACTS.agentTeam,
    data.agentTeam?.ok === true ? "pass" : artifactExternalBlocked(data.agentTeam) ? "external-blocked" : "block",
    data.agentTeam?.ok === true
      ? "agent-team orchestration readiness is green"
      : artifactExternalBlocked(data.agentTeam)
        ? `agent-team orchestration readiness is environment-blocked: ${(data.agentTeam?.blockers ?? [])
            .map((item) => item.detail)
            .filter(Boolean)
            .join("; ") || "host capability unavailable"}`
        : "agent-team orchestration readiness is blocked",
    {
      failedChecks: data.agentTeam?.failedChecks ?? [],
      environmentBlockedChecks: data.agentTeam?.environmentBlockedChecks ?? [],
      implementationFailedChecks: data.agentTeam?.implementationFailedChecks ?? [],
    },
  ),
]);

function nativeTextShapingReason(nativeTextShaping) {
  if (nativeTextShaping?.readyForGhosttyClaim === true) {
    return "native text shaping, renderer integration, and fallback visual fixtures are proven";
  }
  if (
    nativeTextShaping?.systemTextShapingReady === true &&
    nativeTextShaping?.rendererTextShapingIntegrated === true &&
    nativeTextShaping?.realFontFallbackReady !== true &&
    nativeTextShaping?.unsupportedSystemShaper === false
  ) {
    return "native DirectWrite shaped runs are consumed by the renderer, but real DirectWrite font fallback mapping is not ready for Ghostty claim";
  }
  if (
    nativeTextShaping?.systemTextShapingReady === true &&
    nativeTextShaping?.realFontFallbackReady === true &&
    nativeTextShaping?.rendererTextShapingIntegrated === true &&
    nativeTextShaping?.rendererFallbackGlyphRasterizationReady === true &&
    nativeTextShaping?.visualFallbackGlyphFixturesReady !== true &&
    nativeTextShaping?.unsupportedSystemShaper === false
  ) {
    return "native DirectWrite shaped runs, real fallback mapping, and fallback atlas rasterization are source-contract ready, but visual fixtures are not ready for Ghostty claim";
  }
  if (
    nativeTextShaping?.systemTextShapingReady === true &&
    nativeTextShaping?.realFontFallbackReady === true &&
    nativeTextShaping?.rendererTextShapingIntegrated === true &&
    nativeTextShaping?.rendererFallbackGlyphRasterizationReady !== true &&
    nativeTextShaping?.unsupportedSystemShaper === false
  ) {
    return "native DirectWrite shaped runs are consumed by the renderer, but fallback glyph rasterization is not ready for Ghostty claim";
  }
  if (
    nativeTextShaping?.systemTextShapingReady === true &&
    nativeTextShaping?.realFontFallbackReady === true &&
    nativeTextShaping?.unsupportedSystemShaper === false
  ) {
    return "native DirectWrite system shaping/fallback boundary is present, but renderer integration, fallback glyph rasterization, or visual fixtures are not ready for Ghostty claim";
  }
  return "native system text shaping and fallback are not ready for Ghostty claim";
}

const ghosttyClaim = claim("Ghostty/WezTerm-class native terminal", [
  component(
    "native-boundary",
    ARTIFACTS.nativeBoundary,
    data.nativeBoundary?.ok === true &&
      data.nativeBoundary?.status === "pass" &&
      artifactSelfFresh(ARTIFACTS.nativeBoundary, data.nativeBoundary)
      ? "pass"
      : "block",
    data.nativeBoundary?.ok === true && data.nativeBoundary?.status === "pass"
      ? "native boundary is green"
      : "native boundary contract is blocked or stale",
    { fresh: artifactSelfFresh(ARTIFACTS.nativeBoundary, data.nativeBoundary) },
  ),
  component(
    "native-text-shaping",
    ARTIFACTS.nativeTextShaping,
    data.nativeTextShaping?.readyForGhosttyClaim === true &&
      artifactSelfFresh(ARTIFACTS.nativeTextShaping, data.nativeTextShaping)
      ? "pass"
      : artifactExternalBlocked(data.nativeTextShaping) &&
          artifactSelfFresh(ARTIFACTS.nativeTextShaping, data.nativeTextShaping)
        ? "external-blocked"
        : "block",
    nativeTextShapingReason(data.nativeTextShaping),
    {
      blockers: data.nativeTextShaping?.blockers ?? [],
      systemTextShapingReady: data.nativeTextShaping?.systemTextShapingReady ?? null,
      realFontFallbackReady: data.nativeTextShaping?.realFontFallbackReady ?? null,
      rendererTextShapingIntegrated: data.nativeTextShaping?.rendererTextShapingIntegrated ?? null,
      rendererFallbackGlyphRasterizationReady: data.nativeTextShaping?.rendererFallbackGlyphRasterizationReady ?? null,
      visualFallbackGlyphFixturesReady: data.nativeTextShaping?.visualFallbackGlyphFixturesReady ?? null,
      fresh: artifactSelfFresh(ARTIFACTS.nativeTextShaping, data.nativeTextShaping),
    },
  ),
  component(
    "native-daily-driver",
    ARTIFACTS.nativeDailyDriver,
    data.nativeDailyDriver?.ok === true && artifactSelfFresh(ARTIFACTS.nativeDailyDriver, data.nativeDailyDriver)
      ? "pass"
      : artifactExternalBlocked(data.nativeDailyDriver) && artifactSelfFresh(ARTIFACTS.nativeDailyDriver, data.nativeDailyDriver)
        ? "external-blocked"
        : "block",
    data.nativeDailyDriver?.ok === true
      ? "native daily-driver terminal proof is green"
      : artifactExternalBlocked(data.nativeDailyDriver)
        ? "native daily-driver terminal proof is externally blocked by host/operator proof gates"
        : "native daily-driver terminal proof is blocked",
    {
      blockers: data.nativeDailyDriver?.blockers ?? [],
      fresh: artifactSelfFresh(ARTIFACTS.nativeDailyDriver, data.nativeDailyDriver),
    },
  ),
  component(
    "native-visual-regression",
    ARTIFACTS.nativeVisualRegression,
    data.nativeVisualRegression?.ok === true &&
      artifactSelfFresh(ARTIFACTS.nativeVisualRegression, data.nativeVisualRegression)
      ? "pass"
      : artifactExternalBlocked(data.nativeVisualRegression) &&
          artifactSelfFresh(ARTIFACTS.nativeVisualRegression, data.nativeVisualRegression)
        ? "external-blocked"
        : "block",
    data.nativeVisualRegression?.ok === true
      ? "native visual regression proof is green"
      : artifactExternalBlocked(data.nativeVisualRegression)
        ? "native visual regression proof is externally blocked by host/operator proof gates"
        : "native visual regression proof is blocked",
    {
      blockers: data.nativeVisualRegression?.blockers ?? [],
      fresh: artifactSelfFresh(ARTIFACTS.nativeVisualRegression, data.nativeVisualRegression),
    },
  ),
]);

const releaseClaim = claim("release readiness", [
  component(
    "current-readiness-source",
    ARTIFACTS.currentReadiness,
    data.currentReadiness?.status === "pass"
      ? "pass"
      : releaseQualityOnlyExternalOrPolicyBlockers(data.releaseQuality, [tmuxClaim, bridgespaceClaim, ghosttyClaim])
        ? "external-blocked"
        : "block",
    data.currentReadiness?.status === "pass"
      ? "current readiness source is pass"
      : "current readiness source blocks world-class/release claims",
    { claimBlocks: data.currentReadiness?.claimBlocks ?? [] },
  ),
  component(
    "release-quality-score",
    ARTIFACTS.releaseQuality,
    data.releaseQuality?.releaseCandidateReady === true
      ? "pass"
      : releaseQualityOnlyExternalOrPolicyBlockers(data.releaseQuality, [tmuxClaim, bridgespaceClaim, ghosttyClaim])
        ? "external-blocked"
        : "block",
    data.releaseQuality?.releaseCandidateReady === true
      ? "release quality score is release-candidate ready"
      : "release quality score is not release-candidate ready",
    {
      score: data.releaseQuality?.score ?? null,
      max: data.releaseQuality?.max ?? null,
      grade: data.releaseQuality?.grade ?? null,
    },
  ),
  component(
    "anti-debt-claim-contract",
    ARTIFACTS.antiDebt,
    data.antiDebt?.ok === true ? "pass" : "block",
    data.antiDebt?.ok === true ? "anti-debt claim contract is green" : "anti-debt claim contract is missing or failing",
  ),
  component(
    "modularity-boundary",
    ARTIFACTS.modularity,
    data.modularity?.ok === true ? (data.modularity?.status === "pass-advisory-baseline" ? "review" : "pass") : "block",
    data.modularity?.ok === true
      ? "modularity boundary is green but still advisory until baseline is ratified"
      : "modularity boundary contract is missing or failing",
    { warnings: data.modularity?.warnings ?? [] },
  ),
]);

const claimDetails = {
  tmux: tmuxClaim,
  bridgespace: bridgespaceClaim,
  ghostty: ghosttyClaim,
  release: releaseClaim,
};
const claims = Object.fromEntries(Object.entries(claimDetails).map(([id, detail]) => [id, detail.status]));
const status = statusFromComponents(Object.values(claimDetails).map((detail) => ({ status: detail.status })));
const blockingReasons = Object.entries(claimDetails).flatMap(([id, detail]) =>
  detail.blockers.map((reason) => ({ claim: id, reason })),
);
const externalBlockingReasons = Object.entries(claimDetails).flatMap(([id, detail]) =>
  detail.externalBlockers.map((reason) => ({ claim: id, reason })),
);
const reviewReasons = Object.entries(claimDetails).flatMap(([id, detail]) =>
  detail.reviewItems.map((reason) => ({ claim: id, reason })),
);

const report = {
  schema: "aether.world-class-terminal-ai-os/v1",
  version: 1,
  ok: status === "pass",
  status,
  generatedAt: new Date().toISOString(),
  sourceCutoffMs,
  sourcePaths: SOURCE_PATHS,
  claims,
  claimDetails,
  blockingReasons,
  externalBlockingReasons,
  reviewReasons,
  artifacts: artifactList,
  checks: {
    artifactStatusFailHelperUsed: Object.values(data).some(artifactStatusFail),
    allClaimsPass: status === "pass",
    noGhosttyClaimWithoutSystemShaping:
      claims.ghostty !== "pass" || data.nativeTextShaping?.readyForGhosttyClaim === true,
    noGhosttyClaimWithStaleNativeArtifacts:
      claims.ghostty !== "pass" ||
      [
        ARTIFACTS.nativeBoundary,
        ARTIFACTS.nativeTextShaping,
        ARTIFACTS.nativeDailyDriver,
        ARTIFACTS.nativeVisualRegression,
      ].every((path) => artifactSelfFresh(path)),
    noWorldClassClaimWhileReleaseBlocked: claims.release === "pass" || status !== "pass",
  },
};

writeJsonAtomic(OUT, report);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  process.exitCode = 1;
}
