import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TerminalPaneTarget } from "../App";
import { PaneSwitcherDialog } from "../features/terminal/pane-switcher";
import type { Invoke } from "../shared/hooks/useLogStream";
import { useConfirmStore } from "../shared/ui/ConfirmDialog";
import { usePromptStore } from "../shared/ui/PromptDialog";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver ??= ResizeObserverMock as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= vi.fn();

function pane(overrides: Partial<TerminalPaneTarget> = {}): TerminalPaneTarget {
  const target: TerminalPaneTarget = {
    tabId: "tab-main",
    tabLabel: "Main",
    tabShell: "powershell",
    tabCwd: "C:\\repo",
    paneId: "pane-main",
    terminalId: "pty-main-123456",
    index: 0,
    shell: "powershell",
    cwd: "C:\\repo",
    title: "Shell",
    role: undefined,
    ...overrides,
  };
  const label =
    target.label || target.title || (target.role ? `@${target.role}` : `${target.shell} pane ${target.index + 1}`);
  return {
    ...target,
    label,
    route: target.route || `${target.tabLabel}.${target.index + 1} ${label}`,
  };
}

describe("PaneSwitcherDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfirmStore.setState({
      open: false,
      title: "",
      description: "",
      confirmLabel: "OK",
      cancelLabel: "Cancel",
      tone: "default",
      resolve: null,
    });
    usePromptStore.setState({ open: false, title: "", placeholder: "", defaultValue: "", resolve: null });
  });

  it("links its Radix-generated description without warning noise", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(
      <PaneSwitcherDialog
        visible
        panes={[pane({ title: "Builder", role: "build" })]}
        activeTabId="tab-main"
        activeTerminalId="pty-main-123456"
        onClose={vi.fn()}
        onFocusPane={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Switch Terminal Pane" });
    const describedBy = dialog.getAttribute("aria-describedby");

    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")?.textContent).toMatch(/Filter panes by tab, role, title/i);
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("Missing `Description`"));
    warnSpy.mockRestore();
  });

  it("renders panes grouped by tab and marks the active pane", () => {
    render(
      <PaneSwitcherDialog
        visible
        panes={[
          pane({ title: "Builder", role: "build" }),
          pane({
            tabId: "tab-review",
            tabLabel: "Review",
            tabShell: "gitbash",
            paneId: "pane-review",
            terminalId: null,
            index: 0,
            shell: "gitbash",
            cwd: "C:\\repo\\packages\\ui",
            title: "Reviewer",
          }),
        ]}
        activeTabId="tab-main"
        activeTerminalId="pty-main-123456"
        onClose={vi.fn()}
        onFocusPane={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Switch Terminal Pane" });
    expect(document.getElementById(dialog.getAttribute("aria-describedby") ?? "")?.textContent).toMatch(
      /Filter panes by tab, role, title/i,
    );
    expect(screen.getByLabelText("Filter terminal panes")).toBeTruthy();
    expect(screen.getByLabelText("2 live panes")).toBeTruthy();
    expect(screen.getByText("Switch Terminal Pane")).toBeTruthy();
    expect(screen.getByText("Main")).toBeTruthy();
    expect(screen.getByText("Review")).toBeTruthy();
    expect(screen.getByText("Builder")).toBeTruthy();
    expect(screen.getByLabelText("Main.1 Builder, active")).toBeTruthy();
    expect(screen.getByText("Main.1 Builder")).toBeTruthy();
    expect(screen.getByText("@build")).toBeTruthy();
    expect(screen.getByText("active")).toBeTruthy();
    expect(screen.getByText("starting")).toBeTruthy();
    expect(screen.getByText("packages/ui")).toBeTruthy();
    expect(screen.getByLabelText("Focus Main.1 Builder")).toBeTruthy();
  });

  it("prefers pane-tree switcher labels and routes over recomputed labels", () => {
    render(
      <PaneSwitcherDialog
        visible
        panes={[
          pane({
            title: "Raw title",
            label: "@review",
            route: "Main.2 @review",
            role: "review",
          }),
        ]}
        activeTabId="tab-main"
        activeTerminalId="pty-main-123456"
        onClose={vi.fn()}
        onFocusPane={vi.fn()}
      />,
    );

    expect(screen.getAllByText("@review").length).toBeGreaterThan(0);
    expect(screen.getByText("Main.2 @review")).toBeTruthy();
    expect(screen.queryByText("Main / Raw title")).toBeNull();
  });

  it("focuses the selected pane and closes the dialog", async () => {
    const onFocusPane = vi.fn();
    const onClose = vi.fn();

    render(
      <PaneSwitcherDialog
        visible
        panes={[
          pane({ title: "Main Shell" }),
          pane({
            tabId: "tab-review",
            tabLabel: "Review",
            paneId: "pane-review",
            terminalId: "pty-review-abcdef",
            index: 0,
            title: "Reviewer",
          }),
        ]}
        activeTabId="tab-main"
        activeTerminalId="pty-main-123456"
        onClose={onClose}
        onFocusPane={onFocusPane}
      />,
    );

    fireEvent.click(screen.getByText("Reviewer"));

    expect(onFocusPane).toHaveBeenCalledWith("tab-review", "pane-review");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("restarts a pane from the action cluster after confirmation", async () => {
    const onRestartPane = vi.fn();
    const onFocusPane = vi.fn();
    const onClose = vi.fn();

    render(
      <PaneSwitcherDialog
        visible
        panes={[
          pane({ title: "Agent" }),
          pane({ paneId: "pane-peer", terminalId: "pty-peer-123456", index: 1, title: "Peer" }),
        ]}
        activeTabId="tab-main"
        activeTerminalId="pty-main-123456"
        onClose={onClose}
        onFocusPane={onFocusPane}
        onRestartPane={onRestartPane}
      />,
    );

    fireEvent.click(screen.getByLabelText("Restart Main.1 Agent"));
    expect(useConfirmStore.getState().title).toBe("Restart terminal shell");

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(onRestartPane).toHaveBeenCalledWith("tab-main", "pane-main");
    expect(onFocusPane).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("does not restart a stale pane after confirmation resolves", async () => {
    const onRestartPane = vi.fn();
    const onClose = vi.fn();
    const peer = pane({ paneId: "pane-peer", terminalId: "pty-peer-123456", index: 1, title: "Peer" });
    const { rerender } = render(
      <PaneSwitcherDialog
        visible
        panes={[pane({ title: "Agent" }), peer]}
        activeTabId="tab-main"
        activeTerminalId="pty-main-123456"
        onClose={onClose}
        onFocusPane={vi.fn()}
        onRestartPane={onRestartPane}
      />,
    );

    fireEvent.click(screen.getByLabelText("Restart Main.1 Agent"));
    rerender(
      <PaneSwitcherDialog
        visible
        panes={[peer]}
        activeTabId="tab-main"
        activeTerminalId="pty-peer-123456"
        onClose={onClose}
        onFocusPane={vi.fn()}
        onRestartPane={onRestartPane}
      />,
    );

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(onRestartPane).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("coalesces repeated restart clicks into one pending action", async () => {
    const onRestartPane = vi.fn();

    render(
      <PaneSwitcherDialog
        visible
        panes={[
          pane({ title: "Agent" }),
          pane({ paneId: "pane-peer", terminalId: "pty-peer-123456", index: 1, title: "Peer" }),
        ]}
        activeTabId="tab-main"
        activeTerminalId="pty-main-123456"
        onClose={vi.fn()}
        onFocusPane={vi.fn()}
        onRestartPane={onRestartPane}
      />,
    );

    const restart = screen.getByLabelText("Restart Main.1 Agent");
    fireEvent.click(restart);
    expect((restart as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(restart);

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(onRestartPane).toHaveBeenCalledTimes(1);
  });

  it("re-enables a restart action after confirmation is cancelled", async () => {
    render(
      <PaneSwitcherDialog
        visible
        panes={[
          pane({ title: "Agent" }),
          pane({ paneId: "pane-peer", terminalId: "pty-peer-123456", index: 1, title: "Peer" }),
        ]}
        activeTabId="tab-main"
        activeTerminalId="pty-main-123456"
        onClose={vi.fn()}
        onFocusPane={vi.fn()}
        onRestartPane={vi.fn()}
      />,
    );

    const restart = screen.getByLabelText("Restart Main.1 Agent") as HTMLButtonElement;
    fireEvent.click(restart);
    expect(restart.disabled).toBe(true);

    await act(async () => {
      useConfirmStore.getState().close(false);
    });

    await waitFor(() => expect(restart.disabled).toBe(false));
  });

  it("closes a pane from the action cluster after confirmation", async () => {
    const onClosePane = vi.fn();
    const onFocusPane = vi.fn();
    const onClose = vi.fn();

    render(
      <PaneSwitcherDialog
        visible
        panes={[
          pane({ title: "Review" }),
          pane({ paneId: "pane-peer", terminalId: "pty-peer-123456", index: 1, title: "Peer" }),
        ]}
        activeTabId="tab-main"
        activeTerminalId="pty-main-123456"
        onClose={onClose}
        onFocusPane={onFocusPane}
        onClosePane={onClosePane}
      />,
    );

    fireEvent.click(screen.getByLabelText("Close Main.1 Review"));
    expect(useConfirmStore.getState().title).toBe("Close terminal pane");

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(onClosePane).toHaveBeenCalledWith("tab-main", "pane-main");
    expect(onFocusPane).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("sends input to a pane through its PTY id", async () => {
    const invoke = vi.fn(async () => undefined) as Invoke;
    const onFocusPane = vi.fn();
    const onClose = vi.fn();

    render(
      <PaneSwitcherDialog
        visible
        panes={[pane({ title: "Shell", terminalId: "pty-shell-abcdef" })]}
        activeTabId="tab-main"
        activeTerminalId="pty-shell-abcdef"
        onClose={onClose}
        onFocusPane={onFocusPane}
        invoke={invoke}
      />,
    );

    fireEvent.click(screen.getByLabelText("Send command to Main.1 Shell"));
    expect(usePromptStore.getState().title).toBe("Send to Main.1 Shell");

    await act(async () => {
      usePromptStore.getState().close("pnpm test");
    });

    expect(invoke).toHaveBeenCalledWith("send_keys", { terminalId: "pty-shell-abcdef", data: "pnpm test\r" });
    expect(onFocusPane).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("disables send while a pane prompt is pending", async () => {
    const invoke = vi.fn(async () => undefined) as Invoke;

    render(
      <PaneSwitcherDialog
        visible
        panes={[pane({ title: "Shell", terminalId: "pty-shell-abcdef" })]}
        activeTabId="tab-main"
        activeTerminalId="pty-shell-abcdef"
        onClose={vi.fn()}
        onFocusPane={vi.fn()}
        invoke={invoke}
      />,
    );

    const send = screen.getByLabelText("Send command to Main.1 Shell") as HTMLButtonElement;
    fireEvent.click(send);
    expect(send.disabled).toBe(true);
    fireEvent.click(send);

    await act(async () => {
      usePromptStore.getState().close("pnpm test");
    });

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("locks all actions for a pane while a send prompt is pending", () => {
    render(
      <PaneSwitcherDialog
        visible
        panes={[
          pane({ title: "Shell", terminalId: "pty-shell-abcdef" }),
          pane({ paneId: "pane-peer", terminalId: "pty-peer-123456", index: 1, title: "Peer" }),
        ]}
        activeTabId="tab-main"
        activeTerminalId="pty-shell-abcdef"
        onClose={vi.fn()}
        onFocusPane={vi.fn()}
        onRestartPane={vi.fn()}
        onRenamePane={vi.fn()}
        onClosePane={vi.fn()}
        invoke={vi.fn(async () => undefined) as Invoke}
      />,
    );

    fireEvent.click(screen.getByLabelText("Send command to Main.1 Shell"));

    expect((screen.getByLabelText("Restart Main.1 Shell") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Rename Main.1 Shell") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Close Main.1 Shell") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Send command to Main.2 Peer") as HTMLButtonElement).disabled).toBe(false);
  });

  it("normalizes CRLF prompt input to a single terminal carriage return", async () => {
    const invoke = vi.fn(async () => undefined) as Invoke;

    render(
      <PaneSwitcherDialog
        visible
        panes={[pane({ title: "Shell", terminalId: "pty-shell-abcdef" })]}
        activeTabId="tab-main"
        activeTerminalId="pty-shell-abcdef"
        onClose={vi.fn()}
        onFocusPane={vi.fn()}
        invoke={invoke}
      />,
    );

    fireEvent.click(screen.getByLabelText("Send command to Main.1 Shell"));

    await act(async () => {
      usePromptStore.getState().close("pnpm test\r\n");
    });

    expect(invoke).toHaveBeenCalledWith("send_keys", { terminalId: "pty-shell-abcdef", data: "pnpm test\r" });
  });

  it("renames a pane from the action cluster", async () => {
    const onRenamePane = vi.fn();
    const onClose = vi.fn();

    render(
      <PaneSwitcherDialog
        visible
        panes={[pane({ title: "Shell" })]}
        activeTabId="tab-main"
        activeTerminalId="pty-main-123456"
        onClose={onClose}
        onFocusPane={vi.fn()}
        onRenamePane={onRenamePane}
      />,
    );

    fireEvent.click(screen.getByLabelText("Rename Main.1 Shell"));
    expect(usePromptStore.getState().title).toBe("Rename Main.1 Shell");

    await act(async () => {
      usePromptStore.getState().close("  Reviewer  ");
    });

    expect(onRenamePane).toHaveBeenCalledWith("tab-main", "pane-main", "Reviewer");
    expect(onClose).toHaveBeenCalled();
  });

  it("does not rename a stale pane after the prompt resolves", async () => {
    const onRenamePane = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <PaneSwitcherDialog
        visible
        panes={[pane({ title: "Shell" })]}
        activeTabId="tab-main"
        activeTerminalId="pty-main-123456"
        onClose={onClose}
        onFocusPane={vi.fn()}
        onRenamePane={onRenamePane}
      />,
    );

    fireEvent.click(screen.getByLabelText("Rename Main.1 Shell"));
    rerender(
      <PaneSwitcherDialog
        visible
        panes={[]}
        activeTabId="tab-main"
        activeTerminalId={null}
        onClose={onClose}
        onFocusPane={vi.fn()}
        onRenamePane={onRenamePane}
      />,
    );

    await act(async () => {
      usePromptStore.getState().close("Reviewer");
    });

    expect(onRenamePane).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cycles a pane role from the action cluster", async () => {
    const onCyclePaneRole = vi.fn();
    const onClose = vi.fn();

    render(
      <PaneSwitcherDialog
        visible
        panes={[pane({ title: "Shell", role: "work" })]}
        activeTabId="tab-main"
        activeTerminalId="pty-main-123456"
        onClose={onClose}
        onFocusPane={vi.fn()}
        onCyclePaneRole={onCyclePaneRole}
      />,
    );

    fireEvent.click(screen.getByLabelText("Cycle role for Main.1 Shell"));

    expect(onCyclePaneRole).toHaveBeenCalledWith("tab-main", "pane-main");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("does not send to a stale pane after the prompt resolves", async () => {
    const invoke = vi.fn(async () => undefined) as Invoke;
    const onClose = vi.fn();
    const { rerender } = render(
      <PaneSwitcherDialog
        visible
        panes={[pane({ title: "Shell", terminalId: "pty-shell-abcdef" })]}
        activeTabId="tab-main"
        activeTerminalId="pty-shell-abcdef"
        onClose={onClose}
        onFocusPane={vi.fn()}
        invoke={invoke}
      />,
    );

    fireEvent.click(screen.getByLabelText("Send command to Main.1 Shell"));
    rerender(
      <PaneSwitcherDialog
        visible
        panes={[pane({ title: "Shell", terminalId: null })]}
        activeTabId="tab-main"
        activeTerminalId={null}
        onClose={onClose}
        onFocusPane={vi.fn()}
        invoke={invoke}
      />,
    );

    await act(async () => {
      usePromptStore.getState().close("pnpm test");
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("disables close when it is the only pane", () => {
    render(
      <PaneSwitcherDialog
        visible
        panes={[pane({ title: "Only" })]}
        activeTabId="tab-main"
        activeTerminalId="pty-main-123456"
        onClose={vi.fn()}
        onFocusPane={vi.fn()}
        onClosePane={vi.fn()}
      />,
    );

    expect((screen.getByLabelText("Close Main.1 Only") as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables send and restart actions while a pane is still spawning", () => {
    render(
      <PaneSwitcherDialog
        visible
        panes={[pane({ title: "Pending", terminalId: null })]}
        activeTabId="tab-main"
        activeTerminalId={null}
        onClose={vi.fn()}
        onFocusPane={vi.fn()}
        onRestartPane={vi.fn()}
      />,
    );

    expect((screen.getByLabelText("Send command to Main.1 Pending") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Restart Main.1 Pending") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("active")).toBeNull();
  });
});
