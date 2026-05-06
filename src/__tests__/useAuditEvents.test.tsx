import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useAuditEvents } from "../shared/hooks/useAuditEvents";
import type { Invoke } from "../shared/hooks/useLogStream";
import type { AuditEventRecord } from "../shared/types/audit";

type TestListen = <T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>;

function AuditProbe({
  invoke,
  listen,
  pollMs = 60_000,
  unfiltered = false,
}: {
  invoke: Invoke;
  listen?: TestListen;
  pollMs?: number;
  unfiltered?: boolean;
}) {
  const state = useAuditEvents({
    filters: unfiltered
      ? undefined
      : {
          category: " terminal ",
          entityId: "pty-a",
          severity: "warn",
        },
    invoke,
    limit: 12,
    listen,
    pollMs,
  });

  return (
    <span>
      {state.ready ? "ready" : "loading"}:{state.entries.length}:{state.error ?? "ok"}:
      {state.entries[0]?.summary ?? "empty"}
    </span>
  );
}

function auditEvent(overrides: Partial<AuditEventRecord> = {}): AuditEventRecord {
  return {
    id: 1,
    timestamp: "2026-05-02T12:00:00.000Z",
    category: "terminal",
    action: "send_keys_failed",
    severity: "warn",
    entityType: "terminal",
    entityId: "pty-a",
    summary: "Failed to write to pane",
    metadata: { redacted: true },
    ...overrides,
  };
}

describe("useAuditEvents", () => {
  it("reads the authoritative audit journal and filters normalized events", async () => {
    const invoke = vi.fn(async () => []) as Invoke;
    render(<AuditProbe invoke={invoke} />);

    await waitFor(() => expect(screen.getByText(/^ready:/)).toBeTruthy());
    expect(invoke).toHaveBeenCalledWith("list_audit_events", {
      filter: {
        limit: 200,
      },
    });
  });

  it("normalizes audit journal records for existing timeline consumers", async () => {
    const invoke = vi.fn(async () => [
      {
        id: 42,
        workspaceId: "workspace-a",
        correlationId: "trace-a",
        sequence: 7,
        kind: "terminal_input",
        severity: "warning",
        source: "journal-test",
        confidence: 1,
        createdAt: "2026-05-02T12:00:00.000Z",
        redactedPayloadJson: { summary: "Failed to write to pane" },
        hash: "hash-a",
        terminalId: "pty-a",
      },
    ]) as Invoke;

    render(<AuditProbe invoke={invoke} />);

    await waitFor(() => expect(screen.getByText(/ready:1:ok:Failed to write to pane/)).toBeTruthy());
  });

  it("renders live audit:event bus records and keeps them through DB replay reloads", async () => {
    const listeners = new Map<string, (event: { payload: unknown }) => void>();
    const listen: TestListen = async <T,>(event: string, handler: (event: { payload: T }) => void) => {
      listeners.set(event, handler as (event: { payload: unknown }) => void);
      return () => {
        listeners.delete(event);
      };
    };
    const replayed = [
      {
        id: 103,
        workspaceId: "workspace-a",
        correlationId: "trace-session-complete",
        sequence: 103,
        kind: "session_complete",
        severity: "info",
        source: "agent-runtime",
        confidence: 1,
        createdAt: "2026-05-02T12:03:00.000Z",
        redactedPayloadJson: { summary: "Session complete replay", doneCount: 12 },
        hash: "hash-session",
        sessionId: "session-a",
      },
      {
        id: 102,
        workspaceId: "workspace-a",
        correlationId: "trace-tool-result",
        sequence: 102,
        kind: "tool_result",
        severity: "info",
        source: "tool-runner",
        confidence: 1,
        createdAt: "2026-05-02T12:02:00.000Z",
        redactedPayloadJson: { summary: "Tool result rendered" },
        hash: "hash-tool",
        agentId: "agent-a",
      },
      {
        id: 101,
        workspaceId: "workspace-a",
        correlationId: "trace-watchdog",
        sequence: 101,
        kind: "watchdog_decision",
        severity: "warn",
        source: "watchdog",
        confidence: 1,
        createdAt: "2026-05-02T12:01:00.000Z",
        redactedPayloadJson: { summary: "Watchdog decision rendered" },
        hash: "hash-watchdog",
        taskId: "P0-12",
      },
      {
        id: 100,
        workspaceId: "workspace-a",
        correlationId: "trace-agent",
        sequence: 100,
        kind: "agent_output",
        severity: "info",
        source: "agent-runtime",
        confidence: 1,
        createdAt: "2026-05-02T12:00:00.000Z",
        redactedPayloadJson: { summary: "Agent output rendered" },
        hash: "hash-agent",
        agentId: "agent-a",
      },
    ];
    const invoke = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(replayed) as unknown as Invoke;

    const { unmount } = render(<AuditProbe invoke={invoke} listen={listen} unfiltered />);

    await waitFor(() => expect(listeners.has("audit:event")).toBe(true));
    listeners.get("audit:event")?.({
      payload: replayed[3],
    });
    await waitFor(() => expect(screen.getByText(/ready:1:ok:Agent output rendered/)).toBeTruthy());
    unmount();

    render(<AuditProbe invoke={invoke} listen={listen} unfiltered />);

    await waitFor(() => expect(screen.getByText(/ready:4:ok:Session complete replay/)).toBeTruthy());
    expect(screen.getByText(/Session complete replay/)).toBeTruthy();
  });

  it("falls back to the legacy recent_audit_events IPC when the journal command is unavailable", async () => {
    const invoke = vi
      .fn()
      .mockRejectedValueOnce(new Error("unknown command: list_audit_events"))
      .mockResolvedValueOnce([auditEvent()]) as unknown as Invoke;

    render(<AuditProbe invoke={invoke} />);

    await waitFor(() => expect(screen.getByText(/ready:1:ok:Failed to write to pane/)).toBeTruthy());
    expect(invoke).toHaveBeenLastCalledWith("recent_audit_events", {
      category: "terminal",
      entityId: "pty-a",
      limit: 12,
      severity: "warn",
    });
  });

  it("keeps the last valid audit events when a later poll returns malformed payload", async () => {
    const invoke = vi.fn().mockResolvedValueOnce([auditEvent()]).mockResolvedValue(undefined) as unknown as Invoke;

    render(<AuditProbe invoke={invoke} pollMs={5} />);

    await waitFor(() => expect(screen.getByText(/ready:1:ok:Failed to write to pane/)).toBeTruthy());
    await waitFor(() =>
      expect(screen.getByText(/ready:1:Invalid audit event payload:Failed to write to pane/)).toBeTruthy(),
    );
  });
});
