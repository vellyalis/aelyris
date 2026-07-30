import type { ReactNode } from "react";
import { Suspense } from "react";
import { ErrorBoundary } from "../../shared/ui/ErrorBoundary";
import { ContextPanel } from "../context/ContextPanel";
import { DecisionInboxPanel } from "../decision-inbox";
import { OrchestratorPanel } from "../orchestrator/OrchestratorPanel";
import { ToolkitPanel } from "../toolkit/ToolkitPanel";
import { WorkflowPanel } from "../workflow/WorkflowPanel";
import type { RightRailCommandModeActions, RightRailCommandModeViewModel } from "./rightRailCommandModeContract";
import { RightRailWidgetFrame } from "./rightRailWidgetFrame";

export interface RightRailCommandModeProps {
  readonly viewModel: RightRailCommandModeViewModel;
  readonly actions: RightRailCommandModeActions;
  readonly agentInspector: ReactNode;
  readonly toolkitDestination: ReactNode;
  readonly decisionInboxDestination: ReactNode;
}

export function RightRailCommandMode({
  viewModel,
  actions,
  agentInspector,
  toolkitDestination,
  decisionInboxDestination,
}: RightRailCommandModeProps) {
  const {
    sessions,
    activeSessionId,
    auditEvents,
    workflows,
    project,
    context,
    focusedWidget,
    toolkit,
    decisionInbox,
    agents,
    workflowConfirmation,
  } = viewModel;

  return (
    <>
      <ErrorBoundary>
        <Suspense fallback={null}>
          <div
            className="bento-widget"
            data-widget="toolkit"
            data-rail-focus={focusedWidget === "toolkit" || undefined}
          >
            {toolkitDestination}
            <ToolkitPanel
              projectName={project.name}
              onRunCommand={actions.onRunCommand}
              activeTargetLabel={toolkit.activeTargetLabel}
              activeTargetReady={toolkit.activeTargetReady}
              forceExpanded={focusedWidget === "toolkit"}
            />
          </div>
        </Suspense>
      </ErrorBoundary>
      {decisionInbox.visible && (
        <ErrorBoundary>
          <Suspense fallback={null}>
            <RightRailWidgetFrame
              widget="decision-inbox"
              title="Decision Inbox"
              subtitle={`${decisionInbox.pendingCount} waiting`}
              defaultOpen={decisionInbox.pendingCount > 0}
              forceOpen={focusedWidget === "decision-inbox"}
            >
              {decisionInboxDestination}
              <DecisionInboxPanel
                sessions={sessions}
                auditEvents={auditEvents}
                workflows={workflows}
                activeSessionId={activeSessionId}
                onSelectSession={actions.onSelectSession}
                onOpenWorkflow={actions.onOpenWorkflow}
                onOpenAudit={actions.onOpenAudit}
                onDecide={actions.onDecide}
                focusRequestKey={decisionInbox.focusRequestKey}
              />
            </RightRailWidgetFrame>
          </Suspense>
        </ErrorBoundary>
      )}
      <ErrorBoundary>
        <Suspense fallback={null}>
          <RightRailWidgetFrame
            widget="sessions"
            title="Agents"
            subtitle={`${agents.summary} · ${agents.detail}`}
            defaultOpen={false}
            forceOpen={focusedWidget === "sessions"}
          >
            {agentInspector}
          </RightRailWidgetFrame>
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary>
        <Suspense fallback={null}>
          <RightRailWidgetFrame
            widget="orchestrator"
            title="Orchestrator"
            subtitle="autonomy loop"
            defaultOpen={false}
            forceOpen={focusedWidget === "orchestrator"}
          >
            <OrchestratorPanel />
          </RightRailWidgetFrame>
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary>
        <Suspense fallback={null}>
          <RightRailWidgetFrame
            widget="workflow"
            title="Workflows"
            subtitle="multi-step runs"
            defaultOpen={false}
            forceOpen={focusedWidget === "workflow"}
            focusConfirmation={workflowConfirmation}
          >
            <WorkflowPanel
              projectPath={project.path}
              sessions={sessions}
              onStartAgent={actions.onStartAgent}
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
              changedFilesCount={context.changedFiles.length}
              changedFiles={context.changedFiles}
              panes={context.panes}
              auditEvents={auditEvents}
              projectName={project.name}
              projectPath={project.path}
              branch={project.branch}
              workstationGraph={context.workstationGraph}
            />
          </RightRailWidgetFrame>
        </Suspense>
      </ErrorBoundary>
    </>
  );
}
