import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "a8-native-terminal-disposition.json");

const paths = {
  workOrder: "audit-remediation-instructions.md",
  plan: "docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md",
  terminalDesign: "docs/specs/TERMINAL_CORE_DESIGN.md",
  appStore: "src/shared/store/appStore.ts",
  rendererPerf: ".codex-auto/quality/renderer-perf.json",
  rendererParity: ".codex-auto/quality/renderer-parity.json",
  rendererSoak: ".codex-auto/quality/renderer-soak.json",
  rendererTransparency: ".codex-auto/quality/renderer-transparency.json",
  fontRender: ".codex-auto/quality/terminal-font-render-contract.json",
  nativeClient: ".codex-auto/quality/native-client-spike.json",
  nativeInput: ".codex-auto/production-smoke/native-terminal-input-host.json",
  nativeBoundary: ".codex-auto/quality/native-boundary-contract.json",
};

const allowedDirtyPaths = new Set([
  "audit-remediation-instructions.md",
  "docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md",
  "docs/specs/README.md",
  "docs/specs/TERMINAL_CORE_DESIGN.md",
  "package.json",
  "scripts/verify-a8-native-terminal-disposition.mjs",
  "scripts/verify-terminal-font-render-contract.mjs",
  "scripts/verify-verifiable-agent-work-os-spec.mjs",
]);

const rendererSources = [
  "scripts/verify-renderer-perf.mjs",
  "e2e/renderer-perf-harness.ts",
  "scripts/verify-renderer-parity.mjs",
  "e2e/renderer-parity-harness.ts",
  "scripts/verify-renderer-soak.mjs",
  "e2e/renderer-soak-harness.ts",
  "scripts/verify-renderer-transparency.mjs",
  "e2e/renderer-transparency-harness.ts",
  "src/features/terminal/terminalPaint.ts",
  "src/features/terminal/gpu/terminalPaintGpu.ts",
  "src/features/terminal/__fixtures__/rendererFixtures.ts",
  "src/features/terminal/terminalMetrics.ts",
];

const nativeClientSources = [
  "scripts/verify-native-client-spike.mjs",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/src/aelyris_native.rs",
  "src-tauri/src/aelyris_native/readiness.rs",
  "src-tauri/src/term/render_frame.rs",
  "src-tauri/src/term/render_pipeline.rs",
];

const nativeInputSources = [
  "scripts/verify-native-terminal-input-host.mjs",
  "src-tauri/src/ipc/commands.rs",
  "src/features/terminal/NativeTerminalArea.tsx",
  "src/features/terminal/hooks/useCanvasIME.ts",
];

function fullPath(path) {
  return join(ROOT, path);
}

function readText(path) {
  return existsSync(fullPath(path)) ? readFileSync(fullPath(path), "utf8") : "";
}

function readJson(path) {
  try {
    return JSON.parse(readText(path));
  } catch {
    return null;
  }
}

function mtime(path) {
  return existsSync(fullPath(path)) ? statSync(fullPath(path)).mtimeMs : 0;
}

function maxMtime(sourcePaths) {
  return Math.max(0, ...sourcePaths.map(mtime));
}

function freshAfterSources(artifactPath, sourcePaths, graceMs = 5_000) {
  return mtime(artifactPath) + graceMs >= maxMtime(sourcePaths);
}

function sha256(path) {
  return existsSync(fullPath(path))
    ? createHash("sha256")
        .update(readFileSync(fullPath(path)))
        .digest("hex")
    : null;
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function dirtyPaths() {
  const raw = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trimEnd();
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.slice(3).trim())
    .map((path) => (path.includes(" -> ") ? path.split(" -> ").at(-1) : path))
    .map((path) => path.replace(/^"|"$/g, "").replaceAll("\\", "/"));
}

function backtickField(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp(`^${escaped}:\\s*\\x60([^\\x60]+)\\x60`, "m"))?.[1] ?? null;
}

function check(id, passed, detail, evidence = {}) {
  return { id, status: passed ? "passed" : "failed", detail, evidence };
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

const source = {
  workOrder: readText(paths.workOrder),
  plan: readText(paths.plan),
  terminalDesign: readText(paths.terminalDesign),
  appStore: readText(paths.appStore),
};
const artifacts = {
  rendererPerf: readJson(paths.rendererPerf),
  rendererParity: readJson(paths.rendererParity),
  rendererSoak: readJson(paths.rendererSoak),
  rendererTransparency: readJson(paths.rendererTransparency),
  fontRender: readJson(paths.fontRender),
  nativeClient: readJson(paths.nativeClient),
  nativeInput: readJson(paths.nativeInput),
  nativeBoundary: readJson(paths.nativeBoundary),
};

const requiredPaths = Object.values(paths);
const missingPaths = requiredPaths.filter((path) => !existsSync(fullPath(path)));
const dirty = dirtyPaths();
const unexpectedDirtyPaths = dirty.filter((path) => !allowedDirtyPaths.has(path));
const frontier = {
  phase: backtickField(source.workOrder, "CURRENT PHASE"),
  activeSlice: backtickField(source.workOrder, "ACTIVE SLICE"),
  lastCompletedSlice: backtickField(source.workOrder, "LAST COMPLETED SLICE"),
  nextImplementationSlice: backtickField(source.workOrder, "NEXT IMPLEMENTATION SLICE"),
};

const rendererEvidenceFresh = [
  paths.rendererPerf,
  paths.rendererParity,
  paths.rendererSoak,
  paths.rendererTransparency,
].every((path) => freshAfterSources(path, rendererSources));
const fontEvidenceFresh =
  artifacts.fontRender?.sourceCutoffMs > 0 && mtime(paths.fontRender) + 5_000 >= artifacts.fontRender.sourceCutoffMs;
const nativeClientFresh = freshAfterSources(paths.nativeClient, nativeClientSources);
const nativeInputFresh = freshAfterSources(paths.nativeInput, nativeInputSources);

const sampleGridRatio = artifacts.rendererPerf?.comparison?.fullGridRepaint?.webgl2VsCanvasP95Ratio ?? null;
const sampleScrollRatio = artifacts.rendererPerf?.comparison?.scrollFlood?.webgl2VsCanvasP95Ratio ?? null;
const canvasFullGrid = artifacts.rendererPerf?.baseline?.fullGridRepaint ?? null;
const canvasScroll = artifacts.rendererPerf?.baseline?.scrollFlood ?? null;
const gpuSampleGrid = artifacts.rendererPerf?.gpu?.sampleGridRepaint ?? null;
const nativeWinit = artifacts.nativeClient?.nativeWinitWgpu?.winitWgpu ?? null;
const nativeRenderFrame = artifacts.nativeClient?.nativeWinitWgpu?.renderFrame ?? null;

const currentDefaultIsCanvas =
  source.appStore.includes('const DEFAULT_TERMINAL_RENDERER_MODE: TerminalRendererMode = "canvas2d"') &&
  source.appStore.includes('export type TerminalRendererMode = "canvas2d" | "webgl2"');
const sameConditionWebglRecorded =
  artifacts.rendererPerf?.ok === true &&
  artifacts.rendererPerf?.status === "comparison-recorded" &&
  canvasFullGrid?.cols === 120 &&
  canvasFullGrid?.rows === 40 &&
  canvasFullGrid?.frames === 1_000 &&
  canvasScroll?.frames === 240 &&
  gpuSampleGrid?.sampled === true &&
  artifacts.rendererPerf?.comparison?.fullGridRepaint?.sampleGrid?.cols === gpuSampleGrid?.cols &&
  artifacts.rendererPerf?.comparison?.fullGridRepaint?.sampleGrid?.rows === gpuSampleGrid?.rows;
const webglPromotionRejected =
  sameConditionWebglRecorded &&
  Number.isFinite(sampleGridRatio) &&
  Number.isFinite(sampleScrollRatio) &&
  sampleGridRatio > 1 &&
  sampleScrollRatio > 1 &&
  artifacts.rendererPerf?.flagDefaultProposal?.proposedDefault === "canvas2d";
const nativeCandidateIsNotSameCondition =
  artifacts.nativeClient?.status === "passed" &&
  nativeWinit?.terminalRenderer === "native-winit-wgpu-terminal" &&
  nativeWinit?.webviewUsed === false &&
  nativeWinit?.framesPresented >= 2 &&
  (nativeRenderFrame?.cols !== canvasFullGrid?.cols ||
    nativeRenderFrame?.rows !== canvasFullGrid?.rows ||
    nativeWinit?.framesPresented !== canvasFullGrid?.frames);

const promotionEvidenceGaps = [
  "key-to-paint p99 from real terminal input to presented cell",
  "event-queue lag under the same candidate workload",
  "WebView and renderer process memory delta under the same workload",
  "24-hour long-soak memory growth and frame-decay evidence",
  "DWM/WebView2 see-through operator screenshot signoff",
  "native 120x40 1000-frame full-grid plus 240-frame scroll-flood comparison",
];

const frontierClosed =
  frontier.phase === "A9" &&
  frontier.activeSlice === "A9.0" &&
  frontier.lastCompletedSlice === "A8.1" &&
  frontier.nextImplementationSlice === "A9.0" &&
  source.plan.includes("### **A9.0 - Release Evidence Inventory And Owner Split**") &&
  source.plan.includes("A8.1 disposition: `do_not_promote`");

const checks = [
  check("required-paths", missingPaths.length === 0, "all A8.1 source and evidence paths exist", { missingPaths }),
  check("frontier-advanced", frontierClosed, "A8.1 is closed only by advancing the single tracked frontier to A9.0", {
    frontier,
  }),
  check(
    "canvas-current-best",
    currentDefaultIsCanvas,
    "Canvas2D remains the explicit product default and rollback",
    {},
  ),
  check(
    "renderer-evidence-current",
    rendererEvidenceFresh,
    "renderer perf, parity, transparency, and short-soak artifacts are newer than their owner sources",
    { rendererEvidenceFresh },
  ),
  check(
    "webgl-do-not-promote",
    webglPromotionRejected,
    "the same-grid Canvas/WebGL sample rejects WebGL promotion and preserves Canvas2D",
    {
      sampleGridRatio,
      sampleScrollRatio,
      proposedDefault: artifacts.rendererPerf?.flagDefaultProposal?.proposedDefault,
    },
  ),
  check(
    "parity-preserved",
    artifacts.rendererParity?.ok === true &&
      artifacts.rendererParity?.fixtures?.every?.((fixture) => fixture.withinTolerance),
    "the rejected WebGL candidate still preserves fixture parity within the existing tolerance",
    { fixtureCount: artifacts.rendererParity?.fixtures?.length ?? 0 },
  ),
  check(
    "short-soak-bounded",
    artifacts.rendererSoak?.ok === true &&
      artifacts.rendererSoak?.frames === 10_000 &&
      artifacts.rendererSoak?.contextLossEvents?.length === 0 &&
      artifacts.rendererSoak?.frameErrors?.length === 0,
    "the existing 10k-frame short soak is bounded but is not relabeled as a 24-hour soak",
    { frames: artifacts.rendererSoak?.frames ?? null },
  ),
  check(
    "transparency-boundary-honest",
    artifacts.rendererTransparency?.ok === true && artifacts.rendererTransparency?.operatorSignoff?.required === true,
    "Chromium alpha parity passes while final DWM see-through signoff remains explicit",
    { operatorSignoffRequired: artifacts.rendererTransparency?.operatorSignoff?.required ?? null },
  ),
  check(
    "font-render-current-best",
    fontEvidenceFresh && artifacts.fontRender?.ok === true,
    "the retained Canvas2D/font path passes its current source contract",
    { fresh: fontEvidenceFresh, status: artifacts.fontRender?.status ?? null },
  ),
  check(
    "native-proof-current-not-comparable",
    nativeClientFresh && nativeCandidateIsNotSameCondition,
    "fresh native winit/wgpu proof exists but does not masquerade as the required same-condition promotion run",
    {
      fresh: nativeClientFresh,
      nativeGrid: { cols: nativeRenderFrame?.cols ?? null, rows: nativeRenderFrame?.rows ?? null },
      framesPresented: nativeWinit?.framesPresented ?? null,
      averageFrameMs: nativeWinit?.averageFrameMs ?? null,
    },
  ),
  check(
    "native-input-current",
    nativeInputFresh && artifacts.nativeInput?.ok === true && artifacts.nativeInput?.checks?.length === 17,
    "native input/IME authority remains current and passing",
    { fresh: nativeInputFresh, checkCount: artifacts.nativeInput?.checks?.length ?? 0 },
  ),
  check(
    "native-boundary-blockers-preserved",
    artifacts.nativeBoundary?.status === "blocked" &&
      artifacts.nativeBoundary?.summary?.passed === 11 &&
      artifacts.nativeBoundary?.summary?.failed === 3 &&
      artifacts.nativeBoundary?.blockers?.length === 3,
    "broader daemon and AI CLI boundary debt stays BLOCK instead of being hidden by A8.1",
    { summary: artifacts.nativeBoundary?.summary ?? null, blockers: artifacts.nativeBoundary?.blockers ?? [] },
  ),
  check(
    "promotion-evidence-fail-closed",
    promotionEvidenceGaps.length === 6 && nativeCandidateIsNotSameCondition,
    "missing promotion-only measurements prohibit promotion without preventing a measured do_not_promote result",
    { promotionEvidenceGaps },
  ),
  check(
    "falsification-and-scope",
    source.terminalDesign.includes("Falsification criteria") &&
      source.terminalDesign.includes("F1:") &&
      source.terminalDesign.includes("F2:") &&
      source.workOrder.includes("no NUI implementation") &&
      source.workOrder.includes("framework selection"),
    "A8.1 preserves the documented falsification criteria and forbids NUI/framework activation",
    {},
  ),
  check(
    "dirty-scope",
    unexpectedDirtyPaths.length === 0,
    "the A8.1 candidate contains only its owned contract and verifier paths",
    { dirtyPaths: dirty, unexpectedDirtyPaths },
  ),
];

const failed = checks.filter((item) => item.status !== "passed");
const contractPass = failed.length === 0;
const committedAtHead = contractPass && dirty.length === 0;
const report = {
  schema: "aelyris.a8_1_native_terminal_disposition/v1",
  contractVersion: 1,
  ok: contractPass,
  status: !contractPass
    ? "fail-a8.1-native-terminal-disposition"
    : committedAtHead
      ? "pass-a8.1-do-not-promote-committed"
      : "pass-a8.1-do-not-promote-ready-to-commit",
  generatedAt: new Date().toISOString(),
  git: {
    head: git(["rev-parse", "HEAD"]),
    branch: git(["branch", "--show-current"]),
    dirtyPaths: dirty,
  },
  completedSlice: "A8.1",
  activeSlice: "A9.0",
  nextImplementationSlice: "A9.0",
  decision: "do_not_promote",
  currentBest: "canvas2d",
  rollback: "canvas2d",
  phaseComplete: committedAtHead,
  readyToCommit: contractPass && !committedAtHead,
  releaseReady: false,
  nuiActivated: false,
  frameworkSelected: false,
  comparison: {
    canvasFullGrid,
    canvasScroll,
    webglSampleGrid: gpuSampleGrid,
    webgl2VsCanvasP95Ratio: {
      fullGridSample: sampleGridRatio,
      scrollFloodSample: sampleScrollRatio,
    },
    nativeWinitWgpu: {
      cols: nativeRenderFrame?.cols ?? null,
      rows: nativeRenderFrame?.rows ?? null,
      framesPresented: nativeWinit?.framesPresented ?? null,
      averageFrameMs: nativeWinit?.averageFrameMs ?? null,
      sameCondition: false,
    },
  },
  promotionEvidenceGaps,
  broaderBlockers: artifacts.nativeBoundary?.blockers ?? [],
  checks,
  inputs: Object.fromEntries(
    Object.entries(paths).map(([id, path]) => [id, { path, mtimeMs: mtime(path), sha256: sha256(path) }]),
  ),
  artifact: ".codex-auto/quality/a8-native-terminal-disposition.json",
};

writeJsonAtomic(OUT, report);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
