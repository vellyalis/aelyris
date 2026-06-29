import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "current-readiness-source.json");
const LOCAL_TIME_ZONE = "Asia/Tokyo";

const paths = {
  releaseQuality: ".codex-auto/quality/release-quality-score.json",
  worldClass: ".codex-auto/quality/world-class-terminal-ai-os.json",
  antiDebt: ".codex-auto/quality/anti-debt-claim-contract.json",
  modularity: ".codex-auto/quality/modularity-boundary-contract.json",
  requirementsTrace: ".codex-auto/quality/requirements-spec-design-traceability.json",
  degradationRegister: ".codex-auto/quality/degradation-register.json",
  promotionGate: ".codex-auto/promotion-gate.json",
};

function fullPath(path) {
  return join(ROOT, path);
}

function readJson(path) {
  const full = fullPath(path);
  if (!existsSync(full)) return null;
  return JSON.parse(readFileSync(full, "utf8"));
}

function mtimeMs(path) {
  const full = fullPath(path);
  return existsSync(full) ? statSync(full).mtimeMs : 0;
}

function artifactMeta(path, data) {
  const full = fullPath(path);
  return {
    path,
    exists: existsSync(full),
    mtimeMs: mtimeMs(path),
    generatedAt: typeof data?.generatedAt === "string" ? data.generatedAt : null,
    status: data?.status ?? null,
    ok: data?.ok ?? null,
  };
}

function currentLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LOCAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function releaseStatus(releaseQuality) {
  if (!releaseQuality) return "block";
  if (
    releaseQuality.releaseCandidateReady === true &&
    Array.isArray(releaseQuality.blockers) &&
    releaseQuality.blockers.length === 0
  ) {
    return "pass";
  }
  return releaseQuality.score >= 80 ? "review" : "block";
}

function claimBlocksFromRelease(releaseQuality) {
  const blocks = new Set();
  if (!releaseQuality || releaseQuality.releaseCandidateReady !== true) {
    blocks.add("release");
  }
  const blockers = Array.isArray(releaseQuality?.blockers) ? releaseQuality.blockers : [];
  for (const item of blockers) {
    const text = `${item?.area ?? ""} ${item?.blocker ?? item ?? ""}`.toLowerCase();
    if (/mux|pane|reconnect|scrollback|sidecar|pty|live-command|multipane|recovered-command/.test(text)) {
      blocks.add("tmux");
    }
    if (/native|terminal-render|font|ime|dpi|visual|ghostty|wezterm|canvas|text render/.test(text)) {
      blocks.add("ghostty");
    }
    if (/agent|orchestr|mcp|merge|ownership|shared brain|ai-cli|right-rail|command-center/.test(text)) {
      blocks.add("bridgespace");
    }
  }
  return [...blocks].sort();
}

function staleContradictions({ releaseQuality, promotionGate, worldClass }) {
  const contradictions = [];
  const releaseMtime = mtimeMs(paths.releaseQuality);
  const promotionMtime = mtimeMs(paths.promotionGate);
  if (
    promotionGate &&
    (promotionGate.readyForPromotion === true || promotionGate.status === "pass") &&
    releaseQuality?.releaseCandidateReady !== true
  ) {
    contradictions.push({
      artifact: paths.promotionGate,
      reason: "historical promotion gate is green while current release-quality-score blocks release readiness",
      currentArtifact: paths.releaseQuality,
      historicalMtimeMs: promotionMtime,
      currentMtimeMs: releaseMtime,
    });
  }
  if (worldClass?.status === "pass" && releaseQuality?.releaseCandidateReady !== true) {
    contradictions.push({
      artifact: paths.worldClass,
      reason: "world-class aggregate claims pass while current release-quality-score blocks release readiness",
      currentArtifact: paths.releaseQuality,
    });
  }
  return contradictions;
}

function validReleaseShape(releaseQuality) {
  return (
    releaseQuality != null &&
    typeof releaseQuality.generatedAt === "string" &&
    typeof releaseQuality.score === "number" &&
    typeof releaseQuality.total === "number" &&
    typeof releaseQuality.max === "number" &&
    typeof releaseQuality.grade === "string" &&
    typeof releaseQuality.releaseCandidateReady === "boolean" &&
    Array.isArray(releaseQuality.blockers)
  );
}

const releaseQuality = readJson(paths.releaseQuality);
const worldClass = readJson(paths.worldClass);
const antiDebt = readJson(paths.antiDebt);
const modularity = readJson(paths.modularity);
const requirementsTrace = readJson(paths.requirementsTrace);
const degradationRegister = readJson(paths.degradationRegister);
const promotionGate = readJson(paths.promotionGate);

const status = releaseStatus(releaseQuality);
const claimBlocks = claimBlocksFromRelease(releaseQuality);
const contradictions = staleContradictions({ releaseQuality, promotionGate, worldClass });

const checks = {
  releaseQualityExists: releaseQuality != null,
  releaseQualityShapeValid: validReleaseShape(releaseQuality),
  staleGreenContradictionsDetected:
    contradictions.length > 0 ||
    !(promotionGate?.readyForPromotion === true && releaseQuality?.releaseCandidateReady !== true),
  historicalPromotionDemoted:
    !promotionGate ||
    promotionGate.readyForPromotion !== true ||
    releaseQuality?.releaseCandidateReady === true ||
    contradictions.some((item) => item.artifact === paths.promotionGate),
  worldClassCannotOverrideRelease:
    worldClass?.status !== "pass" ||
    releaseQuality?.releaseCandidateReady === true ||
    contradictions.some((item) => item.artifact === paths.worldClass),
};

const ok = Object.values(checks).every(Boolean);
const report = {
  schema: "aelyris.current-readiness-source/v1",
  version: 1,
  generatedAt: new Date().toISOString(),
  localDate: currentLocalDate(),
  timeZone: LOCAL_TIME_ZONE,
  ok,
  status,
  authoritativeSources: [
    "release-quality-score",
    ...(worldClass ? ["world-class-terminal-ai-os"] : []),
    ...(requirementsTrace ? ["requirements-spec-design-traceability"] : []),
    ...(antiDebt ? ["anti-debt-claim-contract"] : []),
    ...(modularity ? ["modularity-boundary-contract"] : []),
  ],
  historicalSources: promotionGate ? ["promotion-gate"] : [],
  releaseQuality: releaseQuality
    ? {
        status,
        score: releaseQuality.score,
        total: releaseQuality.total,
        max: releaseQuality.max,
        grade: releaseQuality.grade,
        releaseCandidateReady: releaseQuality.releaseCandidateReady === true,
        blockerCount: Array.isArray(releaseQuality.blockers) ? releaseQuality.blockers.length : 0,
        artifact: paths.releaseQuality,
      }
    : null,
  claimBlocks,
  staleContradictions: contradictions,
  degradations: {
    artifact: paths.degradationRegister,
    exists: degradationRegister != null,
    count: Array.isArray(degradationRegister?.records) ? degradationRegister.records.length : 0,
  },
  artifacts: {
    releaseQuality: artifactMeta(paths.releaseQuality, releaseQuality),
    worldClass: artifactMeta(paths.worldClass, worldClass),
    requirementsTrace: artifactMeta(paths.requirementsTrace, requirementsTrace),
    antiDebt: artifactMeta(paths.antiDebt, antiDebt),
    modularity: artifactMeta(paths.modularity, modularity),
    degradationRegister: artifactMeta(paths.degradationRegister, degradationRegister),
    promotionGate: artifactMeta(paths.promotionGate, promotionGate),
  },
  checks,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));
if (!ok) process.exitCode = 1;
