import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentManager } from "../shared/hooks/useAgentManager";
import { AGENT_TELEMETRY_STORAGE_KEY, serializeAgentTelemetrySnapshot } from "../shared/lib/agentTelemetryPersistence";
import type { AgentSession } from "../shared/types/agent";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriMocks.invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: tauriMocks.listen,
}));

function session(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    name: `Agent ${id}`,
    status: "coding",
    model: "claude-sonnet",
    prompt: "work",
    startedAt: 1_000,
    logs: [],
    cost: 0,
    tokensUsed: 0,
    ...overrides,
  };
}

describe("useAgentManager telemetry hydration", () => {
  beforeEach(() => {
    window.localStorage.clear();
    tauriMocks.invoke.mockReset();
    tauriMocks.listen.mockReset();
    tauriMocks.listen.mockResolvedValue(vi.fn());
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("merges restored telemetry snapshots with live list_agents rows", async () => {
    window.localStorage.setItem(
      AGENT_TELEMETRY_STORAGE_KEY,
      serializeAgentTelemetrySnapshot([
        session("agent-live", {
          name: "Reviewer",
          status: "coding",
          role: "reviewer",
          handoffFrom: "root-agent",
          startedAt: 42,
          logs: [
            {
              timestamp: 100,
              type: "system",
              content: "Needs manual approval: Bash",
              metadata: {
                event: "watchdog_decision",
                toolName: "Bash",
                decision: "manual",
                rule: "destructive-command",
              },
            },
          ],
          cost: 0.12,
          tokensUsed: 1_200,
          filesChanged: 1,
          changedFileDetails: [{ path: "src/App.tsx", action: "edit", toolName: "Edit", timestamp: 101 }],
        }),
      ]),
    );

    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command !== "list_agents") return Promise.resolve(null);
      return Promise.resolve([
        {
          id: "agent-live",
          status: "waiting",
          model: "claude-opus",
          prompt: "continue review",
          cwd: "C:/Users/owner/Aether_Terminal",
          cost: 0.34,
          tokens_used: 4_800,
        },
      ]);
    });

    const { result } = renderHook(() => useAgentManager());

    expect(result.current.sessions[0]).toMatchObject({
      id: "agent-live",
      name: "Reviewer",
      status: "done",
      role: "reviewer",
      handoffFrom: "root-agent",
      startedAt: 42,
      cost: 0.12,
      tokensUsed: 1_200,
      filesChanged: 1,
    });

    await waitFor(() => {
      expect(result.current.sessions[0]).toMatchObject({
        id: "agent-live",
        name: "Reviewer",
        status: "waiting",
        model: "claude-opus",
        prompt: "continue review",
        cost: 0.34,
        tokensUsed: 4_800,
        role: "reviewer",
        handoffFrom: "root-agent",
        startedAt: 42,
        filesChanged: 1,
      });
    });

    expect(result.current.sessions[0]?.logs).toEqual([
      expect.objectContaining({
        type: "system",
        metadata: expect.objectContaining({ event: "watchdog_decision", decision: "manual" }),
      }),
    ]);
    expect(result.current.sessions[0]?.changedFileDetails).toEqual([
      { path: "src/App.tsx", action: "edit", toolName: "Edit", timestamp: 101 },
    ]);

    await waitFor(() => {
      expect(window.localStorage.getItem(AGENT_TELEMETRY_STORAGE_KEY)).toContain("claude-opus");
    });
  });

  it("does not let a stale initial list_agents response overwrite an earlier push update", async () => {
    const pushSessionsRef: { current?: (payload: unknown[]) => void } = {};

    window.localStorage.setItem(
      AGENT_TELEMETRY_STORAGE_KEY,
      serializeAgentTelemetrySnapshot([
        session("agent-live", {
          name: "Reviewer",
          role: "reviewer",
          handoffFrom: "root-agent",
          startedAt: 42,
          logs: [{ timestamp: 100, type: "system", content: "persisted watchdog log" }],
          changedFileDetails: [{ path: "src/App.tsx", action: "edit", toolName: "Edit", timestamp: 101 }],
          filesChanged: 1,
        }),
      ]),
    );

    tauriMocks.listen.mockImplementation((eventName: string, callback: (event: { payload: unknown[] }) => void) => {
      if (eventName === "agent-sessions-updated") {
        pushSessionsRef.current = (payload) => callback({ payload });
      }
      return Promise.resolve(vi.fn());
    });

    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command !== "list_agents") return Promise.resolve(null);
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve([
            {
              id: "agent-live",
              status: "coding",
              model: "stale-model",
              prompt: "stale prompt",
              cwd: "C:/Users/owner/Aether_Terminal",
              cost: 0.01,
              tokens_used: 100,
            },
          ]);
        }, 0);
      });
    });

    const { result } = renderHook(() => useAgentManager());

    await waitFor(() => {
      expect(pushSessionsRef.current).toBeTypeOf("function");
    });

    if (!pushSessionsRef.current) throw new Error("agent session listener was not registered");
    pushSessionsRef.current([
      {
        id: "agent-live",
        status: "waiting",
        model: "fresh-model",
        prompt: "fresh prompt",
        cwd: "C:/Users/owner/Aether_Terminal",
        cost: 0.77,
        tokens_used: 7_700,
      },
    ]);

    await waitFor(() => {
      expect(result.current.sessions[0]).toMatchObject({
        id: "agent-live",
        status: "waiting",
        model: "fresh-model",
        prompt: "fresh prompt",
        cost: 0.77,
        tokensUsed: 7_700,
        role: "reviewer",
        handoffFrom: "root-agent",
        filesChanged: 1,
      });
    });

    await waitFor(() => {
      expect(result.current.sessions[0]).not.toMatchObject({
        model: "stale-model",
        prompt: "stale prompt",
      });
    });

    expect(result.current.sessions[0]?.logs).toEqual([expect.objectContaining({ content: "persisted watchdog log" })]);
    expect(result.current.sessions[0]?.changedFileDetails).toEqual([
      { path: "src/App.tsx", action: "edit", toolName: "Edit", timestamp: 101 },
    ]);
  });

  it("keeps restored telemetry as completed history when the initial backend list is empty", async () => {
    window.localStorage.setItem(
      AGENT_TELEMETRY_STORAGE_KEY,
      serializeAgentTelemetrySnapshot([
        session("agent-stale", {
          status: "coding",
          role: "implementer",
          handoffFrom: "root-agent",
          logs: [{ timestamp: 100, type: "tool_use", content: "Edit({path})" }],
          changedFileDetails: [{ path: "src/App.tsx", action: "edit", toolName: "Edit", timestamp: 101 }],
          filesChanged: 1,
        }),
      ]),
    );

    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command !== "list_agents") return Promise.resolve(null);
      return Promise.resolve([]);
    });

    const { result } = renderHook(() => useAgentManager());

    await waitFor(() => {
      expect(result.current.sessions[0]).toMatchObject({
        id: "agent-stale",
        status: "done",
        role: "implementer",
        handoffFrom: "root-agent",
        filesChanged: 1,
      });
    });

    expect(result.current.sessions[0]?.logs).toEqual([expect.objectContaining({ type: "tool_use" })]);
    expect(result.current.sessions[0]?.changedFileDetails).toEqual([
      { path: "src/App.tsx", action: "edit", toolName: "Edit", timestamp: 101 },
    ]);

    await waitFor(() => {
      const persisted = window.localStorage.getItem(AGENT_TELEMETRY_STORAGE_KEY);
      expect(persisted).toContain('"status":"done"');
      expect(persisted).toContain("src/App.tsx");
    });
  });

  it("hydrates frontend-enriched telemetry from the backend snapshot store when browser storage is empty", async () => {
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "list_agent_telemetry_snapshots") {
        return Promise.resolve([
          {
            id: 7,
            source: "frontend",
            saved_at: "2026-05-02T07:50:00Z",
            snapshot_json: serializeAgentTelemetrySnapshot([
              session("agent-db", {
                name: "Recovered reviewer",
                status: "done",
                role: "reviewer",
                handoffFrom: "agent-root",
                logs: [{ timestamp: 100, type: "tool_result", content: "patched file" }],
                changedFileDetails: [{ path: "src/db-backed.ts", action: "edit", toolName: "Edit", timestamp: 101 }],
                filesChanged: 1,
              }),
            ]),
          },
        ]);
      }
      if (command === "list_agents") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useAgentManager());

    await waitFor(() => {
      expect(result.current.sessions[0]).toMatchObject({
        id: "agent-db",
        name: "Recovered reviewer",
        status: "done",
        role: "reviewer",
        handoffFrom: "agent-root",
        filesChanged: 1,
      });
    });
    expect(result.current.sessions[0]?.logs).toEqual([expect.objectContaining({ type: "tool_result" })]);
    expect(result.current.sessions[0]?.changedFileDetails).toEqual([
      { path: "src/db-backed.ts", action: "edit", toolName: "Edit", timestamp: 101 },
    ]);

    await waitFor(() => {
      expect(tauriMocks.invoke).toHaveBeenCalledWith("save_agent_telemetry_snapshot", {
        snapshotJson: expect.stringContaining("src/db-backed.ts"),
      });
    });
  });

  it("does not delete restored telemetry when a push update contains no live sessions", async () => {
    const pushSessionsRef: { current?: (payload: unknown[]) => void } = {};

    window.localStorage.setItem(
      AGENT_TELEMETRY_STORAGE_KEY,
      serializeAgentTelemetrySnapshot([
        session("agent-complete", {
          status: "done",
          role: "reviewer",
          logs: [{ timestamp: 100, type: "system", content: "complete" }],
          changedFileDetails: [{ path: "src/review.ts", action: "edit", toolName: "Edit", timestamp: 101 }],
          filesChanged: 1,
        }),
      ]),
    );

    tauriMocks.listen.mockImplementation((eventName: string, callback: (event: { payload: unknown[] }) => void) => {
      if (eventName === "agent-sessions-updated") {
        pushSessionsRef.current = (payload) => callback({ payload });
      }
      return Promise.resolve(vi.fn());
    });
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command !== "list_agents") return Promise.resolve(null);
      return Promise.resolve([]);
    });

    const { result } = renderHook(() => useAgentManager());

    await waitFor(() => {
      expect(pushSessionsRef.current).toBeTypeOf("function");
    });

    if (!pushSessionsRef.current) throw new Error("agent session listener was not registered");
    pushSessionsRef.current([]);

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1);
      expect(result.current.sessions[0]).toMatchObject({
        id: "agent-complete",
        status: "done",
        role: "reviewer",
        filesChanged: 1,
      });
    });

    expect(result.current.sessions[0]?.changedFileDetails).toEqual([
      { path: "src/review.ts", action: "edit", toolName: "Edit", timestamp: 101 },
    ]);
  });

  it("subscribes backend-replayed live sessions to output and exit events", async () => {
    const listeners = new Map<string, (event: { payload: string | unknown[] }) => void>();

    tauriMocks.listen.mockImplementation(
      (eventName: string, callback: (event: { payload: string | unknown[] }) => void) => {
        listeners.set(eventName, callback);
        return Promise.resolve(vi.fn());
      },
    );
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command !== "list_agents") return Promise.resolve(null);
      return Promise.resolve([
        {
          id: "agent-replayed",
          status: "coding",
          model: "claude-sonnet",
          prompt: "resume after reload",
          cwd: "C:/Users/owner/Aether_Terminal",
          cost: 0.2,
          tokens_used: 2_000,
        },
      ]);
    });

    const { result } = renderHook(() => useAgentManager());

    await waitFor(() => {
      expect(listeners.has("agent-output-agent-replayed")).toBe(true);
      expect(listeners.has("agent-exit-agent-replayed")).toBe(true);
      expect(listeners.has("watchdog-decision-agent-replayed")).toBe(true);
    });

    listeners.get("agent-output-agent-replayed")?.({
      payload: JSON.stringify({
        type: "tool_use",
        name: "Edit",
        input: { file_path: "src/live.ts" },
      }),
    });

    await waitFor(() => {
      expect(result.current.sessions[0]).toMatchObject({
        id: "agent-replayed",
        filesChanged: 1,
      });
    });
    expect(result.current.sessions[0]?.changedFileDetails).toEqual([
      expect.objectContaining({ path: "src/live.ts", action: "edit", toolName: "Edit" }),
    ]);

    listeners.get("agent-exit-agent-replayed")?.({ payload: "" });

    await waitFor(() => {
      expect(result.current.sessions[0]).toMatchObject({
        id: "agent-replayed",
        status: "done",
      });
    });
    await waitFor(() => {
      const persisted = window.localStorage.getItem(AGENT_TELEMETRY_STORAGE_KEY);
      expect(persisted).toContain("src/live.ts");
      expect(persisted).toContain('"status":"done"');
    });
  });

  it("keeps malformed structured output visible instead of silently losing provenance", async () => {
    const listeners = new Map<string, (event: { payload: string | unknown[] }) => void>();

    tauriMocks.listen.mockImplementation(
      (eventName: string, callback: (event: { payload: string | unknown[] }) => void) => {
        listeners.set(eventName, callback);
        return Promise.resolve(vi.fn());
      },
    );
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command !== "list_agents") return Promise.resolve(null);
      return Promise.resolve([
        {
          id: "agent-malformed",
          status: "coding",
          model: "claude-sonnet",
          prompt: "resume malformed replay",
          cwd: "C:/Users/owner/Aether_Terminal",
        },
      ]);
    });

    const { result } = renderHook(() => useAgentManager());

    await waitFor(() => {
      expect(listeners.has("agent-output-agent-malformed")).toBe(true);
    });

    act(() => {
      listeners.get("agent-output-agent-malformed")?.({
        payload: '{"type":"tool_use","name":"Edit","input":',
      });
    });

    await waitFor(() => {
      expect(result.current.sessions[0]?.logs).toEqual([
        expect.objectContaining({
          type: "error",
          content: expect.stringContaining("Malformed agent structured output"),
        }),
      ]);
    });
    expect(result.current.sessions[0]?.filesChanged ?? 0).toBe(0);
  });

  it("persists replayed output, watchdog, and exit telemetry in event order", async () => {
    const listeners = new Map<string, (event: { payload: string | unknown[] }) => void>();
    const backendSnapshots: string[] = [];

    tauriMocks.listen.mockImplementation(
      (eventName: string, callback: (event: { payload: string | unknown[] }) => void) => {
        listeners.set(eventName, callback);
        return Promise.resolve(vi.fn());
      },
    );
    tauriMocks.invoke.mockImplementation((command: string, args?: { snapshotJson?: string }) => {
      if (command === "save_agent_telemetry_snapshot" && typeof args?.snapshotJson === "string") {
        backendSnapshots.push(args.snapshotJson);
        return Promise.resolve(null);
      }
      if (command === "list_agent_telemetry_snapshots") return Promise.resolve([]);
      if (command !== "list_agents") return Promise.resolve(null);
      return Promise.resolve([
        {
          id: "agent-ordered",
          status: "coding",
          model: "claude-sonnet",
          prompt: "continue ordered replay",
          cwd: "C:/Users/owner/Aether_Terminal",
          cost: 0.45,
          tokens_used: 4_500,
        },
      ]);
    });

    const { result } = renderHook(() => useAgentManager());

    await waitFor(() => {
      expect(listeners.has("agent-output-agent-ordered")).toBe(true);
      expect(listeners.has("agent-exit-agent-ordered")).toBe(true);
      expect(listeners.has("watchdog-decision-agent-ordered")).toBe(true);
    });

    act(() => {
      listeners.get("agent-output-agent-ordered")?.({
        payload: JSON.stringify({
          type: "tool_use",
          name: "Write",
          input: { path: "src/ordered.ts" },
        }),
      });
    });

    await waitFor(() => {
      expect(result.current.sessions[0]?.logs.map((log) => log.type)).toEqual(["tool_use"]);
    });

    act(() => {
      listeners.get("watchdog-decision-agent-ordered")?.({
        payload: JSON.stringify({
          decision: "manual",
          tool: "Write",
          rule: "workspace-write",
        }),
      });
    });

    await waitFor(() => {
      expect(result.current.sessions[0]).toMatchObject({
        id: "agent-ordered",
        status: "waiting",
        watchdog: "manual",
        filesChanged: 1,
      });
      expect(result.current.sessions[0]?.logs.map((log) => log.type)).toEqual(["tool_use", "system"]);
    });

    act(() => {
      listeners.get("agent-exit-agent-ordered")?.({ payload: "" });
    });

    await waitFor(() => {
      expect(result.current.sessions[0]).toMatchObject({
        id: "agent-ordered",
        status: "done",
        watchdog: "manual",
      });
    });

    await waitFor(() => {
      expect(backendSnapshots.at(-1)).toContain('"status":"done"');
      expect(backendSnapshots.at(-1)).toContain('"watchdog":"manual"');
      expect(backendSnapshots.at(-1)).toContain("workspace-write");
      expect(backendSnapshots.at(-1)).toContain("src/ordered.ts");
    });

    const saved = JSON.parse(backendSnapshots.at(-1) ?? "{}");
    const orderedSession = saved.sessions?.find((savedSession: { id?: string }) => savedSession.id === "agent-ordered");
    expect(orderedSession?.logs.map((log: { type: string }) => log.type)).toEqual(["tool_use", "system"]);
    expect(orderedSession?.changedFileDetails).toEqual([
      expect.objectContaining({ path: "src/ordered.ts", action: "create", toolName: "Write" }),
    ]);
  });
});
