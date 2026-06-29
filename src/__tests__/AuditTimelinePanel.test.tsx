import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalPaneTarget } from "../shared/types/terminalPane";
import { AuditTimelinePanel } from "../features/context/AuditTimelinePanel";
import type { Invoke } from "../shared/hooks/useLogStream";
import { buildWorkstationGraph } from "../shared/lib/workstationGraph";
import type { AuditEventRecord, AuditJournalEventRecord } from "../shared/types/audit";
import { useConfirmStore } from "../shared/ui/ConfirmDialog";

afterEach(() => {
  cleanup();
  useConfirmStore.setState({
    open: false,
    title: "",
    description: "",
    confirmLabel: "OK",
    cancelLabel: "Cancel",
    tone: "default",
    resolve: null,
  });
  vi.useRealTimers();
});

function event(id: number, overrides: Partial<AuditEventRecord> = {}): AuditEventRecord {
  return {
    id,
    timestamp: "2026-05-01T12:34:56.000Z",
    category: "terminal",
    action: "write",
    severity: "info",
    entityType: "terminal",
    entityId: "term-1",
    summary: "Sent Enter to active terminal",
    metadata: {},
    ...overrides,
  };
}

function journalEvent(id: number, overrides: Partial<AuditJournalEventRecord> = {}): AuditJournalEventRecord {
  return {
    id,
    workspaceId: "p0-12-workspace",
    correlationId: `trace-p0-12-${id}`,
    sequence: id,
    kind: "agent_output",
    severity: "info",
    source: "p0-12-harness",
    confidence: 1,
    createdAt: `2026-05-02T12:${String(id).padStart(2, "0")}:00.000Z`,
    redactedPayloadJson: { summary: `P0-12 event ${id}` },
    hash: `hash-${id}`,
    ...overrides,
  };
}

function pane(overrides: Partial<TerminalPaneTarget> = {}): TerminalPaneTarget {
  return {
    paneId: "pane-a",
    terminalId: "term-1",
    index: 0,
    shell: "powershell",
    cwd: "C:/repo/aelyris",
    title: "PowerShell",
    role: "work",
    tabId: "tab-a",
    tabLabel: "Aelyris",
    tabShell: "powershell",
    tabCwd: "C:/repo/aelyris",
    ...overrides,
  };
}

describe("AuditTimelinePanel", () => {
  it("renders compact audit events and risk counts from list_audit_events", async () => {
    const invoke = vi.fn(async () => [
      event(2, {
        action: "workflow_gate_rejected",
        category: "workflow",
        entityType: "workflow",
        entityId: "bugfix",
        severity: "warn",
        summary: "Verify gate rejected",
      }),
      event(1, {
        action: "terminal_failure",
        severity: "error",
        summary: "Failed to write to pane",
      }),
    ]) as Invoke;

    render(<AuditTimelinePanel invoke={invoke} pollMs={60_000} />);

    await waitFor(() => expect(screen.getByText("Audit Timeline")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("workflow gate rejected")).toBeTruthy());

    expect(invoke).toHaveBeenCalledWith("list_audit_events", { filter: { limit: 200 } });
    expect(screen.getByText("Verify gate rejected")).toBeTruthy();
    expect(screen.getByText("Failed to write to pane")).toBeTruthy();
    expect(screen.getByText("Warn")).toBeTruthy();
    expect(screen.getByText("Errors")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Recover" })).toBeTruthy();
    expect(screen.getByText("workflow:bugfix")).toBeTruthy();
  });

  it("renders replayed P0-12 journal scenarios from the authoritative snapshot stream", async () => {
    const invoke = vi.fn(async () => [
      journalEvent(104, {
        correlationId: "trace-session-complete",
        kind: "session_complete",
        source: "agent-runtime",
        redactedPayloadJson: { summary: "Session complete replay", doneCount: 12 },
        sessionId: "session-p0-12",
      }),
      journalEvent(103, {
        correlationId: "trace-tool-result",
        kind: "tool_result",
        source: "tool-runner",
        redactedPayloadJson: { summary: "Tool result rendered", status: "pass" },
        agentId: "agent-p0-12",
      }),
      journalEvent(102, {
        correlationId: "trace-watchdog-decision",
        kind: "watchdog_decision",
        severity: "warn",
        source: "watchdog",
        redactedPayloadJson: { summary: "Watchdog decision rendered", decision: "continue" },
        taskId: "P0-12",
      }),
      journalEvent(101, {
        correlationId: "trace-agent-output",
        kind: "agent_output",
        source: "agent-runtime",
        redactedPayloadJson: { summary: "Agent output rendered" },
        agentId: "agent-p0-12",
      }),
    ]) as Invoke;

    render(<AuditTimelinePanel invoke={invoke} pollMs={60_000} />);

    await waitFor(() => expect(screen.getByText("Session complete replay")).toBeTruthy());
    expect(screen.getByText("Tool result rendered")).toBeTruthy();
    expect(screen.getByText("Watchdog decision rendered")).toBeTruthy();
    expect(screen.getByText("Agent output rendered")).toBeTruthy();
    expect(screen.getByText("session complete")).toBeTruthy();
    expect(screen.getByText("tool result")).toBeTruthy();
    expect(screen.getByText("watchdog decision")).toBeTruthy();
    expect(screen.getByText("agent output")).toBeTruthy();
    expect(screen.getByText("Warn")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filter trace trace-session-complete" })).toBeTruthy();
  });

  it("filters audit rows by risk and recoverable recovery paths", () => {
    render(
      <AuditTimelinePanel
        auditEvents={[
          event(1, { action: "write", severity: "info", summary: "Input sent" }),
          event(2, { action: "resize_failed", severity: "warn", summary: "Resize failed" }),
          event(3, {
            action: "workflow_gate_rejected",
            category: "workflow",
            severity: "warn",
            summary: "Gate rejected",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Input sent")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Risk" }));
    expect(screen.queryByText("Input sent")).toBeNull();
    expect(screen.getByText("Resize failed")).toBeTruthy();
    expect(screen.getByText("Gate rejected")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Recover" }));
    expect(screen.queryByText("Input sent")).toBeNull();
    expect(screen.getByText("Resize failed")).toBeTruthy();
    expect(screen.getByText("Gate rejected")).toBeTruthy();
  });

  it("filters audit rows by correlation trace and can clear the trace", () => {
    render(
      <AuditTimelinePanel
        auditEvents={[
          event(1, {
            action: "send_keys_failed",
            severity: "warn",
            summary: "Send failed",
            metadata: { correlationId: "terminal:terminal:term-1" },
          }),
          event(2, {
            action: "force_restart",
            severity: "info",
            summary: "Restarted pane",
            metadata: { correlationId: "terminal:terminal:term-1" },
          }),
          event(3, {
            action: "workflow_gate_rejected",
            category: "workflow",
            severity: "warn",
            summary: "Other trace",
            metadata: { correlationId: "workflow:workflow:wf-1" },
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Filter trace terminal:terminal:term-1" })[0]);

    expect(screen.getByLabelText("Active audit trace").textContent).toContain("terminal:terminal:term-1");
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.getByText("2 ev")).toBeTruthy();
    expect(screen.getByText("1 risk")).toBeTruthy();
    expect(screen.getByText("Send failed")).toBeTruthy();
    expect(screen.getByText("Restarted pane")).toBeTruthy();
    expect(screen.queryByText("Other trace")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("Other trace")).toBeTruthy();
  });

  it("can be controlled by an app-level trace filter", () => {
    const onTraceFilterChange = vi.fn();
    render(
      <AuditTimelinePanel
        traceFilter="terminal:terminal:term-1"
        onTraceFilterChange={onTraceFilterChange}
        auditEvents={[
          event(1, {
            summary: "Selected trace",
            metadata: { correlationId: "terminal:terminal:term-1" },
          }),
          event(2, {
            summary: "Other trace",
            metadata: { correlationId: "terminal:terminal:term-2" },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Selected trace")).toBeTruthy();
    expect(screen.queryByText("Other trace")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onTraceFilterChange).toHaveBeenCalledWith(null);
  });

  it("polls only while enabled", async () => {
    const invoke = vi.fn(async () => [event(1)]) as Invoke;
    const { rerender } = render(<AuditTimelinePanel enabled={false} invoke={invoke} pollMs={100} />);

    expect(invoke).not.toHaveBeenCalled();

    rerender(<AuditTimelinePanel enabled invoke={invoke} pollMs={100} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  });

  it("keeps raw metadata out of the visible row text", async () => {
    const invoke = vi.fn(async () => [
      event(1, {
        metadata: { content: "secret typed command", bytes: 20 },
        summary: "Sent command to active terminal",
      }),
    ]) as Invoke;

    render(<AuditTimelinePanel invoke={invoke} pollMs={60_000} />);

    await waitFor(() => expect(screen.getByText("Sent command to active terminal")).toBeTruthy());
    expect(screen.queryByText("secret typed command")).toBeNull();
  });

  it("shows only allowlisted metadata details", () => {
    render(
      <AuditTimelinePanel
        auditEvents={[
          event(1, {
            metadata: {
              content: "secret typed command",
              error: "writer unavailable",
              cols: 120,
              rows: 34,
              redacted: true,
            },
            summary: "Failed to write to pane",
          }),
        ]}
      />,
    );

    expect(screen.getByText(/error:writer unavailable/)).toBeTruthy();
    expect(screen.getByText(/cols:120/)).toBeTruthy();
    expect(screen.getByText(/rows:34/)).toBeTruthy();
    expect(screen.queryByText(/secret typed command/)).toBeNull();
    expect(screen.queryByText(/content:/)).toBeNull();
  });

  it("surfaces malformed backend payloads instead of silently clearing the audit trail", async () => {
    const invoke = vi.fn(async () => undefined) as unknown as Invoke;

    render(<AuditTimelinePanel invoke={invoke} pollMs={60_000} />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText("Invalid audit event payload")).toBeTruthy();
  });

  it("can focus the pane referenced by an audit event", () => {
    const onFocusPane = vi.fn();
    render(<AuditTimelinePanel auditEvents={[event(1)]} panes={[pane()]} onFocusPane={onFocusPane} />);

    fireEvent.click(screen.getByRole("button", { name: "Focus Aelyris/PowerShell" }));

    expect(onFocusPane).toHaveBeenCalledWith("tab-a", "pane-a");
  });

  it("scopes audit rows to graph pane, terminal, and risk nodes", () => {
    const workstationGraph = buildWorkstationGraph({
      workspaceId: "C:/repo",
      panes: [{ paneId: "pane-a", terminalId: "term-1" }],
      risks: [{ id: "audit-1", title: "Scoped warning", status: "open", severity: "warn" }],
    });

    render(
      <AuditTimelinePanel
        auditEvents={[
          event(1, { severity: "warn", entityId: "term-1", summary: "Scoped terminal warning" }),
          event(2, { severity: "warn", entityId: "term-2", summary: "Hidden terminal warning" }),
        ]}
        panes={[pane(), pane({ paneId: "pane-b", terminalId: "term-2", title: "Other" })]}
        workstationGraph={workstationGraph}
      />,
    );

    expect(screen.getByLabelText("Audit timeline").getAttribute("data-graph-source")).toBe("workstation-graph");
    expect(screen.getByText("Scoped terminal warning")).toBeTruthy();
    expect(screen.queryByText("Hidden terminal warning")).toBeNull();
    expect(screen.getByLabelText("Audit summary").textContent).toContain("1Events");
  });

  it("keeps selected audit-jump rows visible even when the graph scope would hide them", () => {
    const workstationGraph = buildWorkstationGraph({
      workspaceId: "C:/repo",
      panes: [{ paneId: "pane-a", terminalId: "term-1" }],
    });

    render(
      <AuditTimelinePanel
        auditEvents={[
          event(1, { entityId: "term-1", summary: "Scoped terminal warning" }),
          event(2, {
            entityId: "missing-pane",
            summary: "Right rail stale pane outcome",
            metadata: { correlationId: "trace-right-rail" },
          }),
        ]}
        selectedEventId={2}
        traceFilter="trace-right-rail"
        workstationGraph={workstationGraph}
      />,
    );

    const selectedRow = screen.getByText("Right rail stale pane outcome").closest("article");
    expect(selectedRow?.getAttribute("data-selected")).toBe("true");
    expect(screen.queryByText("Scoped terminal warning")).toBeNull();
  });

  it("scopes audit rows to graph agent nodes", () => {
    const workstationGraph = buildWorkstationGraph({
      workspaceId: "C:/repo",
      sessions: [
        {
          id: "agent-a",
          name: "Focused agent",
          status: "coding",
          model: "claude-sonnet",
          prompt: "work",
          startedAt: 1,
          logs: [],
          cost: 0,
          tokensUsed: 0,
          changedFileDetails: [],
        },
      ],
    });

    render(
      <AuditTimelinePanel
        auditEvents={[
          event(1, {
            entityType: "agent",
            entityId: "agent-a",
            summary: "Focused agent event",
          }),
          event(2, {
            entityType: "agent",
            entityId: "agent-b",
            summary: "Hidden agent event",
          }),
        ]}
        workstationGraph={workstationGraph}
      />,
    );

    expect(screen.getByText("Focused agent event")).toBeTruthy();
    expect(screen.queryByText("Hidden agent event")).toBeNull();
  });

  it("confirms before restarting the pane referenced by a recoverable audit event", async () => {
    const onRestartPane = vi.fn();
    const onSelectEvent = vi.fn();
    render(
      <AuditTimelinePanel
        auditEvents={[event(1, { action: "send_keys_failed", severity: "warn" })]}
        panes={[pane()]}
        onRestartPane={onRestartPane}
        onSelectEvent={onSelectEvent}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Restart Aelyris/PowerShell" }));

    expect(onSelectEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ paneId: "pane-a" }),
    );
    expect(useConfirmStore.getState().open).toBe(true);
    expect(useConfirmStore.getState().title).toBe("Restart terminal shell");

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(onRestartPane).toHaveBeenCalledWith("tab-a", "pane-a");
  });

  it("surfaces selected audit recovery actions at the destination", async () => {
    const onFocusPane = vi.fn();
    const onRestartPane = vi.fn();
    const onSelectEvent = vi.fn();
    const onDestinationOutcome = vi.fn();
    render(
      <AuditTimelinePanel
        auditEvents={[event(1, { action: "send_keys_failed", severity: "warn", summary: "Send failed" })]}
        panes={[pane()]}
        selectedEventId={1}
        onFocusPane={onFocusPane}
        onRestartPane={onRestartPane}
        onSelectEvent={onSelectEvent}
        onDestinationOutcome={onDestinationOutcome}
      />,
    );

    expect(screen.getByLabelText("Selected audit recovery").textContent).toContain("Restart pane");
    expect(screen.getByLabelText("Selected audit recovery").textContent).toContain("Send failed");

    fireEvent.click(screen.getByRole("button", { name: "Focus pane" }));
    expect(onFocusPane).toHaveBeenCalledWith("tab-a", "pane-a");
    expect(onDestinationOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Audit pane focused",
        auditEventId: 1,
        tone: "success",
        routeWidget: "audit-timeline",
        routeLabel: "Audit",
        routeDetail: "Send failed",
      }),
    );
    expect(onSelectEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ paneId: "pane-a" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Restart pane" }));
    expect(useConfirmStore.getState().open).toBe(true);

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(onRestartPane).toHaveBeenCalledWith("tab-a", "pane-a");
    expect(onDestinationOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Audit recovery restarted pane",
        auditEventId: 1,
        tone: "success",
        routeWidget: "audit-timeline",
        routeLabel: "Audit",
        routeDetail: "Send failed",
      }),
    );
  });

  it("does not restart a stale pane after audit confirmation resolves", async () => {
    const onRestartPane = vi.fn();
    const { rerender } = render(
      <AuditTimelinePanel
        auditEvents={[event(1, { action: "send_keys_failed", severity: "warn" })]}
        panes={[pane()]}
        onRestartPane={onRestartPane}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Restart Aelyris/PowerShell" }));
    rerender(
      <AuditTimelinePanel
        auditEvents={[event(1, { action: "send_keys_failed", severity: "warn" })]}
        panes={[]}
        onRestartPane={onRestartPane}
      />,
    );

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(onRestartPane).not.toHaveBeenCalled();
  });

  it("does not focus a stale pane from an audit event", () => {
    const onFocusPane = vi.fn();
    const { rerender } = render(
      <AuditTimelinePanel auditEvents={[event(1)]} panes={[pane()]} onFocusPane={onFocusPane} />,
    );

    rerender(<AuditTimelinePanel auditEvents={[event(1)]} panes={[]} onFocusPane={onFocusPane} />);

    expect(screen.queryByRole("button", { name: "Focus Aelyris/PowerShell" })).toBeNull();
  });

  it("keeps restart available for a recoverable audit event after the terminal id is cleared", async () => {
    const onRestartPane = vi.fn();
    const onSelectEvent = vi.fn();
    render(
      <AuditTimelinePanel
        auditEvents={[event(1, { action: "send_keys_failed", entityId: "pane-a", severity: "warn" })]}
        panes={[pane({ terminalId: null })]}
        onRestartPane={onRestartPane}
        onSelectEvent={onSelectEvent}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Restart Aelyris/PowerShell" }));
    expect(onSelectEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ paneId: "pane-a" }),
    );

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(onRestartPane).toHaveBeenCalledWith("tab-a", "pane-a");
  });

  it("does not expose restart on non-recoverable audit events", () => {
    render(
      <AuditTimelinePanel
        auditEvents={[event(1, { action: "spawn_failed" })]}
        panes={[pane()]}
        onRestartPane={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Restart Aelyris/PowerShell" })).toBeNull();
  });

  it("labels recoverable audit events with their recovery path", () => {
    render(
      <AuditTimelinePanel
        auditEvents={[
          event(1, { action: "send_keys_failed", severity: "warn", summary: "Send failed" }),
          event(2, {
            action: "workflow_gate_rejected",
            category: "workflow",
            entityType: "workflow",
            entityId: "wf-1",
            severity: "warn",
            summary: "Gate rejected",
          }),
          event(3, {
            action: "send_keys_by_role_failed",
            severity: "error",
            summary: "Role target missing",
            metadata: { error: "No pane with role reviewer", redacted: true },
          }),
        ]}
      />,
    );

    expect(screen.getByRole("tab", { name: "Recover" })).toBeTruthy();
    expect(screen.getByText("Restart pane")).toBeTruthy();
    expect(screen.getByText("Review gate")).toBeTruthy();
    expect(screen.getByText("Inspect target")).toBeTruthy();
  });

  it("selects and highlights an audit event row", () => {
    const onSelectEvent = vi.fn();
    render(
      <AuditTimelinePanel
        auditEvents={[event(1), event(2, { action: "resize_failed", entityId: "missing", summary: "Resize failed" })]}
        panes={[pane()]}
        selectedEventId={1}
        onSelectEvent={onSelectEvent}
      />,
    );

    const selectedRow = screen.getByText("Sent Enter to active terminal").closest("article");
    expect(selectedRow?.getAttribute("data-selected")).toBe("true");

    fireEvent.click(screen.getByText("resize failed"));
    expect(onSelectEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), undefined);
  });

  it("uses supplied audit events without polling the backend", () => {
    const invoke = vi.fn(async () => [event(2)]) as Invoke;
    render(<AuditTimelinePanel auditEvents={[event(1)]} invoke={invoke} pollMs={60_000} />);

    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByText("Sent Enter to active terminal")).toBeTruthy();
  });

  it("can show a shared audit stream error when entries are supplied by the app shell", () => {
    render(<AuditTimelinePanel auditEvents={[]} auditReady auditError="database unavailable" />);

    expect(screen.getByRole("alert").textContent).toContain("database unavailable");
    expect(screen.getByText("No audit events yet")).toBeTruthy();
  });
});
