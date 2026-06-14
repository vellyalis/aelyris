// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalPaneTarget } from "../shared/types/terminalPane";
import { ReliabilityPanel } from "../features/context/ReliabilityPanel";
import { buildWorkstationGraph } from "../shared/lib/workstationGraph";
import type { AgentSession } from "../shared/types/agent";
import type { AuditEventRecord } from "../shared/types/audit";
import { useConfirmStore } from "../shared/ui/ConfirmDialog";

declare const process: { cwd(): string };

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
});

function session(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    name: `Agent ${id}`,
    status: "coding",
    model: "claude-sonnet",
    prompt: "work",
    startedAt: 1,
    logs: [],
    cost: 0.1,
    tokensUsed: 12_000,
    changedFileDetails: [],
    ...overrides,
  };
}

function pane(overrides: Partial<TerminalPaneTarget> = {}): TerminalPaneTarget {
  return {
    paneId: "pane-a",
    terminalId: "pty-a",
    index: 0,
    shell: "powershell",
    cwd: "C:/Users/owner/Aether_Terminal",
    title: "PowerShell",
    role: "work",
    tabId: "tab-a",
    tabLabel: "Aether",
    tabShell: "powershell",
    tabCwd: "C:/Users/owner/Aether_Terminal",
    ...overrides,
  };
}

function auditEvent(overrides: Partial<AuditEventRecord> = {}): AuditEventRecord {
  return {
    id: 1,
    timestamp: "2026-05-01T12:00:00.000Z",
    category: "terminal",
    action: "force_restart",
    severity: "warn",
    entityType: "terminal",
    entityId: "pty-a",
    summary: "Terminal force restarted",
    metadata: { redacted: true },
    ...overrides,
  };
}

describe("ReliabilityPanel", () => {
  it("summarizes operational guardrails without exposing logs as a primary surface", () => {
    render(<ReliabilityPanel sessions={[session("a")]} panes={[pane()]} changedFilesCount={0} />);

    expect(screen.getByLabelText("Operational reliability")).toBeTruthy();
    expect(screen.getByText("Reliability")).toBeTruthy();
    expect(screen.getByText("Input path")).toBeTruthy();
    expect(screen.getByText("IME composition guarded")).toBeTruthy();
    expect(screen.getByText("Pane control")).toBeTruthy();
    expect(screen.getByText("1 controllable pane")).toBeTruthy();
    expect(screen.getByText("Diagnostics")).toBeTruthy();
    expect(screen.getByText("Logs kept out of primary flow")).toBeTruthy();
    expect(screen.queryByText("Logs")).toBeNull();
  });

  it("marks blocked agents and review pressure as watch items", () => {
    render(
      <ReliabilityPanel
        sessions={[session("blocked", { status: "waiting" })]}
        panes={[pane({ terminalId: null, role: undefined })]}
        changedFilesCount={4}
      />,
    );

    expect(screen.getByText("Needs watch")).toBeTruthy();
    expect(screen.getAllByText("1 need attention").length).toBeGreaterThan(0);
    expect(screen.getByText("4 changed files")).toBeTruthy();
    expect(screen.getByText("No live panes")).toBeTruthy();
    expect(screen.getByText("No roles assigned")).toBeTruthy();
  });

  it("downgrades reliability when recent audit events need review", () => {
    const onFocusPane = vi.fn();
    render(
      <ReliabilityPanel
        sessions={[session("a")]}
        panes={[pane()]}
        changedFilesCount={0}
        auditEvents={[
          auditEvent({ severity: "warn" }),
          auditEvent({ id: 2, severity: "error", action: "spawn_failed" }),
        ]}
        onFocusPane={onFocusPane}
      />,
    );

    expect(screen.getByText("Audit trail")).toBeTruthy();
    expect(screen.getByText("1 errors / 1 warnings")).toBeTruthy();
    expect(screen.getByText("2 audit events need review")).toBeTruthy();
    expect(screen.getByLabelText("Recent reliability incidents")).toBeTruthy();
    expect(screen.getByText("force restart")).toBeTruthy();
    expect(screen.getByText("spawn failed")).toBeTruthy();
    expect(screen.getByText("Restart pane")).toBeTruthy();
    expect(screen.getByText("Restart the referenced pane if it no longer accepts input.")).toBeTruthy();
    expect(screen.getByText("Recorded")).toBeTruthy();
    expect(screen.getByText("No recovery action is required.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Focus Aether/PowerShell" }).length).toBe(2);
  });

  it("focuses the pane that matches an incident terminal id", async () => {
    const onFocusPane = vi.fn();
    render(
      <ReliabilityPanel
        sessions={[session("a")]}
        panes={[pane()]}
        auditEvents={[auditEvent({ entityId: "pty-a" })]}
        onFocusPane={onFocusPane}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Focus Aether/PowerShell" }));

    expect(onFocusPane).toHaveBeenCalledWith("tab-a", "pane-a");
  });

  it("scopes pane guardrails and incidents to the supplied workstation graph snapshot", () => {
    const workstationGraph = buildWorkstationGraph({
      workspaceId: "C:/repo",
      panes: [{ paneId: "pane-a", terminalId: "pty-a" }],
      risks: [{ id: "audit-1", title: "Terminal warning", status: "open", severity: "warn" }],
    });

    render(
      <ReliabilityPanel
        sessions={[session("a")]}
        panes={[pane(), pane({ paneId: "pane-b", terminalId: "pty-b", title: "Other" })]}
        auditEvents={[
          auditEvent({ id: 1, entityId: "pty-a", summary: "Scoped terminal warning" }),
          auditEvent({ id: 2, entityId: "pty-b", summary: "Hidden terminal warning" }),
        ]}
        workstationGraph={workstationGraph}
      />,
    );

    expect(screen.getByLabelText("Operational reliability").getAttribute("data-graph-source")).toBe(
      "workstation-graph",
    );
    expect(screen.getByText("1 controllable pane")).toBeTruthy();
    expect(screen.getByText("Scoped terminal warning")).toBeTruthy();
    expect(screen.queryByText("Hidden terminal warning")).toBeNull();
  });

  it("scopes incidents to graph agent nodes", () => {
    const focused = session("agent-a", { name: "Focused agent" });
    const workstationGraph = buildWorkstationGraph({
      workspaceId: "C:/repo",
      sessions: [focused],
    });

    render(
      <ReliabilityPanel
        sessions={[focused, session("agent-b", { name: "Hidden agent" })]}
        panes={[]}
        auditEvents={[
          auditEvent({
            id: 1,
            entityType: "agent",
            entityId: "agent-a",
            summary: "Focused agent incident",
          }),
          auditEvent({
            id: 2,
            entityType: "agent",
            entityId: "agent-b",
            summary: "Hidden agent incident",
          }),
        ]}
        workstationGraph={workstationGraph}
      />,
    );

    expect(screen.getByText("Focused agent incident")).toBeTruthy();
    expect(screen.queryByText("Hidden agent incident")).toBeNull();
  });

  it("selects and highlights a reliability incident", () => {
    const onSelectIncident = vi.fn();
    render(
      <ReliabilityPanel
        sessions={[session("a")]}
        panes={[pane()]}
        auditEvents={[auditEvent({ id: 7, entityId: "pty-a" })]}
        selectedEventId={7}
        onSelectIncident={onSelectIncident}
      />,
    );

    const incident = screen.getByText("Terminal force restarted").closest("li");
    expect(incident?.getAttribute("data-selected")).toBe("true");

    fireEvent.click(screen.getByText("force restart"));
    expect(onSelectIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 7,
        pane: expect.objectContaining({ paneId: "pane-a" }),
      }),
    );
  });

  it("does not show restart controls for non-restart recovery hints", () => {
    render(
      <ReliabilityPanel
        sessions={[session("a")]}
        panes={[pane({ role: "review" })]}
        auditEvents={[
          auditEvent({
            action: "send_to_role_no_pane",
            severity: "error",
            entityId: "review",
          }),
        ]}
        onRestartPane={vi.fn()}
      />,
    );

    expect(screen.getByText("Inspect target")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restart Aether/PowerShell" })).toBeNull();
  });

  it("keeps restart available for a recoverable pane after its terminal id is cleared", async () => {
    const onRestartPane = vi.fn();
    render(
      <ReliabilityPanel
        sessions={[session("a")]}
        panes={[pane({ terminalId: null })]}
        auditEvents={[auditEvent({ action: "send_keys_failed", entityId: "pane-a" })]}
        onRestartPane={onRestartPane}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Restart Aether/PowerShell" }));
    expect(useConfirmStore.getState().title).toBe("Restart terminal shell");

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(onRestartPane).toHaveBeenCalledWith("tab-a", "pane-a");
  });

  it("does not restart a stale reliability incident pane after confirmation resolves", async () => {
    const onRestartPane = vi.fn();
    const { rerender } = render(
      <ReliabilityPanel
        sessions={[session("a")]}
        panes={[pane()]}
        auditEvents={[auditEvent({ action: "send_keys_failed", entityId: "pty-a" })]}
        onRestartPane={onRestartPane}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Restart Aether/PowerShell" }));
    rerender(
      <ReliabilityPanel
        sessions={[session("a")]}
        panes={[]}
        auditEvents={[auditEvent({ action: "send_keys_failed", entityId: "pty-a" })]}
        onRestartPane={onRestartPane}
      />,
    );

    await act(async () => {
      useConfirmStore.getState().close(true);
    });

    expect(onRestartPane).not.toHaveBeenCalled();
  });

  it("opens the audit trace for an incident with a correlation id", () => {
    const onTraceIncident = vi.fn();
    render(
      <ReliabilityPanel
        sessions={[session("a")]}
        panes={[pane()]}
        auditEvents={[
          auditEvent({
            id: 11,
            metadata: { correlationId: "terminal:terminal:pty-a" },
          }),
        ]}
        onTraceIncident={onTraceIncident}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open trace terminal:terminal:pty-a" }));

    expect(onTraceIncident).toHaveBeenCalledWith(
      "terminal:terminal:pty-a",
      expect.objectContaining({
        eventId: 11,
        pane: expect.objectContaining({ paneId: "pane-a" }),
      }),
    );
  });

  it("supports keyboard selection for reliability incidents", () => {
    const onSelectIncident = vi.fn();
    render(
      <ReliabilityPanel
        sessions={[session("a")]}
        panes={[pane()]}
        auditEvents={[auditEvent({ id: 9 })]}
        onSelectIncident={onSelectIncident}
      />,
    );

    const incident = screen.getByText("Terminal force restarted").closest("li");
    expect(incident).toBeTruthy();
    if (!incident) throw new Error("Expected reliability incident row");
    fireEvent.keyDown(incident, { key: "Enter" });

    expect(onSelectIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 9,
        pane: expect.objectContaining({ paneId: "pane-a" }),
      }),
    );
  });

  it("keeps incident controls and guardrails stable in the right rail", () => {
    const css = readFileSync(`${process.cwd()}/src/features/context/ReliabilityPanel.module.css`, "utf8");

    expect(css).toContain("grid-template-columns: repeat(auto-fit, minmax(116px, 1fr));");
    expect(css).toContain("grid-template-columns: 3px minmax(0, 1fr) minmax(70px, auto);");
    expect(css).toContain("min-width: 70px;");
    expect(css).toContain("max-width: 76px;");
    expect(css).toContain("max-width: min(44%, 112px);");
    expect(css).toContain("overflow: hidden;");
    expect(css).not.toContain("grid-template-columns: 3px minmax(0, 1fr) auto;");
    expect(css).not.toContain("max-width: 46%;");
  });
});
