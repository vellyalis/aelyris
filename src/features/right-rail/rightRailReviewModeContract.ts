import type { AgentFleetSession } from "../../shared/lib/agentFleet";
import type { OrchestraRoleId } from "../../shared/lib/orchestrator";
import type { GitChangedFile } from "../../shared/lib/reviewQueue";
import type { FileProvenanceTrace, WorkstationGraph, WorkstationGraphPane } from "../../shared/lib/workstationGraph";
import type { AuditEventRecord } from "../../shared/types/audit";

export interface RightRailReviewModeViewModel {
  readonly sessions: AgentFleetSession[];
  readonly activeSessionId: string | null;
  readonly changedFiles: GitChangedFile[];
  readonly panes: readonly WorkstationGraphPane[];
  readonly auditEvents: readonly AuditEventRecord[];
  readonly project: {
    readonly name: string;
    readonly path: string;
    readonly branch: string | null;
  };
  readonly workstationGraph: WorkstationGraph;
  readonly contextFocused: boolean;
}

export interface RightRailReviewModeActions {
  readonly onSelectSession: (id: string) => void;
  readonly onOpenDiff: (path: string) => void;
  readonly onOpenCommandEvidence: (command: FileProvenanceTrace["commands"][number]) => void;
  readonly onStartAgent: (
    prompt: string,
    model?: string,
    meta?: { role?: OrchestraRoleId; handoffFrom?: string },
  ) => void;
  readonly onOpenFile: (path: string) => void;
}
