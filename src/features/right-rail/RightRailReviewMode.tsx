import type { ReactNode } from "react";
import { Suspense } from "react";
import { ErrorBoundary } from "../../shared/ui/ErrorBoundary";
import { ContextPanel } from "../context/ContextPanel";
import { ReviewQueuePanel } from "../review/ReviewQueuePanel";
import { SCMPanel } from "../scm/SCMPanel";
import type { RightRailReviewModeActions, RightRailReviewModeViewModel } from "./rightRailReviewModeContract";
import { RightRailWidgetFrame } from "./rightRailWidgetFrame";

export interface RightRailReviewModeProps {
  readonly viewModel: RightRailReviewModeViewModel;
  readonly actions: RightRailReviewModeActions;
  readonly agentInspector: ReactNode;
  readonly reviewQueueDestination: ReactNode;
}

export function RightRailReviewMode({
  viewModel,
  actions,
  agentInspector,
  reviewQueueDestination,
}: RightRailReviewModeProps) {
  const { sessions, activeSessionId, changedFiles, panes, auditEvents, project, workstationGraph, contextFocused } =
    viewModel;

  return (
    <>
      <ErrorBoundary>
        <Suspense fallback={null}>
          <div className="bento-widget" data-widget="review-queue">
            {reviewQueueDestination}
            <ReviewQueuePanel
              sessions={sessions}
              changedFiles={changedFiles}
              activeSessionId={activeSessionId}
              onSelectSession={actions.onSelectSession}
              onOpenDiff={actions.onOpenDiff}
              onOpenCommandEvidence={actions.onOpenCommandEvidence}
              onStartAgent={actions.onStartAgent}
              workstationGraph={workstationGraph}
            />
          </div>
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
          <div className="bento-widget" data-widget="scm">
            <SCMPanel projectPath={project.path} onOpenFile={actions.onOpenFile} onOpenDiff={actions.onOpenDiff} />
          </div>
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary>
        <Suspense fallback={null}>
          <RightRailWidgetFrame
            widget="context"
            title="Context"
            subtitle="handoff state"
            defaultOpen={false}
            forceOpen={contextFocused}
          >
            <ContextPanel
              sessions={sessions}
              activeSessionId={activeSessionId}
              changedFilesCount={changedFiles.length}
              changedFiles={changedFiles}
              panes={panes}
              auditEvents={auditEvents}
              projectName={project.name}
              projectPath={project.path}
              branch={project.branch}
              density="compact"
              workstationGraph={workstationGraph}
            />
          </RightRailWidgetFrame>
        </Suspense>
      </ErrorBoundary>
    </>
  );
}
