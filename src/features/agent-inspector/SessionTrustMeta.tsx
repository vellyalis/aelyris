import type { AgentSession } from "../../shared/types/agent";
import styles from "./AgentInspector.module.css";

export function SessionTrustMeta({ session }: { session: AgentSession }) {
  const ownership = [
    session.owner?.trim(),
    session.workspaceScope?.trim(),
    session.writeSet?.length ? `${session.writeSet.length} files write-set` : undefined,
  ].filter((value): value is string => Boolean(value));
  const blockedReason = session.blockedReason?.trim();
  const nextActor = session.nextActor?.trim();

  if (ownership.length === 0 && !blockedReason) return null;

  return (
    <div className={styles.trustMeta} data-testid="session-trust-meta">
      {ownership.length > 0 && (
        <div className={styles.ownershipLine} title={session.writeSet?.join("\n")}>
          <span className={styles.trustMetaLabel}>Owner</span>
          <span>{ownership.join(" · ")}</span>
        </div>
      )}
      {blockedReason && (
        <div className={styles.blockerLine} role="status">
          <span className={styles.trustMetaLabel}>Blocked</span>
          <span>
            {blockedReason}
            {nextActor ? ` → ${nextActor}` : ""}
          </span>
        </div>
      )}
    </div>
  );
}
