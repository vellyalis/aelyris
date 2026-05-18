// Vitest runs this source-contract test in Node. The app tsconfig does not
// include @types/node, so keep the Node-only imports scoped and ignored here.
// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { join } from "node:path";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

/**
 * Tests for ToolkitPanel placeholder interpolation logic.
 * Extracted from the component's onClick handler.
 */

function interpolatePlaceholders(command: string, values: Record<string, string>): string | null {
  const placeholders = command.match(/\{(\w+)\}/g);
  if (!placeholders) return command;

  let result = command;
  for (const ph of [...new Set(placeholders)]) {
    const name = ph.slice(1, -1);
    const value = values[name];
    if (value === undefined) return null; // user cancelled
    result = result.split(ph).join(value.replace(/"/g, '\\"'));
  }
  return result;
}

describe("Toolkit placeholder interpolation", () => {
  it("returns command unchanged when no placeholders", () => {
    expect(interpolatePlaceholders("git status", {})).toBe("git status");
  });

  it("replaces single placeholder", () => {
    const result = interpolatePlaceholders('git commit -m "{message}"', { message: "fix bug" });
    expect(result).toBe('git commit -m "fix bug"');
  });

  it("replaces multiple different placeholders", () => {
    const result = interpolatePlaceholders('echo "{greeting} {name}"', { greeting: "Hello", name: "World" });
    expect(result).toBe('echo "Hello World"');
  });

  it("replaces duplicate placeholders", () => {
    const result = interpolatePlaceholders("{x} and {x}", { x: "same" });
    expect(result).toBe("same and same");
  });

  it("escapes double quotes in values", () => {
    const result = interpolatePlaceholders('git commit -m "{message}"', { message: 'fix "important" bug' });
    expect(result).toBe('git commit -m "fix \\"important\\" bug"');
  });

  it("returns null when a placeholder value is missing", () => {
    const result = interpolatePlaceholders('git commit -m "{message}"', {});
    expect(result).toBeNull();
  });

  it("handles empty string as valid value", () => {
    // Empty string is a valid user input, different from undefined/cancelled
    const result = interpolatePlaceholders("{prefix}command", { prefix: "" });
    expect(result).toBe("command");
  });
});

const toolkitSources = import.meta.glob("../features/toolkit/ToolkitPanel.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function getToolkitSrc(): string {
  const entries = Object.entries(toolkitSources);
  expect(entries.length).toBe(1);
  return entries[0][1];
}

function getToolkitCss(): string {
  const cssPath = join(process.cwd(), "src", "features", "toolkit", "ToolkitPanel.module.css");
  return readFileSync(cssPath, "utf8");
}

describe("Toolkit adaptive density", () => {
  it("collapses generic command actions by default while keeping the header affordance", () => {
    const src = getToolkitSrc();

    expect(src).toContain("const [collapsed, setCollapsed] = useState(true)");
    expect(src).toContain("<PanelHeader");
    expect(src).toContain('subtitle="saved commands"');
    expect(src).toContain("collapsible");
    expect(src).toContain("collapsed={collapsed}");
    expect(src).toContain("!collapsed &&");
    expect(src).not.toContain('subtitle="Command deck"');
    expect(src).not.toContain("Sparkles");
    expect(src).not.toContain("Generate Tool");
  });

  it("surfaces the active command target in compact header chrome", () => {
    const src = getToolkitSrc();
    const css = getToolkitCss();

    expect(src).toContain("activeTargetLabel");
    expect(src).toContain("activeTargetReady");
    expect(src).toContain("Command target:");
    expect(src).toContain("styles.targetPill");
    expect(css).toContain(".targetPill");
    expect(css).toContain("width: 104px");
    expect(css).toContain("text-overflow: ellipsis");
  });

  it("uses a connected dark liquid action surface instead of isolated milky cards", () => {
    const css = getToolkitCss();
    const gridRule = css.match(/\.grid\s*{[\s\S]*?}/)?.[0] ?? "";
    const actionRule = css.match(/\.action\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(gridRule).toContain("grid-template-columns: repeat(auto-fit");
    expect(gridRule).toContain("grid-auto-rows: minmax(38px, auto)");
    expect(gridRule).toContain("gap: 1px");
    expect(gridRule).toMatch(/rgba\(0, 6, 14, 0\.3\)|var\(--toolkit-grid-bg\)/);
    expect(actionRule).toMatch(/rgba\(0, 7, 15, 0\.34\)|var\(--toolkit-tile-bg\)/);
    expect(`${gridRule}\n${actionRule}`).not.toContain("rgba(255, 255, 255, 0.14)");
    expect(gridRule).not.toContain("rgba(245, 199, 227");
    expect(`${gridRule}\n${actionRule}`).not.toContain("filter: blur(");
  });

  it("turns an empty toolkit into a clear create-or-import path", () => {
    const src = getToolkitSrc();
    const css = getToolkitCss();

    expect(src).toContain("actions.length === 0");
    expect(src).toContain("Create or import a command to run it against the selected pane.");
    expect(css).toContain(".emptyHint");
  });
});
