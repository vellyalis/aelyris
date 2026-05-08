// Vitest runs this source-contract test in Node. The app tsconfig does not
// include @types/node, so keep the Node-only imports scoped and ignored here.
// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for WelcomeScreen handleDrop double-fire bug.
 *
 * Bug (HIGH): handleDrop checked `items[0].webkitGetAsEntry()?.isDirectory`
 * first and called `onOpenProject(entry.fullPath || entry.name)`. The
 * webkitGetAsEntry path is a *sandboxed virtual path* (e.g. "/MyFolder"),
 * not the real OS path — Tauri can't open a project from it. The handler
 * then *also* called `onOpenProject(files[0].path)` with the real Tauri-
 * injected path, so a single drop briefly opened a bogus project before
 * settling on the real one.
 *
 * Fix: drop the webkitGetAsEntry branch entirely; only the Tauri-injected
 * `path` field on the dropped File yields a usable absolute path.
 */

const sources = import.meta.glob("../features/welcome/WelcomeScreen.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

declare const process: { cwd(): string };

const welcomeCss = readFileSync(join(process.cwd(), "src/features/welcome/WelcomeScreen.module.css"), "utf8");

describe("WelcomeScreen handleDrop", () => {
  it("does not call webkitGetAsEntry — only the real Tauri path is used", () => {
    const entries = Object.entries(sources);
    expect(entries.length).toBe(1);
    const src = entries[0][1];

    // Strip `// …` and `/* … */` comments so the explanatory comment for
    // *why* this branch was removed doesn't trip the assertion.
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    // Active call sites — the bug was the items[0].webkitGetAsEntry?.() +
    // entry.fullPath path that fired before the real-path branch.
    expect(stripped).not.toMatch(/items\[\d+\]\.webkitGetAsEntry/);
    expect(stripped).not.toMatch(/\.webkitGetAsEntry\s*\?\.\(\s*\)/);
    expect(stripped).not.toMatch(/entry\?\.\s*isDirectory/);
    expect(stripped).not.toMatch(/entry\.fullPath/);

    // The real path branch must remain intact.
    expect(stripped).toMatch(/dataTransfer\.files/);
    expect(stripped).toMatch(/\.path/);
  });

  it("centers the empty recent-projects state instead of leaving the heading stranded", () => {
    const src = Object.values(sources)[0] ?? "";
    expect(src).toContain("className={styles.recentSection}");
    expect(src).toContain("data-empty={!loading && recentProjects.length === 0}");
    expect(src).toContain('aria-labelledby="welcome-recent-projects"');
    expect(welcomeCss).toContain('.recentSection[data-empty="true"]');
    expect(welcomeCss).toContain("align-items: center");
    expect(welcomeCss).toContain('.recentSection[data-empty="true"] .recentHeader');
    expect(welcomeCss).toContain("text-align: center");
    expect(welcomeCss).toContain('.recentSection[data-empty="true"] .recentList');
    expect(welcomeCss).toContain("grid-template-columns: minmax(0, 1fr)");
  });
});
