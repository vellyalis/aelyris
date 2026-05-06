import { describe, expect, it } from "vitest";

import {
  clearEndedOperationalTerminal,
  formatOperationalPaneChoice,
  type OperationalPaneSelection,
  reconcileOperationalPaneSelection,
  resolveOperationalPaneChoice,
} from "../shared/lib/operationalPaneSelection";

const selected: OperationalPaneSelection = {
  tabId: "tab-main",
  paneId: "pane-main",
  terminalId: "pty-main",
};

describe("operationalPaneSelection", () => {
  it("clears a selection when the pane no longer exists", () => {
    expect(reconcileOperationalPaneSelection(selected, [])).toBeNull();
  });

  it("keeps the selected pane but refreshes its terminal id", () => {
    expect(
      reconcileOperationalPaneSelection(selected, [
        {
          tabId: "tab-main",
          paneId: "pane-main",
          terminalId: "pty-restarted",
        },
      ]),
    ).toEqual({
      tabId: "tab-main",
      paneId: "pane-main",
      terminalId: "pty-restarted",
    });
  });

  it("clears only the dead terminal id when a selected process ends", () => {
    expect(clearEndedOperationalTerminal(selected, "pty-main")).toEqual({
      tabId: "tab-main",
      paneId: "pane-main",
      terminalId: null,
    });
  });

  it("leaves unrelated selections untouched", () => {
    expect(clearEndedOperationalTerminal(selected, "pty-other")).toBe(selected);
  });

  it("resolves tmux-style tab.index pane choices before fuzzy names", () => {
    const panes = [
      {
        tabId: "tab-main",
        tabLabel: "Main",
        paneId: "pane-build",
        terminalId: "pty-build",
        index: 0,
        title: "Build",
        shell: "powershell",
      },
      {
        tabId: "tab-main",
        tabLabel: "Main",
        paneId: "pane-review",
        terminalId: "pty-review",
        index: 1,
        title: "Build",
        shell: "powershell",
      },
    ];

    expect(resolveOperationalPaneChoice(panes, "Main.2")).toEqual({ kind: "match", pane: panes[1] });
  });

  it("reports ambiguous role or title choices instead of picking the first pane", () => {
    const panes = [
      {
        tabId: "tab-main",
        paneId: "pane-a",
        terminalId: "pty-a",
        index: 0,
        title: "Agent",
        role: "review",
      },
      {
        tabId: "tab-main",
        paneId: "pane-b",
        terminalId: "pty-b",
        index: 1,
        title: "Agent",
        role: "review",
      },
    ];

    const result = resolveOperationalPaneChoice(panes, "@review");

    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") expect(result.matches.map((pane) => pane.paneId)).toEqual(["pane-a", "pane-b"]);
  });

  it("formats durable pane choice labels with spawning state", () => {
    expect(
      formatOperationalPaneChoice({
        tabId: "tab-main",
        tabLabel: "Main",
        paneId: "pane-a",
        terminalId: null,
        index: 2,
        shell: "cmd",
      }),
    ).toBe("Main/cmd 3 (spawning)");
  });
});
