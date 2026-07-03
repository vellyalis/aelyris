import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaneTreeRenderer } from "../features/terminal/pane-tree/PaneTreeRenderer";
import type { PaneNode, PaneRole, SplitDirection } from "../features/terminal/pane-tree/types";

vi.mock("../features/terminal/NativeTerminalArea", () => ({
  NativeTerminalArea: () => <div data-testid="native-terminal-area" />,
}));

vi.mock("../features/terminal/TerminalInfoBar", () => ({
  TerminalInfoBar: () => <div data-testid="terminal-info-bar" />,
}));

vi.mock("../shared/store/appStore", () => ({
  useAppStore: <T,>(selector: (state: { terminalTextClarity: "solid" }) => T) =>
    selector({ terminalTextClarity: "solid" }),
}));

const singlePane: PaneNode = {
  type: "terminal",
  id: "pane-a",
  shell: "powershell",
};

const splitPane: PaneNode = {
  type: "split",
  id: "split-root",
  direction: "horizontal",
  ratio: 0.5,
  first: singlePane,
  second: {
    type: "terminal",
    id: "pane-b",
    shell: "powershell",
  },
};

function renderPaneTree(tree: PaneNode, maximizedPaneId: string | null = null) {
  return render(
    <PaneTreeRenderer
      tree={tree}
      activePaneId="pane-a"
      maximizedPaneId={maximizedPaneId}
      terminalIds={new Map()}
      onFocusPane={vi.fn()}
      onSplit={vi.fn<(id: string, direction: SplitDirection) => void>()}
      onClose={vi.fn()}
      onResize={vi.fn()}
      onToggleMaximize={vi.fn()}
      onRenamePane={vi.fn()}
      onCyclePaneRole={vi.fn()}
      onSetPaneRole={vi.fn<(id: string, role: PaneRole) => void>()}
      onTerminalReady={vi.fn()}
      canClose
    />,
  );
}

describe("PaneTreeRenderer terminal density chrome", () => {
  it("hides the pane header for a lone terminal pane", () => {
    renderPaneTree(singlePane);

    expect(screen.queryByTestId("terminal-info-bar")).toBeNull();
  });

  it("shows one pane header per terminal when the layout is split", () => {
    renderPaneTree(splitPane);

    expect(screen.getAllByTestId("terminal-info-bar")).toHaveLength(2);
  });

  it("hides all pane headers while one pane is maximized", () => {
    renderPaneTree(splitPane, "pane-a");

    expect(screen.queryByTestId("terminal-info-bar")).toBeNull();
  });
});
