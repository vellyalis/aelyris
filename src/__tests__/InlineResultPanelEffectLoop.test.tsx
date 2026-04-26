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
    }

    expect(found).toBe(true);
  });
});
