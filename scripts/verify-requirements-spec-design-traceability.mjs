import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "requirements-spec-design-traceability.json");

const DOCS = {
  agents: "AGENTS.md",
  architecture: "ARCHITECTURE.md",
  decisions: "DECISIONS.md",
  auditWorkOrder: "audit-remediation-instructions.md",
  publicationReadiness: "docs/PUBLICATION_READINESS.md",
  requirements: "docs/requirements.md",
  specsReadme: "docs/specs/README.md",
  agentMessage: "docs/specs/AELYRIS_AGENT_MESSAGE_BUS_SUPERSET_SPEC.md",
  visiblePane: "docs/specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md",
  cockpitUx: "docs/specs/COCKPIT_UX_SPEC.md",
  mcpToolSurface: "docs/specs/MCP_TOOL_SURFACE_SPEC.md",
  workOsSpec: "docs/specs/AELYRIS_VERIFIABLE_AGENT_WORK_OS_SPEC.md",
  workOsDesign: "docs/specs/AELYRIS_VERIFIABLE_AGENT_WORK_OS_DETAILED_DESIGN.md",
  workOsRoadmap: "docs/specs/AELYRIS_VERIFIABLE_AGENT_WORK_OS_ROADMAP_2026-07-13.md",
  controlApiMcp: "docs/specs/AELYRIS_CONTROL_API_MCP_ULTRA_DESIGN.md",
  planner: "docs/specs/PLANNER_SPEC.md",
  typeBridge: "docs/specs/TYPE_BRIDGE_SPEC.md",
  uiTokenDial: "docs/specs/UI_TOKEN_DIAL_SPEC.md",
  nativePackageReadme: "docs/plans/full-native-rust-migration/README.md",
  nativeIntegration: "docs/plans/full-native-rust-migration/INTEGRATION.md",
  nativeWorkOrder: "docs/plans/full-native-rust-migration/native-ui-migration-instructions.md",
  nativeAdrDraft: "docs/plans/full-native-rust-migration/ADR-014_FULL_NATIVE_RUST_PRODUCT_SURFACE_DRAFT.md",
  nativeMasterPlan: "docs/specs/AELYRIS_FULL_NATIVE_RUST_MIGRATION_MASTER_PLAN.md",
  nativeRequirements: "docs/requirements/AELYRIS_NATIVE_UI_REQUIREMENTS.md",
  nativeArchitecture: "docs/specs/AELYRIS_NATIVE_UI_ARCHITECTURE.md",
  nativeFramework: "docs/specs/AELYRIS_NATIVE_UI_FRAMEWORK_SPEC.md",
  nativeEditor: "docs/specs/AELYRIS_NATIVE_EDITOR_SPEC.md",
  nativeRoadmap: "docs/specs/AELYRIS_NATIVE_UI_MIGRATION_ROADMAP.md",
  nativeVerification: "docs/specs/AELYRIS_NATIVE_UI_VERIFICATION_PLAN.md",
  nativeTraceability: "docs/specs/AELYRIS_NATIVE_UI_TRACEABILITY.md",
};

const ARTIFACTS = {
  currentReadiness: ".codex-auto/quality/current-readiness-source.json",
  releaseQuality: ".codex-auto/quality/release-quality-score.json",
  releaseReadiness: ".codex-auto/quality/release-readiness-aggregate.json",
  nativeTextShaping: ".codex-auto/quality/native-text-shaping-fallback.json",
  nativePrimaryTerminal: ".codex-auto/quality/native-operator-primary-terminal.json",
  nativeVisualRegression: ".codex-auto/quality/native-visual-regression.json",
  degradationRegister: ".codex-auto/quality/degradation-register.json",
};

const REQUIRED_TRACE_COMMANDS = [
  "verify:current-readiness-source",
  "verify:quality-score",
  "verify:goal:safe",
  "verify:requirements-spec-design-traceability",
  "verify:verifiable-agent-work-os-spec",
  "verify:native-ui:design-package",
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

function normalizeText(text) {
  return text.replace(/\s+/g, " ");
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
const normalizedDocs = Object.fromEntries(Object.entries(docs).map(([id, text]) => [id, normalizeText(text)]));
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
const releaseReadinessClaims = artifacts.releaseReadiness?.claims ?? {};
const blocksProductClaim = (value) => value === "block" || value === "review" || value === "external-blocked";
const productClaimGatesAllBlocked =
  blocksProductClaim(releaseReadinessClaims.tmux) &&
  blocksProductClaim(releaseReadinessClaims.sharedWorkspace) &&
  blocksProductClaim(releaseReadinessClaims.nativeTerminal) &&
  blocksProductClaim(releaseReadinessClaims.release);
const currentReadinessBlocks = Array.isArray(artifacts.currentReadiness?.claimBlocks)
  ? artifacts.currentReadiness.claimBlocks
  : [];
const nativeTextShapingSubclaimReady =
  artifacts.nativeTextShaping?.readyForNativeShapingClaim === true &&
  artifacts.nativeTextShaping?.visualFallbackGlyphFixturesReady === true;
const docsKeepCurrentClaimPolicy =
  normalizedDocs.agents.includes("alpha / active development / not release-ready") &&
  normalizedDocs.requirements.includes("does not claim production readiness") &&
  normalizedDocs.requirements.includes("capability claims are gated by verifiers") &&
  normalizedDocs.publicationReadiness.includes("not release-ready") &&
  normalizedDocs.specsReadme.includes("Aelyris is alpha and does not claim production readiness");

const requiredDocPaths = Object.values(DOCS);
const missingDocs = requiredDocPaths.filter((path) => !exists(path));
const staleReadmePhrases = STALE_README_PHRASES.filter((phrase) => docs.specsReadme.includes(phrase));
const publicTraceText = [
  normalizedDocs.agents,
  normalizedDocs.requirements,
  normalizedDocs.specsReadme,
  normalizedDocs.publicationReadiness,
].join("\n");
const missingTraceCommands = REQUIRED_TRACE_COMMANDS.filter((command) => !publicTraceText.includes(command));
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
    includesAll(normalizedDocs.requirements, [
      "docs/specs/README.md",
      "AELYRIS_AGENT_MESSAGE_BUS_SUPERSET_SPEC.md",
      "VISIBLE_AGENT_PANE_RUNTIME_SPEC.md",
      "does not claim production readiness",
      "capability claims are gated by verifiers",
      "pnpm verify:quality-score",
      "pnpm verify:goal:safe",
      "pnpm verify:current-readiness-source",
    ]),
    "docs/requirements.md is the stable AGENTS entrypoint and points to the current public spec index, claim policy, and machine-truth gates",
  ),
  check(
    "specs-readme-current",
    includesAll(normalizedDocs.specsReadme, [
      "../requirements.md",
      "AELYRIS_AGENT_MESSAGE_BUS_SUPERSET_SPEC.md",
      "VISIBLE_AGENT_PANE_RUNTIME_SPEC.md",
      "PHASE_0_1_ARCHITECTURE_SPEC.md",
      "pnpm verify:quality-score",
      "pnpm verify:goal:safe",
      "古い未着手扱いのステータスではない",
    ]) && staleReadmePhrases.length === 0,
    "docs/specs/README.md indexes current public specs and no longer presents the project as docs-only or implementation-not-started",
    { staleReadmePhrases },
  ),
  check(
    "public-spec-index-covers-current-authority",
    includesAll(docs.specsReadme, [
      "Aelyris Control API",
      "Qralis MCP/control surface",
      "AELYRIS_AGENT_MESSAGE_BUS_SUPERSET_SPEC.md",
      "VISIBLE_AGENT_PANE_RUNTIME_SPEC.md",
      "COCKPIT_UX_SPEC.md",
      "MCP_TOOL_SURFACE_SPEC.md",
      "AELYRIS_VERIFIABLE_AGENT_WORK_OS_SPEC.md",
      "AELYRIS_CONTROL_API_MCP_ULTRA_DESIGN.md",
      "TYPE_BRIDGE_SPEC.md",
      "PLANNER_SPEC.md",
    ]),
    "public spec index maps the current requirements/spec/design authority without relying on removed internal audit docs",
  ),
  check(
    "native-ui-package-queued-traceability",
    includesAll(docs.specsReadme, [
      "AELYRIS_FULL_NATIVE_RUST_MIGRATION_MASTER_PLAN.md",
      "AELYRIS_NATIVE_UI_REQUIREMENTS.md",
      "A8.1",
      "priority 1",
      "verify:native-ui:design-package",
    ]) &&
      includesAll(normalizedDocs.requirements, [
        "AELYRIS_NATIVE_UI_REQUIREMENTS.md",
        "A8.0 accepted N4 with amendments",
        "priority 1 after A9",
        "NUI-F0-F7",
      ]) &&
      includesAll(normalizedDocs.decisions, [
        "ADR-014 Full-Native Rust Product Surface",
        "Status: **accepted with amendments / queued for post-A9 activation**",
        "preserve the measured A8 then A9 execution order",
        "NUI-F0 must compare Slint",
      ]) &&
      includesAll(normalizedDocs.auditWorkOrder, [
        "ACTIVE SLICE:",
        "NEXT IMPLEMENTATION SLICE:",
        "NEXT PHASE:",
        "A8.1",
        "measured native terminal evidence and disposition",
        "exact current slice is owned only by this root work order",
      ]) &&
      includesAll(normalizedDocs.nativeWorkOrder, [
        "STATUS: QUEUED_HIGH_PRIORITY",
        "DECISION: ADR-014 accepted with amendments at A8.0",
        "priority 1 after A9",
        "Pre-A9 takeover was not authorized",
      ]) &&
      includesAll(normalizedDocs.nativeArchitecture, [
        "target contracts, not implemented owners",
        "second durable event stream",
        "existing persistence/migration",
        "A9's single trust",
      ]) &&
      includesAll(normalizedDocs.nativeTraceability, [
        "Activation blocker",
        "every concrete `NUI-*` requirement ID",
        "no wildcard-only coverage",
      ]),
    "the accepted-with-amendments full-native Rust package is queued post-A9 without duplicating A8.1 or changing current claims",
  ),
  check(
    "work-os-authority-composition",
    includesAll(docs.workOsSpec, [
      "Four-Layer Differentiation Audit",
      "Aelyris-Owned Higher-Order Concepts",
      "MissionCompletionPacket",
      "FR-18 Canonical Control API And MCP Adapter",
      "Current Aelyris remains alpha and not release-ready",
    ]) &&
      includesAll(docs.workOsDesign, [
        "Canonical Control API And MCP Boundary",
        "MissionCompletionPacket",
        "R0-A6 historical phase evidence",
        "Apex capabilities are post-release product waves",
      ]) &&
      includesAll(docs.workOsRoadmap, [
        "R0-A9 remains Wave 0",
        "This stable roadmap does not copy the exact current phase or slice",
        "The durable A6 resume slice is `A6.2e1`",
        "Canonical Core Mission Combined Acceptance",
        "A8.1 And A9 Remain Release Gates; A8.0 Decision Is Complete",
      ]) &&
      includesAll(docs.controlApiMcp, [
        "Current Audit Findings At HEAD `3db3932`",
        "Canonical Command Registry",
        "Command Lifecycle And Atomicity",
        "MCP-Specific Contract",
        "Migration And Rollback",
        "Verification Matrix",
      ]),
    "Work OS requirements, detailed design, roadmap, and ultra Control API/MCP authority are linked without replacing R0-A9 or current claims",
  ),
  check(
    "traceability-verifier-coverage",
    missingTraceCommands.length === 0,
    "public docs name the active verifier commands for current machine truth and this traceability gate",
    { missingTraceCommands },
  ),
  check(
    "public-claim-policy-blocks-overclaim",
    docsKeepCurrentClaimPolicy &&
      docs.agentMessage.includes("Current verdict: **BLOCK for strict agmsg superset claims**"),
    "public docs keep alpha/not-release-ready and blocked coordination claims explicit without restoring removed competitor-class claims",
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
      blocksProductClaim(artifacts.releaseReadiness?.status) &&
      productClaimGatesAllBlocked,
    "current artifacts block or review-gate tmux/shared-agent-workspace/native-terminal/release overclaims instead of allowing stale green evidence",
    {
      currentReadinessStatus: artifacts.currentReadiness?.status ?? null,
      releaseCandidateReady: artifacts.releaseQuality?.releaseCandidateReady ?? null,
      releaseReadinessStatus: artifacts.releaseReadiness?.status ?? null,
      releaseReadinessClaims,
      nativeTextShapingSubclaimReady,
      readyForNativeShapingTextShapingSubclaim: artifacts.nativeTextShaping?.readyForNativeShapingClaim ?? null,
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
    "docs-point-to-current-machine-truth",
    releaseScoreText !== null &&
      releasePercentText !== null &&
      releaseGrade !== null &&
      artifacts.releaseQuality?.releaseCandidateReady === false &&
      normalizedDocs.requirements.includes("read the freshly generated artifacts") &&
      normalizedDocs.requirements.includes("override stale prose") &&
      normalizedDocs.publicationReadiness.includes("Aelyris can be published as an alpha / experimental project") &&
      normalizedDocs.publicationReadiness.includes("does not claim production readiness"),
    "public docs avoid stale fixed-score claims and point readers to current generated machine truth",
    {
      releaseScoreText,
      releasePercentText,
      releaseGrade,
      releaseCandidateReady: artifacts.releaseQuality?.releaseCandidateReady ?? null,
    },
  ),
  check(
    "docs-match-claim-blocks",
    ["tmux", "sharedWorkspace", "nativeTerminal", "release"].every((claim) => currentReadinessBlocks.includes(claim)) &&
      docsKeepCurrentClaimPolicy &&
      normalizedDocs.agentMessage.includes(
        "strict `agmsg` superset behavior until the gates in this document are green",
      ),
    "docs keep current claim blocks explicit and distinguish honest substrate work from completed parity",
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
          item.claimBlocks.includes("nativeTerminal"),
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
  schema: "aelyris.requirements-spec-design-traceability/v1",
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
    releaseReadinessStatus: artifacts.releaseReadiness?.status ?? null,
    releaseReadinessClaims,
    readyForNativeShapingTextShapingSubclaim: artifacts.nativeTextShaping?.readyForNativeShapingClaim ?? null,
  },
  claimStatus: productClaimGatesAllBlocked ? "blocked-by-product-gates" : "review-current-artifacts",
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
