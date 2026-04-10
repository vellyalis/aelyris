import * as Tabs from "@radix-ui/react-tabs";
import type { Tab } from "../../shared/hooks/useTabManager";
import type { ShellType } from "../../App";
import { PixelAvatar } from "../../shared/ui/PixelAvatar";
import styles from "./WorkspaceTabs.module.css";

interface WorkspaceTabsProps {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: (shell: ShellType) => void;
  branch?: string;
  changedCount?: number;
}

export function WorkspaceTabs({ tabs, activeTabId, onSelectTab, onCloseTab, onNewTab, branch, changedCount }: WorkspaceTabsProps) {
  return (
    <div className={styles.wrapper}>
      {/* Tab row */}
      <div className={styles.tabRow}>
        <Tabs.Root value={activeTabId} onValueChange={onSelectTab}>
          <Tabs.List className={styles.tabs} aria-label="Terminal tabs">
            {tabs.map((tab) => (
              <Tabs.Trigger key={tab.id} value={tab.id} className={styles.tab} asChild>
                <button>
                  <PixelAvatar seed={tab.label} size={14} />
                  <span className={styles.tabLabel}>{tab.label}</span>
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

      {/* Status row */}
      <div className={styles.statusRow}>
        <div className={styles.statusLeft}>
          {branch && <span className={styles.branchInfo}>⚡ {branch}</span>}
          {changedCount !== undefined && changedCount > 0 && (
            <span className={styles.changes}>{changedCount} changed</span>
          )}
        </div>
        <div className={styles.statusRight}>
          <span className={styles.encoding}>UTF-8</span>
          <span className={styles.separator}>·</span>
          <span className={styles.encoding}>LF</span>
        </div>
      </div>
    </div>
  );
}
