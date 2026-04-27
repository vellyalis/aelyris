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
  it("Editor receives a forward-slash normalised `path` prop", () => {
    const entries = Object.entries(sources);
    expect(entries.length).toBe(1);
    const src = entries[0][1];

    // The memo helper that normalises the path must be wired through to
    // the Editor element via `path={…}`.
    expect(src).toMatch(/const\s+monacoModelPath\s*=\s*useMemo\(/);
    expect(src).toMatch(/filePath\.replace\(\s*\/\\\\\/g\s*,\s*"\/"\s*\)/);
    expect(src).toMatch(/<Editor[\s\S]*?path=\{\s*monacoModelPath\s*\}/);
  });
});
