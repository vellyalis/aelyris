import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import styles from "./Sidebar.module.css";

interface ProjectInfo {
  name: string;
  path: string;
  branch: string;
  has_changes: boolean;
}

interface BranchInfo {
  name: string;
  is_head: boolean;
  is_remote: boolean;
}

type NavSection = "sessions" | "notes" | "files" | "tools";

interface SidebarProps {
  visible: boolean;
  onProjectSelect: (path: string) => void;
}

const SCAN_DIRS = [
  "H:/claude",
  "C:/Users/owner/Documents",
  "C:/Users/owner/Aether_Terminal",
];

export function Sidebar({ visible, onProjectSelect }: SidebarProps) {
  const [activeNav, setActiveNav] = useState<NavSection>("sessions");
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchInfo[]>([]);

  useEffect(() => {
    if (visible) loadProjects();
  }, [visible]);

  async function loadProjects() {
    setLoading(true);
    try {
      const result = await invoke<ProjectInfo[]>("discover_projects", { scanDirs: SCAN_DIRS });
      setProjects(result);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function toggleExpand(path: string) {
    if (expandedProject === path) {
      setExpandedProject(null);
      setBranches([]);
      return;
    }
    setExpandedProject(path);
    try {
      const result = await invoke<BranchInfo[]>("list_branches", { repoPath: path });
      setBranches(result.filter((b) => !b.is_remote));
    } catch { setBranches([]); }
  }

  if (!visible) return null;

  return (
    <div className={styles.sidebar}>
      {/* Logo area */}
      <div className={styles.logo}>
        <span className={styles.logoText}>aether</span>
      </div>

      {/* Navigation */}
      <nav className={styles.nav}>
        {([
          ["sessions", "Sessions"],
          ["notes", "Notes"],
          ["files", "Files"],
          ["tools", "Tools"],
        ] as [NavSection, string][]).map(([id, label]) => (
          <button
            key={id}
            className={`${styles.navItem} ${activeNav === id ? styles.navActive : ""}`}
            onClick={() => setActiveNav(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className={styles.divider} />

      {/* Worktree / Projects section */}
      <div className={styles.sectionHeader}>
        <span>Worktrees</span>
        <button className={styles.iconBtn} onClick={loadProjects} title="Refresh">↻</button>
      </div>

      <div className={styles.list}>
        {loading && <div className={styles.status}>Scanning...</div>}
        {projects.map((p) => (
          <div key={p.path}>
            <div className={styles.projectRow}>
              <button className={styles.expandBtn} onClick={() => toggleExpand(p.path)}>
                {expandedProject === p.path ? "▾" : "▸"}
              </button>
              <button className={styles.project} onClick={() => onProjectSelect(p.path)}>
                <span className={styles.projectName}>
                  {p.has_changes && <span className={styles.dot} />}
                  {p.name}
                </span>
                <span className={styles.branchBadge}>{p.branch}</span>
              </button>
            </div>
            {expandedProject === p.path && branches.length > 0 && (
              <div className={styles.branchList}>
                {branches.map((b) => (
                  <div key={b.name} className={`${styles.branchItem} ${b.is_head ? styles.branchActive : ""}`}>
                    <span className={styles.branchDot} style={{ background: b.is_head ? "#a6e3a1" : "rgba(255,255,255,0.2)" }} />
                    <span>{b.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
