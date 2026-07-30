import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePaneAgentSpawns } from "../features/terminal/usePaneAgentSpawns";

const tauriMocks = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauriMocks.listen }));
vi.mock("../shared/lib/tauriRuntime", () => ({ isTauriRuntime: () => true }));

const ownerSources = import.meta.glob("../features/terminal/usePaneAgentSpawns.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function getOwnerSource(): string {
  const entries = Object.entries(ownerSources);
  expect(entries).toHaveLength(1);
  return entries[0][1].replace(/\r\n/g, "\n");
}

describe("usePaneAgentSpawns", () => {
  let emit!: (event: unknown) => void;
  let unlisten: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    unlisten = vi.fn();
    tauriMocks.listen.mockReset();
    tauriMocks.listen.mockImplementation((_name: string, listener: (event: unknown) => void) => {
      emit = listener;
      return Promise.resolve(unlisten);
    });
  });

  it("owns event parsing, explicit owner routing, global sequencing, and terminal deduplication", () => {
    const owner = getOwnerSource();

    expect(owner).toContain('tauriListen<AgentSpawnedEvent>("agent-event"');
    expect(owner).toContain("sequenceRef.current += 1");
    expect(owner).toContain("mounted.terminalId === agent.terminalId");
    expect(owner).toContain('event.payload?.kind !== "agent_spawned"');
    expect(owner).toContain("resolveEventOwnerTabId");
    expect(owner).toContain("paneAgentSpawnsByTab");
  });

  it("retains the explicit initiating tab when an agent-spawn event arrives after a tab switch", async () => {
    const owners = [{ projectPath: "C:/repo-a", tabId: "tab-a" }];
    const { result, rerender } = renderHook(({ currentOwners }) => usePaneAgentSpawns(currentOwners), {
      initialProps: { currentOwners: owners },
    });
    await waitFor(() => expect(tauriMocks.listen).toHaveBeenCalledTimes(1));

    rerender({ currentOwners: [...owners] });
    act(() => {
      emit({
        payload: {
          kind: "agent_spawned",
          payload: { model: "codex", tabId: "tab-a", taskId: "task-1", terminalId: "pty-1" },
        },
      });
    });

    expect(result.current.paneAgentSpawnsByTab["tab-a"]).toMatchObject({
      agents: [{ model: "codex", taskId: "task-1", terminalId: "pty-1" }],
    });
  });

  it("deduplicates delayed events and detaches the listener on unmount", async () => {
    const { result, unmount } = renderHook(() => usePaneAgentSpawns([{ tabId: "tab-a" }]));
    await waitFor(() => expect(tauriMocks.listen).toHaveBeenCalledTimes(1));
    const event = {
      payload: {
        kind: "agent_spawned",
        payload: { model: "codex", tabId: "tab-a", terminalId: "pty-1" },
      },
    };

    act(() => {
      emit(event);
      emit(event);
    });
    expect(result.current.paneAgentSpawnsByTab["tab-a"]?.agents).toHaveLength(1);

    unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("fails closed when an autonomous spawn event has no initiating tab owner", async () => {
    const { result } = renderHook(() => usePaneAgentSpawns([{ tabId: "tab-a" }]));
    await waitFor(() => expect(tauriMocks.listen).toHaveBeenCalledTimes(1));

    act(() => {
      emit({
        payload: {
          kind: "agent_spawned",
          payload: { model: "codex", terminalId: "pty-unowned" },
        },
      });
    });

    expect(result.current.paneAgentSpawnsByTab).toEqual({});
  });

  it("routes a delayed autonomous event through one unambiguous repo owner", async () => {
    const owners = [
      { projectPath: "C:/repo-a", tabId: "tab-a" },
      { projectPath: "C:/repo-b", tabId: "tab-b" },
    ];
    const { result, rerender } = renderHook(({ currentOwners }) => usePaneAgentSpawns(currentOwners), {
      initialProps: { currentOwners: owners },
    });
    await waitFor(() => expect(tauriMocks.listen).toHaveBeenCalledTimes(1));
    rerender({ currentOwners: [...owners] });

    act(() => {
      emit({
        payload: {
          kind: "agent_spawned",
          payload: {
            model: "codex",
            repoPath: "c:\\repo-a\\",
            terminalId: "pty-owned-by-repo-a",
          },
        },
      });
    });

    expect(result.current.paneAgentSpawnsByTab["tab-a"]).toMatchObject({
      agents: [{ terminalId: "pty-owned-by-repo-a" }],
    });
  });

  it("retains unconsumed batches for two initiating tabs without cross-tab overwrite", () => {
    const owners = [
      { projectPath: "C:/repo-a", tabId: "tab-a" },
      { projectPath: "C:/repo-b", tabId: "tab-b" },
    ];
    const { result } = renderHook(() => usePaneAgentSpawns(owners));

    act(() => {
      result.current.mountAgentPtyInPane({ model: "codex", terminalId: "pty-a" }, "tab-a");
      result.current.mountAgentPtyInPane({ model: "claude", terminalId: "pty-b" }, "tab-b");
    });

    expect(result.current.paneAgentSpawnsByTab).toMatchObject({
      "tab-a": { agents: [{ terminalId: "pty-a" }] },
      "tab-b": { agents: [{ terminalId: "pty-b" }] },
    });
  });
});
