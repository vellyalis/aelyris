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

describe("WelcomeScreen handleDrop", () => {
  it("does not call webkitGetAsEntry — only the real Tauri path is used", () => {
    const entries = Object.entries(sources);
    expect(entries.length).toBe(1);
    const src = entries[0][1];

    // Strip `// …` and `/* … */` comments so the explanatory comment for
    // *why* this branch was removed doesn't trip the assertion.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

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
});
