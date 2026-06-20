import { useEffect, useMemo, useState } from "react";
import { useEventBus } from "../../shared/hooks/useEventBus";
import { useTaskGraph } from "../../shared/hooks/useTaskGraph";
import { deriveFleetAgents } from "./fleetAgents";
import { FleetGrid } from "./FleetGrid";
import styles from "./FleetOverlay.module.css";

/**
 * Center "fleet takeover": while the autonomy loop is running agents, the main
 * terminal area fills with a tiled grid of their live terminals (1 pane = 1
 * agent), so the operator watches the work happen instead of staring at a static
 * shell. Auto-reveals on the first live agent and auto-hides when the loop goes
 * idle. Self-contained (subscribes to the event bus + task graph) so App only
 * mounts it once, inside the center panel.
 */
export function FleetOverlay() {
  const { events } = useEventBus();
  const { tasks } = useTaskGraph();
  const agents = useMemo(() => deriveFleetAgents(events, tasks), [events, tasks]);
  const [dismissed, setDismissed] = useState(false);

  // Once the fleet goes idle, clear a manual dismissal so the next run reveals.
  useEffect(() => {
    if (agents.length === 0 && dismissed) setDismissed(false);
  }, [agents.length, dismissed]);

  if (agents.length === 0 || dismissed) return null;

  return (
    <div className={styles.overlay} role="region" aria-label="Autonomy fleet">
      <div className={styles.bar}>
        <span className={styles.title}>
          Fleet
          <span className={styles.count}>
            {agents.length} agent{agents.length === 1 ? "" : "s"} working
          </span>
        </span>
        <button type="button" className={styles.hide} onClick={() => setDismissed(true)} title="Hide the fleet view">
          Hide
        </button>
      </div>
      <div className={styles.body}>
        <FleetGrid agents={agents} />
      </div>
    </div>
  );
}
