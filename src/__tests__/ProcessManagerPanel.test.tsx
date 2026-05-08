// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalPaneTarget } from "../App";
import { ProcessManagerPanel } from "../features/process-manager";
import type { Invoke } from "../shared/hooks/useLogStream";
import { useConfirmStore } from "../shared/ui/ConfirmDialog";

declare const process: { cwd(): string };

function pane(overrides: Partial<TerminalPaneTarget> = {}): TerminalPaneTarget {
  return {
    tabId: "tab-main",
    tabLabel: "Main",
    tabShell: "powershell",
    tabCwd: "C:\\repo",
    paneId: "pane-main",
    terminalId: "pty-main-123456",
    lifecycle: overrides.terminalId === null ? "layout-only" : "live",
    index: 0,
    shell: "powershell",
    cwd: "C:\\repo",
    title: "PowerShell",
    role: undefined,
    ...overrides,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ProcessManagerPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    useConfirmStore.setState({
      open: false,
      title: "",
      description: "",
      confirmLabel: "OK",
      cancelLabel: "Cancel",
      tone: "default",
      resolve: null,
    });
  });

  it("renders terminal processes as app-native rows with summary metrics", () => {
    render(
      <ProcessManagerPanel
        panes={[
          pane({ title: "PowerShell", terminalId: "pty-main-123456" }),
          pane({
            tabId: "tab-build",
            tabLabel: "Build",
            paneId: "pane-build",
            terminalId: null,
            index: 0,
            shell: "gitbash",
            cwd: "C:\\repo\\packages\\ui",
            title: "Builder",
          }),
        ]}
        activeTerminalId="pty-main-123456"
      />,
    );

    expect(screen.getByText("Processes")).toBeTruthy();
    expect(screen.getByText("PowerShell")).toBeTruthy();
    expect(screen.getByText("Builder")).toBeTruthy();
    expect(screen.getByText("active")).toBeTruthy();
    expect(screen.getByText("starting")).toBeTruthy();
    expect(screen.getByText("packages/ui")).toBeTruthy();
    expect(screen.getByText("1 live")).toBeTruthy();
  });

  it("renders backend lifecycle truth for exited and crashed panes", () => {
    render(
      <ProcessManagerPanel
        panes={[
          pane({ title: "Clean Exit", paneId: "pane-exit", terminalId: "pty-exit", lifecycle: "exited" }),
          pane({ title: "Crash", paneId: "pane-crash", terminalId: "pty-crash", lifecycle: "crashed" }),
        ]}
        activeTerminalId={null}
        onRestartPane={vi.fn()}
      />,
    );

    expect(rowForText("Clean Exit")?.getAttribute("data-state")).toBe("ended");
    expect(rowForText("Crash")?.getAttribute("data-state")).toBe("failed");
    expect(screen.getByLabelText("Process recovery")).toBeTruthy();
  });

  it("surfaces detached and orphaned session truth without pretending the process is live", () => {
    render(
      <ProcessManagerPanel
        panes={[
          pane({ title: "Restored Layout", paneId: "pane-detached", terminalId: null, lifecycle: "detached" }),
          pane({ title: "Backend Orphan", paneId: "pane-orphaned", terminalId: "pty-orphaned", lifecycle: "orphaned" }),
        ]}
        activeTerminalId={null}
      />,
    );

    expect(rowForText("Restored Layout")?.getAttribute("data-state")).toBe("detached");
    expect(rowForText("Backend Orphan")?.getAttribute("data-state")).toBe("orphaned");
    expect(screen.getByLabelText("Process summary").textContent).toContain("0Live");
    expect(screen.getByText("0 live")).toBeTruthy();
    expect(screen.getByText("detached")).toBeTruthy();
    expect(screen.getByText("orphaned")).toBeTruthy();
  });

  it("keeps orphaned backend sessions cleanup-only when no attach bridge is wired", async () => {
    const invoke = vi.fn(async () => undefined) as Invoke;
    const onFocusPane = vi.fn();
    const onClosePane = vi.fn();
    const onRestartPane = vi.fn();

    render(
      <ProcessManagerPanel
        panes={[
          pane({ title: "Restored Layout", paneId: "pane-detached", terminalId: null, lifecycle: "detached" }),
          pane({
            title: "Backend Orphan",
            paneId: "orphan-pty-backend",
            terminalId: "pty-backend",
            lifecycle: "orphaned",
          }),
        ]}
        activeTerminalId={null}
        invoke={invoke}
        onFocusPane={onFocusPane}
        onClosePane={onClosePane}
        onRestartPane={onRestartPane}
        highlightedPaneId="orphan-pty-backend"
      />,
    );

    expect(screen.queryByLabelText("Focus Main/Backend Orphan")).toBeNull();
    expect((screen.getByLabelText("Restart Backend Orphan") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Close Backend Orphan pane") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Focus selected process Backend Orphan") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Restart selected process Backend Orphan") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText("End Backend Orphan"));
    expect(useConfirmStore.getState().description).toContain("orphaned backend session");

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(invoke).toHaveBeenCalledWith("close_terminal", { id: "pty-backend" });
    expect(onFocusPane).not.toHaveBeenCalled();
    expect(onClosePane).not.toHaveBeenCalled();
    expect(onRestartPane).not.toHaveBeenCalled();
    expect(rowForText("Backend Orphan")?.getAttribute("data-state")).toBe("ended");
    expect(screen.getByLabelText("Process summary").textContent).toContain("0Live");
  });

  it("attaches an orphaned backend session to the only detached pane in its tab", async () => {
    const onAttachProcess = vi.fn();

    render(
      <ProcessManagerPanel
        panes={[
          pane({ title: "Restored Layout", paneId: "pane-detached", terminalId: null, lifecycle: "detached" }),
          pane({
            title: "Backend Orphan",
            paneId: "orphan-pty-backend",
            terminalId: "pty-backend",
            lifecycle: "orphaned",
          }),
        ]}
        activeTerminalId={null}
        onAttachProcess={onAttachProcess}
        highlightedPaneId="orphan-pty-backend"
      />,
    );

    fireEvent.click(screen.getByLabelText("Attach Backend Orphan"));
    expect(useConfirmStore.getState().title).toBe("Attach terminal process");
    expect(useConfirmStore.getState().description).toContain("Restored Layout");

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(onAttachProcess).toHaveBeenCalledWith("tab-main", "pane-detached", "pty-backend");
  });

  it("requires an explicit attach destination when more than one detached pane could receive the orphan", async () => {
    const onAttachProcess = vi.fn();

    render(
      <ProcessManagerPanel
        panes={[
          pane({ title: "Left", paneId: "pane-left", terminalId: null, lifecycle: "detached" }),
          pane({ title: "Right", paneId: "pane-right", terminalId: null, lifecycle: "detached", index: 1 }),
          pane({
            title: "Backend Orphan",
            paneId: "orphan-pty-backend",
            terminalId: "pty-backend",
            lifecycle: "orphaned",
            index: 2,
          }),
        ]}
        activeTerminalId={null}
        onAttachProcess={onAttachProcess}
        highlightedPaneId="orphan-pty-backend"
      />,
    );

    expect(screen.getByLabelText("Attach Backend Orphan")).toBeTruthy();
    expect((screen.getByLabelText("Attach selected process Backend Orphan") as HTMLButtonElement).disabled).toBe(true);

    const destinationSelect = screen.getAllByLabelText("Attach destination for Backend Orphan")[0];
    if (!destinationSelect) throw new Error("expected an attach destination selector");
    fireEvent.change(destinationSelect, {
      target: { value: "tab-main:pane-right" },
    });

    expect((screen.getByLabelText("Attach selected process Backend Orphan") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByLabelText("Attach selected process Backend Orphan"));
    expect(useConfirmStore.getState().description).toContain("Right");

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(onAttachProcess).toHaveBeenCalledWith("tab-main", "pane-right", "pty-backend");
  });

  it("confirms before ending a terminal process and calls close_terminal", async () => {
    const invoke = vi.fn(async () => undefined) as Invoke;
    const onProcessEnded = vi.fn();

    render(
      <ProcessManagerPanel
        panes={[pane({ title: "Claude CLI", terminalId: "pty-claude-abcdef" })]}
        activeTerminalId={null}
        invoke={invoke}
        onProcessEnded={onProcessEnded}
      />,
    );

    fireEvent.click(screen.getByLabelText("End Claude CLI"));
    expect(useConfirmStore.getState().open).toBe(true);
    expect(useConfirmStore.getState().title).toBe("End terminal process");

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(invoke).toHaveBeenCalledWith("close_terminal", { id: "pty-claude-abcdef" });
    expect(onProcessEnded).toHaveBeenCalledWith("pty-claude-abcdef");
    expect(screen.getByText("ended")).toBeTruthy();
    expect((screen.getByLabelText("End Claude CLI") as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not end a process when its pane target changed after confirmation opened", async () => {
    const invoke = vi.fn(async () => undefined) as Invoke;
    const { rerender } = render(
      <ProcessManagerPanel
        panes={[pane({ title: "Claude CLI", paneId: "pane-claude", terminalId: "pty-claude-abcdef" })]}
        activeTerminalId={null}
        invoke={invoke}
      />,
    );

    fireEvent.click(screen.getByLabelText("End Claude CLI"));
    rerender(
      <ProcessManagerPanel
        panes={[pane({ title: "Claude CLI", paneId: "pane-claude", terminalId: "pty-new-process" })]}
        activeTerminalId={null}
        invoke={invoke}
      />,
    );

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(screen.queryByText("ended")).toBeNull();
  });

  it("exposes a fast header action for ending the active process", async () => {
    const invoke = vi.fn(async () => undefined) as Invoke;

    render(
      <ProcessManagerPanel
        panes={[
          pane({ title: "PowerShell", terminalId: "pty-shell-abcdef" }),
          pane({ title: "Claude CLI", paneId: "pane-claude", terminalId: "pty-claude-abcdef" }),
        ]}
        activeTerminalId="pty-claude-abcdef"
        invoke={invoke}
      />,
    );

    fireEvent.click(screen.getByLabelText("End active process Claude CLI"));
    expect(useConfirmStore.getState().title).toBe("End terminal process");
    expect(useConfirmStore.getState().description).toContain("Claude CLI");

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(invoke).toHaveBeenCalledWith("close_terminal", { id: "pty-claude-abcdef" });
  });

  it("does not kill when the confirmation is cancelled", async () => {
    const invoke = vi.fn(async () => undefined) as Invoke;

    render(
      <ProcessManagerPanel
        panes={[pane({ title: "Gemini CLI", terminalId: "pty-gemini-abcdef" })]}
        activeTerminalId={null}
        invoke={invoke}
      />,
    );

    fireEvent.click(screen.getByLabelText("End Gemini CLI"));
    await act(async () => {
      useConfirmStore.getState().close(false);
    });

    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not open duplicate end requests while confirmation is pending", async () => {
    const invoke = vi.fn(async () => undefined) as Invoke;
    const onProcessEnded = vi.fn();

    render(
      <ProcessManagerPanel
        panes={[pane({ title: "Claude CLI", terminalId: "pty-claude-abcdef" })]}
        activeTerminalId={null}
        invoke={invoke}
        onProcessEnded={onProcessEnded}
      />,
    );

    const endButton = screen.getByLabelText("End Claude CLI") as HTMLButtonElement;
    fireEvent.click(endButton);
    expect(endButton.disabled).toBe(true);

    fireEvent.click(endButton);
    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(onProcessEnded).toHaveBeenCalledTimes(1);
  });

  it("locks all actions for a process while an end confirmation is pending", () => {
    render(
      <ProcessManagerPanel
        panes={[
          pane({ title: "Claude CLI", paneId: "pane-claude", terminalId: "pty-claude-abcdef" }),
          pane({ title: "PowerShell", paneId: "pane-shell", terminalId: "pty-shell-abcdef" }),
        ]}
        activeTerminalId={null}
        invoke={vi.fn(async () => undefined) as Invoke}
        onClosePane={vi.fn()}
        onRestartPane={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("End Claude CLI"));

    expect((screen.getByLabelText("Restart Claude CLI") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Close Claude CLI pane") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Close PowerShell pane") as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps restart locked while confirmation is pending", async () => {
    const onRestartPane = vi.fn();

    render(
      <ProcessManagerPanel
        panes={[pane({ title: "Gemini CLI", paneId: "pane-gemini", terminalId: "pty-gemini-abcdef" })]}
        activeTerminalId={null}
        onRestartPane={onRestartPane}
      />,
    );

    const restartButton = screen.getByLabelText("Restart Gemini CLI") as HTMLButtonElement;
    fireEvent.click(restartButton);
    expect(restartButton.disabled).toBe(true);

    fireEvent.click(restartButton);
    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(onRestartPane).toHaveBeenCalledTimes(1);
  });

  it("confirms before closing a pane from the process manager", async () => {
    const onClosePane = vi.fn();

    render(
      <ProcessManagerPanel
        panes={[
          pane({ title: "Gemini CLI", paneId: "pane-gemini", terminalId: "pty-gemini-abcdef" }),
          pane({ title: "PowerShell", paneId: "pane-shell", terminalId: "pty-shell-abcdef" }),
        ]}
        activeTerminalId={null}
        onClosePane={onClosePane}
      />,
    );

    fireEvent.click(screen.getByLabelText("Close Gemini CLI pane"));
    expect(useConfirmStore.getState().open).toBe(true);
    expect(useConfirmStore.getState().title).toBe("Close terminal pane");

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(onClosePane).toHaveBeenCalledWith("tab-main", "pane-gemini");
  });

  it("does not close a stale pane after confirmation resolves", async () => {
    const onClosePane = vi.fn();
    const shellPane = pane({ title: "PowerShell", paneId: "pane-shell", terminalId: "pty-shell-abcdef" });
    const { rerender } = render(
      <ProcessManagerPanel
        panes={[pane({ title: "Gemini CLI", paneId: "pane-gemini", terminalId: "pty-gemini-abcdef" }), shellPane]}
        activeTerminalId={null}
        onClosePane={onClosePane}
      />,
    );

    fireEvent.click(screen.getByLabelText("Close Gemini CLI pane"));
    rerender(<ProcessManagerPanel panes={[shellPane]} activeTerminalId={null} onClosePane={onClosePane} />);

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(onClosePane).not.toHaveBeenCalled();
  });

  it("surfaces pane close failures without clearing the row", async () => {
    const onClosePane = vi.fn(async () => {
      throw new Error("layout write rejected");
    });

    render(
      <ProcessManagerPanel
        panes={[
          pane({ title: "Gemini CLI", paneId: "pane-gemini", terminalId: "pty-gemini-abcdef" }),
          pane({ title: "PowerShell", paneId: "pane-shell", terminalId: "pty-shell-abcdef" }),
        ]}
        activeTerminalId={null}
        onClosePane={onClosePane}
      />,
    );

    fireEvent.click(screen.getByLabelText("Close Gemini CLI pane"));
    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(onClosePane).toHaveBeenCalledWith("tab-main", "pane-gemini");
    expect(screen.getByText("layout write rejected")).toBeTruthy();
    expect(screen.getByText("Gemini CLI")).toBeTruthy();
  });

  it("confirms before requesting a pane restart", async () => {
    const onRestartPane = vi.fn();

    render(
      <ProcessManagerPanel
        panes={[pane({ title: "Gemini CLI", paneId: "pane-gemini", terminalId: "pty-gemini-abcdef" })]}
        activeTerminalId={null}
        onRestartPane={onRestartPane}
      />,
    );

    fireEvent.click(screen.getByLabelText("Restart Gemini CLI"));
    expect(useConfirmStore.getState().open).toBe(true);
    expect(useConfirmStore.getState().title).toBe("Restart terminal shell");

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(onRestartPane).toHaveBeenCalledWith("tab-main", "pane-gemini");
  });

  it("does not restart a pane that became non-restartable after confirmation opened", async () => {
    const onRestartPane = vi.fn();
    const { rerender } = render(
      <ProcessManagerPanel
        panes={[pane({ title: "Gemini CLI", paneId: "pane-gemini", terminalId: "pty-gemini-abcdef" })]}
        activeTerminalId={null}
        onRestartPane={onRestartPane}
      />,
    );

    fireEvent.click(screen.getByLabelText("Restart Gemini CLI"));
    rerender(
      <ProcessManagerPanel
        panes={[pane({ title: "Gemini CLI", paneId: "pane-gemini", terminalId: null })]}
        activeTerminalId={null}
        onRestartPane={onRestartPane}
      />,
    );

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(onRestartPane).not.toHaveBeenCalled();
    expect(screen.queryByText("restart")).toBeNull();
  });

  it("shows restarting state while restart is in flight", async () => {
    const gate = deferred();
    const onRestartPane = vi.fn(() => gate.promise);

    render(
      <ProcessManagerPanel
        panes={[pane({ title: "Gemini CLI", paneId: "pane-gemini", terminalId: "pty-gemini-abcdef" })]}
        activeTerminalId={null}
        onRestartPane={onRestartPane}
      />,
    );

    fireEvent.click(screen.getByLabelText("Restart Gemini CLI"));
    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(screen.getByText("restart")).toBeTruthy();
    expect((screen.getByLabelText("Restart Gemini CLI") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("End Gemini CLI") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });

    expect(screen.queryByText("restart")).toBeNull();
    expect((screen.getByLabelText("Restart Gemini CLI") as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps failed restart visible on the affected row", async () => {
    const onRestartPane = vi.fn(async () => {
      throw new Error("respawn rejected");
    });

    render(
      <ProcessManagerPanel
        panes={[pane({ title: "Gemini CLI", paneId: "pane-gemini", terminalId: "pty-gemini-abcdef" })]}
        activeTerminalId={null}
        onRestartPane={onRestartPane}
      />,
    );

    fireEvent.click(screen.getByLabelText("Restart Gemini CLI"));
    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(screen.getByText("failed")).toBeTruthy();
    expect(screen.getByLabelText("Process recovery")).toBeTruthy();
    expect(screen.getByLabelText("Restart affected process Gemini CLI")).toBeTruthy();
    expect(screen.getAllByText("respawn rejected").length).toBeGreaterThanOrEqual(1);
    expect((screen.getByLabelText("Restart Gemini CLI") as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps restart available after a process was ended", async () => {
    const invoke = vi.fn(async () => undefined) as Invoke;
    const onRestartPane = vi.fn();

    render(
      <ProcessManagerPanel
        panes={[pane({ title: "Claude CLI", paneId: "pane-claude", terminalId: "pty-claude-abcdef" })]}
        activeTerminalId={null}
        invoke={invoke}
        onRestartPane={onRestartPane}
      />,
    );

    fireEvent.click(screen.getByLabelText("End Claude CLI"));
    await act(async () => {
      useConfirmStore.getState().close(true);
    });
    expect(screen.getByText("ended")).toBeTruthy();
    expect(screen.getByLabelText("Process recovery")).toBeTruthy();
    expect(screen.getByLabelText("Restart affected process Claude CLI")).toBeTruthy();
    expect((screen.getByLabelText("Restart Claude CLI") as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByLabelText("Restart affected process Claude CLI"));
    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(onRestartPane).toHaveBeenCalledWith("tab-main", "pane-claude");
    expect(screen.queryByText("ended")).toBeNull();
  });

  it("disables the active header end action after the active process was ended", async () => {
    const invoke = vi.fn(async () => undefined) as Invoke;

    render(
      <ProcessManagerPanel
        panes={[pane({ title: "Claude CLI", paneId: "pane-claude", terminalId: "pty-claude-abcdef" })]}
        activeTerminalId="pty-claude-abcdef"
        invoke={invoke}
        onRestartPane={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("End active process Claude CLI"));
    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(screen.getByText("ended")).toBeTruthy();
    expect((screen.getByLabelText("End active process Claude CLI") as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables restart recovery after the ended process id is cleared", async () => {
    const invoke = vi.fn(async () => undefined) as Invoke;
    const onRestartPane = vi.fn();
    const { rerender } = render(
      <ProcessManagerPanel
        panes={[pane({ title: "Claude CLI", paneId: "pane-claude", terminalId: "pty-claude-abcdef" })]}
        activeTerminalId={null}
        invoke={invoke}
        onRestartPane={onRestartPane}
      />,
    );

    fireEvent.click(screen.getByLabelText("End Claude CLI"));
    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    rerender(
      <ProcessManagerPanel
        panes={[pane({ title: "Claude CLI", paneId: "pane-claude", terminalId: null })]}
        activeTerminalId={null}
        invoke={invoke}
        onRestartPane={onRestartPane}
      />,
    );

    expect(screen.getByText("ended")).toBeTruthy();
    expect(screen.queryByLabelText("Process recovery")).toBeNull();
    expect((screen.getByLabelText("Restart Claude CLI") as HTMLButtonElement).disabled).toBe(true);
    expect(onRestartPane).not.toHaveBeenCalled();
  });

  it("drops recovery state when the affected pane is removed", async () => {
    const invoke = vi.fn(async () => undefined) as Invoke;
    const shellPane = pane({ title: "PowerShell", paneId: "pane-shell", terminalId: "pty-shell-abcdef" });
    const { rerender } = render(
      <ProcessManagerPanel
        panes={[pane({ title: "Claude CLI", paneId: "pane-claude", terminalId: "pty-claude-abcdef" }), shellPane]}
        activeTerminalId={null}
        invoke={invoke}
        onRestartPane={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("End Claude CLI"));
    await act(async () => {
      useConfirmStore.getState().close(true);
    });
    expect(screen.getByLabelText("Process recovery")).toBeTruthy();

    rerender(
      <ProcessManagerPanel panes={[shellPane]} activeTerminalId={null} invoke={invoke} onRestartPane={vi.fn()} />,
    );

    expect(screen.queryByLabelText("Process recovery")).toBeNull();
    expect(screen.queryByText("ended")).toBeNull();
  });

  it("keeps process rows compact and app-native in narrow right rails", () => {
    const css = readFileSync(`${process.cwd()}/src/features/process-manager/ProcessManagerPanel.module.css`, "utf8");

    expect(css).toContain(".row::before");
    expect(css).toContain('.row[data-active="true"]::before');
    expect(css).toContain('.row[data-state="ended"]');
    expect(css).toContain('.row[data-state="restarting"]');
    expect(css).toContain('.row[data-state="failed"]');
    expect(css).toContain(".rowError");
    expect(css).toContain(".actions");
    expect(css).toContain(".headerActions");
    expect(css).toContain(".headerKillBtn");
    expect(css).toContain(".recovery");
    expect(css).toContain(".recoveryBtn");
    expect(css).toContain("min-width: 72px");
    expect(css).toContain("grid-template-columns: 24px minmax(0, 1fr) minmax(72px, auto)");
    expect(css).toContain(".more");
    expect(css).toContain("scrollbar-gutter: stable");
    expect(css).toContain("border-radius: var(--radius-pill)");
    expect(css).toContain("@container (max-width: 300px)");
    expect(css).toContain("grid-template-columns: 22px minmax(0, 1fr) minmax(66px, auto)");
    expect(css).toContain(".id");
    expect(css).toContain("display: none");
  });

  it("highlights the process row selected from audit or reliability", () => {
    render(
      <ProcessManagerPanel
        panes={[
          pane({ title: "PowerShell", paneId: "pane-shell", terminalId: "pty-shell-abcdef" }),
          pane({ title: "Claude CLI", paneId: "pane-claude", terminalId: "pty-claude-abcdef" }),
        ]}
        activeTerminalId={null}
        highlightedPaneId="pane-claude"
      />,
    );

    expect(rowForText("Claude CLI")?.getAttribute("data-highlighted")).toBe("true");
    expect(screen.getByText("PowerShell").closest("article")?.getAttribute("data-highlighted")).toBe("false");
  });

  it("surfaces selected audit or reliability target as a process context action", async () => {
    const onFocusPane = vi.fn();
    const onRestartPane = vi.fn();

    render(
      <ProcessManagerPanel
        panes={[
          pane({ title: "PowerShell", paneId: "pane-shell", terminalId: "pty-shell-abcdef" }),
          pane({ title: "Claude CLI", paneId: "pane-claude", terminalId: "pty-claude-abcdef" }),
        ]}
        activeTerminalId={null}
        highlightedPaneId="pane-claude"
        onFocusPane={onFocusPane}
        onRestartPane={onRestartPane}
      />,
    );

    expect(screen.getByLabelText("Selected process context")).toBeTruthy();
    expect(screen.getByText("Selected target")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Focus selected process Claude CLI"));
    expect(onFocusPane).toHaveBeenCalledWith("tab-main", "pane-claude");

    await act(async () => {});

    fireEvent.click(screen.getByLabelText("Restart selected process Claude CLI"));
    expect(useConfirmStore.getState().title).toBe("Restart terminal shell");

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(onRestartPane).toHaveBeenCalledWith("tab-main", "pane-claude");
  });

  it("keeps focus locked while a focus request is in flight", async () => {
    const gate = deferred();
    const onFocusPane = vi.fn(() => gate.promise);

    render(
      <ProcessManagerPanel
        panes={[pane({ title: "Claude CLI", paneId: "pane-claude", terminalId: "pty-claude-abcdef" })]}
        activeTerminalId={null}
        onFocusPane={onFocusPane}
        highlightedPaneId="pane-claude"
      />,
    );

    const rowFocusButton = screen.getByLabelText("Focus Main/Claude CLI") as HTMLButtonElement;
    const contextFocusButton = screen.getByLabelText("Focus selected process Claude CLI") as HTMLButtonElement;

    fireEvent.click(rowFocusButton);
    expect(rowFocusButton.disabled).toBe(true);
    expect(contextFocusButton.disabled).toBe(true);

    fireEvent.click(contextFocusButton);
    expect(onFocusPane).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });

    expect(rowFocusButton.disabled).toBe(false);
    expect(contextFocusButton.disabled).toBe(false);
  });

  it("keeps selected process restart disabled while the selected pane is still spawning", () => {
    render(
      <ProcessManagerPanel
        panes={[pane({ title: "Pending", paneId: "pane-pending", terminalId: null })]}
        activeTerminalId={null}
        highlightedPaneId="pane-pending"
        onRestartPane={vi.fn()}
      />,
    );

    expect((screen.getByLabelText("Restart selected process Pending") as HTMLButtonElement).disabled).toBe(true);
  });

  it("scrolls the highlighted process row into view", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(
      <ProcessManagerPanel
        panes={[
          pane({ title: "PowerShell", paneId: "pane-shell", terminalId: "pty-shell-abcdef" }),
          pane({ title: "Claude CLI", paneId: "pane-claude", terminalId: "pty-claude-abcdef" }),
        ]}
        activeTerminalId={null}
        highlightedPaneId="pane-claude"
      />,
    );

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  });

  it("keeps a highlighted process visible even when the process list is clipped", () => {
    render(
      <ProcessManagerPanel
        panes={Array.from({ length: 10 }, (_, index) =>
          pane({
            title: `Process ${index + 1}`,
            paneId: `pane-${index + 1}`,
            terminalId: `pty-process-${index + 1}`,
            index,
          }),
        )}
        activeTerminalId={null}
        highlightedPaneId="pane-10"
      />,
    );

    expect(screen.getByText("Process 1")).toBeTruthy();
    expect(screen.queryByText("Process 6")).toBeNull();
    expect(screen.queryByText("Process 8")).toBeNull();
    expect(rowForText("Process 10")?.getAttribute("data-highlighted")).toBe("true");
    expect(screen.getByText("+5 more processes")).toBeTruthy();
  });
});

function rowForText(text: string): HTMLElement | null {
  return (
    screen
      .getAllByText(text)
      .find((node) => node.closest("article"))
      ?.closest("article") ?? null
  );
}
