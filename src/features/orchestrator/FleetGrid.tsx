import { cliFromModel } from "../../shared/types/interactiveAgent";
import { AgentTerminal } from "../agent-terminal/AgentTerminal";
import type { FleetAgent } from "./fleetAgents";
import styles from "./FleetGrid.module.css";

interface FleetGridProps {
  /** Live loop-dispatched agents (derived from agent_spawned + the task graph). */
  agents: FleetAgent[];
}

/**
 * The cockpit fleet grid: one live PTY pane per loop-dispatched agent
 * (1 pane = 1 agent). Each tile reuses {@link AgentTerminal} to render the
 * agent's terminal — the same grid path interactive agents use — so the
 * operator watches every agent working in parallel. Renders nothing when the
 * loop has no agents in flight.
 */
export function FleetGrid({ agents }: FleetGridProps) {
  if (agents.length === 0) return null;

  return (
    <div className={styles.fleet}>
      <div className={styles.heading}>
        Fleet <span className={styles.count}>{agents.length} live</span>
      </div>
      <div className={styles.grid}>
        {agents.map((agent) => (
          <div key={agent.taskId} className={styles.tile}>
            <div className={styles.tileHeader} title={agent.title}>
              {agent.title}
            </div>
            <div className={styles.tileBody}>
              <AgentTerminal
                ptyId={agent.terminalId}
                cli={cliFromModel(agent.model)}
                status="thinking"
                model={agent.model}
                cost={0}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
