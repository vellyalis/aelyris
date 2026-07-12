import type { RightRailEdgeScoreItem } from "./rightRailTypes";

export const RIGHT_RAIL_EDGE_FEEDBACK_LIMIT = 4;
export const RIGHT_RAIL_EDGE_FEEDBACK_STORAGE_PREFIX = "aelyris:right-rail-edge-feedback:";
export const RIGHT_RAIL_EDGE_FEEDBACK_HISTORY_STATE_KEY = "aelyrisRightRailEdgeFeedback";
export const RIGHT_RAIL_EDGE_FEEDBACK_URL_PARAM = "edgeLoop";
export const RIGHT_RAIL_EDGE_FEEDBACK_AXIS_IDS: readonly RightRailEdgeScoreItem["id"][] = [
  "decision", "evidence", "recovery", "live",
];
export const RIGHT_RAIL_EDGE_FEEDBACK_AXIS_LABELS: Record<RightRailEdgeScoreItem["id"], string> = {
  decision: "Decision", evidence: "Evidence", recovery: "Recovery", live: "Live",
};
export const RIGHT_RAIL_EDGE_FEEDBACK_ACTION_LABELS = new Set([
  "Open inbox", "Inspect inbox", "Open review", "Open audit", "Open risks", "Open recovery", "Watch live", "Open processes",
]);
export const RIGHT_RAIL_EDGE_FEEDBACK_TARGET_WIDGETS = new Set([
  "decision-inbox", "review-queue", "audit-timeline", "reliability", "live-panes", "processes",
]);
