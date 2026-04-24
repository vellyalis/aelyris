import { Shield } from "lucide-react";
import { memo } from "react";
import type { AgentStatus } from "../../shared/types/agent";
import { EmptyState } from "../../shared/ui/EmptyState";
import { StatusIcon } from "../../shared/ui/StatusIcon";
import styles from "./SubagentList.module.css";

interface AgentNode {
  id: string;
  name: string;
  status: AgentStatus;
  model: string;
  permissionMode: "full" | "edit" | "readonly" | "restricted";
}

interface SubagentListProps {
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

export const SubagentList = memo(function SubagentList({ agents, activeId, onSelect }: SubagentListProps) {
  if (agents.length === 0) {
    return <EmptyState preset="agents" title="No active agents" description="Start an agent to see its subagents" />;
  }

  return (
    <ul className={styles.list} role="listbox" aria-label="Subagents">
      {agents.map((agent) => {
        const active = agent.id === activeId;
        return (
          <li
            key={agent.id}
            className={`${styles.row} ${active ? styles.rowActive : ""}`}
            role="option"
            aria-selected={active}
            tabIndex={0}
            onClick={() => onSelect(agent.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(agent.id);
              }
            }}
          >
            <StatusIcon status={agent.status} size={12} />
            <span className={styles.name}>{agent.name}</span>
            <span className={styles.model}>{agent.model.split("-").pop()}</span>
            <Shield
              size={10}
              color={PERM_COLORS[agent.permissionMode]}
              aria-label={`Permission: ${agent.permissionMode}`}
            />
          </li>
        );
      })}
    </ul>
  );
});
