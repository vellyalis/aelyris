import * as Tabs from "@radix-ui/react-tabs";
import type { Tab } from "../../shared/hooks/useTabManager";
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
}

export function WorkspaceTabs({ tabs, activeTabId, activityTabs, onSelectTab, onCloseTab, onNewTab }: WorkspaceTabsProps) {
  return (
    <div className={styles.bar}>
      <Tabs.Root value={activeTabId} onValueChange={onSelectTab}>
        <Tabs.List className={styles.tabs} aria-label="Terminal tabs">
          {tabs.map((tab) => (
            <Tabs.Trigger key={tab.id} value={tab.id} className={styles.tab} asChild>
              <button>
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
        </Tabs.List>
      </Tabs.Root>
      <button className={styles.addBtn} onClick={() => onNewTab("powershell")} aria-label="New terminal tab">+</button>
    </div>
  );
}
