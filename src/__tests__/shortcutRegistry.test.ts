import { describe, expect, it } from "vitest";
import {
  getShortcutHelpItems,
  matchesShortcut,
  SHORTCUT_REGISTRY,
  SHORTCUTS,
  shortcutFor,
} from "../shared/lib/shortcutRegistry";

describe("shortcut registry", () => {
  it("keeps help entries unique and describes the real split prefix", () => {
    const ids = SHORTCUT_REGISTRY.map((shortcut) => shortcut.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(shortcutFor("splitPaneRight")).toBe("Ctrl+B %");
    expect(shortcutFor("splitPaneDown")).toBe('Ctrl+B "');
    expect(getShortcutHelpItems().some(({ display }) => display === "Ctrl+Shift+H")).toBe(false);
    expect(getShortcutHelpItems().some(({ display }) => display === "Ctrl+Shift+V")).toBe(false);
  });

  it("is the matcher source used by the global shortcut hook", () => {
    expect(
      matchesShortcut(new KeyboardEvent("keydown", { key: "F6", shiftKey: true }), SHORTCUTS.cycleWorkspaceRegion),
    ).toBe(true);
    expect(
      matchesShortcut(
        new KeyboardEvent("keydown", { key: "R", ctrlKey: true, shiftKey: true }),
        SHORTCUTS.toggleRightRail,
      ),
    ).toBe(true);
    expect(matchesShortcut(new KeyboardEvent("keydown", { key: "R", ctrlKey: true }), SHORTCUTS.toggleRightRail)).toBe(
      false,
    );
  });
});
