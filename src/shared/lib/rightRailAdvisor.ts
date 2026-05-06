import type { AgentSession } from "../types/agent";
import type { WorkstationGraph } from "./workstationGraph";
import { buildWorkstationSummary } from "./workstationSummary";

export type RightRailMode = "command" | "review" | "observe";

export interface RightRailRecommendation {
  mode: RightRailMode;
  label: string;
  detail: string;
  tone: "command" | "review" | "observe" | "warn";
}

interface RightRailAdvisorInput {
  sessions: AgentSession[];
  interactiveSessionCount: number;
  changedFilesCount: number;
  contextWarnPct: number;
  currentMode: RightRailMode;
  workstationGraph?: WorkstationGraph;
  selectedPane?: {
    role?: string;
    title?: string;
    label?: string;
  } | null;
}

function plural(value: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : pluralLabel}`;
}

export function deriveRightRailRecommendation({
  sessions,
  interactiveSessionCount,
  changedFilesCount,
  contextWarnPct,
  currentMode,
  workstationGraph,
  selectedPane,
}: RightRailAdvisorInput): RightRailRecommendation | null {
  const graphChangedFilesCount = workstationGraph?.nodeCountByKind.file ?? 0;
  const graphPaneCount = workstationGraph?.nodeCountByKind.pane ?? 0;
  const summary = buildWorkstationSummary({
    sessions,
    changedFilesCount: Math.max(changedFilesCount, graphChangedFilesCount),
    interactiveSessionCount,
  });
  const peakContext = Math.round(summary.peakContextPct);
  const selectedRole = selectedPane?.role?.toLowerCase();
  const selectedName =
    selectedPane?.title || selectedPane?.label || (selectedRole ? `@${selectedRole}` : "selected pane");

  if (summary.peakSession && peakContext >= contextWarnPct && currentMode !== "observe") {
    return {
      mode: "observe",
      tone: "warn",
      label: "Handoff watch",
      detail: `${summary.peakSession.name} is at ${peakContext}% context`,
    };
  }

  if (
    (selectedRole === "review" || selectedRole === "test") &&
    summary.changedFilesCount > 0 &&
    currentMode !== "review"
  ) {
    return {
      mode: "review",
      tone: "review",
      label: selectedRole === "test" ? "Verify changes" : "Focused review",
      detail: `${selectedName} · ${plural(summary.changedFilesCount, "changed file")}`,
    };
  }

  if (
    (selectedRole === "agent" || selectedRole === "logs") &&
    (summary.liveRunCount > 0 || graphPaneCount > 0) &&
    currentMode !== "observe"
  ) {
    return {
      mode: "observe",
      tone: "observe",
      label: selectedRole === "logs" ? "Inspect logs" : "Track agent",
      detail: `${selectedName} · ${plural(summary.liveRunCount, "live session")}`,
    };
  }

  if (summary.changedFilesCount > 0 && currentMode !== "review") {
    return {
      mode: "review",
      tone: "review",
      label: "Review queue",
      detail: plural(summary.changedFilesCount, "changed file"),
    };
  }

  if (summary.attentionCount > 0 && currentMode !== "observe") {
    return {
      mode: "observe",
      tone: "warn",
      label: "Attention needed",
      detail: plural(summary.attentionCount, "agent"),
    };
  }

  if (summary.liveRunCount >= 2 && currentMode !== "observe") {
    return {
      mode: "observe",
      tone: "observe",
      label: "Parallel run",
      detail: plural(summary.liveRunCount, "live session"),
    };
  }

  if (summary.liveRunCount === 0 && summary.changedFilesCount === 0 && currentMode !== "command") {
    return {
      mode: "command",
      tone: "command",
      label: "Ready for command",
      detail: "Launch agents, workflows, or tools",
    };
  }

  return null;
}
