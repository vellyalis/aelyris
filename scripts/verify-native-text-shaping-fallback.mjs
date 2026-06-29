import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "native-text-shaping-fallback.json");
const FIXTURE_ARTIFACT = ".codex-auto/quality/native-text-shaping-visual-fixture.json";
const FIXTURE_PNG = ".codex-auto/production-smoke/native-text-shaping/fallback-glyph-atlas.png";
const NATIVE_BIN = join(
  ROOT,
  "src-tauri",
  "target",
  "debug",
  process.platform === "win32" ? "aether-native.exe" : "aether-native",
);

const SOURCE_PATHS = [
  "package.json",
  "src-tauri/src/term/mod.rs",
  "src-tauri/src/term/text_shaping.rs",
  "src-tauri/src/bin/aether_native.rs",
  "src-tauri/Cargo.toml",
  "docs/specs/QUORUM_GAP_CLOSURE_DESIGN_2026-06-25.md",
];

function source(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

function mtime(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? statSync(full).mtimeMs : 0;
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

function readJson(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(full, "utf8"));
  } catch {
    return null;
  }
}

function runTextShapingFixture() {
  if (!existsSync(NATIVE_BIN)) {
    return {
      status: null,
      ok: false,
      error: `native binary missing: ${NATIVE_BIN}; run cargo build --manifest-path src-tauri/Cargo.toml --bin aether-native`,
      stdoutTail: "",
      stderrTail: "",
    };
  }
  const result = spawnSync(
    NATIVE_BIN,
    ["text-shaping-fixture-proof", "--out", FIXTURE_ARTIFACT, "--png", FIXTURE_PNG],
    {
      cwd: ROOT,
      encoding: "utf8",
      shell: false,
      timeout: 120_000,
      windowsHide: true,
    },
  );
  return {
    status: result.status,
    ok: result.status === 0 && !result.error,
    error: result.error?.message ?? null,
    stdoutTail: String(result.stdout ?? "").slice(-2000),
    stderrTail: String(result.stderr ?? "").slice(-2000),
  };
}

function hasAll(text, needles) {
  return needles.every((needle) => text.includes(needle));
}

function check(id, passed, detail, evidence = {}) {
  return { id, status: passed ? "passed" : "failed", detail, evidence };
}

const packageJson = source("package.json");
const termMod = source("src-tauri/src/term/mod.rs");
const textShaping = source("src-tauri/src/term/text_shaping.rs");
const nativeClient = source("src-tauri/src/bin/aether_native.rs");
const cargoToml = source("src-tauri/Cargo.toml");
const g5Design = source("docs/specs/QUORUM_GAP_CLOSURE_DESIGN_2026-06-25.md");
const sourceCutoffMs = Math.max(mtime("scripts/verify-native-text-shaping-fallback.mjs"), ...SOURCE_PATHS.map(mtime));
const visualFixtureSourceCutoffMs = Math.max(
  mtime("src-tauri/src/term/text_shaping.rs"),
  mtime("src-tauri/src/bin/aether_native.rs"),
  mtime("src-tauri/Cargo.toml"),
);
const fixtureRun = runTextShapingFixture();
const visualFixture = readJson(FIXTURE_ARTIFACT);

const checks = [
  check(
    "package-script",
    packageJson.includes('"verify:native-text-shaping-fallback"') &&
      packageJson.includes("scripts/verify-native-text-shaping-fallback.mjs"),
    "package.json exposes the native text-shaping/fallback honesty verifier",
  ),
  check(
    "term-module-boundary",
    termMod.includes("pub mod text_shaping") &&
      termMod.includes("TextShaper") &&
      termMod.includes("terminal_text_shaping_policy"),
    "term module exports a first-class text shaping boundary",
  ),
  check(
    "text-shaper-trait",
    hasAll(textShaping, [
      "pub trait TextShaper",
      "fn shape_run(&self, input: &ShapeInput)",
      "fn resolve_fallback(&self, ch: char",
      "fn policy(&self) -> TerminalTextShapingPolicy",
      "pub struct ShapedRun",
      "pub struct GlyphCluster",
      "pub struct FontFaceRef",
    ]),
    "native terminal text layout has a stable trait and serializable run metadata",
  ),
  check(
    "directwrite-system-shaper-boundary",
    hasAll(textShaping, [
      "pub struct DirectWriteTextShaper",
      "DWriteCreateFactory",
      "CreateTextLayout",
      "GetClusterMetrics",
      "GetSystemFontCollection",
      "FindFamilyName",
      "HasCharacter",
      "TextShapingBackend::SystemDirectWrite",
      "system_text_shaping_capability",
    ]) &&
      cargoToml.includes('"Win32_Graphics_DirectWrite"') &&
      nativeClient.includes('"systemTextShapingCapability"'),
    "Windows builds expose a DirectWrite-backed text layout boundary plus installed-family fallback candidate probes",
  ),
  check(
    "fallback-classes-covered",
    hasAll(textShaping, [
      "FontFallbackClass::Japanese",
      "FontFallbackClass::Emoji",
      "FontFallbackClass::Powerline",
      "FontFallbackClass::NerdFont",
      "FontFallbackClass::BoxDrawing",
      "Yu Gothic UI",
      "Segoe UI Emoji",
      "CaskaydiaCove Nerd Font",
    ]),
    "policy fallback classifies Japanese, emoji, Powerline, Nerd Font, and box drawing glyph requirements",
  ),
  check(
    "ghostty-claim-blocked",
    hasAll(textShaping, [
      "ready_for_ghostty_claim: false",
      "renderer_integration_ready: false",
      "visual_fixture_ready: false",
      "native visual regression must prove ligature/no-ligature",
    ]) && !textShaping.includes("ready_for_ghostty_claim: true"),
    "policy keeps Ghostty/WezTerm claims blocked until renderer integration and visual fallback fixtures are proven",
  ),
  check(
    "native-client-artifact-honesty",
    hasAll(nativeClient, [
      "terminal_text_shaping_policy",
      '"textShapingPolicy"',
      '"systemTextShapingCapability"',
      '"textShapingBackend": text_shaping_backend',
      "directwrite-shaped-run-consumed-fontdue-directwrite-fallback-atlas",
      "directwrite-shaped-run-consumed-fontdue-primary-atlas-fallback-raster-pending",
      '"rendererConsumesSystemShapedRuns"',
      '"questionMarkSubstitutionDisabled"',
      '"fontAtlasFallbackGlyphs"',
      '"fontAtlasFallbackFontLoadFailures"',
      '"fontAtlasQuestionMarkSubstitutions"',
      '"textShapingRendererIntegrationReady": renderer_text_shaping_integrated',
      '"textShapingFallbackGlyphRasterizationReady": renderer_fallback_glyph_rasterization_ready',
      '"textShapingReadyForGhosttyClaim": false',
      '"textShapingBlockedUntil"',
      "winit/wgpu glyph atlas rasterizes fallback glyphs from DirectWrite-resolved fonts",
      "text-shaping-fixture-proof",
      "write_font_atlas_png",
    ]) &&
      !nativeClient.includes("or_else(|| atlas_glyphs.get(&'?'))") &&
      !nativeClient.includes("let fallback = font.rasterize('?', font_px)"),
    "aether-native artifacts disclose DirectWrite run consumption separately from pending fallback glyph rasterization",
  ),
  check(
    "tests-cover-policy-contract",
    hasAll(textShaping, [
      "policy_keeps_ghostty_claim_blocked_until_system_shaper",
      "policy_shaper_classifies_required_fallbacks",
      "directwrite_shaper_shapes_system_clusters_without_unlocking_visual_claim",
      "combining_marks_stay_with_previous_cluster",
      "rejects_zero_cell_metrics",
    ]),
    "Rust tests lock the no-false-claim policy and fallback classification behavior",
  ),
  check(
    "design-doc-updated",
    hasAll(g5Design, [
      "G5 Implementation Status",
      "Native text-shaping contract added",
      "Ghostty/WezTerm parity remains BLOCKED",
      "verify:native-text-shaping-fallback",
    ]),
    "G5 design doc records the implemented boundary and remaining release blockers",
  ),
];

const systemTextShapingReady =
  checks.find((item) => item.id === "directwrite-system-shaper-boundary")?.status === "passed";
const realFontFallbackReady =
  systemTextShapingReady &&
  hasAll(textShaping, [
    "IDWriteFontFallback",
    "MapCharacters",
    "directwrite-map-characters",
    "font_file_path",
    "font_collection_index",
    "directwrite_font_file_ref",
    "IDWriteLocalFontFileLoader",
  ]);
const rendererTextShapingIntegrated =
  nativeClient.includes("fn build_native_text_shape_plan") &&
  nativeClient.includes("DirectWriteTextShaper::new") &&
  nativeClient.includes("shaper.shape_run(&input)") &&
  nativeClient.includes("renderer_consumes_system_shaped_runs") &&
  nativeClient.includes("question_mark_substitution_disabled: true") &&
  nativeClient.includes('"textShapingRendererIntegrationReady": renderer_text_shaping_integrated') &&
  !nativeClient.includes("or_else(|| atlas_glyphs.get(&'?'))") &&
  !nativeClient.includes("let fallback = font.rasterize('?', font_px)");
const rendererFallbackGlyphRasterizationReady =
  rendererTextShapingIntegrated &&
  hasAll(nativeClient, [
    "fallback_font_refs",
    "load_fontdue_font_from_path",
    "fontdue::FontSettings",
    "collection_index",
    "font_atlas_fallback_glyphs > 0",
    "font_atlas_fallback_font_load_failures == 0",
    "font_atlas_missing_fallback_glyphs == 0",
    '"fontAtlasFallbackGlyphs"',
    '"fontAtlasFallbackFontLoadFailures"',
    "directwrite-shaped-run-consumed-fontdue-directwrite-fallback-atlas",
  ]);
const fixturePngPath = typeof visualFixture?.png?.path === "string" ? join(ROOT, visualFixture.png.path) : null;
const visualFixtureFresh =
  mtime(FIXTURE_ARTIFACT) + 5000 >= visualFixtureSourceCutoffMs &&
  fixturePngPath !== null &&
  existsSync(fixturePngPath) &&
  statSync(fixturePngPath).mtimeMs + 5000 >= visualFixtureSourceCutoffMs;
const visualFallbackGlyphFixturesReady =
  visualFixtureFresh &&
  visualFixture?.visualFallbackGlyphFixturesReady === true &&
  visualFixture?.webviewUsed === false &&
  visualFixture?.reactUsed === false &&
  visualFixture?.textShaping?.rendererConsumesSystemShapedRuns === true &&
  visualFixture?.textShaping?.directWriteFallbackClusters > 0 &&
  visualFixture?.textShaping?.fontAtlasFallbackGlyphs > 0 &&
  visualFixture?.textShaping?.fontAtlasFallbackFontLoadFailures === 0 &&
  visualFixture?.textShaping?.fontAtlasMissingFallbackGlyphs === 0 &&
  visualFixture?.textShaping?.fontAtlasQuestionMarkSubstitutions === 0 &&
  visualFixture?.textShaping?.ligaturePolicy?.allowLigatures === false &&
  fixturePngPath !== null &&
  statSync(fixturePngPath).size === visualFixture.png.bytes &&
  visualFixture.png.bytes > 0;
const visualFixtureEnvironmentBlocked =
  !visualFallbackGlyphFixturesReady &&
  systemTextShapingReady &&
  realFontFallbackReady &&
  rendererTextShapingIntegrated &&
  rendererFallbackGlyphRasterizationReady &&
  /EPERM|spawn/i.test(`${fixtureRun.error ?? ""} ${fixtureRun.stderrTail ?? ""}`);
const readyForGhosttyClaim =
  systemTextShapingReady &&
  realFontFallbackReady &&
  rendererTextShapingIntegrated &&
  rendererFallbackGlyphRasterizationReady &&
  visualFallbackGlyphFixturesReady;
const unsupportedSystemShaper =
  !systemTextShapingReady &&
  !/(rustybuzz|harfbuzz|swash|cosmic-text|fontdb|DirectWrite|DWriteCreateFactory)/i.test(cargoToml) &&
  !/(rustybuzz|harfbuzz|swash|cosmic-text|fontdb|DWriteCreateFactory)/i.test(nativeClient);
const failed = checks.filter((item) => item.status !== "passed");
const ok = failed.length === 0 && !visualFixtureEnvironmentBlocked;
const report = {
  version: 1,
  ok,
  status: ok ? "review" : visualFixtureEnvironmentBlocked ? "environment-blocked-current-contract" : "fail",
  externalBlocked: visualFixtureEnvironmentBlocked,
  generatedAt: new Date().toISOString(),
  sourceCutoffMs,
  visualFixtureSourceCutoffMs,
  sourcePaths: ["scripts/verify-native-text-shaping-fallback.mjs", ...SOURCE_PATHS],
  artifactPaths: {
    visualFixture: FIXTURE_ARTIFACT,
    visualFixturePng: FIXTURE_PNG,
  },
  visualFixtureRun: fixtureRun,
  visualFixtureFresh,
  visualFixture,
  systemTextShapingReady,
  realFontFallbackReady,
  rendererTextShapingIntegrated,
  rendererFallbackGlyphRasterizationReady,
  visualFallbackGlyphFixturesReady,
  visualFixtureEnvironmentBlocked,
  readyForGhosttyClaim,
  fullNativeBlocked: true,
  unsupportedSystemShaper,
  summary:
    failed.length === 0
      ? readyForGhosttyClaim
        ? "native text-shaping subclaim is ready with DirectWrite shaped runs, DirectWrite-resolved fallback atlas rasterization, and a fresh PNG fixture; full Ghostty/WezTerm parity remains blocked by native visual, daily-driver, and boundary gates"
        : visualFixtureEnvironmentBlocked
          ? "native text-shaping source and renderer contracts are ready, but fresh visual fixture generation is environment-blocked by host process policy"
          : "native text-shaping consumes DirectWrite shaped runs and can rasterize DirectWrite-resolved fallback fonts; visual fixtures still block the text-shaping subclaim"
      : `${failed.length} native text-shaping/fallback contract checks failed`,
  externalBlockers: visualFixtureEnvironmentBlocked
    ? [
        `fresh aether-native text-shaping fixture proof is environment-blocked: ${fixtureRun.error ?? (fixtureRun.stderrTail || "host process policy unavailable")}`,
      ]
    : [],
  blockers: [
    ...(systemTextShapingReady ? [] : ["wire a Windows system-backed text shaper into the native renderer"]),
    ...(realFontFallbackReady
      ? []
      : ["replace single-font '?' substitution with real Japanese/emoji/Powerline/Nerd/box-drawing fallback"]),
    ...(rendererTextShapingIntegrated ? [] : ["wire DirectWrite shaped runs into the winit/wgpu glyph atlas renderer"]),
    ...(rendererFallbackGlyphRasterizationReady
      ? []
      : ["rasterize DirectWrite-resolved fallback font glyphs into the winit/wgpu atlas"]),
    ...(visualFallbackGlyphFixturesReady
      ? []
      : [
          visualFixtureFresh
            ? "produce native visual regression artifacts for ligature/no-ligature and fallback glyph cases"
            : `produce a fresh aether-native text-shaping-fixture-proof JSON/PNG artifact (${fixtureRun.error ?? (fixtureRun.stderrTail || "no current fixture artifact")})`,
        ]),
  ],
  checks,
};

writeJsonAtomic(OUT, report);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  process.exitCode = 1;
}
