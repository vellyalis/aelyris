import { describe, expect, it } from "vitest";

/**
 * Regression guard for the diff-loading effect in InlineResultPanel.
 *
 * Bug: an earlier revision had the load-diff useEffect deps as
 * `[activeFile, projectPath, diffs]`. Because the effect's first action
 * is `setDiffs((prev) => new Map(prev).set(path, { ..., loading: true }))`,
 * every load re-fires the effect before the original Promise.all settles —
 * the IPC pair (`git_file_original` + `read_file`) is fired twice (or more)
 * per file.
 *
 * The runtime reproduction for this is fragile in jsdom (Suspense + lazy +
 * Tauri mock interactions hang vitest), so we guard the structural fix
 * instead: the deps must include activeFile + projectPath, never `diffs`.
 */

const sources = import.meta.glob("../features/agent-inspector/InlineResultPanel.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("InlineResultPanel load-diff effect deps", () => {
  it("does not include `diffs` in the dep array (regression: effect-loop)", () => {
    const entries = Object.entries(sources);
    expect(entries.length).toBe(1);
    const src = entries[0][1];

    const effectRegex = /useEffect\(\s*\(\)\s*=>\s*\{([\s\S]*?)\},\s*\[([^\]]*)\]\s*\)/g;
    const matches = Array.from(src.matchAll(effectRegex));

    let found = false;
    for (const m of matches) {
      const body = m[1];
      const deps = m[2];
      if (!body.includes("setDiffs")) continue;
      found = true;

      const depList = deps
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);

      expect(depList).toContain("activeFile");
      expect(depList).toContain("projectPath");
      expect(depList).not.toContain("diffs");
      // Reload-after-revert relies on a dedicated trigger dep — codex
      // [P2] regression: dropping `diffs` broke the cache-delete reload
      // path because the effect no longer re-fired for the same file.
      expect(depList).toContain("reloadTick");
    }

    expect(found).toBe(true);
  });

  it("revert handler blocks while diff is still loading (codex P1 regression)", () => {
    const entries = Object.entries(sources);
    const src = entries[0][1];

    // The revert click handler must reference the cached entry's
    // `loading` flag — without that guard, a Revert click during the
    // initial fetch overwrites the file with the placeholder
    // `original: ""` and silently truncates user data.
    expect(src).toMatch(/cached\.loading/);
  });
});
