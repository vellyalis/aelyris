import type { StartAgentMeta } from "../../shared/hooks/useAgentFleet";
import type { AgentFleetSession } from "../../shared/lib/agentFleet";
import type { DecisionWorkflowStatus, HumanDecisionItem } from "../../shared/lib/decisionInbox";
import type { GitChangedFile } from "../../shared/lib/reviewQueue";
import type { WorkstationGraph, WorkstationGraphPane } from "../../shared/lib/workstationGraph";
import type { AuditEventRecord } from "../../shared/types/audit";
import type { DecisionAction } from "../decision-inbox/DecisionInboxPanel";
import type { RightRailActionResultTone, RightRailRouteConfirmation, RightRailWidgetId } from "./rightRailTypes";

export interface RightRailCommandModeViewModel {
  readonly sessions: AgentFleetSession[];
  readonly activeSessionId: string | null;
  readonly auditEvents: AuditEventRecord[];
  readonly workflows: DecisionWorkflowStatus[];
  readonly project: { readonly name: string; readonly path: string; readonly branch: string | null };
  readonly context: {
    readonly changedFiles: GitChangedFile[];
    readonly panes: readonly WorkstationGraphPane[];
    readonly workstationGraph: WorkstationGraph;
  };
  readonly focusedWidget: string | null;
  readonly toolkit: { readonly activeTargetLabel: string; readonly activeTargetReady: boolean };
  readonly decisionInbox: {
    readonly visible: boolean;
    readonly pendingCount: number;
    readonly focusRequestKey: number;
  };
  readonly agents: { readonly summary: string; readonly detail: string };
  readonly workflowConfirmation: Pick<RightRailRouteConfirmation, "title" | "detail"> | null;
}

export interface RightRailCommandModeActions {
  readonly onRunCommand: (command: string) => void | Promise<void>;
  readonly onSelectSession: (id: string) => void;
  readonly onOpenWorkflow: (id: string) => void;
  readonly onOpenAudit: (id: number) => void;
  readonly onDecide: (item: HumanDecisionItem, decision: DecisionAction) => void | Promise<void>;
  readonly onStartAgent: (prompt: string, model?: string, meta?: StartAgentMeta) => Promise<string | undefined>;
  readonly onDestinationOutcome: (outcome: {
    label: string;
    detail: string;
    tone: RightRailActionResultTone;
    routeWidget?: RightRailWidgetId | null;
    routeLabel?: string | null;
    routeDetail?: string | null;
  }) => void;
}
