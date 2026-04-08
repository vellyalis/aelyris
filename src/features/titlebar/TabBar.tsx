import type { Tab } from "../../shared/hooks/useTabManager";
import type { ShellType } from "../../App";
import styles from "./TabBar.module.css";

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: (shell: ShellType) => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onNewTab }: TabBarProps) {
  return (
    <div className={styles.tabBar}>
      <div className={styles.tabs}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`${styles.tab} ${tab.id === activeTabId ? styles.active : ""}`}
            onClick={() => onSelectTab(tab.id)}
          >
            <span className={styles.tabLabel}>{tab.label}</span>
            {tabs.length > 1 && (
              <span
                className={styles.tabClose}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                ×
              </span>
            )}
          </button>
        ))}
      </div>
      <button
        className={styles.newTab}
        onClick={() => onNewTab("powershell")}
        aria-label="New tab"
      >
        +
      </button>
    </div>
  );
}
