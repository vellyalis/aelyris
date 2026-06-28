// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { join } from "node:path";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("terminal font settings contract", () => {
  it("hydrates config font settings into the runtime terminal store", () => {
    const app = read("src/App.tsx");

    expect(app).toContain("terminal_font_family?: string");
    expect(app).toContain("font_size?: number");
    expect(app).toContain('terminal_text_clarity?: "glass" | "balanced" | "solid"');
    expect(app).toContain("terminal_surface_opacity?: number");
    expect(app).toContain("store.setTerminalAppearance({");
    expect(app).toContain("fontFamily: cfg.appearance.terminal_font_family");
    expect(app).toContain("fontSize: cfg.appearance.font_size");
    expect(app).toContain("textClarity: cfg.appearance.terminal_text_clarity");
    expect(app).toContain("surfaceOpacity: cfg.appearance.terminal_surface_opacity");
  });

  it("saves settings font changes into both config and live terminal rendering state", () => {
    const settings = read("src/features/settings/Settings.tsx");

    expect(settings).toContain("function terminalFontStack(primaryFont: string)");
    expect(settings).toContain("const terminalFontFamily = terminalFontStack(font)");
    expect(settings).toContain("terminal_font_family: terminalFontFamily");
    expect(settings).toContain("font_size: fontSize");
    expect(settings).toContain("terminal_text_clarity: terminalTextClarity");
    expect(settings).toContain("terminal_surface_opacity: terminalSurfaceOpacity");
    expect(settings).toContain("surfaceOpacity: terminalSurfaceOpacity");
  });

  it("uses the live terminal font and clarity settings for normal and agent panes", () => {
    const nativeArea = read("src/features/terminal/NativeTerminalArea.tsx");
    const agentTerminal = read("src/features/agent-terminal/AgentTerminal.tsx");

    for (const source of [nativeArea, agentTerminal]) {
      expect(source).toContain("terminalFontFamily = useAppStore((s) => s.terminalFontFamily)");
      expect(source).toContain("terminalFontSize = useAppStore((s) => s.terminalFontSize)");
      expect(source).toContain("terminalTextClarity = useAppStore((s) => s.terminalTextClarity)");
      expect(source).toContain("terminalLineHeight = useAppStore((s) => s.terminalLineHeight)");
      // Line height now threads through cell metrics so the configured
      // multiplier drives row spacing in both normal and agent panes.
      expect(source).toContain("useTerminalCellMetrics(terminalFontSize, terminalFontFamily, terminalLineHeight)");
      expect(source).toContain("fontSize={terminalFontSize}");
      expect(source).toContain("fontFamily={terminalFontFamily}");
      expect(source).toContain("textClarity={terminalTextClarity}");
    }
  });

  it("keeps text clarity as a persisted render contract", () => {
    const store = read("src/shared/store/appStore.ts");
    const canvas = read("src/features/terminal/TerminalCanvas.tsx");
    const terminalColors = read("src/features/terminal/terminalColors.ts");
    const terminalPaint = read("src/features/terminal/terminalPaint.ts");
    const paneTreeRenderer = read("src/features/terminal/pane-tree/PaneTreeRenderer.tsx");
    const paneTreeRendererStyles = read("src/features/terminal/pane-tree/PaneTreeRenderer.module.css");
    const terminalAreaStyles = read("src/features/terminal/TerminalArea.module.css");
    const settings = read("src/features/settings/Settings.tsx");
    const rustSettings = read("src-tauri/src/config/settings.rs");

    expect(store).toContain('export type TerminalTextClarity = "glass" | "balanced" | "solid"');
    expect(store).toContain('const DEFAULT_TERMINAL_TEXT_CLARITY: TerminalTextClarity = "solid"');
    expect(store).toContain("TERMINAL_TEXT_CLARITY_KEY");
    expect(store).toContain("TERMINAL_SURFACE_OPACITY_KEY");
    expect(store).toContain("terminalTextClarity: loadTerminalTextClarity()");
    expect(store).toContain("terminalSurfaceOpacity: loadTerminalSurfaceOpacity()");
    expect(settings).toContain("TERMINAL_TEXT_CLARITY_OPTIONS");
    expect(settings).toContain("settings-terminal-text-clarity");
    expect(settings).toContain("settings-terminal-surface-opacity");
    expect(canvas).toContain("data-terminal-text-clarity={textClarity}");
    expect(canvas).toContain("--terminal-surface-opacity");
    // The colour/contrast maths moved into the testable terminalColors module;
    // terminalPaint wires to it while the canvas keeps the backing translucent.
    expect(terminalPaint).toContain('from "./terminalColors"');
    expect(canvas).not.toContain("forceOpaqueCssColor");
    expect(terminalColors).toContain("export function forceOpaqueCssColor");
    expect(terminalColors).toContain("export function enhanceTerminalTextColor");
    expect(terminalColors).toContain("export function minimumTerminalContrastRatio");
    expect(terminalColors).toContain("export function dimAlphaForTextClarity");
    expect(canvas).toContain('textClarity = "solid"');
    expect(canvas).toContain("Solid clarity now means solid glyph paint");
    expect(paneTreeRenderer).toContain("terminalTextClarity = useAppStore((s) => s.terminalTextClarity)");
    expect(paneTreeRenderer).toContain("data-terminal-text-clarity={terminalTextClarity}");
    expect(paneTreeRenderer).toContain("snapPaneRectToDevicePixels");
    expect(paneTreeRenderer).toContain("snapTerminalCssPixel");
    expect(paneTreeRendererStyles).toContain('.terminalMount[data-terminal-text-clarity="solid"]');
    expect(paneTreeRendererStyles).toContain("backdrop-filter: none");
    expect(terminalAreaStyles).toContain('.terminalViewport[data-terminal-text-clarity="solid"]');
    expect(terminalAreaStyles).toContain("--terminal-surface-opacity");
    expect(rustSettings).toContain("pub terminal_text_clarity: String");
    expect(rustSettings).toContain("pub terminal_surface_opacity: f32");
    expect(rustSettings).toContain("fn default_terminal_text_clarity() -> String");
    expect(rustSettings).toContain("fn default_terminal_surface_opacity() -> f32");
    expect(rustSettings).toContain('"solid".to_string()');
  });
});
