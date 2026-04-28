import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInteractiveAgent } from "../shared/hooks/useInteractiveAgent";
import type { InteractiveSession } from "../shared/types/interactiveAgent";

type Listener = (event: { payload: InteractiveSession[] }) => void;

const invokeMock = vi.fn();
const listenMock = vi.fn();
const unlistenMock = vi.fn();
const listeners: Record<string, Listener> = {};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: Listener) => listenMock(event, handler),
}));

function session(id: string): InteractiveSession {
  return {
    id,
    pty_id: id,
    cli: "codex",
    status: "coding",
    model: "codex",
    cwd: "C:\\repo",
    cost: 0,
    tokens_used: 0,
    started_at: 1,
  };
}

describe("useInteractiveAgent", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    unlistenMock.mockReset();
    for (const key of Object.keys(listeners)) delete listeners[key];
    listenMock.mockImplementation((event: string, handler: Listener) => {
      listeners[event] = handler;
      return Promise.resolve(unlistenMock);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("arms the update listener before seeding existing interactive sessions", async () => {
    const existing = [session("agent-1")];
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_interactive_agents") return Promise.resolve(existing);
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const { result } = renderHook(() => useInteractiveAgent());

    await waitFor(() => expect(result.current.sessions).toEqual(existing));
    expect(listenMock).toHaveBeenCalledWith("interactive-sessions-updated", expect.any(Function));
    const listenOrder = listenMock.mock.invocationCallOrder[0];
    const seedOrder = invokeMock.mock.invocationCallOrder.find(
      (_order, index) => invokeMock.mock.calls[index][0] === "list_interactive_agents",
    );
    expect(seedOrder).toBeGreaterThan(listenOrder);
  });

  it("keeps pre-seed events instead of overwriting them with a stale empty seed", async () => {
    const seed = {
      resolve: undefined as undefined | ((value: InteractiveSession[]) => void),
    };
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_interactive_agents") {
        return new Promise<InteractiveSession[]>((resolve) => {
          seed.resolve = resolve;
        });
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const { result } = renderHook(() => useInteractiveAgent());
    await waitFor(() => expect(listeners["interactive-sessions-updated"]).toBeDefined());

    const live = [session("agent-live")];
    listeners["interactive-sessions-updated"]?.({ payload: live });
    await waitFor(() => expect(result.current.sessions).toEqual(live));

    seed.resolve?.([]);
    await Promise.resolve();
    expect(result.current.sessions).toEqual(live);
  });
});
