import { memo } from "react";
import { ChevronRight, Shield } from "lucide-react";
import { StatusIcon } from "../../shared/ui/StatusIcon";
import { EmptyState } from "../../shared/ui/EmptyState";
import type { AgentStatus } from "../../shared/types/agent";
import styles from "./SubagentTree.module.css";

interface AgentNode {
  id: string;
  name: string;
  status: AgentStatus;
  model: string;
  permissionMode: "full" | "edit" | "readonly" | "restricted";
}

interface SubagentTreeProps {
  agents: AgentNode[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

const PERM_COLORS: Record<string, string> = {
  full: "var(--ctp-green)",
  edit: "var(--ctp-yellow)",
  readonly: "var(--ctp-blue)",
  restricted: "var(--ctp-red)",
};

export const SubagentTree = memo(function SubagentTree({ agents, activeId, onSelect }: SubagentTreeProps) {
  if (agents.length === 0) {
    return (
      <EmptyState preset="agents" title="No active agents" description="Start an agent to see its subagents" />
    );
  }

  return (
    <div className={styles.tree}>
      {agents.map((agent, i) => (
        <div
          key={agent.id}
          className={`${styles.node} ${agent.id === activeId ? styles.nodeActive : ""}`}
          onClick={() => onSelect(agent.id)}
        >
          <div className={styles.connector}>
            {i > 0 && <div className={styles.line} />}
            <ChevronRight size={10} className={styles.arrow} />
          </div>
          <StatusIcon status={agent.status} size={12} />
          <span className={styles.name}>{agent.name}</span>
          <span className={styles.model}>{agent.model.split("-").pop()}</span>
          <Shield size={10} color={PERM_COLORS[agent.permissionMode]} />
        </div>
      ))}
    </div>
  );
});
