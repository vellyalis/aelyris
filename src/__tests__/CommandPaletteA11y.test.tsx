import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type CommandItem, CommandPalette } from "../features/command-palette/CommandPalette";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver ??= ResizeObserverMock as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= vi.fn();

describe("CommandPalette accessibility", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("names the dialog, labels the filter, and exposes shortcuts to assistive tech", () => {
    const onClose = vi.fn();
    const switchPane = vi.fn();
    const commands: CommandItem[] = [
      {
        id: "switch-terminal-pane",
        label: "Switch Terminal Pane...",
        description: "Choose a live pane without detaching or respawning PTYs",
        shortcut: "Ctrl+Shift+`",
        category: "Terminal",
        keywords: ["tmux", "pane", "focus"],
        action: switchPane,
      },
      {
        id: "open-settings",
        label: "Open Settings",
        description: "Edit preferences and model config",
        shortcut: "Ctrl+,",
        category: "View",
        action: vi.fn(),
      },
    ];

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(<CommandPalette visible onClose={onClose} commands={commands} />);

    const dialog = screen.getByRole("dialog", { name: "Command Palette" });
    const describedBy = dialog.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")?.textContent).toMatch(
      /Search commands by name, category, shortcut, or keyword/i,
    );
    expect(screen.getByLabelText("Search commands")).toBeTruthy();
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("Missing `Description`"));
    warnSpy.mockRestore();

    const paneCommand = screen.getByLabelText("Switch Terminal Pane..., Ctrl+Shift+`");
    expect(paneCommand.getAttribute("aria-keyshortcuts")).toBe("Control+Shift+`");

    fireEvent.click(paneCommand);

    expect(switchPane).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
