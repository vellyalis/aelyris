import type { ReactNode } from "react";
import { Suspense } from "react";
import { ErrorBoundary } from "../../shared/ui/ErrorBoundary";
import { AuditTimelinePanel } from "../context/AuditTimelinePanel";
import { ContextPanel } from "../context/ContextPanel";
import { LivePanesPanel } from "../context/LivePanesPanel";
import { ReliabilityPanel } from "../context/ReliabilityPanel";
import { RunGraphPanel } from "../context/RunGraphPanel";
import { ToolLedgerPanel } from "../context/ToolLedgerPanel";
import { FleetBriefingPanel } from "../fleet-briefing/FleetBriefingPanel";
import { LogsPanel } from "../logs/LogsPanel";
import { ProcessManagerPanel } from "../process-manager";
import type { RightRailObserveModeActions, RightRailObserveModeViewModel } from "./rightRailObserveModeContract";
import { RightRailWidgetFrame } from "./rightRailWidgetFrame";

export interface RightRailObserveModeProps {
  readonly viewModel: RightRailObserveModeViewModel;
  readonly actions: RightRailObserveModeActions;
  readonly agentInspector: ReactNode;
  readonly processDestination: ReactNode;
  readonly livePanesDestination: ReactNode;
  readonly auditDestination: ReactNode;
  readonly reliabilityDestination: ReactNode;
}

export function RightRailObserveMode({
  viewModel,
  actions,
  agentInspector,
  processDestination,
  livePanesDestination,
  auditDestination,
  reliabilityDestination,
}: RightRailObserveModeProps) {
  const {
    sessions,
    activeSessionId,
    panes,
    activeTerminalId,
    highlightedPane,
    audit,
    changedFiles,
    project,
    workstationGraph,
    focusedWidget,
    auditConfirmation,
    diagnosticsEnabled,
  } = viewModel;

  return (
    <>
      <ErrorBoundary>
        <Suspense fallback={null}>
          <RightRailWidgetFrame
            widget="fleet-briefing"
            title="Fleet Briefing"
            subtitle="since your last check"
            forceOpen={focusedWidget === "fleet-briefing"}
          >
            <FleetBriefingPanel key={project.path} projectPath={project.path} />
          </RightRailWidgetFrame>
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary>
        <Suspense fallback={null}>
          <div className="bento-widget" data-widget="processes">
            {processDestination}
            <ProcessManagerPanel
              panes={panes}
              activeTerminalId={activeTerminalId}
              highlightedPaneId={highlightedPane.paneId}
              highlightedTerminalId={highlightedPane.terminalId}
              onFocusPane={actions.onFocusPane}
              onClosePane={actions.onClosePane}
              onRestartPane={actions.onRestartPane}
              onAttachProcess={actions.onAttachPane}
              onProcessEnded={actions.onProcessEnded}
            />
          </div>
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary>
        <Suspense fallback={null}>
          <div className="bento-widget" data-widget="live-panes">
            {livePanesDestination}
            <LivePanesPanel
              panes={panes}
              highlightedPaneId={highlightedPane.paneId}
              highlightedTerminalId={highlightedPane.terminalId}
              onFocusPane={actions.onFocusPane}
              onAttachPane={actions.onAttachPane}
              onSelectPane={actions.onSelectPane}
            />
          </div>
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary>
        <Suspense fallback={null}>
          <RightRailWidgetFrame
            widget="audit-timeline"
            title="Audit"
            subtitle="events and recovery"
            defaultOpen={false}
            forceOpen={focusedWidget === "audit-timeline"}
            focusConfirmation={auditConfirmation}
          >
            {auditDestination}
            <AuditTimelinePanel
              auditEvents={audit.events}
              auditError={audit.error}
              auditReady={audit.ready}
              panes={panes}
              selectedEventId={audit.selectedEventId}
              traceFilter={audit.traceFilter}
              workstationGraph={workstationGraph}
              onFocusPane={actions.onFocusPane}
              onRestartPane={actions.onRestartPane}
              onSelectEvent={actions.onSelectEvent}
              onTraceFilterChange={actions.onTraceFilterChange}
              onDestinationOutcome={actions.onDestinationOutcome}
            />
          </RightRailWidgetFrame>
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary>
        <Suspense fallback={null}>
          <RightRailWidgetFrame
            widget="context"
            title="Context"
            subtitle="handoff state"
            defaultOpen={false}
            forceOpen={focusedWidget === "context"}
          >
            <ContextPanel
              sessions={sessions}
              activeSessionId={activeSessionId}
              changedFilesCount={changedFiles.length}
              changedFiles={changedFiles}
              panes={panes}
              auditEvents={audit.events}
              projectName={project.name}
              projectPath={project.path}
              branch={project.branch}
              density="compact"
              workstationGraph={workstationGraph}
            />
          </RightRailWidgetFrame>
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary>
        <Suspense fallback={null}>
          <RightRailWidgetFrame
            widget="run-graph"
            title="Run Graph"
            subtitle="roles and handoffs"
            defaultOpen={false}
            forceOpen={focusedWidget === "run-graph"}
          >
            <RunGraphPanel
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelectSession={actions.onSelectSession}
              workstationGraph={workstationGraph}
            />
          </RightRailWidgetFrame>
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary>
        <Suspense fallback={null}>
          <RightRailWidgetFrame widget="tool-ledger" title="Run Ledger" subtitle="tool activity" defaultOpen={false}>
            <ToolLedgerPanel
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelectSession={actions.onSelectSession}
              workstationGraph={workstationGraph}
            />
          </RightRailWidgetFrame>
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary>
        <Suspense fallback={null}>
          <div className="bento-widget" data-widget="sessions" style={{ minHeight: 200 }}>
            {agentInspector}
          </div>
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary>
        <Suspense fallback={null}>
          <div className="bento-widget" data-widget="reliability">
            {reliabilityDestination}
            <ReliabilityPanel
              sessions={sessions}
              panes={panes}
              changedFilesCount={changedFiles.length}
              auditEvents={audit.events}
              workstationGraph={workstationGraph}
              selectedEventId={audit.selectedEventId}
              onFocusPane={actions.onFocusPane}
              onRestartPane={actions.onRestartPane}
              onSelectIncident={actions.onSelectIncident}
              onTraceIncident={actions.onTraceIncident}
            />
          </div>
        </Suspense>
      </ErrorBoundary>
      {diagnosticsEnabled && (
        <ErrorBoundary>
          <Suspense fallback={null}>
            <RightRailWidgetFrame widget="logs" title="Logs" subtitle="diagnostics" defaultOpen={false}>
              <LogsPanel defaultCollapsed />
            </RightRailWidgetFrame>
          </Suspense>
        </ErrorBoundary>
      )}
    </>
  );
}
