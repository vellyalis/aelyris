import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "requirements-spec-design-traceability.json");

const DOCS = {
  requirements: "docs/requirements.md",
  specsReadme: "docs/specs/README.md",
  traceability: "docs/specs/AETHER_REQUIREMENTS_SPEC_DESIGN_TRACEABILITY_2026-06-27.md",
  cockpitRequirements: "docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md",
  gapAudit: "docs/specs/AETHER_TMUX_BRIDGESPACE_GHOSTTY_GAP_AUDIT_2026-06-25.md",
  worldClassDesign: "docs/specs/AETHER_WORLD_CLASS_GAP_CLOSURE_IMPLEMENTATION_DESIGN_2026-06-25.md",
  handoff: "docs/specs/CODEX_HANDOFF.md",
};

const ARTIFACTS = {
  currentReadiness: ".codex-auto/quality/current-readiness-source.json",
  releaseQuality: ".codex-auto/quality/release-quality-score.json",
  worldClass: ".codex-auto/quality/world-class-terminal-ai-os.json",
  nativeTextShaping: ".codex-auto/quality/native-text-shaping-fallback.json",
  nativeDailyDriver: ".codex-auto/quality/native-daily-driver-terminal.json",
  nativeVisualRegression: ".codex-auto/quality/native-visual-regression.json",
  degradationRegister: ".codex-auto/quality/degradation-register.json",
};

const REQUIRED_TRACE_COMMANDS = [
  "verify:current-readiness-source",
  "verify:world-class-terminal-ai-os",
  "verify:quality-score",
  "verify:requirements-spec-design-traceability",
  "verify:native-text-shaping-fallback",
  "verify:native-daily-driver-terminal",
  "verify:native-visual-regression",
  "verify:mux-window-session-model",
  "verify:mux-tmux-grade-contract",
  "verify:mux-multiclient-attach",
  "verify:mux-fallback-blocker",
  "verify:mux-live-process-preservation",
  "verify:shared-brain-restart-replay",
  "verify:modularity-boundary",
];

const STALE_README_PHRASES = ["全て draft / docs only", "設計完了・実装未着手", "source code changes は含まない"];

function pathOf(path) {
  return join(ROOT, path);
}

function exists(path) {
  return existsSync(pathOf(path));
}

function source(path) {
  const full = pathOf(path);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

function readJson(path) {
  const full = pathOf(path);
  if (!existsSync(full)) return null;
  try {
    return JSON.parse(readFileSync(full, "utf8"));
  } catch {
    return null;
  }
}

function mtime(path) {
  const full = pathOf(path);
  return existsSync(full) ? statSync(full).mtimeMs : 0;
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

function includesAll(text, needles) {
  return needles.every((needle) => text.includes(needle));
}

function check(id, passed, detail, evidence = {}) {
  return {
    id,
    status: passed ? "passed" : "failed",
    detail,
    evidence,
  };
}

function artifactMeta(path, data) {
  return {
    path,
    exists: data !== null,
    mtimeMs: mtime(path),
    generatedAt: data?.generatedAt ?? null,
    ok: data?.ok ?? null,
    status: data?.status ?? null,
  };
}

const docs = Object.fromEntries(Object.entries(DOCS).map(([id, path]) => [id, source(path)]));
const artifacts = Object.fromEntries(Object.entries(ARTIFACTS).map(([id, path]) => [id, readJson(path)]));
const packageJson = source("package.json");

const releaseScoreText =
  artifacts.releaseQuality &&
  typeof artifacts.releaseQuality.total === "number" &&
  typeof artifacts.releaseQuality.max === "number"
    ? `${artifacts.releaseQuality.total}/${artifacts.releaseQuality.max}`
    : null;
const releasePercentText =
  artifacts.releaseQuality && typeof artifacts.releaseQuality.score === "number"
    ? `${artifacts.releaseQuality.score}/100`
    : null;
const releaseGrade = typeof artifacts.releaseQuality?.grade === "string" ? artifacts.releaseQuality.grade : null;
const worldClassClaims = artifacts.worldClass?.claims ?? {};
const blocksProductClaim = (value) => value === "block" || value === "external-blocked";
const worldClassAllBlocked =
  blocksProductClaim(worldClassClaims.tmux) &&
  blocksProductClaim(worldClassClaims.bridgespace) &&
  blocksProductClaim(worldClassClaims.ghostty) &&
  blocksProductClaim(worldClassClaims.release);
const currentReadinessBlocks = Array.isArray(artifacts.currentReadiness?.claimBlocks)
  ? artifacts.currentReadiness.claimBlocks
  : [];
const nativeTextShapingSubclaimReady =
  artifacts.nativeTextShaping?.readyForGhosttyClaim === true &&
  artifacts.nativeTextShaping?.visualFallbackGlyphFixturesReady === true;
const docsDistinguishNativeTextShapingSubclaim =
  docs.traceability.includes(
    "The native text-shaping, native-client, native-input, HWND paste, and native visual QA subclaims are current",
  ) &&
  docs.traceability.includes("full Ghostty/WezTerm quality remains blocked") &&
  docs.worldClassDesign.includes("text-shaping subclaim only") &&
  docs.worldClassDesign.includes("Ghostty/WezTerm parity remains BLOCKED");

const requiredDocPaths = Object.values(DOCS);
const missingDocs = requiredDocPaths.filter((path) => !exists(path));
const staleReadmePhrases = STALE_README_PHRASES.filter((phrase) => docs.specsReadme.includes(phrase));
const missingTraceCommands = REQUIRED_TRACE_COMMANDS.filter((command) => !docs.traceability.includes(command));
const packageScriptPresent =
  packageJson.includes('"verify:requirements-spec-design-traceability"') &&
  packageJson.includes("scripts/verify-requirements-spec-design-traceability.mjs");

const checks = [
  check(
    "required-documents-exist",
    missingDocs.length === 0,
    "all current requirements/spec/design authority documents exist",
    {
      missingDocs,
      docs: requiredDocPaths,
    },
  ),
  check(
    "requirements-entrypoint-linked",
    includesAll(docs.requirements, [
      "AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md",
      "AETHER_TMUX_BRIDGESPACE_GHOSTTY_GAP_AUDIT_2026-06-25.md",
      "AETHER_WORLD_CLASS_GAP_CLOSURE_IMPLEMENTATION_DESIGN_2026-06-25.md",
      "AETHER_REQUIREMENTS_SPEC_DESIGN_TRACEABILITY_2026-06-27.md",
      "verify:requirements-spec-design-traceability",
      "releaseCandidateReady=false",
    ]),
    "docs/requirements.md is the stable AGENTS entrypoint and points to active authority, claim policy, and doc gate",
  ),
  check(
    "specs-readme-current",
    includesAll(docs.specsReadme, [
      "../requirements.md",
      "AETHER_REQUIREMENTS_SPEC_DESIGN_TRACEABILITY_2026-06-27.md",
      "verify:requirements-spec-design-traceability",
      "古い未着手扱いのステータスではない",
    ]) && staleReadmePhrases.length === 0,
    "docs/specs/README.md no longer presents the project as docs-only or implementation-not-started",
    { staleReadmePhrases },
  ),
  check(
    "traceability-matrix-covers-claims",
    includesAll(docs.traceability, [
      "Requirement Trace Matrix",
      "tmux-grade mux",
      "BridgeSpace-plus AI team OS",
      "Ghostty/WezTerm-class quality",
      "Release readiness",
      "Modularity and implementation grain",
      "Fallbacks must not unlock product claims",
    ]),
    "traceability doc maps product claims and anti-debt policy to specs, design, verifiers, artifacts, and status",
  ),
  check(
    "traceability-verifier-coverage",
    missingTraceCommands.length === 0,
    "traceability doc names the active verifier commands for current truth, mux, BridgeSpace, Ghostty, release, and modularity",
    { missingTraceCommands },
  ),
  check(
    "world-class-design-doc-links-doc-gate",
    includesAll(docs.worldClassDesign, [
      "verify:world-class-terminal-ai-os",
      "verify:requirements-spec-design-traceability",
      "AETHER_REQUIREMENTS_SPEC_DESIGN_TRACEABILITY_2026-06-27.md",
      "Ghostty/WezTerm parity remains BLOCKED",
      "must not be softened to `review`",
    ]),
    "world-class implementation design links the aggregate gate and the doc traceability gate without softening blocked claims",
  ),
  check(
    "package-script-present",
    packageScriptPresent && exists("scripts/verify-requirements-spec-design-traceability.mjs"),
    "package.json exposes the requirements/spec/design traceability verifier",
  ),
  check(
    "current-artifacts-present",
    Object.values(artifacts).every((artifact) => artifact !== null),
    "current claim artifacts exist so docs can be checked against machine truth",
    {
      artifacts: Object.fromEntries(
        Object.entries(ARTIFACTS).map(([id, path]) => [id, artifactMeta(path, artifacts[id])]),
      ),
    },
  ),
  check(
    "machine-truth-blocks-overclaim",
    artifacts.currentReadiness?.status === "block" &&
      artifacts.releaseQuality?.releaseCandidateReady === false &&
      blocksProductClaim(artifacts.worldClass?.status) &&
      worldClassAllBlocked,
    "current artifacts block tmux/BridgeSpace/Ghostty/release overclaims instead of allowing stale green evidence",
    {
      currentReadinessStatus: artifacts.currentReadiness?.status ?? null,
      releaseCandidateReady: artifacts.releaseQuality?.releaseCandidateReady ?? null,
      worldClassStatus: artifacts.worldClass?.status ?? null,
      worldClassClaims,
      nativeTextShapingSubclaimReady,
      readyForGhosttyTextShapingSubclaim: artifacts.nativeTextShaping?.readyForGhosttyClaim ?? null,
    },
  ),
  check(
    "current-readiness-includes-doc-trace",
    Array.isArray(artifacts.currentReadiness?.authoritativeSources) &&
      artifacts.currentReadiness.authoritativeSources.includes("requirements-spec-design-traceability") &&
      artifacts.currentReadiness?.artifacts?.requirementsTrace?.exists === true,
    "current-readiness-source lists the requirements/spec/design trace artifact as an authoritative source",
    {
      authoritativeSources: artifacts.currentReadiness?.authoritativeSources ?? [],
      requirementsTrace: artifacts.currentReadiness?.artifacts?.requirementsTrace ?? null,
    },
  ),
  check(
    "docs-match-release-score",
    releaseScoreText !== null &&
      releasePercentText !== null &&
      releaseGrade !== null &&
      docs.requirements.includes(releaseGrade) &&
      docs.traceability.includes(releaseScoreText) &&
      docs.traceability.includes(releasePercentText) &&
      docs.traceability.includes("releaseCandidateReady=false"),
    "docs record the current release score and blocked release-candidate status",
    {
      releaseScoreText,
      releasePercentText,
      releaseGrade,
      releaseCandidateReady: artifacts.releaseQuality?.releaseCandidateReady ?? null,
    },
  ),
  check(
    "docs-match-claim-blocks",
    ["tmux", "bridgespace", "ghostty", "release"].every((claim) => currentReadinessBlocks.includes(claim)) &&
      docs.requirements.includes("tmux-equivalent") &&
      docs.requirements.includes("BridgeSpace-plus complete") &&
      docs.requirements.includes("Ghostty-class") &&
      docsDistinguishNativeTextShapingSubclaim,
    "docs keep all currently blocked claims explicit and distinguish honest boundary work from completed parity",
    { currentReadinessBlocks, nativeTextShapingSubclaimReady },
  ),
  check(
    "degradation-register-has-native-text-shaping-debt",
    nativeTextShapingSubclaimReady ||
      (Array.isArray(artifacts.degradationRegister?.records) ? artifacts.degradationRegister.records : []).some(
        (item) =>
          (item?.id === "native-fallback-glyph-rasterization-deferred" ||
            item?.id === "native-fallback-glyph-visual-fixtures-deferred" ||
            item?.id === "native-directwrite-font-fallback-mapping-deferred" ||
            item?.id === "native-renderer-text-shaping-integration-deferred") &&
          item?.removalGate === "verify:native-text-shaping-fallback" &&
          Array.isArray(item?.claimBlocks) &&
          item.claimBlocks.includes("ghostty"),
      ),
    "degradation register records deferred native text-shaping debt when incomplete, or the native text-shaping subclaim is ready",
  ),
];

const failed = checks.filter((item) => item.status !== "passed");
const sourcePaths = [
  "package.json",
  "scripts/verify-requirements-spec-design-traceability.mjs",
  ...requiredDocPaths,
  ...Object.values(ARTIFACTS),
];
const report = {
  schema: "aether.requirements-spec-design-traceability/v1",
  version: 1,
  ok: failed.length === 0,
  status: failed.length === 0 ? "pass-doc-traceability-current" : "fail-doc-traceability",
  generatedAt: new Date().toISOString(),
  sourceCutoffMs: Math.max(...sourcePaths.map(mtime)),
  sourcePaths,
  productClaims: {
    currentReadinessStatus: artifacts.currentReadiness?.status ?? null,
    releaseCandidateReady: artifacts.releaseQuality?.releaseCandidateReady ?? null,
    releaseScore: releaseScoreText,
    releasePercent: releasePercentText,
    releaseGrade,
    worldClassStatus: artifacts.worldClass?.status ?? null,
    worldClassClaims,
    readyForGhosttyTextShapingSubclaim: artifacts.nativeTextShaping?.readyForGhosttyClaim ?? null,
  },
  claimStatus: worldClassAllBlocked ? "blocked-by-product-gates" : "review-current-artifacts",
  summary:
    failed.length === 0
      ? "requirements/spec/design docs are connected to current gates; product claims remain blocked by machine truth"
      : `${failed.length} requirements/spec/design traceability checks failed`,
  checks,
};

writeJsonAtomic(OUT, report);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  process.exitCode = 1;
}
