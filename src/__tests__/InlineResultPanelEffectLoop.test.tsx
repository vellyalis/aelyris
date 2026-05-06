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
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(stripped).not.toMatch(/git_file_original[\s\S]{0,80}\.catch\(\(\)\s*=>\s*""\)/);
    expect(stripped).not.toMatch(/read_file[\s\S]{0,80}\.catch\(\(\)\s*=>\s*""\)/);

    // The loader's error stamp must include the git rejection branch.
    expect(src).toMatch(/originalResult\.status\s*===\s*"rejected"/);
    expect(src).toMatch(/modifiedResult\.status\s*===\s*"rejected"/);

    // Per-action expected rejections (create → no git original;
    // delete → no working copy) must NOT be stamped as errors —
    // otherwise the Revert guard blocks legitimate restores.
    expect(src).toMatch(/action\s*===\s*"create"/);
    expect(src).toMatch(/action\s*===\s*"delete"/);

    // Codex r1 of this loader BLOCKed because the suppression covered
    // *every* rejection on those actions. Genuine I/O errors must
    // still propagate — gate suppression on a "file not found"
    // reason pattern.
    expect(src).toMatch(/isFileNotFoundReason/);
  });

  it("diff cache key includes action so a `create` stub can't be reused for `edit`/`delete` (codex r1 HIGH)", () => {
    const entries = Object.entries(sources);
    const src = entries[0][1];

    // The cache previously keyed entries by `path` alone. If the same
    // path showed up later with a different action, the loader's
    // `existing && !existing.loading` early-return would reuse the
    // stale `create` stub (`original: ""`), which the Revert handler
    // could then write back over the working copy.
    expect(src).toMatch(/function\s+diffCacheKey\s*\(/);
    expect(src).toMatch(/`\$\{file\.action\}:\$\{file\.path\}`/);

    // Every cache call site must go through the helper — direct
    // `diffs.get(activeFile.path)` / `next.set(path, ...)` / etc. would
    // re-introduce the cross-action stale-stub leak.
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(stripped).not.toMatch(/diffs\.get\(\s*activeFile\.path\s*\)/);
    expect(stripped).not.toMatch(/next\.delete\(\s*activeFile\.path\s*\)/);
    expect(stripped).not.toMatch(/diffsRef\.current\.get\(\s*path\s*\)/);
  });

  it("does not present the review navigation button as a fake Accept action", () => {
    const entries = Object.entries(sources);
    const src = entries[0][1];
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(stripped).not.toMatch(/toast\.success\(\s*"Accepted"/);
    expect(stripped).not.toMatch(/aria-label="Accept change"/);
    expect(stripped).toMatch(/aria-label=\{activeIndex < uniqueFiles\.length - 1 \? "Next file" : "Done reviewing"\}/);
    expect(stripped).toMatch(/onClose\(\)/);
  });

  it("keeps the active file tab reachable without horizontal scroll", () => {
    const entries = Object.entries(sources);
    const src = entries[0][1];

    expect(src).toMatch(/const visibleFileTabs = useMemo/);
    expect(src).toMatch(/Math\.min\(Math\.max\(activeIndex - 1, 0\), uniqueFiles\.length - 3\)/);
    expect(src).toMatch(/visibleFileTabs\.map/);
    expect(src).toMatch(/onClick=\{\(\) => setActiveIndex\(i\)\}/);
  });

  it("uses the shared panel header for the empty state", () => {
    const entries = Object.entries(sources);
    const src = entries[0][1];
    const start = src.indexOf("if (uniqueFiles.length === 0) {");
    const end = src.indexOf("const currentDiff", start);
    const emptyStateBranch = start >= 0 && end > start ? src.slice(start, end) : "";

    expect(emptyStateBranch).toContain("<PanelHeader");
    expect(emptyStateBranch).not.toContain("styles.header");
    expect(emptyStateBranch).not.toContain("styles.title");
  });
});
