import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RightRailObserveMode } from "../features/right-rail/RightRailObserveMode";
import { deriveFleetBriefing } from "../features/fleet-briefing/fleetBriefingModel";
import type {
  RightRailObserveModeActions,
  RightRailObserveModeViewModel,
} from "../features/right-rail/rightRailObserveModeContract";
import { buildWorkstationGraph } from "../shared/lib/workstationGraph";
import type { TerminalPaneTarget } from "../shared/types/terminalPane";
import type { SeqEvent } from "../shared/types/eventBus";

const PANE: TerminalPaneTarget = {
  paneId: "pane-1",
  terminalId: "terminal-1",
  index: 0,
  shell: "powershell",
  tabId: "tab-1",
  tabLabel: "Workspace",
  tabShell: "powershell",
};

vi.mock("../features/right-rail/rightRailWidgetFrame", () => ({
  RightRailWidgetFrame: ({
    children,
    title,
    subtitle,
  }: {
    children: React.ReactNode;
    title: string;
    subtitle: string;
  }) => (
    <section aria-label={title} data-subtitle={subtitle}>
      {children}
    </section>
  ),
}));

vi.mock("../features/fleet-briefing/FleetBriefingPanel", () => ({
  FleetBriefingPanel: ({ projectPath }: { projectPath: string }) => (
    <section aria-label="fleet briefing projection" data-project-path={projectPath} />
  ),
}));

vi.mock("../features/process-manager", () => ({
  ProcessManagerPanel: ({
    activeTerminalId,
    highlightedPaneId,
    highlightedTerminalId,
    onFocusPane,
    onClosePane,
    onRestartPane,
    onAttachProcess,
    onProcessEnded,
  }: {
    activeTerminalId: string | null;
    highlightedPaneId: string | null;
    highlightedTerminalId: string | null;
    onFocusPane: (tabId: string, paneId: string) => void;
    onClosePane: (tabId: string, paneId: string) => void;
    onRestartPane: (tabId: string, paneId: string) => void;
    onAttachProcess: (tabId: string, paneId: string, terminalId: string) => void;
    onProcessEnded: (terminalId: string) => void;
  }) => (
    <section
      aria-label="process projection"
      data-active-terminal={activeTerminalId ?? ""}
      data-highlighted-pane={highlightedPaneId ?? ""}
      data-highlighted-terminal={highlightedTerminalId ?? ""}
    >
      <button type="button" onClick={() => onFocusPane("tab-1", "pane-1")}>
        focus process pane
      </button>
      <button type="button" onClick={() => onClosePane("tab-1", "pane-1")}>
        close process pane
      </button>
      <button type="button" onClick={() => onRestartPane("tab-1", "pane-1")}>
        restart process pane
      </button>
      <button type="button" onClick={() => onAttachProcess("tab-1", "pane-1", "terminal-2")}>
        attach process
      </button>
      <button type="button" onClick={() => onProcessEnded("terminal-1")}>
        end process
      </button>
    </section>
  ),
}));

vi.mock("../features/context/LivePanesPanel", () => ({
  LivePanesPanel: ({
    onFocusPane,
    onAttachPane,
    onSelectPane,
  }: {
    onFocusPane: (tabId: string, paneId: string) => void;
    onAttachPane: (tabId: string, paneId: string, terminalId: string) => void;
    onSelectPane: (pane: TerminalPaneTarget) => void;
  }) => (
    <section aria-label="live panes projection">
      <button type="button" onClick={() => onFocusPane("tab-1", "pane-1")}>
        focus live pane
      </button>
      <button type="button" onClick={() => onAttachPane("tab-1", "pane-1", "terminal-3")}>
        attach live pane
      </button>
      <button type="button" onClick={() => onSelectPane(PANE)}>
        select live pane
      </button>
    </section>
  ),
}));

vi.mock("../features/context/AuditTimelinePanel", () => ({
  AuditTimelinePanel: ({
    auditError,
    auditReady,
    selectedEventId,
    traceFilter,
    onSelectEvent,
    onTraceFilterChange,
    onDestinationOutcome,
  }: {
    auditError: string | null;
    auditReady: boolean;
    selectedEventId: number | null;
    traceFilter: string | null;
    onSelectEvent: (entry: { id: number }, pane: TerminalPaneTarget) => void;
    onTraceFilterChange: (correlationId: string | null) => void;
    onDestinationOutcome: (outcome: { label: string; detail: string; tone: "success" }) => void;
  }) => (
    <section
      aria-label="audit projection"
      data-error={auditError ?? ""}
      data-ready={String(auditReady)}
      data-selected-event={selectedEventId ?? ""}
      data-trace-filter={traceFilter ?? ""}
    >
      <button type="button" onClick={() => onSelectEvent({ id: 42 }, PANE)}>
        select audit event
      </button>
      <button type="button" onClick={() => onTraceFilterChange("trace-1")}>
        trace audit event
      </button>
      <button
        type="button"
        onClick={() => onDestinationOutcome({ label: "Audit ready", detail: "event 42", tone: "success" })}
      >
        report audit outcome
      </button>
    </section>
  ),
}));

vi.mock("../features/context/ContextPanel", () => ({
  ContextPanel: ({
    changedFilesCount,
    density,
    projectName,
  }: {
    changedFilesCount: number;
    density: string;
    projectName: string;
  }) => (
    <section
      aria-label="observe context projection"
      data-changed-files={changedFilesCount}
      data-density={density}
      data-project-name={projectName}
    />
  ),
}));

vi.mock("../features/context/RunGraphPanel", () => ({
  RunGraphPanel: ({ onSelectSession }: { onSelectSession: (id: string) => void }) => (
    <section aria-label="run graph projection">
      <button type="button" onClick={() => onSelectSession("agent-run")}>
        select run agent
      </button>
    </section>
  ),
}));

vi.mock("../features/context/ToolLedgerPanel", () => ({
  ToolLedgerPanel: ({ onSelectSession }: { onSelectSession: (id: string) => void }) => (
    <section aria-label="tool ledger projection">
      <button type="button" onClick={() => onSelectSession("agent-tool")}>
        select tool agent
      </button>
    </section>
  ),
}));

vi.mock("../features/context/ReliabilityPanel", () => ({
  ReliabilityPanel: ({
    changedFilesCount,
    selectedEventId,
    onSelectIncident,
    onTraceIncident,
  }: {
    changedFilesCount: number;
    selectedEventId: number | null;
    onSelectIncident: (incident: { eventId: number }) => void;
    onTraceIncident: (correlationId: string, incident: { eventId: number }) => void;
  }) => (
    <section
      aria-label="reliability projection"
      data-changed-files={changedFilesCount}
      data-selected-event={selectedEventId ?? ""}
    >
      <button type="button" onClick={() => onSelectIncident({ eventId: 51 })}>
        select incident
      </button>
      <button type="button" onClick={() => onTraceIncident("trace-2", { eventId: 51 })}>
        trace incident
      </button>
    </section>
  ),
}));

vi.mock("../features/logs/LogsPanel", () => ({
  LogsPanel: ({ defaultCollapsed }: { defaultCollapsed: boolean }) => (
    <section aria-label="logs projection" data-collapsed={String(defaultCollapsed)} />
  ),
}));

const VIEW_MODEL: RightRailObserveModeViewModel = {
  sessions: [],
  activeSessionId: "agent-1",
  panes: [PANE],
  activeTerminalId: "terminal-1",
  highlightedPane: { paneId: "pane-1", terminalId: "terminal-1" },
  audit: {
    events: [],
    error: null,
    ready: true,
    selectedEventId: 42,
    traceFilter: "trace-current",
  },
  changedFiles: [{ path: "src/observe.ts", status: "modified" }],
  project: { name: "Aelyris", path: "C:/repo", branch: "main" },
  workstationGraph: buildWorkstationGraph({ workspaceId: "C:/repo" }),
  focusedWidget: "audit-timeline",
  auditConfirmation: { title: "Audit reached", detail: "event 42" },
  diagnosticsEnabled: true,
};

function createActions(): RightRailObserveModeActions {
  return {
    onFocusPane: vi.fn(),
    onClosePane: vi.fn(),
    onRestartPane: vi.fn(),
    onAttachPane: vi.fn(),
    onProcessEnded: vi.fn(),
    onSelectPane: vi.fn(),
    onSelectEvent: vi.fn(),
    onTraceFilterChange: vi.fn(),
    onSelectSession: vi.fn(),
    onSelectIncident: vi.fn(),
    onTraceIncident: vi.fn(),
    onDestinationOutcome: vi.fn(),
  };
}

afterEach(cleanup);

describe("RightRailObserveMode", () => {
  it("projects the observe surface from one typed view model without duplicating runtime owners", () => {
    render(
      <RightRailObserveMode
        viewModel={VIEW_MODEL}
        actions={createActions()}
        processDestination={<span>process destination</span>}
        livePanesDestination={<span>live destination</span>}
        auditDestination={<span>audit destination</span>}
        reliabilityDestination={<span>reliability destination</span>}
        agentInspector={<section aria-label="observe agent inspector slot" />}
      />,
    );

    expect(screen.getByText("process destination")).not.toBeNull();
    expect(screen.getByText("live destination")).not.toBeNull();
    expect(screen.getByText("audit destination")).not.toBeNull();
    expect(screen.getByText("reliability destination")).not.toBeNull();
    expect(screen.getByRole("region", { name: "fleet briefing projection" }).dataset.projectPath).toBe("C:/repo");
    expect(screen.getByRole("region", { name: "observe agent inspector slot" })).not.toBeNull();
    expect(screen.getByRole("region", { name: "process projection" }).dataset.activeTerminal).toBe("terminal-1");
    expect(screen.getByRole("region", { name: "audit projection" }).dataset.traceFilter).toBe("trace-current");
    expect(screen.getByRole("region", { name: "observe context projection" }).dataset.density).toBe("compact");
    expect(screen.getByRole("region", { name: "reliability projection" }).dataset.changedFiles).toBe("1");
    expect(screen.getByRole("region", { name: "logs projection" }).dataset.collapsed).toBe("true");
  });

  it("routes process, pane, audit, session, and reliability intents through the action contract", () => {
    const actions = createActions();
    render(
      <RightRailObserveMode
        viewModel={VIEW_MODEL}
        actions={actions}
        processDestination={null}
        livePanesDestination={null}
        auditDestination={null}
        reliabilityDestination={null}
        agentInspector={null}
      />,
    );

    for (const name of [
      "focus process pane",
      "close process pane",
      "restart process pane",
      "attach process",
      "end process",
      "focus live pane",
      "attach live pane",
      "select live pane",
      "select audit event",
      "trace audit event",
      "report audit outcome",
      "select run agent",
      "select tool agent",
      "select incident",
      "trace incident",
    ]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }

    expect(actions.onFocusPane).toHaveBeenCalledTimes(2);
    expect(actions.onClosePane).toHaveBeenCalledWith("tab-1", "pane-1");
    expect(actions.onRestartPane).toHaveBeenCalledWith("tab-1", "pane-1");
    expect(actions.onAttachPane).toHaveBeenNthCalledWith(1, "tab-1", "pane-1", "terminal-2");
    expect(actions.onAttachPane).toHaveBeenNthCalledWith(2, "tab-1", "pane-1", "terminal-3");
    expect(actions.onProcessEnded).toHaveBeenCalledWith("terminal-1");
    expect(actions.onSelectPane).toHaveBeenCalledWith(PANE);
    expect(actions.onSelectEvent).toHaveBeenCalledWith({ id: 42 }, PANE);
    expect(actions.onTraceFilterChange).toHaveBeenCalledWith("trace-1");
    expect(actions.onDestinationOutcome).toHaveBeenCalledWith({
      label: "Audit ready",
      detail: "event 42",
      tone: "success",
    });
    expect(actions.onSelectSession).toHaveBeenNthCalledWith(1, "agent-run");
    expect(actions.onSelectSession).toHaveBeenNthCalledWith(2, "agent-tool");
    expect(actions.onSelectIncident).toHaveBeenCalledWith({ eventId: 51 });
    expect(actions.onTraceIncident).toHaveBeenCalledWith("trace-2", { eventId: 51 });
  });

  it("summarizes durable fleet facts without inventing timestamps or serializing arbitrary payloads", () => {
    const events: SeqEvent[] = [
      { seq: 1, eventId: "event-1", kind: "agent_activity", channel: "system", payload: { sessionId: "agent-1" } },
      { seq: 2, eventId: "event-2", kind: "task_completed", channel: "planning", payload: { taskId: "task-7" } },
      { seq: 3, eventId: "event-3", kind: "review_required", channel: "review", payload: { message: "Needs operator review" } },
      { seq: 4, eventId: "event-4", kind: "execution_reserved", channel: "system", payload: { nested: { secret: true } } },
    ];

    const summary = deriveFleetBriefing(events, 3);

    expect(summary.total).toBe(4);
    expect(summary.latestSeq).toBe(4);
    expect(summary.counts).toEqual({ progress: 1, attention: 1, durable: 1, fleet: 1 });
    expect(summary.unlocks).toBe(1);
    expect(summary.headline).toBe("1 item needs attention");
    expect(summary.items.map((item) => item.seq)).toEqual([4, 3, 2]);
    expect(summary.items[0]?.detail).toBeNull();
    expect(summary.items[1]?.detail).toBe("Needs operator review");
  });
});
