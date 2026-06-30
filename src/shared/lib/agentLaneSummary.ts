export interface AgentLaneCounts {
  /** Sessions blocked on a human/operator decision (waiting_approval/blocked) or errored. */
  attentionCount: number;
  /** Sessions that are not idle and not done (includes the attention subset). */
  liveCount: number;
  /** All sessions on the rail, regardless of status. */
  totalCount: number;
}

/**
 * Single source for the right-rail "Agents" lane headline.
 *
 * Priority: attention &gt; live &gt; parked &gt; empty. A session waiting on a human
 * decision (or errored) must not hide inside the generic "N live" count — the
 * operator needs to see it first. The attention predicate matches
 * {@link import("./workstationSummary").buildWorkstationSummary}'s `attentionCount`
 * so the rail headline and the workstation pulse agree.
 */
export function summarizeAgentLane({ attentionCount, liveCount, totalCount }: AgentLaneCounts): string {
  if (attentionCount > 0) {
    return `${attentionCount} need${attentionCount === 1 ? "s" : ""} attention`;
  }
  if (liveCount > 0) return `${liveCount} live`;
  if (totalCount > 0) return `${totalCount} parked`;
  return "No agents";
}
