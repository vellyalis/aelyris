import { useState, useCallback } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import type { Tab } from "../../shared/hooks/useTabManager";
import type { InteractiveSession } from "../../shared/types/interactiveAgent";
import { getCliLabel, getCliColor } from "../../shared/types/interactiveAgent";
import type { ShellType } from "../../App";
import { PixelAvatar } from "../../shared/ui/PixelAvatar";
import styles from "./WorkspaceTabs.module.css";

interface WorkspaceTabsProps {
  tabs: Tab[];
  activeTabId: string;
  activityTabs?: Set<string>;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: (shell: ShellType) => void;
  onReorderTab?: (fromId: string, toId: string) => void;
  interactiveSessions?: InteractiveSession[];
  activeInteractiveId?: string | null;
  onSelectInteractive?: (id: string) => void;
  onCloseInteractive?: (id: string) => void;
}

export function WorkspaceTabs({
  tabs, activeTabId, activityTabs, onSelectTab, onCloseTab, onNewTab, onReorderTab,
  interactiveSessions = [], activeInteractiveId, onSelectInteractive, onCloseInteractive,
}: WorkspaceTabsProps) {
  const effectiveActiveId = activeInteractiveId ? `agent-${activeInteractiveId}` : activeTabId;
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleValueChange = (value: string) => {
    if (value.startsWith("agent-")) {
      onSelectInteractive?.(value.replace("agent-", ""));
    } else {
      onSelectTab(value);
    }
  };

  const handleDragStart = useCallback((e: React.DragEvent, tabId: string) => {
    e.dataTransfer.setData("text/plain", tabId);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, tabId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(tabId);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, toId: string) => {
    e.preventDefault();
    const fromId = e.dataTransfer.getData("text/plain");
    if (fromId && fromId !== toId) {
      onReorderTab?.(fromId, toId);
    }
    setDragOverId(null);
  }, [onReorderTab]);

  const handleDragEnd = useCallback(() => {
    setDragOverId(null);
  }, []);

  return (
    <div className={styles.bar}>
      <Tabs.Root value={effectiveActiveId} onValueChange={handleValueChange}>
        <Tabs.List className={styles.tabs} aria-label="Terminal tabs">
          {tabs.map((tab) => (
            <Tabs.Trigger key={tab.id} value={tab.id} className={styles.tab} asChild>
              <button
                draggable
                onDragStart={(e) => handleDragStart(e, tab.id)}
                onDragOver={(e) => handleDragOver(e, tab.id)}
                onDrop={(e) => handleDrop(e, tab.id)}
                onDragEnd={handleDragEnd}
                data-drag-over={dragOverId === tab.id || undefined}
              >
                <PixelAvatar seed={tab.label} size={12} />
                {activityTabs?.has(tab.id) && <span className={styles.activityDot} />}
                <span className={styles.tabLabel}>{tab.label}</span>
                {tab.worktreeBranch && <span className={styles.branchBadge}>⚡{tab.worktreeBranch}</span>}
                {tabs.length > 1 && (
                  <span
                    className={styles.tabClose}
                    role="button"
                    aria-label={`Close ${tab.label}`}
                    onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                  >×</span>
                )}
              </button>
            </Tabs.Trigger>
          ))}
          {interactiveSessions.map((session) => (
            <Tabs.Trigger key={`agent-${session.id}`} value={`agent-${session.id}`} className={styles.tab} asChild>
              <button>
                <span className={styles.agentDot} style={{ background: getCliColor(session.cli) }} />
                <span className={styles.tabLabel}>{getCliLabel(session.cli)}</span>
                {session.worktree_branch && <span className={styles.branchBadge}>⚡{session.worktree_branch}</span>}
                <span
                  className={styles.tabClose}
                  role="button"
                  aria-label={`Close ${getCliLabel(session.cli)} session`}
                  onClick={(e) => { e.stopPropagation(); onCloseInteractive?.(session.id); }}
                >×</span>
              </button>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>
      <button className={styles.addBtn} onClick={() => onNewTab("powershell")} aria-label="New terminal tab">+</button>
    </div>
  );
}
