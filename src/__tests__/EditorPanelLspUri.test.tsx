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
  it("Editor.path uses toMonacoModelUri; notifyOpen reads the canonical URI back from Monaco", () => {
    const entries = Object.entries(sources);
    expect(entries.length).toBe(1);
    const src = entries[0][1];

    // The helper still produces a valid `file://` URI as INPUT for
    // Monaco's `Uri.parse`, but the OUTPUT (notifyOpen + provider) must
    // come from Monaco itself — `model.uri.toString()` — because Monaco
    // may re-encode on round-trip (drive-letter casing, additional
    // reserved chars our helper does not escape, non-ASCII).
    expect(src).toMatch(/import\s*\{\s*toMonacoModelUri\s*\}\s*from\s*"\.\/lsp\/lspUri"/);
    expect(src).toMatch(/const\s+monacoModelPath\s*=\s*useMemo\([\s\S]*?toMonacoModelUri\(filePath\)/);
    expect(src).toMatch(/<Editor[\s\S]*?path=\{\s*monacoModelPath\s*\}/);

    // notifyOpen must dispatch with the URI Monaco itself produced,
    // NOT the helper's raw output (which can diverge after parse →
    // toString round-trip). Provider also calls model.uri.toString()
    // (covered in registerLspProvidersUri.test), so the URIs match by
    // construction.
    expect(src).toMatch(/editor\.getModel\(\s*\)\s*\?\.\s*uri\.toString\(\s*\)/);
    expect(src).toMatch(/lsp\.notifyOpen\(\s*modelUri\s*,/);

    // The unsafe inline `file:///${filePath...}` constructions that
    // produced the four-slash bug must be gone from the LSP wiring.
    // (We strip comments first because the explanatory comment for the
    // fix references the bad pattern intentionally.)
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(stripped).not.toMatch(/`file:\/\/\/\$\{filePath\.replace\(\/\\\\\/g/);
    // Helper output must NOT be passed directly to notifyOpen — that
    // was the codex r3 BLOCK regression.
    expect(stripped).not.toMatch(/lsp\.notifyOpen\(\s*toMonacoModelUri\(/);

    // The `filePath` defensive guard must wrap the notifyOpen path —
    // codex r4 caught its accidental removal during the URI source
    // refactor. The panel's early-return makes this check redundant
    // today, but we keep it so a future Editor-mount lifecycle change
    // can't quietly start dispatching with a stale model URI.
    const lspBlockMatch = src.match(/if\s*\(\s*lsp\.isAvailable\s*\)\s*\{([\s\S]*?)\n\s+\}\s*\n\s+\}\}/);
    expect(lspBlockMatch).not.toBeNull();
    expect(lspBlockMatch?.[1]).toMatch(/if\s*\(\s*filePath\s*&&\s*content\s*!==\s*null\s*\)/);
  });
});
