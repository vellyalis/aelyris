import { describe, it, expect } from "vitest";

/**
 * Tests for ToolkitPanel placeholder interpolation logic.
 * Extracted from the component's onClick handler.
 */

function interpolatePlaceholders(
  command: string,
  values: Record<string, string>,
): string | null {
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
    const result = interpolatePlaceholders(
      'git commit -m "{message}"',
      { message: "fix bug" },
    );
    expect(result).toBe('git commit -m "fix bug"');
  });

  it("replaces multiple different placeholders", () => {
    const result = interpolatePlaceholders(
      'echo "{greeting} {name}"',
      { greeting: "Hello", name: "World" },
    );
    expect(result).toBe('echo "Hello World"');
  });

  it("replaces duplicate placeholders", () => {
    const result = interpolatePlaceholders(
      "{x} and {x}",
      { x: "same" },
    );
    expect(result).toBe("same and same");
  });

  it("escapes double quotes in values", () => {
    const result = interpolatePlaceholders(
      'git commit -m "{message}"',
      { message: 'fix "important" bug' },
    );
    expect(result).toBe('git commit -m "fix \\"important\\" bug"');
  });

  it("returns null when a placeholder value is missing", () => {
    const result = interpolatePlaceholders(
      'git commit -m "{message}"',
      {},
    );
    expect(result).toBeNull();
  });

  it("handles empty string as valid value", () => {
    // Empty string is a valid user input, different from undefined/cancelled
    const result = interpolatePlaceholders(
      "{prefix}command",
      { prefix: "" },
    );
    expect(result).toBe("command");
  });
});
