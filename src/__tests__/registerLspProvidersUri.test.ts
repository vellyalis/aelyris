import { describe, expect, it } from "vitest";

/**
 * Codex r2 surfaced an end-to-end concern: even with a percent-escaping
 * helper feeding both Editor.path and notifyOpen, the completion /
 * hover provider still reconstructed a URI from `model.uri.path` —
 * which Monaco hands back DECODED. So a path like `c#sharp/foo.ts`
 * sent to notifyOpen as `file:///C:/repo/c%23sharp/foo.ts` would be
 * reconstructed by the provider as `file:///C:/repo/c#sharp/foo.ts`,
 * re-introducing the URI mismatch.
 *
 * Fix: provider uses `model.uri.toString()` directly, which returns
 * the canonical encoded form that matches notifyOpen by construction.
 */

const sources = import.meta.glob("../features/editor/lsp/registerProviders.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("registerLspProviders URI", () => {
  it("provider derives the LSP URI from `model.uri.toString()`, not a hand-rebuilt path", () => {
    const entries = Object.entries(sources);
    expect(entries.length).toBe(1);
    const src = entries[0][1];

    expect(src).toMatch(/const\s+uri\s*=\s*model\.uri\.toString\(\s*\)/);

    // The hand-rebuilt form was the bug. Strip comments first because
    // the explanatory comment intentionally references the bad shape.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(stripped).not.toMatch(/`file:\/\/\/\$\{model\.uri\.path/);
  });
});
