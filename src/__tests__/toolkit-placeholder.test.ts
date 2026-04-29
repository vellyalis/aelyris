import { describe, expect, it } from "vitest";

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

describe("Toolkit adaptive density", () => {
  it("collapses generic command actions by default while keeping the header affordance", () => {
    const src = getToolkitSrc();

    expect(src).toContain("const [collapsed, setCollapsed] = useState(true)");
    expect(src).toContain("<PanelHeader");
    expect(src).toContain("collapsible");
    expect(src).toContain("collapsed={collapsed}");
    expect(src).toContain("!collapsed &&");
    expect(src).not.toContain('subtitle="Command deck"');
  });
});
