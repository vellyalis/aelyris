/**
 * Format a past timestamp (epoch ms) as a short relative age:
 * "now" / "5m ago" / "3h ago" / "2d ago".
 *
 * Shared by the agent-inspector session cards (SessionCard / InteractiveSessionCard).
 * Note: DecisionInboxPanel and ToolLedgerPanel intentionally use different
 * formats (no "ago" suffix / seconds granularity) and keep their own formatters.
 */
export function formatRelativeAge(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
