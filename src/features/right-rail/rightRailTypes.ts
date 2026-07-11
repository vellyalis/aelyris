import type { AiCliLaunchPreflightEvidence, AiCliProbeEvidence } from "../../shared/lib/aiCliLaunchPlanner";
import type { RightRailAction, RightRailMode } from "../../shared/lib/rightRailAdvisor";
import type { WorkforceGuardrailProfile } from "../../shared/lib/rightRailWorkforce";

export type RightRailActionResultTone = "success" | "warn" | "error";
export type RightRailGuardrailSelection = "Auto" | WorkforceGuardrailProfile;
export type RightRailWidgetId =
  | "decision-inbox" | "sessions" | "orchestrator" | "workflow" | "toolkit"
  | "context" | "audit-timeline" | "run-graph" | "tool-ledger" | "logs";

export interface RightRailActionResult {
  id: string; label: string; detail: string; tone: RightRailActionResultTone; timestamp: number;
  auditEventId: number | null; auditCorrelationId: string | null; auditKind: string | null;
  auditTimestamp: string | null; routeWidget: RightRailWidgetId | null; routeLabel: string | null;
  routeDetail: string | null;
}
export interface RightRailAiCliLaunchEvidenceState { evidence: AiCliProbeEvidence | null; preflight: AiCliLaunchPreflightEvidence | null }
export interface RightRailRouteConfirmation { widget: RightRailWidgetId; title: string; detail: string; createdAt: number }
export interface RightRailEdgeScoreItem {
  id: "decision" | "evidence" | "recovery" | "live"; label: string; score: number; max: number;
  status: "pass" | "watch" | "gap"; detail: string; actionLabel: string; routeMode: RightRailMode;
  focusWidget: string; routeTitle: string; routeDetail: string; promptTitle: string; promptDetail: string;
}
export interface RightRailEdgeScore {
  score: number; grade: "S" | "A" | "B" | "C" | "D"; tone: "strong" | "watch" | "gap";
  label: string; detail: string; items: RightRailEdgeScoreItem[];
}
export interface RightRailDestinationPrompt {
  widget: string; axisLabel: string; title: string; detail: string; actionLabel: string;
  item: RightRailEdgeScoreItem; edgeScore: number; edgeGrade: RightRailEdgeScore["grade"];
  fromMode: RightRailMode; createdAt: number; reachedAt?: number;
}
export interface RightRailEdgeScoreFeedbackEntry {
  id: string; axisId: string; axisLabel: string; actionLabel: string; targetWidget: string;
  score: number; grade: RightRailEdgeScore["grade"]; previousScore: number | null; delta: number;
  trend: "baseline" | "improved" | "flat" | "regressed"; createdAt: number;
}
export interface RightRailEdgeFeedbackAxisSummary { axisId: string; axisLabel: string; count: number; trend: RightRailEdgeScoreFeedbackEntry["trend"] }
export interface RightRailEdgeFeedbackStaleGroup { axisId: string; axisLabel: string; count: number; score: number; grade: RightRailEdgeScore["grade"]; staleReason: string }
export interface RightRailEdgeNextBestAction { item: RightRailEdgeScoreItem; reason: "repeated-axis" | "weakest-axis" }
export interface RightRailEdgeRecommendationOutcome { status: "reached" | "replayed" | "stale"; label: string; detail: string }
export interface RightRailEdgeFeedbackResetNotice { createdAt: number; label: string; detail: string }

export type { RightRailAction };
