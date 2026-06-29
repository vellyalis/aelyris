import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "native-visual-regression.json");

const ARTIFACTS = {
  nativeClient: ".codex-auto/quality/native-client-spike.json",
  textShaping: ".codex-auto/quality/native-text-shaping-fallback.json",
  postcheck: ".codex-auto/production-smoke/postcheck-write-smoke/real-os-suspend-native-postcheck-write-smoke.json",
};

const SOURCE_GROUPS = {
  nativeClient: [
    "scripts/verify-native-client-spike.mjs",
    "src-tauri/src/bin/aelyris_native.rs",
    "src-tauri/src/term/mod.rs",
    "src-tauri/src/term/text_shaping.rs",
    "src-tauri/Cargo.toml",
  ],
  textShaping: [
    "scripts/verify-native-text-shaping-fallback.mjs",
    "src-tauri/src/bin/aelyris_native.rs",
    "src-tauri/src/term/mod.rs",
    "src-tauri/src/term/text_shaping.rs",
    "src-tauri/Cargo.toml",
  ],
  postcheck: [
    "scripts/verify-real-os-suspend-evidence.mjs",
    "scripts/verify-native-client-spike.mjs",
    "src-tauri/src/bin/aelyris_native.rs",
  ],
};

const SOURCE_PATHS = Array.from(
  new Set(["scripts/verify-native-visual-regression.mjs", ...Object.values(SOURCE_GROUPS).flat()]),
);

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

function check(id, passed, detail, evidence = {}, options = {}) {
  const externalBlocked = passed !== true && options.externalBlocked === true;
  return {
    id,
    status: passed ? "passed" : externalBlocked ? "external-blocked" : "failed",
    detail,
    evidence,
    ...(externalBlocked ? { externalBlocker: options.externalBlocker ?? detail } : {}),
  };
}

function fresh(path, cutoffMs) {
  return mtime(path) + 5000 >= cutoffMs;
}

function cutoffMsFor(paths) {
  return Math.max(...paths.map(mtime));
}

function collectPngs(dir) {
  const full = pathOf(dir);
  if (!existsSync(full)) {
    return [];
  }
  const pending = [full];
  const pngs = [];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const child = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(child);
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".png") {
        pngs.push(child);
      }
    }
  }
  return pngs;
}

function hasRealSleepResumeOperatorGate() {
  return (
    postcheck?.checks?.noRealSleepClaim === true ||
    postcheck?.noRealSleepClaim === true ||
    visualQa?.readyForSleepResumeDogfood === true ||
    visualQa?.sleepResumeRecoveryProbe?.readyForRealSleepResumeDogfood === true ||
    nativeClient?.nativePrimaryShell?.primaryShell?.remainingFullNativeBlockers?.includes?.("real-windows-sleep-resume-visual-dogfood") === true
  );
}

const sourceCutoffMs = cutoffMsFor(SOURCE_PATHS);const freshnessCutoffs = Object.fromEntries(
  Object.entries(SOURCE_GROUPS).map(([id, sourcePaths]) => [
    id,
    {
      cutoffMs: cutoffMsFor(sourcePaths),
      sourcePaths,
    },
  ]),
);
function artifactFresh(id) {
  return fresh(ARTIFACTS[id], freshnessCutoffs[id].cutoffMs);
}

function textShapingEnvironmentBlocked() {
  return textShaping?.externalBlocked === true || textShaping?.status === "environment-blocked-current-contract";
}

const nativeClient = readJson(ARTIFACTS.nativeClient);const textShaping = readJson(ARTIFACTS.textShaping);
const postcheck = readJson(ARTIFACTS.postcheck);
const visualQa = nativeClient?.nativeVisualQa?.visualQa;
const primaryShell = nativeClient?.nativePrimaryShell?.primaryShell?.primaryShellWindow;
const textShapingFixturePng =
  typeof textShaping?.artifactPaths?.visualFixturePng === "string" ? textShaping.artifactPaths.visualFixturePng : null;
const textShapingFixturePngFull = textShapingFixturePng ? pathOf(textShapingFixturePng) : null;
const textShapingPngCutoffMs =
  typeof textShaping?.visualFixtureSourceCutoffMs === "number"
    ? textShaping.visualFixtureSourceCutoffMs
    : freshnessCutoffs.textShaping.cutoffMs;
const pngArtifacts = collectPngs(".codex-auto/production-smoke").map((path) => ({
  path: path.replace(`${ROOT}\\`, "").replaceAll("\\", "/"),
  mtimeMs: statSync(path).mtimeMs,
  bytes: statSync(path).size,
}));
const freshPngArtifacts =
  textShapingFixturePngFull && existsSync(textShapingFixturePngFull)
    ? [
        {
          path: textShapingFixturePng,
          mtimeMs: statSync(textShapingFixturePngFull).mtimeMs,
          bytes: statSync(textShapingFixturePngFull).size,
          source: "native-text-shaping-visual-fixture",
        },
      ].filter(
        (item) =>
          item.mtimeMs + 5000 >= textShapingPngCutoffMs &&
          textShaping?.visualFixture?.png?.bytes === item.bytes &&
          textShaping?.visualFallbackGlyphFixturesReady === true,
      )
    : [];

const checks = [
  check(
    "visual-qa-artifact-current",
    nativeClient?.status === "passed" && artifactFresh("nativeClient") && visualQa?.schema === "aelyris.native.visual-qa-proof.v1",
    "native visual QA must be produced from the current native renderer sources",
    {
      artifact: ARTIFACTS.nativeClient,
      fresh: artifactFresh("nativeClient"),
      cutoffMs: freshnessCutoffs.nativeClient.cutoffMs,
    },
  ),
  check(
    "nonblank-contrast-resize-focus",
    visualQa?.nativeVisualQaHarness === true &&
      visualQa?.allRequiredSurfacesNonBlank === true &&
      visualQa?.pixelProbePass === true &&
      visualQa?.contrastPass === true &&
      visualQa?.resizeProbePass === true &&
      visualQa?.focusCoveragePass === true &&
      visualQa?.webviewUsed === false &&
      visualQa?.reactUsed === false,
    "native visual QA must prove nonblank pixels, contrast, resize, focus, and no React/WebView dependency",
    {
      pixelProbePass: visualQa?.pixelProbePass ?? null,
      contrastPass: visualQa?.contrastPass ?? null,
      resizeProbePass: visualQa?.resizeProbePass ?? null,
      focusCoveragePass: visualQa?.focusCoveragePass ?? null,
    },
  ),
  check(
    "primary-shell-visual-current",
    primaryShell?.interactiveWindow === true &&
      primaryShell?.nonBlank === true &&
      primaryShell?.webviewUsed === false &&
      primaryShell?.reactUsed === false,
    "primary native shell visual proof must be interactive, nonblank, and no-WebView",
    { artifact: ARTIFACTS.nativeClient },
  ),
  check(
    "fallback-glyph-fixtures",
    textShaping?.systemTextShapingReady === true &&
      artifactFresh("textShaping") &&
      textShaping?.realFontFallbackReady === true &&
      textShaping?.rendererFallbackGlyphRasterizationReady === true &&
      textShaping?.visualFallbackGlyphFixturesReady === true &&
      textShaping?.unsupportedSystemShaper === false,
    "visual regression must include real native fallback glyph rasterization and fixtures after system shaping is implemented",
    {
      artifact: ARTIFACTS.textShaping,
      systemTextShapingReady: textShaping?.systemTextShapingReady ?? null,
      realFontFallbackReady: textShaping?.realFontFallbackReady ?? null,
      rendererFallbackGlyphRasterizationReady: textShaping?.rendererFallbackGlyphRasterizationReady ?? null,
      visualFallbackGlyphFixturesReady: textShaping?.visualFallbackGlyphFixturesReady ?? null,
      readyForGhosttyClaim: textShaping?.readyForGhosttyClaim ?? null,
      textShapingExternalBlocked: textShapingEnvironmentBlocked(),
      unsupportedSystemShaper: textShaping?.unsupportedSystemShaper ?? null,
      fresh: artifactFresh("textShaping"),
      cutoffMs: freshnessCutoffs.textShaping.cutoffMs,
    },
    {
      externalBlocked:
        textShapingEnvironmentBlocked() &&
        textShaping?.systemTextShapingReady === true &&
        textShaping?.realFontFallbackReady === true &&
        textShaping?.rendererFallbackGlyphRasterizationReady === true,
      externalBlocker:
        "Text-shaping fallback source and renderer contracts are ready, but fresh visual fixture generation is blocked by host process policy.",
    },
  ),  check(
    "real-sleep-resume-visual",
    postcheck?.ok === true &&
      postcheck?.checks?.nativeVisual === true &&
      postcheck?.validation?.postResumeProbes?.nativeVisual?.ok === true &&
      artifactFresh("postcheck"),
    "real post-resume native visual proof must be current",
    {
      artifact: ARTIFACTS.postcheck,
      fresh: artifactFresh("postcheck"),
      cutoffMs: freshnessCutoffs.postcheck.cutoffMs,
      noRealSleepClaim: postcheck?.checks?.noRealSleepClaim ?? postcheck?.noRealSleepClaim ?? null,
      readyForSleepResumeDogfood: visualQa?.readyForSleepResumeDogfood ?? null,
    },
    {
      externalBlocked: hasRealSleepResumeOperatorGate(),
      externalBlocker:
        "Real post-resume native visual proof requires an operator-controlled Windows sleep/resume cycle before the visual regression claim can pass.",
    },
  ),
  check(
    "current-png-artifact-set",
    freshPngArtifacts.length > 0,
    "the current native text-shaping visual fixture PNG must be tied to the native visual proof run",
    {
      currentPngCount: freshPngArtifacts.length,
      totalPngCount: pngArtifacts.length,
      expectedPng: textShapingFixturePng,
      pngCutoffMs: textShapingPngCutoffMs,
      textShapingExternalBlocked: textShapingEnvironmentBlocked(),
    },
    {
      externalBlocked: textShapingEnvironmentBlocked(),
      externalBlocker:
        "Current native text-shaping PNG fixture proof is blocked by host process policy, with the previous fixture artifact preserved.",
    },
  ),];

const failed = checks.filter((item) => item.status === "failed");
const externalBlockedChecks = checks.filter((item) => item.status === "external-blocked");
const ok = failed.length === 0 && externalBlockedChecks.length === 0;
const externallyBlockedOnly = failed.length === 0 && externalBlockedChecks.length > 0;
const report = {
  version: 1,
  ok,
  status: ok ? "pass" : externallyBlockedOnly ? "environment-blocked-current-contract" : "blocked",
  externalBlocked: externallyBlockedOnly,  generatedAt: new Date().toISOString(),
  sourceCutoffMs,
  sourcePaths: SOURCE_PATHS,
  freshnessCutoffs: {
    ...freshnessCutoffs,
    textShapingPng: {
      cutoffMs: textShapingPngCutoffMs,
      sourcePaths: textShaping?.visualFixtureSourceCutoffMs
        ? textShaping?.sourcePaths ?? freshnessCutoffs.textShaping.sourcePaths
        : freshnessCutoffs.textShaping.sourcePaths,
    },
  },
  artifactPaths: ARTIFACTS,
  readyForVisualRegressionClaim: ok,
  freshPngArtifacts,
  summary: ok
    ? "native visual regression proof is current"
    : externallyBlockedOnly
      ? `${externalBlockedChecks.length} native visual regression gates require external host/operator proof`
      : `${failed.length} native visual regression gates are blocked`,
  blockers: failed.map((item) => item.detail),
  externalBlockers: externalBlockedChecks.map((item) => item.externalBlocker ?? item.detail),
  failedChecks: failed.map((item) => item.id),
  externalBlockedChecks: externalBlockedChecks.map((item) => item.id),
  checks,
};
writeJsonAtomic(OUT, report);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  process.exitCode = 1;
}