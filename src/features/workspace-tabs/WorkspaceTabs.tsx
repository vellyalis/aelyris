import type { Tab } from "../../shared/hooks/useTabManager";
import type { ShellType } from "../../App";
import styles from "./WorkspaceTabs.module.css";

interface WorkspaceTabsProps {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: (shell: ShellType) => void;
}

export function WorkspaceTabs({ tabs, activeTabId, onSelectTab, onCloseTab, onNewTab }: WorkspaceTabsProps) {
  return (
    <div className={styles.bar}>
      <button className={styles.replyBtn}>◀ reply</button>
      <div className={styles.tabs}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`${styles.tab} ${tab.id === activeTabId ? styles.active : ""}`}
            onClick={() => onSelectTab(tab.id)}
          >
            <span className={styles.tabDot} />
            <span className={styles.tabLabel}>{tab.label}</span>
            {tabs.length > 1 && (
              <span className={styles.tabClose} onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}>×</span>
            )}
          </button>
        ))}
      </div>
      <button className={styles.addBtn} onClick={() => onNewTab("powershell")}>+</button>
    </div>
  );
}
