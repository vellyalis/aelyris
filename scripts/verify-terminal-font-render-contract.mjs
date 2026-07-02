import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "terminal-font-render-contract.json");

const SOURCE_PATHS = [
  "package.json",
  "src/App.tsx",
  "src/features/right-rail/rightRailModel.tsx",
  "src/features/settings/Settings.tsx",
  "src/features/terminal/NativeTerminalArea.tsx",
  "src/features/agent-terminal/AgentTerminal.tsx",
  "src/features/terminal/TerminalCanvas.tsx",
  "src/features/terminal/terminalCanvasGeometry.ts",
  "src/features/terminal/terminalPaint.ts",
  "src/features/terminal/gpu/terminalPaintGpu.ts",
  "src/features/terminal/terminalColors.ts",
  "src/features/terminal/repaintDecision.ts",
  "src/features/terminal/pane-tree/PaneTreeRenderer.tsx",
  "src/features/terminal/pane-tree/PaneTreeRenderer.module.css",
  "src/features/terminal/TerminalArea.module.css",
  "src/features/terminal/terminalMetrics.ts",
  "src/shared/themes/moods",
  "src/shared/store/appStore.ts",
  "src/styles/global.css",
  "src-tauri/src/config/settings.rs",
  "src/__tests__/NativeTerminalArea.test.tsx",
  "src/__tests__/TerminalCanvas.test.tsx",
  "src/__tests__/TerminalFontSettingsContract.test.ts",
  "src/__tests__/terminalColors.test.ts",
];

function source(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return "";
  if (statSync(full).isDirectory()) {
    // Module split across files (e.g. themes/moods/): concatenate its .ts
    // sources so content assertions still see the full surface.
    return readdirSync(full)
      .filter((entry) => entry.endsWith(".ts"))
      .sort()
      .map((entry) => readFileSync(join(full, entry), "utf8"))
      .join("\n");
  }
  return readFileSync(full, "utf8");
}

function mtime(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? statSync(full).mtimeMs : 0;
}

function check(id, passed, detail, evidence = {}) {
  return { id, status: passed ? "passed" : "failed", detail, evidence };
}

function hasAll(text, needles) {
  return needles.every((needle) => text.includes(needle));
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

const packageJson = source("package.json");
const app = source("src/App.tsx");
const rightRailModel = source("src/features/right-rail/rightRailModel.tsx");
const settings = source("src/features/settings/Settings.tsx");
const nativeTerminalArea = source("src/features/terminal/NativeTerminalArea.tsx");
const agentTerminal = source("src/features/agent-terminal/AgentTerminal.tsx");
const terminalCanvas = source("src/features/terminal/TerminalCanvas.tsx");
const terminalCanvasGeometry = source("src/features/terminal/terminalCanvasGeometry.ts");
const terminalPaint = source("src/features/terminal/terminalPaint.ts");
const terminalPaintGpu = source("src/features/terminal/gpu/terminalPaintGpu.ts");
const terminalColors = source("src/features/terminal/terminalColors.ts");
const repaintDecision = source("src/features/terminal/repaintDecision.ts");
const paneTreeRenderer = source("src/features/terminal/pane-tree/PaneTreeRenderer.tsx");
const paneTreeRendererStyles = source("src/features/terminal/pane-tree/PaneTreeRenderer.module.css");
const terminalAreaStyles = source("src/features/terminal/TerminalArea.module.css");
const terminalMetrics = source("src/features/terminal/terminalMetrics.ts");
const moodTheme = source("src/shared/themes/moods");
const appStore = source("src/shared/store/appStore.ts");
const globalCss = source("src/styles/global.css");
const rustSettings = source("src-tauri/src/config/settings.rs");
const nativeTerminalAreaTest = source("src/__tests__/NativeTerminalArea.test.tsx");
const terminalCanvasTest = source("src/__tests__/TerminalCanvas.test.tsx");
const sourceContractTest = source("src/__tests__/TerminalFontSettingsContract.test.ts");
const terminalColorsTest = source("src/__tests__/terminalColors.test.ts");
const appConfigSurface = `${app}\n${rightRailModel}`;

const sourceCutoffMs = Math.max(mtime("scripts/verify-terminal-font-render-contract.mjs"), ...SOURCE_PATHS.map(mtime));

const runtimePaneNeedles = [
  "terminalFontFamily = useAppStore((s) => s.terminalFontFamily)",
  "terminalFontSize = useAppStore((s) => s.terminalFontSize)",
  "terminalTextClarity = useAppStore((s) => s.terminalTextClarity)",
  "terminalLineHeight = useAppStore((s) => s.terminalLineHeight)",
  "useTerminalCellMetrics(terminalFontSize, terminalFontFamily, terminalLineHeight)",
  "fontSize={terminalFontSize}",
  "fontFamily={terminalFontFamily}",
  "lineHeight={terminalLineHeight}",
  "textClarity={terminalTextClarity}",
];

const checks = [
  check(
    "package-script",
    packageJson.includes('"verify:terminal:font-render"') &&
      packageJson.includes("scripts/verify-terminal-font-render-contract.mjs"),
    "package.json exposes the no-Vite terminal font/render contract verifier",
  ),
  check(
    "store-terminal-appearance",
    hasAll(appStore, [
      "TERMINAL_FONT_FAMILY_KEY",
      "TERMINAL_FONT_SIZE_KEY",
      "DEFAULT_TERMINAL_FONT_FAMILY",
      "Cascadia Code",
      "Cascadia Next JP",
      "BIZ UDGothic",
      "terminalFontFamily: loadTerminalFontFamily()",
      "terminalFontSize: loadTerminalFontSize()",
      "terminalTextClarity: loadTerminalTextClarity()",
      "terminalSurfaceOpacity: loadTerminalSurfaceOpacity()",
      "TERMINAL_TEXT_CLARITY_KEY",
      "TERMINAL_SURFACE_OPACITY_KEY",
      'export type TerminalTextClarity = "glass" | "balanced" | "solid"',
      'const DEFAULT_TERMINAL_TEXT_CLARITY: TerminalTextClarity = "solid"',
      "setTerminalAppearance",
      "localStorage.setItem(TERMINAL_FONT_FAMILY_KEY",
      "localStorage.setItem(TERMINAL_FONT_SIZE_KEY",
      "localStorage.setItem(TERMINAL_TEXT_CLARITY_KEY",
      "localStorage.setItem(TERMINAL_SURFACE_OPACITY_KEY",
    ]),
    "runtime store persists Cascadia-first terminal font settings and text clarity before panes render",
  ),
  check(
    "config-bootstrap",
    hasAll(appConfigSurface, [
      "terminal_font_family?: string",
      "font_size?: number",
      "terminal_text_clarity?:",
      "terminal_surface_opacity?: number",
      "store.setTerminalAppearance({",
      "fontFamily: cfg.appearance.terminal_font_family",
      "fontSize: cfg.appearance.font_size",
      "textClarity: cfg.appearance.terminal_text_clarity",
      "surfaceOpacity: cfg.appearance.terminal_surface_opacity",
    ]),
    "Tauri config hydration writes Rust settings into the live terminal appearance store",
  ),
  check(
    "settings-fallback-stack",
    hasAll(settings, [
      "TERMINAL_FONT_FALLBACKS",
      "Cascadia Next JP",
      "BIZ UDGothic",
      "Noto Sans Mono CJK JP",
      "function terminalPrimaryFont",
      "function terminalFontStack(primaryFont: string)",
      'terminalFontStack("Cascadia Code")',
    ]),
    "settings keep Japanese fallback fonts attached to the selected primary terminal font",
  ),
  check(
    "settings-loads-live-runtime",
    settings.includes("setFont(terminalPrimaryFont(cfg.appearance.terminal_font_family))") &&
      settings.includes("fontFamily: terminalFontStack(cfg.appearance.terminal_font_family)") &&
      settings.includes("fontSize: cfg.appearance.font_size"),
    "loading settings updates both UI selection and active terminal runtime font metrics",
  ),
  check(
    "settings-save-roundtrip",
    hasAll(settings, [
      "const terminalFontFamily = terminalFontStack(font)",
      "terminal_font_family: terminalFontFamily",
      "font_size: fontSize",
      "terminal_text_clarity: terminalTextClarity",
      "terminal_surface_opacity: terminalSurfaceOpacity",
      "surfaceOpacity: terminalSurfaceOpacity",
    ]),
    "saving settings round-trips font stack to Rust config and applies it immediately to existing panes",
  ),
  check(
    "normal-pane-runtime-font",
    hasAll(nativeTerminalArea, runtimePaneNeedles),
    "normal terminal panes use the store-backed terminal font settings for metrics and canvas painting",
  ),
  check(
    "agent-pane-runtime-font",
    hasAll(agentTerminal, runtimePaneNeedles),
    "agent terminal panes use the same store-backed font path as normal panes",
  ),
  check(
    "canvas-render-fidelity",
    hasAll(terminalCanvas, [
      "canvasBitmapSize",
      "canvasCssSize",
      "setTransform",
      "useTerminalRasterBackground",
      "TERMINAL_RASTER_BG_FALLBACK",
      "--terminal-raster-bg",
      "prevCanvasGeometryRef",
      "canvasGeometryChanged",
      "devicePixelRatio: canvasDevicePixelRatio",
      'textClarity = "solid"',
      'textClarity === "glass"',
      "data-terminal-text-clarity={textClarity}",
      'textCtx.fontKerning = "none"',
      'textCtx.textRendering = "auto"',
    ]) &&
      hasAll(terminalCanvasGeometry, ["snapCanvasTextCoord", "canvasBitmapSize", "canvasCssSize"]) &&
      hasAll(terminalPaint, ["snapCanvasTextCoord", "enhanceTerminalTextColor", "dimAlphaForTextClarity"]) &&
      hasAll(terminalColors, [
        "forceOpaqueCssColor",
        "minimumTerminalContrastRatio",
        "dimAlphaForTextClarity",
        'textClarity === "solid"',
        "minimumContrast <= 0",
        "const opaqueColor = fg.a < 1 ? forceOpaqueCssColor(color) : color",
        "return opaqueColor",
      ]) &&
      hasAll(repaintDecision, ["flags.canvasGeometryChanged", "flags.rowContentChanged"]) &&
      !terminalCanvas.includes('imageRendering: "pixelated"') &&
      !terminalPaint.includes('imageRendering: "pixelated"'),
    "canvas text is DPR-backed, pixel snapped, painted over a clarity-selectable in-canvas raster backing, and leaves Windows/WebView text hinting on the engine-selected path",
  ),
  check(
    "gpu-render-contract",
    hasAll(terminalPaintGpu, [
      "createTerminalGpuPaintContext",
      "alpha: true",
      "premultipliedAlpha: true",
      "gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)",
      "gl.clearColor(0, 0, 0, 0)",
      "enhanceTerminalTextColor",
      "dimAlphaForTextClarity",
      "colorToRgba(cssColor, alpha)",
      "uniform bool u_mask",
      "outColor = vec4(v_color.rgb, sampleColor.a * v_color.a)",
      "readGpuImageData",
    ]),
    "GPU terminal paint keeps the same solid-text contrast contract while preserving transparent clear alpha through premultiplied WebGL2 compositing",
  ),
  check(
    "pane-mount-pixel-grid",
    hasAll(paneTreeRenderer, [
      "snapTerminalCssPixel",
      "snapPaneRectToDevicePixels",
      "rect.right - rootRect.left",
      "rect.bottom - rootRect.top",
    ]) && !paneTreeRenderer.includes("Math.round(r.left - rootRect.left)"),
    "absolute pane mounts are snapped to the physical pixel grid so the terminal canvas is not composited at fractional device pixels",
  ),
  check(
    "solid-clarity-bypasses-blur-compositing",
    hasAll(paneTreeRenderer, [
      "terminalTextClarity = useAppStore((s) => s.terminalTextClarity)",
      "data-terminal-text-clarity={terminalTextClarity}",
    ]) &&
      hasAll(paneTreeRendererStyles, [
        '.terminalMount[data-terminal-text-clarity="solid"]',
        "backdrop-filter: none",
        "-webkit-backdrop-filter: none",
      ]) &&
      hasAll(terminalAreaStyles, [
        '.terminalArea[data-terminal-text-clarity="solid"]',
        '.terminalViewport[data-terminal-text-clarity="solid"]',
        "color-mix(in srgb, var(--terminal-raster-bg)",
      ]),
    "Sharp text mode removes terminal-shell backdrop blur and routes raster material strength through terminal surface opacity without dimming glyphs",
  ),
  check(
    "rust-config-text-clarity",
    hasAll(rustSettings, [
      "pub terminal_text_clarity: String",
      "pub terminal_surface_opacity: f32",
      "default_terminal_text_clarity",
      "default_terminal_surface_opacity",
      '"solid".to_string()',
      'terminal_text_clarity = "solid"',
      'cfg.appearance.terminal_text_clarity = "solid".to_string()',
      "cfg.appearance.terminal_surface_opacity = 0.74",
    ]),
    "Rust config persists terminal text clarity so sharp/glass rendering survives restart",
  ),
  check(
    "theme-raster-backing",
    hasAll(globalCss, ["--terminal-raster-bg"]) &&
      hasAll(moodTheme, ["--terminal-raster-bg", "MOOD_CSS_KEYS", "materialOverridesToCSS"]),
    "all mood presets and material overrides expose a dedicated terminal raster backing separate from visible material opacity",
  ),
  check(
    "metrics-render-fidelity",
    hasAll(terminalMetrics, [
      "Cascadia Code",
      "Cascadia Next JP",
      "BIZ UDGothic",
      "snapTerminalCssPixel",
      "currentTerminalDevicePixelRatio",
      "fonts.ready",
      "loadingdone",
    ]),
    "terminal metrics use the same Cascadia-first stack and refresh after browser font readiness changes",
  ),
  check(
    "browser-preview-renderer",
    hasAll(nativeTerminalArea, [
      "buildPreviewTerminalSnapshot",
      "PREVIEW_TERMINAL_ID",
      'data-renderer="canvas"',
      "snapshotOverride={previewSnapshot}",
      "terminalId={PREVIEW_TERMINAL_ID}",
    ]) &&
      !nativeTerminalArea.includes("styles.previewPrompt") &&
      hasAll(nativeTerminalAreaTest, [
        "uses the production canvas renderer for browser visual preview",
        "buildPreviewTerminalSnapshot",
        'data-renderer="canvas"',
      ]),
    "browser/Codex preview uses the same TerminalCanvas renderer instead of a clean DOM-text surrogate",
  ),
  check(
    "source-contract-test",
    hasAll(sourceContractTest, [
      "terminal font settings contract",
      "terminalFontStack",
      "terminal_font_family: terminalFontFamily",
      "terminal_text_clarity: terminalTextClarity",
      "terminal_surface_opacity: terminalSurfaceOpacity",
      "terminalFontFamily = useAppStore((s) => s.terminalFontFamily)",
      "terminalTextClarity = useAppStore((s) => s.terminalTextClarity)",
      "terminalLineHeight = useAppStore((s) => s.terminalLineHeight)",
      "useTerminalCellMetrics(terminalFontSize, terminalFontFamily, terminalLineHeight)",
      "snapPaneRectToDevicePixels",
      "forceOpaqueCssColor",
      "enhanceTerminalTextColor",
      "minimumTerminalContrastRatio",
      "dimAlphaForTextClarity",
    ]) &&
      hasAll(terminalCanvasTest, [
        'getAttribute("data-terminal-text-clarity")).toBe("solid")',
        "clears rows then paints an in-canvas raster backing before glyphs",
        "rgba(3, 10, 22, 1)",
        "boosts low-contrast text in solid clarity mode",
      ]) &&
      hasAll(terminalColorsTest, [
        "forces translucent legible glyph colours opaque outside glass mode",
        'enhanceTerminalTextColor("rgba(255, 255, 255, 0.8)", "#000000", "solid")',
        'enhanceTerminalTextColor("rgba(255, 255, 255, 0.8)", "#000000", "balanced")',
      ]),
    "source-level regression coverage records the settings-to-rendering contract and default sharp raster paint path",
  ),
];

const failed = checks.filter((item) => item.status !== "passed");
const report = {
  version: 1,
  ok: failed.length === 0,
  status: failed.length === 0 ? "pass" : "fail",
  generatedAt: new Date().toISOString(),
  sourceCutoffMs,
  sourcePaths: ["scripts/verify-terminal-font-render-contract.mjs", ...SOURCE_PATHS],
  summary:
    failed.length === 0
      ? "terminal font settings flow, text clarity contrast mode, Japanese fallback stack, DPR canvas/GPU render fidelity, and physical-pixel pane compositing are contract-covered"
      : `${failed.length} terminal font/render contract checks failed`,
  checks,
};

writeJsonAtomic(OUT, report);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  process.exitCode = 1;
}
