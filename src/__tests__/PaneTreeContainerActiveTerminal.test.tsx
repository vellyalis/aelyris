import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaneTreeContainer } from "../features/terminal/pane-tree/PaneTreeContainer";
import type { PaneNode, SplitDirection } from "../features/terminal/pane-tree/types";

// PaneTreeRenderer mounts NativeTerminalArea / IMEInputBar / ResizeObserver
// and is far too heavy for a callback regression test. Replace it with a
// passthrough that captures the latest props so the test can call
// `onTerminalReady` / `onFocusPane` / `onSplit` directly and observe the
// container's contract for `onActiveTerminalChange`.
interface CapturedProps {
  tree: PaneNode;
  activePaneId: string | null;
  terminalIds: Map<string, string>;
  onFocusPane: (id: string) => void;
  onSplit: (id: string, direction: SplitDirection) => void;
  onTerminalReady: (paneId: string, terminalId: string) => void;
}

let captured: CapturedProps | null = null;

vi.mock("../features/terminal/pane-tree/PaneTreeRenderer", () => ({
  PaneTreeRenderer: (props: CapturedProps) => {
    captured = props;
    return null;
  },
}));

function leafIds(node: PaneNode): string[] {
  if (node.type === "terminal") return [node.id];
  return [...leafIds(node.first), ...leafIds(node.second)];
}

describe("PaneTreeContainer onActiveTerminalChange", () => {
  afterEach(() => {
    captured = null;
  });

  it("reports null on mount before any pane has registered its PTY id", () => {
    const onChange = vi.fn();
    render(
      <PaneTreeContainer shell="powershell" onActiveTerminalChange={onChange} />,
    );
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("falls back to the only-pane's PTY id when no pane is explicitly focused", () => {
    const onChange = vi.fn();
    render(
      <PaneTreeContainer shell="powershell" onActiveTerminalChange={onChange} />,
    );
    const c = captured as unknown as CapturedProps;
    const initialPaneId = leafIds(c.tree)[0]!;
    act(() => {
      c.onTerminalReady(initialPaneId, "pty-abc-123");
    });
    // Last call must be the real PTY id, not the pane id and not the
    // tab UUID — this is the wiring that the StatusBar inline-image
    // budget badge depends on.
    expect(onChange).toHaveBeenLastCalledWith("pty-abc-123");
  });

  it("reports null with two unfocused panes — fallback only fires when exactly one pane exists", () => {
    const onChange = vi.fn();
    render(
      <PaneTreeContainer shell="powershell" onActiveTerminalChange={onChange} />,
    );
    let c = captured as unknown as CapturedProps;
    const firstId = leafIds(c.tree)[0]!;
    act(() => {
      c.onTerminalReady(firstId, "pty-A");
    });
    expect(onChange).toHaveBeenLastCalledWith("pty-A");

    // Split → 2 panes. The new pane has not yet registered its PTY id.
    act(() => {
      c.onSplit(firstId, "right");
    });
    c = captured as unknown as CapturedProps;
    const ids = leafIds(c.tree);
    const newPaneId = ids.find((id) => id !== firstId)!;
    act(() => {
      c.onTerminalReady(newPaneId, "pty-B");
    });
    // Two panes, no explicit focus → ambiguous → null.
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("switches to the focused pane's PTY id when the user clicks into it", () => {
    const onChange = vi.fn();
    render(
      <PaneTreeContainer shell="powershell" onActiveTerminalChange={onChange} />,
    );
    let c = captured as unknown as CapturedProps;
    const firstId = leafIds(c.tree)[0]!;
    act(() => {
      c.onTerminalReady(firstId, "pty-A");
      c.onSplit(firstId, "right");
    });
    c = captured as unknown as CapturedProps;
    const ids = leafIds(c.tree);
    const otherId = ids.find((id) => id !== firstId)!;
    act(() => {
      c.onTerminalReady(otherId, "pty-B");
      c.onFocusPane(otherId);
    });
    expect(onChange).toHaveBeenLastCalledWith("pty-B");

    act(() => {
      c.onFocusPane(firstId);
    });
    expect(onChange).toHaveBeenLastCalledWith("pty-A");
  });
});
