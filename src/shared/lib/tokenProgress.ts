/**
 * Token-usage progress percent for a session's progress bar.
 *
 * - done  → 100
 * - idle  → 0
 * - running with usage → min(99, round(used / max * 100))
 * - running with no usage yet → a small 2% floor so the bar is visible
 *
 * Shared by SessionCard, InteractiveSessionCard, and the AgentInspector parallel
 * view so the cap stays consistent (it was 95 in one place and 99 in the others
 * — a copy-paste drift now unified to 99).
 */
export function computeTokenProgress(status: string, tokensUsed: number, maxTokens: number): number {
  if (status === "done") return 100;
  if (status === "idle") return 0;
  if (tokensUsed > 0) return Math.min(99, Math.round((tokensUsed / maxTokens) * 100));
  return 2;
}
