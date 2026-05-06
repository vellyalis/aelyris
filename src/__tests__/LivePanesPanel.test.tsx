import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TerminalPaneTarget } from "../App";
import { LivePanesPanel } from "../features/context/LivePanesPanel";
import type { Invoke } from "../shared/hooks/useLogStream";
import { useConfirmStore } from "../shared/ui/ConfirmDialog";
import { usePromptStore } from "../shared/ui/PromptDialog";

function pane(overrides: Partial<TerminalPaneTarget> = {}): TerminalPaneTarget {
  return {
    tabId: "tab-main",
    tabLabel: "Main",
    tabShell: "powershell",
    tabCwd: "C:\\repo",
    paneId: "pane-main",
    terminalId: "pty-main",
    lifecycle: overrides.terminalId === null ? "layout-only" : "live",
    index: 0,
    shell: "powershell",
    cwd: "C:\\repo",
    title: "PowerShell",
    role: undefined,
    ...overrides,
  };
}

describe("LivePanesPanel", () => {
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

  it("renders live panes with role and compact cwd metadata", async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "list_panes_info") {
        return [
          {
            terminal_id: "terminal-123456",
            name: "Build",
            role: "build",
            shell_type: "powershell",
            cwd: "C:\\Users\\owner\\Aether_Terminal",
          },
        ];
      }
      return undefined;
    }) as Invoke;

    render(<LivePanesPanel invoke={invoke} pollMs={60_000} />);

    expect(await screen.findByText("Build")).toBeTruthy();
    expect(screen.getByText("@build")).toBeTruthy();
    expect(screen.getByText("owner/Aether_Terminal")).toBeTruthy();
  });

  it("merges frontend panes with backend-only orphan terminal truth", async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "list_panes_info") {
        return [
          {
            terminal_id: "pty-build",
            name: "Build Backend",
            role: "build",
            shell_type: "powershell",
            cwd: "C:\\repo",
          },
          {
            terminal_id: "pty-orphan",
            name: "Long Runner",
            role: "agent",
            shell_type: "powershell",
            cwd: "C:\\repo\\agent",
          },
        ];
      }
      if (cmd === "list_terminals") return ["pty-build", "pty-orphan"];
      return undefined;
    }) as Invoke;

    render(
      <LivePanesPanel
        invoke={invoke}
        panes={[
          {
            tabId: "tab-main",
            tabLabel: "Main",
            tabShell: "powershell",
            paneId: "pane-build",
            terminalId: "pty-build",
            index: 0,
            shell: "powershell",
            cwd: "C:\\repo",
            title: "Build",
            role: "build",
          },
        ]}
        pollMs={60_000}
      />,
    );

    expect(await screen.findByText("Build")).toBeTruthy();
    expect(await screen.findByText("Long Runner")).toBeTruthy();
    expect(screen.getByText("Long Runner").closest("article")?.getAttribute("data-state")).toBe("orphaned");
    expect(screen.getByText("Build").closest("article")?.getAttribute("data-state")).toBe("live");
  });

  it("marks frontend-only panes when backend active terminal truth no longer contains their PTY", async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "list_panes_info") return [];
      if (cmd === "list_terminals") return ["pty-other"];
      return undefined;
    }) as Invoke;

    render(
      <LivePanesPanel
        invoke={invoke}
        panes={[
          {
            tabId: "tab-main",
            tabLabel: "Main",
            tabShell: "powershell",
            paneId: "pane-stale",
            terminalId: "pty-stale",
            index: 0,
            shell: "powershell",
            cwd: "C:\\repo",
            title: "Stale",
            role: "test",
          },
        ]}
        pollMs={60_000}
      />,
    );

    expect(await screen.findByText("Stale")).toBeTruthy();
    expect(await screen.findByText("frontend-only")).toBeTruthy();
    expect(screen.getByText("Stale").closest("article")?.getAttribute("data-state")).toBe("frontend-only");
  });

  it("adds active backend terminals even when pane metadata is missing", async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "list_panes_info") return [];
      if (cmd === "list_terminals") return ["pty-shell-only"];
      return undefined;
    }) as Invoke;

    render(<LivePanesPanel invoke={invoke} pollMs={60_000} />);

    expect(await screen.findByText("pty-shel")).toBeTruthy();
    expect(screen.getByText("pty-shel").closest("article")?.getAttribute("data-state")).toBe("live");
  });

  it("keeps the last valid pane list when a later poll returns malformed payload", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce([
        {
          terminal_id: "terminal-build",
          name: "Build",
          role: "build",
          shell_type: "powershell",
          cwd: "C:\\repo",
        },
      ])
      .mockResolvedValue(undefined) as unknown as Invoke;

    render(<LivePanesPanel invoke={invoke} pollMs={5} />);

    expect(await screen.findByText("Build")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Invalid live panes payload")).toBeTruthy());
    expect(screen.getByText("Build")).toBeTruthy();
  });

  it("caps dense pane lists and shows an overflow count", () => {
    render(
      <LivePanesPanel
        panes={Array.from({ length: 8 }, (_, index) => ({
          tabId: "tab-main",
          tabLabel: "Main",
          tabShell: "powershell",
          paneId: `pane-${index + 1}`,
          terminalId: `pty-${index + 1}`,
          index,
          shell: "powershell",
          cwd: "C:\\repo",
          title: `Pane ${index + 1}`,
          role: index === 0 ? "build" : undefined,
        }))}
        pollMs={60_000}
      />,
    );

    expect(screen.getByText("Pane 1")).toBeTruthy();
    expect(screen.getByText("Pane 5")).toBeTruthy();
    expect(screen.queryByText("Pane 6")).toBeNull();
    expect(screen.getByText("+3 more panes")).toBeTruthy();
  });

  it("sends named pane input through the target router", async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "list_panes_info") {
        return [
          {
            terminal_id: "terminal-123456",
            name: "Review",
            role: "",
            shell_type: "powershell",
            cwd: "C:\\repo",
          },
        ];
      }
      return 1;
    }) as Invoke;

    render(<LivePanesPanel invoke={invoke} pollMs={60_000} />);

    const sendButton = await screen.findByLabelText("Send command to Review");
    fireEvent.click(sendButton);
    await act(async () => {
      usePromptStore.getState().close("pnpm test");
    });

    expect(invoke).toHaveBeenCalledWith("send_keys_by_target", { target: "Review", data: "pnpm test\r" });
  });

  it("sends unnamed pane input directly by terminal id", async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === "list_panes_info") {
        return [
          {
            terminal_id: "terminal-abcdef",
            name: "",
            role: "",
            shell_type: "cmd",
            cwd: "C:\\repo",
          },
        ];
      }
      return undefined;
    }) as Invoke;

    render(<LivePanesPanel invoke={invoke} pollMs={60_000} />);

    const sendButton = await screen.findByLabelText("Send command to terminal-abcdef");
    fireEvent.click(sendButton);
    await act(async () => {
      usePromptStore.getState().close("dir");
    });

    expect(invoke).toHaveBeenCalledWith("send_keys", { terminalId: "terminal-abcdef", data: "dir\r" });
  });

  it("normalizes pasted CRLF input to one terminal carriage return", async () => {
    const invoke = vi.fn(async () => undefined) as Invoke;

    render(
      <LivePanesPanel
        invoke={invoke}
        panes={[
          {
            tabId: "tab-main",
            tabLabel: "Main",
            tabShell: "powershell",
            paneId: "pane-build",
            terminalId: "pty-build-123456",
            index: 0,
            shell: "powershell",
            cwd: "C:\\repo",
            title: "Builder",
            role: "build",
          },
        ]}
        pollMs={60_000}
      />,
    );

    fireEvent.click(await screen.findByLabelText("Send command to Main/Builder"));
    await act(async () => {
      usePromptStore.getState().close("pnpm build\r\n");
    });

    expect(invoke).toHaveBeenCalledWith("send_keys", {
      terminalId: "pty-build-123456",
      data: "pnpm build\r",
    });
  });

  it("focuses frontend pane targets and sends directly by their PTY id", async () => {
    const invoke = vi.fn(async () => undefined) as Invoke;
    const onFocusPane = vi.fn();

    render(
      <LivePanesPanel
        invoke={invoke}
        panes={[
          {
            tabId: "tab-main",
            tabLabel: "Main",
            tabShell: "powershell",
            paneId: "pane-build",
            terminalId: "pty-build-123456",
            index: 0,
            shell: "powershell",
            cwd: "C:\\repo",
            title: "Builder",
            role: "build",
          },
        ]}
        onFocusPane={onFocusPane}
        pollMs={60_000}
      />,
    );

    expect(await screen.findByText("Builder")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Focus Main/Builder"));
    expect(onFocusPane).toHaveBeenCalledWith("tab-main", "pane-build");

    fireEvent.click(screen.getByLabelText("Send command to Main/Builder"));
    await act(async () => {
      usePromptStore.getState().close("pnpm build");
    });

    expect(invoke).toHaveBeenCalledWith("send_keys", {
      terminalId: "pty-build-123456",
      data: "pnpm build\r",
    });
  });

  it("does not send to a frontend pane when its terminal target changed after the prompt opened", async () => {
    const invoke = vi.fn(async () => undefined) as Invoke;
    const { rerender } = render(
      <LivePanesPanel
        invoke={invoke}
        panes={[
          {
            tabId: "tab-main",
            tabLabel: "Main",
            tabShell: "powershell",
            paneId: "pane-build",
            terminalId: "pty-build-123456",
            index: 0,
            shell: "powershell",
            cwd: "C:\\repo",
            title: "Builder",
            role: "build",
          },
        ]}
        pollMs={60_000}
      />,
    );

    fireEvent.click(await screen.findByLabelText("Send command to Main/Builder"));
    rerender(
      <LivePanesPanel
        invoke={invoke}
        panes={[
          {
            tabId: "tab-main",
            tabLabel: "Main",
            tabShell: "powershell",
            paneId: "pane-build",
            terminalId: "pty-replacement",
            index: 0,
            shell: "powershell",
            cwd: "C:\\repo",
            title: "Builder",
            role: "build",
          },
        ]}
        pollMs={60_000}
      />,
    );

    await act(async () => {
      usePromptStore.getState().close("pnpm build");
    });

    expect(invoke).not.toHaveBeenCalledWith("send_keys", expect.anything());
  });

  it("coalesces repeated pane send clicks into one pending prompt action", async () => {
    const invoke = vi.fn(async () => undefined) as Invoke;

    render(
      <LivePanesPanel
        invoke={invoke}
        panes={[
          {
            tabId: "tab-main",
            tabLabel: "Main",
            tabShell: "powershell",
            paneId: "pane-build",
            terminalId: "pty-build-123456",
            index: 0,
            shell: "powershell",
            cwd: "C:\\repo",
            title: "Builder",
            role: "build",
          },
        ]}
        pollMs={60_000}
      />,
    );

    const sendButton = await screen.findByLabelText("Send command to Main/Builder");
    fireEvent.click(sendButton);
    expect((sendButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(sendButton);

    await act(async () => {
      usePromptStore.getState().close("pnpm build");
    });

    expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "send_keys")).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith("send_keys", {
      terminalId: "pty-build-123456",
      data: "pnpm build\r",
    });
    await waitFor(() => expect((sendButton as HTMLButtonElement).disabled).toBe(false));
  });

  it("selects and highlights frontend pane targets", async () => {
    const onSelectPane = vi.fn();

    render(
      <LivePanesPanel
        panes={[
          {
            tabId: "tab-main",
            tabLabel: "Main",
            tabShell: "powershell",
            paneId: "pane-shell",
            terminalId: "pty-shell-123456",
            index: 0,
            shell: "powershell",
            cwd: "C:\\repo",
            title: "Shell",
            role: "work",
          },
          {
            tabId: "tab-main",
            tabLabel: "Main",
            tabShell: "powershell",
            paneId: "pane-review",
            terminalId: "pty-review-123456",
            index: 1,
            shell: "powershell",
            cwd: "C:\\repo",
            title: "Review",
            role: "review",
          },
        ]}
        highlightedPaneId="pane-review"
        onSelectPane={onSelectPane}
        pollMs={60_000}
      />,
    );

    expect((await screen.findByText("Review")).closest("article")?.getAttribute("data-highlighted")).toBe("true");
    expect(screen.getByText("Review").closest("article")?.getAttribute("data-selectable")).toBe("true");
    expect(screen.getByText("Shell").closest("article")?.getAttribute("data-highlighted")).toBe("false");

    fireEvent.click(screen.getByText("Review"));
    expect(onSelectPane).toHaveBeenCalledWith(expect.objectContaining({ paneId: "pane-review" }));
  });

  it("attaches an orphaned backend session to the only detached pane from Live Panes", async () => {
    const onAttachPane = vi.fn();

    render(
      <LivePanesPanel
        panes={[
          pane({ title: "Restored Layout", paneId: "pane-detached", terminalId: null, lifecycle: "detached" }),
          pane({
            title: "Backend Orphan",
            paneId: "orphan-pty-backend",
            terminalId: "pty-backend",
            lifecycle: "orphaned",
            index: 1,
          }),
        ]}
        onAttachPane={onAttachPane}
        pollMs={60_000}
      />,
    );

    expect(screen.getByText("Restored Layout").closest("article")?.getAttribute("data-state")).toBe("detached");
    expect(screen.getByText("Backend Orphan").closest("article")?.getAttribute("data-state")).toBe("orphaned");

    fireEvent.click(screen.getByLabelText("Attach Backend Orphan"));
    expect(useConfirmStore.getState().title).toBe("Attach terminal pane");
    expect(useConfirmStore.getState().description).toContain("Restored Layout");

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(onAttachPane).toHaveBeenCalledWith("tab-main", "pane-detached", "pty-backend");
  });

  it("requires an explicit Live Panes attach destination when multiple detached panes match", async () => {
    const onAttachPane = vi.fn();

    render(
      <LivePanesPanel
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
        onAttachPane={onAttachPane}
        pollMs={60_000}
      />,
    );

    const attachButton = screen.getByLabelText("Attach Backend Orphan") as HTMLButtonElement;
    expect(attachButton.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Attach destination for Backend Orphan"), {
      target: { value: "tab-main:pane-right" },
    });

    expect(attachButton.disabled).toBe(false);
    fireEvent.click(attachButton);
    expect(useConfirmStore.getState().description).toContain("Right");

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(onAttachPane).toHaveBeenCalledWith("tab-main", "pane-right", "pty-backend");
  });

  it("confirms before broadcasting input to a role assigned to multiple panes", async () => {
    const invoke = vi.fn(async () => 2) as Invoke;

    render(
      <LivePanesPanel
        invoke={invoke}
        panes={[
          {
            tabId: "tab-main",
            tabLabel: "Main",
            tabShell: "powershell",
            paneId: "pane-build-a",
            terminalId: "pty-build-a",
            index: 0,
            shell: "powershell",
            cwd: "C:\\repo",
            title: "Build A",
            role: "build",
          },
          {
            tabId: "tab-main",
            tabLabel: "Main",
            tabShell: "powershell",
            paneId: "pane-build-b",
            terminalId: "pty-build-b",
            index: 1,
            shell: "powershell",
            cwd: "C:\\repo",
            title: "Build B",
            role: "build",
          },
        ]}
        pollMs={60_000}
      />,
    );

    expect(await screen.findByText("Build A")).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText("Broadcast to @build")[0]);
    await act(async () => {
      usePromptStore.getState().close("pnpm build");
    });

    expect(useConfirmStore.getState().open).toBe(true);
    expect(useConfirmStore.getState().title).toBe("Broadcast to @build");
    expect(invoke).not.toHaveBeenCalledWith("send_keys_by_role", expect.anything());

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(invoke).toHaveBeenCalledWith("send_keys_by_role", { role: "build", data: "pnpm build\r" });
  });

  it("cancels a multi-pane role broadcast before invoking the backend", async () => {
    const invoke = vi.fn(async () => 2) as Invoke;

    render(
      <LivePanesPanel
        invoke={invoke}
        panes={[
          {
            tabId: "tab-main",
            tabLabel: "Main",
            tabShell: "powershell",
            paneId: "pane-review-a",
            terminalId: "pty-review-a",
            index: 0,
            shell: "powershell",
            cwd: "C:\\repo",
            title: "Review A",
            role: "review",
          },
          {
            tabId: "tab-main",
            tabLabel: "Main",
            tabShell: "powershell",
            paneId: "pane-review-b",
            terminalId: "pty-review-b",
            index: 1,
            shell: "powershell",
            cwd: "C:\\repo",
            title: "Review B",
            role: "review",
          },
        ]}
        pollMs={60_000}
      />,
    );

    expect(await screen.findByText("Review A")).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText("Broadcast to @review")[0]);
    await act(async () => {
      usePromptStore.getState().close("pnpm test");
    });
    await act(async () => {
      useConfirmStore.getState().close(false);
    });

    expect(invoke).not.toHaveBeenCalledWith("send_keys_by_role", expect.anything());
  });

  it("broadcasts directly when a role is assigned to one pane", async () => {
    const invoke = vi.fn(async () => 1) as Invoke;

    render(
      <LivePanesPanel
        invoke={invoke}
        panes={[
          {
            tabId: "tab-main",
            tabLabel: "Main",
            tabShell: "powershell",
            paneId: "pane-test",
            terminalId: "pty-test",
            index: 0,
            shell: "powershell",
            cwd: "C:\\repo",
            title: "Test",
            role: "test",
          },
        ]}
        pollMs={60_000}
      />,
    );

    fireEvent.click(await screen.findByLabelText("Broadcast to @test"));
    await act(async () => {
      usePromptStore.getState().close("pnpm test");
    });

    expect(useConfirmStore.getState().open).toBe(false);
    expect(invoke).toHaveBeenCalledWith("send_keys_by_role", { role: "test", data: "pnpm test\r" });
  });

  it("does not broadcast when a role disappears after the prompt opened", async () => {
    const invoke = vi.fn(async () => 1) as Invoke;
    const { rerender } = render(
      <LivePanesPanel
        invoke={invoke}
        panes={[
          {
            tabId: "tab-main",
            tabLabel: "Main",
            tabShell: "powershell",
            paneId: "pane-test",
            terminalId: "pty-test",
            index: 0,
            shell: "powershell",
            cwd: "C:\\repo",
            title: "Test",
            role: "test",
          },
        ]}
        pollMs={60_000}
      />,
    );

    fireEvent.click(await screen.findByLabelText("Broadcast to @test"));
    rerender(<LivePanesPanel invoke={invoke} panes={[]} pollMs={60_000} />);
    await act(async () => {
      usePromptStore.getState().close("pnpm test");
    });

    expect(invoke).not.toHaveBeenCalledWith("send_keys_by_role", expect.anything());
  });

  it("normalizes pasted CRLF input before role broadcasts", async () => {
    const invoke = vi.fn(async () => 1) as Invoke;

    render(
      <LivePanesPanel
        invoke={invoke}
        panes={[
          {
            tabId: "tab-main",
            tabLabel: "Main",
            tabShell: "powershell",
            paneId: "pane-test",
            terminalId: "pty-test",
            index: 0,
            shell: "powershell",
            cwd: "C:\\repo",
            title: "Test",
            role: "test",
          },
        ]}
        pollMs={60_000}
      />,
    );

    fireEvent.click(await screen.findByLabelText("Broadcast to @test"));
    await act(async () => {
      usePromptStore.getState().close("pnpm test\r\n");
    });

    expect(invoke).toHaveBeenCalledWith("send_keys_by_role", { role: "test", data: "pnpm test\r" });
  });
});
