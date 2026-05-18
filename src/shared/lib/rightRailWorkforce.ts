import type { AgentSession } from "../types/agent";
import type { WorkstationGraph } from "./workstationGraph";
import { buildWorkstationSummary } from "./workstationSummary";

export type WorkforceGuardrailProfile = "Release" | "Builder" | "Research" | "Conservative";
export type WorkforceTone = "ready" | "running" | "blocked" | "review";

export const WORKFORCE_GUARDRAIL_PROFILES: readonly WorkforceGuardrailProfile[] = [
  "Conservative",
  "Release",
  "Builder",
  "Research",
];

export interface RightRailWorkforceAgent {
  id: string;
  name: string;
  role: string;
  status: AgentSession["status"];
  model: string;
  contextPct: number;
  filesChanged: number;
  next: string;
}

export interface RightRailWorkforceSummary {
  tone: WorkforceTone;
  headline: string;
  detail: string;
  guardrailProfile: WorkforceGuardrailProfile;
  guardrailDetail: string;
  liveCount: number;
  blockedCount: number;
  reviewCount: number;
  handoffCount: number;
  topAgents: RightRailWorkforceAgent[];
}

interface RightRailWorkforceInput {
  sessions: readonly AgentSession[];
  interactiveSessionCount: number;
  changedFilesCount: number;
  pendingDecisionCount: number;
  workstationGraph?: WorkstationGraph;
}

function contextPct(session: AgentSession): number {
  const max = session.model.toLowerCase().includes("gpt-5") ? 400_000 : 200_000;
  if (session.tokensUsed <= 0) return 0;
  return Math.min(100, Math.round((session.tokensUsed / max) * 100));
}

function changedFileCount(session: AgentSession): number {
  return session.changedFileDetails?.length ?? session.filesChanged ?? 0;
}

function roleLabel(session: AgentSession): string {
  return session.role ?? session.owner ?? session.permissionMode ?? "agent";
}

function nextStep(session: AgentSession): string {
  if (session.blockedReason) return session.blockedReason;
  if (session.status === "waiting") return session.nextActor ? `Waiting for ${session.nextActor}` : "Needs decision";
  if (session.status === "error") return "Inspect failure";
  if (session.finalReport?.status === "ready" || session.closeState === "collectable") return "Collect report";
  if (changedFileCount(session) > 0) return "Review changes";
  if (session.status === "done") return "Complete";
  return "Keep watching";
}

function deriveProfile(input: {
  pendingDecisionCount: number;
  riskCount: number;
  reviewCount: number;
  liveCount: number;
}): { profile: WorkforceGuardrailProfile; detail: string } {
  if (input.pendingDecisionCount > 0 || input.riskCount > 0) {
    return {
      profile: "Conservative",
      detail: "Human gates or risks are active; direct writes should stay guarded.",
    };
  }
  if (input.reviewCount > 0) {
    return {
      profile: "Release",
      detail: "Changed files need evidence, diff review, and rollback confidence.",
    };
  }
  if (input.liveCount > 0) {
    return {
      profile: "Builder",
      detail: "Local edits and focused tests are allowed; destructive actions remain gated.",
    };
  }
  return {
    profile: "Research",
    detail: "No active run; exploration and planning are the safest next moves.",
  };
}

export function deriveRightRailWorkforceSummary({
  sessions,
  interactiveSessionCount,
  changedFilesCount,
  pendingDecisionCount,
  workstationGraph,
}: RightRailWorkforceInput): RightRailWorkforceSummary {
  const graphChangedFilesCount = workstationGraph?.nodeCountByKind.file ?? 0;
  const reviewCount = Math.max(changedFilesCount, graphChangedFilesCount);
  const riskCount = (workstationGraph?.nodeCountByKind.risk ?? 0) + (workstationGraph?.nodeCountByKind.blocker ?? 0);
  const contextPackCount = workstationGraph?.nodeCountByKind.context_pack ?? 0;
  const summary = buildWorkstationSummary({
    sessions,
    changedFilesCount: reviewCount,
    interactiveSessionCount,
  });
  const blockedCount = summary.attentionCount + pendingDecisionCount + riskCount;
  const handoffCount = sessions.filter((session) => session.handoffFrom).length + contextPackCount;
  const tone: WorkforceTone =
    blockedCount > 0 ? "blocked" : reviewCount > 0 ? "review" : summary.liveRunCount > 0 ? "running" : "ready";
  const { profile, detail: guardrailDetail } = deriveProfile({
    pendingDecisionCount,
    riskCount,
    reviewCount,
    liveCount: summary.liveRunCount,
  });
  const headline =
    tone === "blocked"
      ? "Needs command decision"
      : tone === "review"
        ? "Review pressure active"
        : tone === "running"
          ? "Workforce running"
          : "Ready to launch";
  const detail = `${summary.liveRunCount} live · ${blockedCount} blocked · ${reviewCount} files`;

  return {
    tone,
    headline,
    detail,
    guardrailProfile: profile,
    guardrailDetail,
    liveCount: summary.liveRunCount,
    blockedCount,
    reviewCount,
    handoffCount,
    topAgents: summary.rankedSessions.slice(0, 3).map((session) => ({
      id: session.id,
      name: session.name,
      role: roleLabel(session),
      status: session.status,
      model: session.model,
      contextPct: contextPct(session),
      filesChanged: changedFileCount(session),
      next: nextStep(session),
    })),
  };
}
