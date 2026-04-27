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

  it("loader records git_file_original / read_file rejections instead of swallowing to '' (codex r4)", () => {
    const entries = Object.entries(sources);
    const src = entries[0][1];

    // Codex-flagged: the prior loader did
    //   invoke(...).catch(() => "")
    // for both invokes and stamped `error: null`. A Revert click after
    // a git_file_original rejection then bypassed `cached.error` and
    // wrote the empty-string placeholder over the working copy. The
    // fix swaps to Promise.allSettled and feeds rejections into
    // `error` so the revert guard can see them.
    expect(src).toMatch(/Promise\.allSettled\(/);

    // The unsafe per-invoke `.catch(() => "")` rescue that swallowed
    // rejections must be gone from the loader path.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(stripped).not.toMatch(/git_file_original[\s\S]{0,80}\.catch\(\(\)\s*=>\s*""\)/);
    expect(stripped).not.toMatch(/read_file[\s\S]{0,80}\.catch\(\(\)\s*=>\s*""\)/);

    // The loader's error stamp must include the git rejection branch.
    expect(src).toMatch(/originalResult\.status\s*===\s*"rejected"/);
    expect(src).toMatch(/modifiedResult\.status\s*===\s*"rejected"/);

    // Per-action expected rejections (create → no git original;
    // delete → no working copy) must NOT be stamped as errors —
    // otherwise the Revert guard blocks legitimate restores.
    expect(src).toMatch(/action\s*!==\s*"create"/);
    expect(src).toMatch(/action\s*!==\s*"delete"/);
  });
});
