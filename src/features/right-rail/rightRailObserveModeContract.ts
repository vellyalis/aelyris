import type { AgentFleetSession } from "../../shared/lib/agentFleet";
import type { GitChangedFile } from "../../shared/lib/reviewQueue";
import type { WorkstationGraph } from "../../shared/lib/workstationGraph";
import type { AuditEventRecord } from "../../shared/types/audit";
import type { TerminalPaneTarget } from "../../shared/types/terminalPane";
import type { RightRailActionResultTone, RightRailRouteConfirmation, RightRailWidgetId } from "./rightRailTypes";

export interface RightRailObserveModeViewModel {
  readonly sessions: AgentFleetSession[];
  readonly activeSessionId: string | null;
  readonly panes: TerminalPaneTarget[];
  readonly activeTerminalId: string | null;
  readonly highlightedPane: {
    readonly paneId: string | null;
    readonly terminalId: string | null;
  };
  readonly audit: {
    readonly events: AuditEventRecord[];
    readonly error: string | null;
    readonly ready: boolean;
    readonly selectedEventId: number | null;
    readonly traceFilter: string | null;
  };
  readonly changedFiles: GitChangedFile[];
  readonly project: {
    readonly name: string;
    readonly path: string;
    readonly branch: string | null;
  };
  readonly workstationGraph: WorkstationGraph;
  readonly focusedWidget: string | null;
  readonly auditConfirmation: Pick<RightRailRouteConfirmation, "title" | "detail"> | null;
  readonly diagnosticsEnabled: boolean;
}

export interface RightRailIncidentSelection {
  readonly eventId: number;
  readonly pane?: TerminalPaneTarget;
}

export interface RightRailObserveModeActions {
  readonly onFocusPane: (tabId: string, paneId: string) => void | Promise<void>;
  readonly onClosePane: (tabId: string, paneId: string) => void | Promise<void>;
  readonly onRestartPane: (tabId: string, paneId: string) => void | Promise<void>;
  readonly onAttachPane: (tabId: string, paneId: string, terminalId: string) => void | Promise<void>;
  readonly onProcessEnded: (terminalId: string) => void;
  readonly onSelectPane: (pane: TerminalPaneTarget) => void;
  readonly onSelectEvent: (entry: AuditEventRecord, pane?: TerminalPaneTarget) => void;
  readonly onTraceFilterChange: (correlationId: string | null) => void;
  readonly onSelectSession: (id: string) => void;
  readonly onSelectIncident: (incident: RightRailIncidentSelection) => void;
  readonly onTraceIncident: (correlationId: string, incident: RightRailIncidentSelection) => void;
  readonly onDestinationOutcome: (outcome: {
    label: string;
    detail: string;
    tone: RightRailActionResultTone;
    auditEventId?: number | null;
    auditCorrelationId?: string | null;
    routeWidget?: RightRailWidgetId | null;
    routeLabel?: string | null;
    routeDetail?: string | null;
  }) => void;
}
