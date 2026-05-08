import { describe, expect, it } from "vitest";

const sources = import.meta.glob("../shared/hooks/useKeyboardShortcuts.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const menuSources = import.meta.glob("../features/app/useAppMenus.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function getOnlySource(sourceMap: Record<string, string>): string {
  const entries = Object.entries(sourceMap);
  expect(entries.length).toBe(1);
  return entries[0][1];
}

describe("pane switcher keyboard shortcut", () => {
  it("opens the pane switcher before the Ctrl+` terminal focus fallback", () => {
    const src = getOnlySource(sources);
    const paneSwitcher = src.indexOf('e.ctrlKey && e.shiftKey && e.key === "`"');
    const terminalFocus = src.indexOf('e.ctrlKey && e.key === "`"');

    expect(paneSwitcher).toBeGreaterThan(-1);
    expect(terminalFocus).toBeGreaterThan(-1);
    expect(paneSwitcher).toBeLessThan(terminalFocus);
    expect(src).toContain("openPaneSwitcher?.();");
    expect(src).toContain("[data-testid='terminal-ime-textarea']");
    expect(src).not.toContain("xterm-helper-textarea");
  });

  it("advertises the same shortcut in the terminal command surface", () => {
    const src = getOnlySource(menuSources);

    expect(src).toContain('id: "switch-terminal-pane"');
    expect(src).toContain('shortcut: "Ctrl+Shift+`"');
  });

  it("exposes tmux-style next and previous pane cycling", () => {
    const shortcutSrc = getOnlySource(sources);
    const menuSrc = getOnlySource(menuSources);

    expect(shortcutSrc).toContain('e.ctrlKey && e.shiftKey && e.key === "]"');
    expect(shortcutSrc).toContain("void focusNextPane?.();");
    expect(shortcutSrc).toContain('e.ctrlKey && e.shiftKey && e.key === "["');
    expect(shortcutSrc).toContain("void focusPreviousPane?.();");
    expect(menuSrc).toContain('id: "focus-next-terminal-pane"');
    expect(menuSrc).toContain('shortcut: "Ctrl+Shift+]"');
    expect(menuSrc).toContain('id: "focus-previous-terminal-pane"');
    expect(menuSrc).toContain('shortcut: "Ctrl+Shift+["');
  });
});
