import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauriMock = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  return {
    listeners,
    invoke: vi.fn(async () => undefined),
    listen: vi.fn(async (eventName: string, handler: (event: { payload: unknown }) => void) => {
      listeners.set(eventName, handler);
      return () => listeners.delete(eventName);
    }),
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriMock.invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: tauriMock.listen,
}));

vi.mock("../features/terminal/TerminalCanvas", () => ({
  TerminalCanvas: ({ terminalId }: { terminalId: string }) => (
    <canvas data-testid="terminal-canvas" data-terminal-id={terminalId} />
  ),
}));

import { AgentTerminal } from "../features/agent-terminal/AgentTerminal";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("AgentTerminal", () => {
  beforeEach(() => {
    tauriMock.listeners.clear();
    tauriMock.invoke.mockReset();
    tauriMock.invoke.mockResolvedValue(undefined);
    tauriMock.listen.mockClear();
    Object.defineProperty(HTMLDivElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 800,
    });
    Object.defineProperty(HTMLDivElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 400,
    });
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    cleanup();
  });

  it("disables the IME input and does not write after the agent PTY exits", async () => {
    render(<AgentTerminal ptyId="pty-agent" cli="codex" status="coding" model="codex" cost={0.12} />);

    await waitFor(() => expect(tauriMock.listen).toHaveBeenCalledWith("pty-exit-pty-agent", expect.any(Function)));
    const input = screen.getByLabelText("ターミナル入力") as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: "before exit" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(tauriMock.invoke).toHaveBeenCalledWith("write_terminal", {
        id: "pty-agent",
        data: "before exit\r",
      }),
    );

    tauriMock.invoke.mockClear();
    await act(async () => {
      tauriMock.listeners.get("pty-exit-pty-agent")?.({ payload: { code: 0, crashed: false } });
    });

    await waitFor(() => expect(input.disabled).toBe(true));
    expect(document.activeElement).not.toBe(input);

    fireEvent.change(input, { target: { value: "lost prompt" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(tauriMock.invoke).not.toHaveBeenCalledWith("write_terminal", expect.anything());
  });

  it("surfaces IME write failures instead of dropping the input silently", async () => {
    tauriMock.invoke.mockImplementation(async (...args: unknown[]) => {
      const command = args[0];
      if (command === "write_terminal") throw new Error("pty closed");
      return undefined;
    });

    render(<AgentTerminal ptyId="pty-agent" cli="codex" status="coding" model="codex" cost={0.12} />);
    const input = await screen.findByLabelText("ターミナル入力");

    fireEvent.change(input, { target: { value: "lost prompt" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByText("Input write failed: pty closed")).toBeTruthy());
  });

  it("surfaces backend resize failures as degraded terminal state", async () => {
    tauriMock.invoke.mockImplementation(async (...args: unknown[]) => {
      const command = args[0];
      if (command === "resize_terminal") throw new Error("resize denied");
      return undefined;
    });

    render(<AgentTerminal ptyId="pty-agent" cli="codex" status="coding" model="codex" cost={0.12} />);

    await waitFor(() => expect(screen.getByText("Resize failed: resize denied")).toBeTruthy());
  });
});
