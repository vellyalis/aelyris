import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { useTaskGraph } from "../../shared/hooks/useTaskGraph";
import { FleetHudCard } from "./FleetHudCard";
import styles from "./FleetHud.module.css";
import { useFleetHud } from "./useFleetHud";

/**
 * Fleet HUD (visible-fleet constellation) — an always-on, floating overview of
 * every agent the autonomy loop currently has in flight, as a swarm of live
 * cards. It is the ambient "who is alive, how far, do any need me" glance layer
 * that stays legible even as the terminal panes split, churn, and close. It self
 * gates: with no active agents it renders nothing. Distinct from OrchestratorPanel
 * (task graph / scheduler), ReliabilityPanel (incidents) and AgentInspector
 * (deep dive) — this is the only persistent, glanceable fleet surface.
 */
export function FleetHud() {
  const { tasks } = useTaskGraph();
  const { agents, summary, hasAgents } = useFleetHud(tasks);
  const reduceMotion = useReducedMotion();
  // One shared 1 Hz tick drives every card's elapsed timer (not one timer each).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasAgents) return;
    setNow(Date.now()); // snap to now so a freshly-shown card never flashes a stale elapsed
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasAgents]);

  if (!hasAgents) return null;

  return (
    <aside className={styles.hud} data-testid="fleet-hud" aria-label="Agent fleet">
      <header className={styles.head}>
        <span className={styles.mark} aria-hidden>
          ✦
        </span>
        <span className={styles.title}>Fleet</span>
        <span className={styles.count}>{summary.total}</span>
        <span className={styles.stats}>
          {summary.running > 0 && <em className={styles.running}>{summary.running} running</em>}
          {summary.review > 0 && <em className={styles.review}>{summary.review} review</em>}
          {summary.attention > 0 && <em className={styles.attention}>{summary.attention} attn</em>}
        </span>
      </header>

      <ul className={styles.grid} data-count={summary.total}>
        <AnimatePresence initial={!reduceMotion}>
          {agents.map((agent) => (
            <motion.li
              key={agent.taskId}
              layout={!reduceMotion}
              initial={reduceMotion ? false : { opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.7, transition: { duration: 0.18 } }}
              transition={{ type: "spring", stiffness: 520, damping: 30 }}
              className={styles.cardWrap}
            >
              <FleetHudCard agent={agent} now={now} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </aside>
  );
}
