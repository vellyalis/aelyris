import { FolderTree, Kanban, Bot, Wrench } from "lucide-react";
import { useAppStore, type SidebarSection } from "../../shared/store/appStore";
import { Tooltip } from "../../shared/ui/Tooltip";
import styles from "./Sidebar.module.css";

const NAV_ITEMS: { id: SidebarSection; icon: typeof FolderTree; label: string }[] = [
  { id: "files", icon: FolderTree, label: "Explorer" },
  { id: "tasks", icon: Kanban, label: "Tasks" },
  { id: "agents", icon: Bot, label: "Agents" },
  { id: "tools", icon: Wrench, label: "Tools" },
];

export function Sidebar() {
  const section = useAppStore((s) => s.sidebarSection);
  const setSection = useAppStore((s) => s.setSidebarSection);

  return (
    <div className={styles.rail}>
      <div className={styles.navGroup}>
        {NAV_ITEMS.map(({ id, icon: Icon, label }) => (
          <Tooltip key={id} content={label} side="right" delay={300}>
            <button
              className={`${styles.navBtn} ${section === id ? styles.active : ""}`}
              onClick={() => setSection(id)}
              aria-label={label}
            >
              <Icon size={20} strokeWidth={1.5} />
              {section === id && <div className={styles.indicator} />}
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
