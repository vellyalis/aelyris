import { describe, expect, it } from "vitest";

/**
 * Regression guard for the LSP completion URI mismatch bug.
 *
 * Bug: the `<Editor>` element had no `path` prop. Monaco generated a
 * synthetic `inmemory://model/N` URI for the model, but
 * `lsp.notifyOpen(...)` was called with `file:///<filePath>`. The LSP
 * server tracked documents under one URI while the completion provider
 * (registerProviders.tsx) issued requests against `file:///${
 * model.uri.path... }` derived from the synthetic URI — which produced
 * a bogus `file:///model/N`. The two URIs never matched, and
 * rust-analyzer / pyright returned zero completions.
 *
 * Fix: forward `path={filePath}` (forward-slash normalised) so Monaco
 * mounts the model under `file:///<path>` and both notifyOpen and the
 * provider see the same canonical URI.
 */

const sources = import.meta.glob("../features/editor/EditorPanel.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("EditorPanel LSP URI alignment", () => {
  it("Editor path and notifyOpen both go through the toMonacoModelUri helper", () => {
    const entries = Object.entries(sources);
    expect(entries.length).toBe(1);
    const src = entries[0][1];

    // Both sites must share the same helper — the prior revision
    // (codex r1 BLOCK) inlined the URI construction in two places
    // and they disagreed on POSIX paths (notifyOpen produced four
    // leading slashes vs. Monaco's three). Routing through one
    // helper makes the two URIs identical by construction.
    expect(src).toMatch(/import\s*\{\s*toMonacoModelUri\s*\}\s*from\s*"\.\/lsp\/lspUri"/);
    expect(src).toMatch(/const\s+monacoModelPath\s*=\s*useMemo\([\s\S]*?toMonacoModelUri\(filePath\)/);
    expect(src).toMatch(/lsp\.notifyOpen\(\s*toMonacoModelUri\(filePath\)/);

    // The memo result must be wired through to `<Editor path={…} />`.
    expect(src).toMatch(/<Editor[\s\S]*?path=\{\s*monacoModelPath\s*\}/);

    // The unsafe inline `file:///${filePath...}` constructions that
    // produced the four-slash bug must be gone from the LSP wiring.
    // (We strip comments first because the explanatory comment for the
    // fix references the bad pattern intentionally.)
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(stripped).not.toMatch(/`file:\/\/\/\$\{filePath\.replace\(\/\\\\\/g/);
  });
});
