import { memo } from "react";
import type { TaskStatus } from "../../shared/types/taskStatus";
import styles from "./FleetHud.module.css";
import type { FleetBucket, FleetHudAgent } from "./useFleetHud";

const STATUS_CLASS: Record<FleetBucket, string> = {
  attention: styles.bAttention,
  error: styles.bError,
  running: styles.bRunning,
  review: styles.bReview,
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "pending",
  ready: "ready",
  running: "running",
  blocked: "blocked",
  review: "review",
  done: "done",
  failed: "failed",
};

/** Compact model glyph so the chip stays narrow (sonnet→S, opus→O, …). */
function modelGlyph(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  if (m.includes("codex")) return "codex";
  if (m.includes("gemini")) return "gemini";
  return model;
}

/** `mm:ss` elapsed; clamps negatives (clock skew) to 0. */
function elapsed(now: number, startedAt: number): string {
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  const mm = Math.floor(secs / 60);
  const ss = secs % 60;
  return `${`${mm}`.padStart(2, "0")}:${`${ss}`.padStart(2, "0")}`;
}

interface FleetHudCardProps {
  agent: FleetHudAgent;
  now: number;
}

export const FleetHudCard = memo(function FleetHudCard({ agent, now }: FleetHudCardProps) {
  const cls = STATUS_CLASS[agent.bucket];
  const title = [agent.title, agent.model, STATUS_LABEL[agent.status], agent.attentionReason]
    .filter(Boolean)
    .join(" · ");
  return (
    <article
      className={`${styles.card} ${cls}`}
      data-testid="fleet-hud-card"
      data-agent-id={agent.taskId}
      data-bucket={agent.bucket}
      title={title}
      aria-label={title}
    >
      <span className={`${styles.rail} ${cls}`} aria-hidden />
      <span className={styles.cardBody}>
        <span className={styles.line}>
          <span className={`${styles.dot} ${cls}`} aria-hidden />
          <span className={styles.cardTitle}>{agent.title}</span>
          <span className={styles.model}>{modelGlyph(agent.model)}</span>
        </span>
        <span className={styles.meta}>
          <span className={`${styles.status} ${cls}`}>{STATUS_LABEL[agent.status]}</span>
          <span className={styles.elapsed}>{elapsed(now, agent.startedAt)}</span>
        </span>
      </span>
    </article>
  );
});
