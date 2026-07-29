import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const PACKAGE_DIR = "docs/plans/full-native-rust-migration";
const SOURCE_TREE = `${PACKAGE_DIR}/source`;
const OUT = join(ROOT, ".codex-auto", "quality", "native-ui-design-package.json");
const SOURCE_ARCHIVE_SHA256 =
  "9024b28dc2cc6c78d6e1d9cd1e244b9b025bb8bd1cb80f406d4c13f4698f73cf";

const CANONICAL_DOCUMENTS = [
  `${PACKAGE_DIR}/README.md`,
  `${PACKAGE_DIR}/INTEGRATION.md`,
  `${PACKAGE_DIR}/native-ui-migration-instructions.md`,
  `${PACKAGE_DIR}/ADR-014_FULL_NATIVE_RUST_PRODUCT_SURFACE_DRAFT.md`,
  "docs/specs/AELYRIS_FULL_NATIVE_RUST_MIGRATION_MASTER_PLAN.md",
  "docs/requirements/AELYRIS_NATIVE_UI_REQUIREMENTS.md",
  "docs/specs/AELYRIS_NATIVE_UI_ARCHITECTURE.md",
  "docs/specs/AELYRIS_NATIVE_UI_FRAMEWORK_SPEC.md",
  "docs/specs/AELYRIS_NATIVE_EDITOR_SPEC.md",
  "docs/specs/AELYRIS_NATIVE_UI_MIGRATION_ROADMAP.md",
  "docs/specs/AELYRIS_NATIVE_UI_VERIFICATION_PLAN.md",
  "docs/specs/AELYRIS_NATIVE_UI_TRACEABILITY.md",
];

const ROUTING_DOCUMENTS = [
  "AGENTS.md",
  "AI_GUIDE.md",
  "ARCHITECTURE.md",
  "DECISIONS.md",
  "audit-remediation-instructions.md",
  "docs/requirements.md",
  "docs/specs/README.md",
  "docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md",
  "docs/specs/AELYRIS_VERIFIABLE_AGENT_WORK_OS_ROADMAP_2026-07-13.md",
];

const SUPPORTING_PATHS = [
  "package.json",
  `${PACKAGE_DIR}/source-manifest.json`,
  `${SOURCE_TREE}/manifest.json`,
  `${PACKAGE_DIR}/manifest.json`,
  ".codex-auto/quality/native-coverage-gap-audit.json",
  ...CANONICAL_DOCUMENTS,
  ...ROUTING_DOCUMENTS,
];

function pathOf(path) {
  return join(ROOT, path);
}

function exists(path) {
  return existsSync(pathOf(path));
}

function source(path) {
  return exists(path) ? readFileSync(pathOf(path), "utf8") : "";
}

function readJson(path) {
  try {
    return JSON.parse(source(path));
  } catch {
    return null;
  }
}

function mtime(path) {
  return exists(path) ? statSync(pathOf(path)).mtimeMs : 0;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(pathOf(path))).digest("hex");
}

function includesAll(text, needles) {
  return needles.every((needle) => text.includes(needle));
}

function normalizeText(text) {
  return text.replace(/\s+/g, " ");
}

function backtickField(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp(`^${escaped}:\\s*\\x60([^\\x60]+)\\x60`, "m"))?.[1] ?? null;
}

function check(id, passed, detail, evidence = {}) {
  return {
    id,
    status: passed ? "passed" : "failed",
    detail,
    evidence,
  };
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

function localMarkdownLinkFailures(path) {
  if (extname(path).toLowerCase() !== ".md") return [];
  const text = source(path);
  const failures = [];
  const pattern = /\[[^\]]*]\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const rawTarget = match[1].trim();
    if (
      rawTarget === "" ||
      rawTarget.startsWith("#") ||
      /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)
    ) {
      continue;
    }
    const withoutAnchor = rawTarget.split("#", 1)[0];
    if (withoutAnchor === "") continue;
    let decoded;
    try {
      decoded = decodeURIComponent(withoutAnchor);
    } catch {
      decoded = withoutAnchor;
    }
    const resolved = resolve(dirname(pathOf(path)), decoded);
    const rel = relative(ROOT, resolved).replaceAll("\\", "/");
    if (rel.startsWith("../") || rel === ".." || !existsSync(resolved)) {
      failures.push({ source: path, target: rawTarget, resolved: rel });
    }
  }
  return failures;
}

const texts = Object.fromEntries(
  [...CANONICAL_DOCUMENTS, ...ROUTING_DOCUMENTS].map((path) => [path, source(path)]),
);
const packageJson = readJson("package.json");
const sourceManifest = readJson(`${PACKAGE_DIR}/source-manifest.json`);
const canonicalManifest = readJson(`${PACKAGE_DIR}/manifest.json`);
const nativeCoverage = readJson(".codex-auto/quality/native-coverage-gap-audit.json");

const missingPaths = SUPPORTING_PATHS.filter((path) => !exists(path));
const sourceManifestDocuments = Array.isArray(sourceManifest?.documents)
  ? sourceManifest.documents
  : [];
const sourceDocumentPath = (path) => {
  if (
    typeof path !== "string" ||
    path.startsWith("/") ||
    /^[a-z]:/i.test(path) ||
    path.split(/[\\/]/).includes("..")
  ) {
    return null;
  }
  return `${SOURCE_TREE}/${path.replaceAll("\\", "/")}`;
};
const rawSourcePaths = sourceManifestDocuments
  .map((item) => sourceDocumentPath(item?.path))
  .filter((path) => path !== null);
const sourceTreeFailures = sourceManifestDocuments.flatMap((item) => {
  const rawPath = sourceDocumentPath(item?.path);
  if (!rawPath || !exists(rawPath)) {
    return [{ path: item?.path ?? null, reason: "invalid or missing byte-identical source path" }];
  }
  const bytes = statSync(pathOf(rawPath)).size;
  const digest = sha256(rawPath);
  return item.bytes === bytes && item.sha256 === digest
    ? []
    : [
        {
          path: item.path,
          reason: "source hash or byte count mismatch",
          expectedBytes: item.bytes ?? null,
          actualBytes: bytes,
          expectedSha256: item.sha256 ?? null,
          actualSha256: digest,
        },
      ];
});
const sourceManifestMirrorMatches =
  exists(`${PACKAGE_DIR}/source-manifest.json`) &&
  exists(`${SOURCE_TREE}/manifest.json`) &&
  sha256(`${PACKAGE_DIR}/source-manifest.json`) === sha256(`${SOURCE_TREE}/manifest.json`);
const canonicalManifestDocuments = Array.isArray(canonicalManifest?.documents)
  ? canonicalManifest.documents
  : [];
const canonicalByPath = new Map(canonicalManifestDocuments.map((item) => [item?.path, item]));
const manifestFailures = CANONICAL_DOCUMENTS.flatMap((path) => {
  const item = canonicalByPath.get(path);
  if (!item || !exists(path)) return [{ path, reason: "missing manifest entry or file" }];
  const bytes = statSync(pathOf(path)).size;
  const digest = sha256(path);
  return item.bytes === bytes && item.sha256 === digest
    ? []
    : [
        {
          path,
          reason: "canonical hash or byte count mismatch",
          expectedBytes: item.bytes ?? null,
          actualBytes: bytes,
          expectedSha256: item.sha256 ?? null,
          actualSha256: digest,
        },
      ];
});
const unexpectedManifestPaths = canonicalManifestDocuments
  .map((item) => item?.path)
  .filter((path) => typeof path !== "string" || !CANONICAL_DOCUMENTS.includes(path));
const linkFailures = [...CANONICAL_DOCUMENTS, ...ROUTING_DOCUMENTS].flatMap(
  localMarkdownLinkFailures,
);

const workOrder = texts["audit-remediation-instructions.md"];
const currentExecution = {
  program: backtickField(workOrder, "PROGRAM"),
  phase: backtickField(workOrder, "CURRENT PHASE"),
  activeSlice: backtickField(workOrder, "ACTIVE SLICE"),
  lastCompletedSlice: backtickField(workOrder, "LAST COMPLETED SLICE"),
  nextImplementationSlice: backtickField(workOrder, "NEXT IMPLEMENTATION SLICE"),
  resumePhase: backtickField(workOrder, "NEXT PHASE"),
  resumeSlice: workOrder.match(/\bresume at (A\d+(?:\.\d+\w*)?)\b/)?.[1] ?? null,
};
const trackedPlan =
  texts["docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md"];
const workOsRoadmap =
  texts["docs/specs/AELYRIS_VERIFIABLE_AGENT_WORK_OS_ROADMAP_2026-07-13.md"];
const queuedWorkOrder =
  texts[`${PACKAGE_DIR}/native-ui-migration-instructions.md`];
const decisions = texts["DECISIONS.md"];
const adrDraft =
  texts[`${PACKAGE_DIR}/ADR-014_FULL_NATIVE_RUST_PRODUCT_SURFACE_DRAFT.md`];
const architecture = texts["ARCHITECTURE.md"];
const nativeArchitecture = texts["docs/specs/AELYRIS_NATIVE_UI_ARCHITECTURE.md"];
const nativeFramework = texts["docs/specs/AELYRIS_NATIVE_UI_FRAMEWORK_SPEC.md"];
const nativeRoadmap = texts["docs/specs/AELYRIS_NATIVE_UI_MIGRATION_ROADMAP.md"];
const nativeVerification = texts["docs/specs/AELYRIS_NATIVE_UI_VERIFICATION_PLAN.md"];
const nativeTraceability = texts["docs/specs/AELYRIS_NATIVE_UI_TRACEABILITY.md"];

const checks = [
  check("required-files-exist", missingPaths.length === 0, "all canonical and routing files exist", {
    missingPaths,
  }),
  check(
    "source-package-integrity-recorded",
    sourceManifest?.schema === "aelyris.native-ui-design-package.v1" &&
      sourceManifest?.status === "proposal" &&
      sourceManifestDocuments.length === 11 &&
      rawSourcePaths.length === sourceManifestDocuments.length &&
      sourceManifestDocuments.every(
        (item) =>
          typeof item?.path === "string" &&
          Number.isInteger(item?.bytes) &&
          /^[a-f0-9]{64}$/.test(item?.sha256 ?? ""),
      ) &&
      sourceTreeFailures.length === 0 &&
      sourceManifestMirrorMatches &&
      source(`${PACKAGE_DIR}/INTEGRATION.md`).includes(SOURCE_ARCHIVE_SHA256),
    "the complete byte-identical source tree, immutable manifest, and verified ZIP SHA-256 are preserved separately",
    {
      schema: sourceManifest?.schema ?? null,
      documentCount: sourceManifestDocuments.length,
      sourceArchiveSha256: SOURCE_ARCHIVE_SHA256,
      sourceManifestMirrorMatches,
      sourceTreeFailures,
    },
  ),
  check(
    "canonical-manifest-current",
    canonicalManifest?.schema === "aelyris.native-ui-design-package.integration.v1" &&
      canonicalManifest?.sourceArchiveSha256 === SOURCE_ARCHIVE_SHA256 &&
      canonicalManifest?.status === "queued_high_priority_proposal" &&
      canonicalManifestDocuments.length === CANONICAL_DOCUMENTS.length &&
      manifestFailures.length === 0 &&
      unexpectedManifestPaths.length === 0,
    "adapted canonical documents have exact byte counts and SHA-256 values",
    { manifestFailures, unexpectedManifestPaths },
  ),
  check(
    "queued-not-active-routing",
    includesAll(queuedWorkOrder, [
      "STATUS: QUEUED_HIGH_PRIORITY",
      "priority 1 after A9",
      "CURRENT EXECUTION OWNER: root `audit-remediation-instructions.md`",
      "read its exact",
      "explicit owner decision",
      "A6.6 already owns",
    ]) &&
      !exists("native-ui-migration-instructions.md") &&
      includesAll(workOrder, [
        "CURRENT PHASE: `A4`",
        "ACTIVE SLICE:",
        "NEXT IMPLEMENTATION SLICE:",
        "NEXT PHASE: `A6`",
        "resume at A6.2e1",
        "A8.0",
        "measured terminal-only native spike",
      ]) &&
      Object.values(currentExecution).every(Boolean) &&
      currentExecution.activeSlice === currentExecution.nextImplementationSlice &&
      canonicalManifest?.currentExecutionOwner === "audit-remediation-instructions.md" &&
      includesAll(trackedPlan, [
        "After it passes, resume the already",
        "frozen A6 frontier at A6.2e1",
        "A8.0 - Native Product Goal And Architecture Decision Gate",
        "## A8 - Measured Native Terminal Spike",
      ]),
    "the imported package is priority-1 queued after A9, reads the active frontier from its owner, and does not rewrite A6.2e1 or measured A8",
    { currentExecution },
  ),
  check(
    "unique-proposed-adr-owner",
    includesAll(normalizeText(decisions), [
      "## ADR-013 External Team Patterns Extend Existing Owners",
      "## ADR-014 Full-Native Rust Product Surface",
      "Status: **proposed / queued**",
      "does not yet supersede ADR-001",
      "priority 1 after A9",
    ]) &&
      normalizeText(
        source(`${PACKAGE_DIR}/ADR-014_FULL_NATIVE_RUST_PRODUCT_SURFACE_DRAFT.md`),
      ).includes(
        "canonical decision owner is",
      ) &&
      !exists("docs/adr/ADR-014_FULL_NATIVE_RUST_PRODUCT_SURFACE_DRAFT.md"),
    "DECISIONS.md uniquely owns proposed ADR-014 while the package keeps subordinate detail",
  ),
  check(
    "portfolio-order-and-adr-lifecycle",
    includesAll(normalizeText(trackedPlan), [
      "accepts ADR-014 as written or with amendments",
      "NUI-F0-F7 is the priority-1 program",
      "runs before these Apex waves",
      "If A8.0 defers or rejects ADR-014, the Apex sequence starts directly",
    ]) &&
      includesAll(normalizeText(workOsRoadmap), [
        "accepts ADR-014 as written or with amendments",
        "NUI-F0-F7 is the first post-A9 portfolio program",
        "If A8.0 defers or rejects ADR-014, Apex V1 begins directly",
      ]) &&
      includesAll(normalizeText(decisions), [
        "accepted-as-written, accepted-with-amendments, deferred, or rejected",
        "Both accepted results enter the same activation branch",
        "NUI-0.1 may only ratify that already accepted decision",
      ]) &&
      includesAll(normalizeText(nativeRoadmap), [
        "NUI-0.1 — Ratify accepted ADR-014 for activation",
        "accepted-as-written or accepted-with-amendments",
        "both accepted results enter this branch",
        "deferred or rejected decisions cannot enter NUI-F0",
        "without reopening the architecture choice",
      ]) &&
      includesAll(normalizeText(adrDraft), [
        "accept-as-written/accept-with-amendments/defer/reject",
        "both accepted results enter one branch",
        "Would supersede if accepted: ADR-001",
        "Would also supersede if accepted",
      ]) &&
      !nativeRoadmap.includes("accept, amend, or reject proposed ADR-014") &&
      !/^\s*Supersedes:/m.test(adrDraft),
    "A8.0 uniquely owns the ADR decision and an accepted NUI program precedes Apex after A9",
  ),
  check(
    "architecture-and-complexity-guards",
    includesAll(normalizeText(architecture), [
      "Queued Full-Native Rust Target",
      "not the current placement authority",
      "ProjectionHub",
      "not authorization for a second durable stream",
    ]) &&
      includesAll(normalizeText(nativeArchitecture), [
        "target contracts, not implemented owners",
        "second durable event stream",
        "existing persistence/migration",
        "A9's single trust",
        "current hybrid",
        "mature Rust UI framework",
      ]) &&
      includesAll(normalizeText(nativeFramework), [
        "Activation prerequisite",
        "current hybrid",
        "mature Rust UI framework",
        "not an authorized new framework dependency surface",
      ]),
    "target-only names map to existing owners and custom-framework complexity has an alternatives gate",
  ),
  check(
    "claim-and-baseline-guards",
    includesAll(nativeVerification, [
      "schema v2 only after its",
      "historical v1",
      "never promotion evidence",
      "`shippingShellReady=false` remains",
    ]) &&
      nativeCoverage?.schema === "aelyris.native-coverage-gap/v2" &&
      nativeCoverage?.fullNativeReady === undefined &&
      nativeCoverage?.percent === undefined &&
      includesAll(source(`${PACKAGE_DIR}/INTEGRATION.md`), [
        "explicitly stale",
        "`shippingShellReady=false`",
        "cannot",
        "A8.0/NUI-0.3 must regenerate",
      ]),
    "only native coverage v2 is admissible and the observed stale snapshot cannot promote claims",
    {
      artifactSchema: nativeCoverage?.schema ?? null,
      generatedAt: nativeCoverage?.generatedAt ?? null,
      measuredCoveragePercent: nativeCoverage?.measuredCoveragePercent ?? null,
      shippingShellReady: nativeCoverage?.shippingShellReady ?? null,
    },
  ),
  check(
    "traceability-debt-fails-closed",
    includesAll(nativeTraceability, [
      "Activation blocker",
      "every concrete `NUI-*` requirement ID",
      "owner, Work Unit, verifier, artifact, rollback, and status",
      "no wildcard-only coverage",
    ]),
    "group-level imported traceability is explicitly blocked from NUI-F0 completion until expanded per requirement",
  ),
  check(
    "local-links-resolve",
    linkFailures.length === 0,
    "all local Markdown links in canonical package and routing documents resolve",
    { linkFailures },
  ),
  check(
    "package-command-present",
    packageJson?.scripts?.["verify:native-ui:design-package"] ===
      "node scripts/verify-native-ui-design-package.mjs",
    "package.json exposes the focused native UI design-package verifier",
  ),
];

const failed = checks.filter((item) => item.status !== "passed");
const report = {
  schema: "aelyris.native-ui-design-package-verification/v1",
  version: 1,
  ok: failed.length === 0,
  status:
    failed.length === 0
      ? "pass-queued-high-priority-proposal-integrated"
      : "fail-native-ui-design-package-integration",
  generatedAt: new Date().toISOString(),
  sourceCutoffMs: Math.max(...[...SUPPORTING_PATHS, ...rawSourcePaths].map(mtime)),
  sourcePaths: [...SUPPORTING_PATHS, ...rawSourcePaths],
  currentExecution,
  queuedProgram: {
    program: "native-ui-migration",
    priority: "priority-1-post-A9",
    decisionGate: "A8.0",
    activationAuthorized: false,
    claimLevelAuthorized: null,
  },
  summary:
    failed.length === 0
      ? "full-native Rust design package is integrity-checked, canonically routed, and queued without changing current execution or claims"
      : `${failed.length} native UI design-package integration checks failed`,
  checks,
};

writeJsonAtomic(OUT, report);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  process.exitCode = 1;
}
