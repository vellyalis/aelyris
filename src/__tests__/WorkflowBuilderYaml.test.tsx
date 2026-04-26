import { describe, expect, it } from "vitest";

/**
 * Regression guard for WorkflowBuilder YAML serialization bug.
 *
 * Bug (HIGH): buildYaml emitted the prompt as `prompt: "${agent.prompt}"`
 * with no escaping. A prompt containing a double-quote (e.g. {"OK" と
 * 言ったら…}) produced invalid YAML — `prompt: ""OK" と言ったら…"` — and
 * the workflow failed to start with a generic parse error.
 *
 * Fix: escape the YAML double-quoted scalar (backslash, quote, newline,
 * carriage return) before injecting the prompt.
 */

const sources = import.meta.glob("../features/workflow/WorkflowBuilder.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("WorkflowBuilder YAML escape", () => {
  it("prompt is run through a string escape helper before injection", () => {
    const entries = Object.entries(sources);
    expect(entries.length).toBe(1);
    const src = entries[0][1];

    // The fix introduces a local escape helper. The exact name doesn't
    // matter, but the prompt line must call it instead of inlining the
    // raw string.
    expect(src).toMatch(/prompt:\s*"\$\{escapeYamlString\(/);

    // The helper must escape backslash and double-quote at minimum.
    expect(src).toMatch(/replace\(\s*\/\\\\\/g\s*,\s*"\\\\\\\\"/); // \\ → \\\\
    expect(src).toMatch(/replace\(\s*\/"\/g\s*,\s*'\\\\"'/); // " → \"

    // The unsafe direct interpolation must be gone.
    expect(src).not.toMatch(/prompt:\s*"\$\{agent\.prompt\}"/);
  });

  it("import path inverts the escape so prompt round-trips cleanly (codex r0 M2)", () => {
    const entries = Object.entries(sources);
    const src = entries[0][1];

    // Without an inverse, an exported `prompt: "foo \"bar\""` re-imports
    // as the literal string `foo \"bar\"` — the next export then
    // double-escapes to `foo \\\"bar\\\"`. Round-trip is broken.
    expect(src).toMatch(/unescapeYamlString\(/);

    // The unescape must run on the prompt assignment in the importer.
    expect(src).toMatch(/currentPhase\.prompt\s*=\s*unescapeYamlString\(/);
  });
});
