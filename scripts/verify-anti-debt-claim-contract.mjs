import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "anti-debt-claim-contract.json");
const REGISTER_OUT = join(ROOT, ".codex-auto", "quality", "degradation-register.json");
const LOCAL_TIME_ZONE = "Asia/Tokyo";

const paths = {
  releaseQuality: ".codex-auto/quality/release-quality-score.json",
  currentReadiness: ".codex-auto/quality/current-readiness-source.json",
  worldClass: ".codex-auto/quality/world-class-terminal-ai-os.json",
  agentTeam: ".codex-auto/quality/agent-team-orchestration-readiness.json",
  nativeBoundary: ".codex-auto/quality/native-boundary-contract.json",
  nativeTextShaping: ".codex-auto/quality/native-text-shaping-fallback.json",
  degradationRegister: ".codex-auto/quality/degradation-register.json",
};

function fullPath(path) {
  return join(ROOT, path);
}

function readJson(path) {
  const full = fullPath(path);
  if (!existsSync(full)) return null;
  return JSON.parse(readFileSync(full, "utf8"));
}

function currentLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LOCAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function releaseScoreItem(releaseQuality, id) {
  return (Array.isArray(releaseQuality?.scores) ? releaseQuality.scores : []).find((item) => item?.id === id);
}

function releaseHasBlocker(releaseQuality, pattern) {
  return (Array.isArray(releaseQuality?.blockers) ? releaseQuality.blockers : []).some((item) =>
    pattern.test(`${item?.area ?? ""} ${item?.blocker ?? item ?? ""}`),
  );
}

function record(id, component, fallbackPath, reason, claimBlocks, recoveryAction, removalGate, userVisible = true) {
  return {
    id,
    component,
    fallbackPath,
    reason,
    userVisible,
    claimBlocks,
    recoveryAction,
    removalGate,
    observedAt: new Date().toISOString(),
    source: "generated",
  };
}

function generatedRecords({ releaseQuality, currentReadiness, agentTeam, nativeBoundary, nativeTextShaping }) {
  const records = [];
  if (releaseHasBlocker(releaseQuality, /mux-performance|mux performance|mux live|mux restore/i)) {
    records.push(
      record(
        "mux-performance-proof-blocked",
        "mux",
        "unmeasured-or-blocked-mux-performance",
        "current mux performance or restore evidence is missing, stale, blocked, or over budget",
        ["tmux"],
        "refresh mux performance and live restore proof on a host where process spawn is allowed",
        "verify-mux-performance",
      ),
    );
  }
  if (
    releaseHasBlocker(releaseQuality, /process-reconnect|recovered-command|multipane-command|sidecar.*retain|adopt/i)
  ) {
    records.push(
      record(
        "mux-reconnect-replay-not-proven",
        "mux",
        "sidecar-reconnect-proof-missing",
        "process reconnect, recovered command, or multi-pane replay evidence is not green",
        ["tmux"],
        "prove sidecar-owned terminal adoption and replay after app restart",
        "verify-mux-live",
      ),
    );
  }
  if (releaseScoreItem(releaseQuality, "native-boundary-contract")?.points === 0 || nativeBoundary?.ok === false) {
    records.push(
      record(
        "native-boundary-degraded",
        "native",
        "native-boundary-contract-red",
        "native boundary contract is not green, including no-silent-fallback or sidecar command-session proof",
        ["ghostty", "release"],
        "make native boundary contract pass with fresh artifacts",
        "verify-terminal:native-boundary",
      ),
    );
  }
  const nativeTextShapingSubclaimReady =
    nativeTextShaping?.readyForGhosttyClaim === true &&
    nativeTextShaping?.systemTextShapingReady === true &&
    nativeTextShaping?.realFontFallbackReady === true &&
    nativeTextShaping?.rendererTextShapingIntegrated === true &&
    nativeTextShaping?.rendererFallbackGlyphRasterizationReady === true &&
    nativeTextShaping?.visualFallbackGlyphFixturesReady === true;
  if (!nativeTextShapingSubclaimReady) {
    const systemShaperReady =
      nativeTextShaping?.systemTextShapingReady === true && nativeTextShaping?.unsupportedSystemShaper === false;
    const realFallbackReady = nativeTextShaping?.realFontFallbackReady === true;
    const rendererRunsConsumed = systemShaperReady && nativeTextShaping?.rendererTextShapingIntegrated === true;
    const fallbackGlyphRasterReady =
      rendererRunsConsumed && nativeTextShaping?.rendererFallbackGlyphRasterizationReady === true;
    records.push(
      record(
        rendererRunsConsumed && !realFallbackReady
          ? "native-directwrite-font-fallback-mapping-deferred"
          : fallbackGlyphRasterReady
            ? "native-fallback-glyph-visual-fixtures-deferred"
            : rendererRunsConsumed
              ? "native-fallback-glyph-rasterization-deferred"
              : "native-renderer-text-shaping-integration-deferred",
        "native",
        rendererRunsConsumed && !realFallbackReady
          ? "directwrite-shaped-run-consumed-real-font-fallback-mapping-pending"
          : fallbackGlyphRasterReady
            ? "directwrite-shaped-run-consumed-fontdue-directwrite-fallback-atlas-visual-fixtures-pending"
            : rendererRunsConsumed
              ? "directwrite-shaped-run-consumed-fontdue-primary-atlas-fallback-raster-pending"
              : systemShaperReady
                ? "directwrite-system-shaper-boundary-fontdue-atlas-renderer-pending"
                : "fontdue-single-font-atlas-policy-fallback",
        rendererRunsConsumed && !realFallbackReady
          ? "DirectWrite shaped runs are consumed by the native renderer, but real DirectWrite fallback mapping is not implemented"
          : fallbackGlyphRasterReady
            ? "DirectWrite shaped runs, real fallback mapping, and fallback atlas rasterization are implemented, but visual fixtures still do not prove Ghostty-class text shaping"
            : rendererRunsConsumed
              ? "DirectWrite shaped runs are consumed by the native renderer, but fallback glyph rasterization and visual fixtures still do not prove Ghostty-class text shaping"
              : systemShaperReady
                ? "DirectWrite system shaping/fallback boundary exists, but the native renderer and visual fixtures still do not prove Ghostty-class text shaping"
                : "native renderer still uses a non-final text shaping/fallback boundary; system-backed shaping and real font fallback are required before Ghostty-class claims",
        ["ghostty", "release"],
        rendererRunsConsumed && !realFallbackReady
          ? "implement real DirectWrite font fallback mapping for shaped clusters before rasterizing fallback glyphs"
          : fallbackGlyphRasterReady
            ? "produce fallback-glyph and ligature/no-ligature visual fixtures on the native winit/wgpu renderer"
            : rendererRunsConsumed
              ? "rasterize DirectWrite-resolved fallback font glyphs into the winit/wgpu atlas and produce fallback-glyph visual fixtures"
              : systemShaperReady
                ? "wire DirectWrite shaped runs into the winit/wgpu glyph atlas and produce fallback-glyph visual fixtures"
                : "wire a Windows system-backed shaper and real Japanese/emoji/Powerline/Nerd/box-drawing fallback into the native renderer",
        "verify:native-text-shaping-fallback",
      ),
    );
  }
  if (releaseScoreItem(releaseQuality, "terminal-render-fidelity")?.points === 0) {
    records.push(
      record(
        "terminal-render-fidelity-degraded",
        "terminal",
        "renderer-fidelity-proof-missing",
        "terminal render fidelity guarantees are missing or stale",
        ["ghostty"],
        "prove DPR backing store, font/render settings, repaint, and text snapping",
        "verify-terminal:font-render",
      ),
    );
  }
  if (
    releaseHasBlocker(
      releaseQuality,
      /interactive AI CLI boundary|real AI CLI|AI CLI launch planner|post-launch chaos/i,
    )
  ) {
    records.push(
      record(
        "ai-cli-visible-team-boundary-unproven",
        "orchestrator",
        "ai-cli-boundary-proof-missing",
        "visible AI CLI launch, planner, or sidecar boundary proof is not current",
        ["bridgespace", "release"],
        "refresh interactive AI CLI, real CLI binary, and launch planner proof",
        "verify-terminal:ai-cli-boundary",
      ),
    );
  }
  if (agentTeam && agentTeam.ok !== true) {
    records.push(
      record(
        "agent-team-orchestration-readiness-blocked",
        "orchestrator",
        "orchestra-dispatch-proof-red",
        "agent team orchestration readiness artifact is not green",
        ["bridgespace"],
        "make agent-team orchestration readiness pass without brittle static-only proof",
        "verify:goal:orchestration",
      ),
    );
  }
  if (Array.isArray(currentReadiness?.staleContradictions) && currentReadiness.staleContradictions.length > 0) {
    records.push(
      record(
        "stale-green-readiness-contradiction",
        "orchestrator",
        "historical-green-artifact",
        "historical green readiness artifacts contradict the current release-quality source",
        ["release"],
        "keep historical artifacts demoted and current readiness source authoritative",
        "verify-current-readiness-source",
        false,
      ),
    );
  }
  return records;
}

function mergeManualRecords(existing, generated) {
  const manualRecords = (Array.isArray(existing?.records) ? existing.records : []).filter(
    (item) => item?.source === "manual",
  );
  const byId = new Map();
  for (const item of [...generated, ...manualRecords]) {
    if (item?.id) byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function validateRecord(item) {
  const claimSet = new Set(["tmux", "bridgespace", "ghostty", "release"]);
  return {
    id: item?.id,
    ok:
      typeof item?.id === "string" &&
      typeof item?.component === "string" &&
      typeof item?.fallbackPath === "string" &&
      typeof item?.reason === "string" &&
      typeof item?.userVisible === "boolean" &&
      Array.isArray(item?.claimBlocks) &&
      item.claimBlocks.length > 0 &&
      item.claimBlocks.every((claim) => claimSet.has(claim)) &&
      typeof item?.recoveryAction === "string" &&
      typeof item?.removalGate === "string" &&
      typeof item?.observedAt === "string",
  };
}

function currentClaimPasses({ worldClass, releaseQuality }) {
  const passes = new Set();
  if (releaseQuality?.releaseCandidateReady === true) passes.add("release");
  for (const [claim, value] of Object.entries(worldClass?.claims ?? {})) {
    if (value === "pass") passes.add(claim);
  }
  if (worldClass?.status === "pass") {
    passes.add("tmux");
    passes.add("bridgespace");
    passes.add("ghostty");
    passes.add("release");
  }
  return passes;
}

const releaseQuality = readJson(paths.releaseQuality);
const currentReadiness = readJson(paths.currentReadiness);
const worldClass = readJson(paths.worldClass);
const agentTeam = readJson(paths.agentTeam);
const nativeBoundary = readJson(paths.nativeBoundary);
const nativeTextShaping = readJson(paths.nativeTextShaping);
const existingRegister = readJson(paths.degradationRegister);

const records = mergeManualRecords(
  existingRegister,
  generatedRecords({ releaseQuality, currentReadiness, agentTeam, nativeBoundary, nativeTextShaping }),
);
const recordChecks = records.map(validateRecord);
const passedClaims = currentClaimPasses({ worldClass, releaseQuality });
const violations = [];
for (const item of records) {
  for (const claim of item.claimBlocks ?? []) {
    if (passedClaims.has(claim)) {
      violations.push({
        claim,
        degradationId: item.id,
        reason: `claim ${claim} is pass while degradation ${item.id} blocks it`,
      });
    }
  }
}

const register = {
  schema: "aelyris.degradation-register/v1",
  version: 1,
  generatedAt: new Date().toISOString(),
  localDate: currentLocalDate(),
  timeZone: LOCAL_TIME_ZONE,
  records,
  generatedRecordCount: records.filter((item) => item.source === "generated").length,
  manualRecordCount: records.filter((item) => item.source === "manual").length,
};

const checks = {
  releaseQualityExists: releaseQuality != null,
  degradationRecordsValid: recordChecks.every((item) => item.ok),
  noClaimPassesWhileBlocked: violations.length === 0,
  registerHasRemovalGates: records.every((item) => typeof item.removalGate === "string" && item.removalGate.length > 0),
  nativeTextShapingDebtRecorded:
    nativeTextShaping?.readyForGhosttyClaim === true ||
    records.some(
      (item) =>
        [
          "native-renderer-text-shaping-integration-deferred",
          "native-directwrite-font-fallback-mapping-deferred",
          "native-fallback-glyph-rasterization-deferred",
          "native-fallback-glyph-visual-fixtures-deferred",
        ].includes(item.id) &&
        item.removalGate === "verify:native-text-shaping-fallback" &&
        Array.isArray(item.claimBlocks) &&
        item.claimBlocks.includes("ghostty"),
    ),
};
const ok = Object.values(checks).every(Boolean);
const report = {
  schema: "aelyris.anti-debt-claim-contract/v1",
  version: 1,
  generatedAt: new Date().toISOString(),
  localDate: currentLocalDate(),
  timeZone: LOCAL_TIME_ZONE,
  ok,
  status: ok ? "pass-current-anti-debt-contract" : "failed",
  mode: "claim-blocking",
  degradationRegister: {
    path: ".codex-auto/quality/degradation-register.json",
    recordCount: records.length,
  },
  currentClaimPasses: [...passedClaims].sort(),
  violations,
  recordChecks,
  checks,
};

mkdirSync(dirname(REGISTER_OUT), { recursive: true });
writeFileSync(REGISTER_OUT, `${JSON.stringify(register, null, 2)}\n`);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: OUT, register: REGISTER_OUT, ...report }, null, 2));
if (!ok) process.exitCode = 1;
