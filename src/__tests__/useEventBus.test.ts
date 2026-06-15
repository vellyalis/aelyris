import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEventBus } from "../shared/hooks/useEventBus";
import type { AgentEvent } from "../shared/types/eventBus";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriMocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauriMocks.listen }));

function event(kind: AgentEvent["kind"], channel: AgentEvent["channel"]): AgentEvent {
  return { kind, channel };
}

describe("useEventBus", () => {
  beforeEach(() => {
    tauriMocks.invoke.mockReset();
    tauriMocks.listen.mockReset();
    tauriMocks.listen.mockResolvedValue(vi.fn());
  });

  it("hydrates the feed from event_recent", async () => {
    tauriMocks.invoke.mockImplementation((cmd: string) =>
      cmd === "event_recent" ? Promise.resolve([event("task_created", "planning")]) : Promise.resolve(null),
    );
    const { result } = renderHook(() => useEventBus());
    await waitFor(() => {
      expect(result.current.events).toHaveLength(1);
      expect(result.current.events[0].kind).toBe("task_created");
    });
  });

  it("appends live agent-event stream entries", async () => {
    const ref: { current?: (payload: AgentEvent) => void } = {};
    tauriMocks.listen.mockImplementation((name: string, cb: (e: { payload: AgentEvent }) => void) => {
      if (name === "agent-event") ref.current = (payload) => cb({ payload });
      return Promise.resolve(vi.fn());
    });
    tauriMocks.invoke.mockResolvedValue([]);

    const { result } = renderHook(() => useEventBus());
    await waitFor(() => expect(ref.current).toBeTypeOf("function"));

    act(() => ref.current?.(event("review_required", "review")));
    await waitFor(() => {
      expect(result.current.events).toHaveLength(1);
      expect(result.current.events[0].channel).toBe("review");
    });
  });

  it("publish invokes event_publish with kind/channel/payload", async () => {
    tauriMocks.invoke.mockImplementation((cmd: string) =>
      cmd === "event_publish" ? Promise.resolve(event("decision_changed", "system")) : Promise.resolve([]),
    );
    const { result } = renderHook(() => useEventBus());
    const published = await result.current.publish("decision_changed", { key: "auth_method" });
    expect(published).toMatchObject({ kind: "decision_changed", channel: "system" });
    expect(tauriMocks.invoke).toHaveBeenCalledWith("event_publish", {
      kind: "decision_changed",
      channel: null,
      payload: { key: "auth_method" },
    });
  });
});
