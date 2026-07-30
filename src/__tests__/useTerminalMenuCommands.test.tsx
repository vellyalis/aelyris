import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type UseTerminalMenuCommandsOptions, useTerminalMenuCommands } from "../features/app/useTerminalMenuCommands";
import type { TerminalPaneTarget } from "../shared/types/terminalPane";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  invoke: vi.fn(),
  prompt: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../shared/ui/ConfirmDialog", () => ({ showConfirm: mocks.confirm }));
vi.mock("../shared/ui/PromptDialog", () => ({ showPrompt: mocks.prompt }));
vi.mock("../shared/store/toastStore", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
    warning: mocks.toastWarning,
  },
}));
vi.mock("../shared/lib/fallbackTelemetry", () => ({
  formatFallbackError: (error: unknown) => String(error),
  reportInvokeFailure: vi.fn(),
}));
vi.mock("../features/terminal/hooks/useCanvasIME", () => ({
  copyImeDiagnostics: vi.fn(async () => false),
  disableImeDiagnostics: vi.fn(),
  enableImeDiagnostics: vi.fn(),
  imeDiagnosticsEnabled: vi.fn(() => false),
}));

function pane(overrides: Partial<TerminalPaneTarget> = {}): TerminalPaneTarget {
  return {
    tabId: "tab-main",
    tabLabel: "Main",
    tabShell: "powershell",
    tabCwd: "C:\\repo",
    paneId: "pane-main",
    terminalId: "pty-main",
    index: 0,
    shell: "powershell",
    cwd: "C:\\repo",
    title: "Reviewer",
    label: "@review",
    role: "review",
    route: "Main.1 @review",
    ...overrides,
  };
}

function options(overrides: Partial<UseTerminalMenuCommandsOptions> = {}): UseTerminalMenuCommandsOptions {
  return {
    activeTabId: "tab-main",
    addTab: vi.fn(),
    closeTab: vi.fn(),
    panes: [pane()],
    switchPane: vi.fn(async () => ({ status: "focused" as const })),
    switchTab: vi.fn(async () => true),
    tabs: [{ id: "tab-main", label: "Main", shell: "powershell" }],
    ...overrides,
  };
}

function command(
  result: ReturnType<typeof useTerminalMenuCommands>,
  id: string,
): (typeof result.terminalCommands)[number] {
  const found = result.terminalCommands.find((item) => item.id === id);
  if (!found) throw new Error(`Missing command ${id}`);
  return found;
}

describe("useTerminalMenuCommands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.confirm.mockResolvedValue(true);
  });

  it("exposes the terminal command and menu contract from one owner", () => {
    const { result } = renderHook(() => useTerminalMenuCommands(options()));

    expect(result.current.terminalCommands.map((item) => item.id)).toEqual([
      "new-tab-ps",
      "new-tab-cmd",
      "new-tab-gitbash",
      "new-tab-wsl",
      "close-tab",
      "switch-terminal-tab",
      "switch-terminal-pane",
      "focus-next-terminal-pane",
      "focus-previous-terminal-pane",
      "move-terminal-pane-next",
      "move-terminal-pane-previous",
      "rotate-terminal-panes-next",
      "rotate-terminal-panes-previous",
      "equalize-terminal-panes",
      "tile-terminal-panes",
      "synchronize-terminal-panes-on",
      "synchronize-terminal-panes-off",
      "send-to-pane",
      "broadcast-to-all-panes",
      "enable-ime-diagnostics",
      "copy-ime-diagnostics",
      "disable-ime-diagnostics",
      "split-pane-right",
      "split-pane-down",
    ]);
    expect(result.current.terminalMenu.label).toBe("Terminal");
    expect(result.current.terminalMenu.items.map((item) => item.label)).toEqual([
      "New Terminal",
      "New CMD",
      "New Git Bash",
      "New WSL",
      "",
      "Switch Terminal Tab...",
      "Switch Terminal Pane...",
      "Focus Next Pane",
      "Focus Previous Pane",
      "Move Pane Next",
      "Move Pane Previous",
      "Rotate Panes Next",
      "Rotate Panes Previous",
      "Equalize Pane Sizes",
      "Tile Panes",
      "Synchronize Panes On",
      "Synchronize Panes Off",
      "",
      "Send Command to Pane...",
      "Broadcast Command to All Panes...",
      "",
      "Enable IME Diagnostics",
      "Copy IME Diagnostic Trace",
      "Disable IME Diagnostics",
    ]);
  });

  it("opens the pane switcher without prompting for a fallback target", async () => {
    const openPaneSwitcher = vi.fn();
    const switchPane = vi.fn();
    const { result } = renderHook(() => useTerminalMenuCommands(options({ openPaneSwitcher, switchPane })));

    await act(async () => {
      await command(result.current, "switch-terminal-pane").action();
    });

    expect(openPaneSwitcher).toHaveBeenCalledTimes(1);
    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(switchPane).not.toHaveBeenCalled();
  });

  it("does not report focus success when the pane owner rejects the target", async () => {
    mocks.prompt.mockResolvedValue("@review");
    const switchPane = vi.fn(async () => ({ status: "failed" as const, error: new Error("Pane was removed") }));
    const { result } = renderHook(() => useTerminalMenuCommands(options({ switchPane })));

    await act(async () => {
      await command(result.current, "switch-terminal-pane").action();
    });

    expect(switchPane).toHaveBeenCalledWith("tab-main", "pane-main");
    expect(mocks.toastError).toHaveBeenCalledWith("Switch terminal pane", "Pane was removed");
    expect(mocks.toastSuccess).not.toHaveBeenCalledWith("Terminal pane active", expect.anything());
  });

  it("rechecks broadcast targets after confirmation before sending", async () => {
    mocks.prompt.mockResolvedValue("echo ready");
    mocks.invoke.mockResolvedValueOnce([{}, {}]).mockResolvedValueOnce([]);
    const { result } = renderHook(() => useTerminalMenuCommands(options()));

    await act(async () => {
      await command(result.current, "broadcast-to-all-panes").action();
    });

    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "list_panes_info");
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "list_panes_info");
    expect(mocks.invoke).not.toHaveBeenCalledWith("broadcast_keys", expect.anything());
    expect(mocks.toastError).toHaveBeenCalledWith("Broadcast target changed", "No live terminal panes are available.");
  });

  it("normalizes the exact targeted-send payload", async () => {
    mocks.prompt.mockResolvedValueOnce("@review").mockResolvedValueOnce("echo ready");
    mocks.invoke.mockResolvedValueOnce([]).mockResolvedValueOnce(1);
    const { result } = renderHook(() => useTerminalMenuCommands(options()));

    await act(async () => {
      await command(result.current, "send-to-pane").action();
    });

    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "send_keys_by_target", {
      target: "@review",
      data: "echo ready\r",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Sent to pane", "1 target");
  });

  it("normalizes the exact confirmed broadcast payload", async () => {
    mocks.prompt.mockResolvedValue("echo ready");
    mocks.invoke.mockResolvedValueOnce([{}, {}]).mockResolvedValueOnce([{}, {}]).mockResolvedValueOnce(2);
    const { result } = renderHook(() => useTerminalMenuCommands(options()));

    await act(async () => {
      await command(result.current, "broadcast-to-all-panes").action();
    });

    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "broadcast_keys", {
      data: "echo ready\r",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Broadcast sent", "2 panes");
  });

  it("refreshes close-tab command ownership after the active tab changes", () => {
    const closeTab = vi.fn();
    const { result, rerender } = renderHook(
      ({ activeTabId }) => useTerminalMenuCommands(options({ activeTabId, closeTab })),
      { initialProps: { activeTabId: "tab-main" } },
    );

    rerender({ activeTabId: "tab-next" });
    command(result.current, "close-tab").action();

    expect(closeTab).toHaveBeenCalledTimes(1);
    expect(closeTab).toHaveBeenCalledWith("tab-next");
  });
});
