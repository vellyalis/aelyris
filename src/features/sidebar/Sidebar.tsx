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
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchInfo[]>([]);

  useEffect(() => {
    if (!visible) return;
    loadProjects();
  }, [visible]);

  async function loadProjects() {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<ProjectInfo[]>("discover_projects", {
        scanDirs: SCAN_DIRS,
      });
      setProjects(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
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
    } catch {
      setBranches([]);
    }
  }

  if (!visible) return null;

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.title}>Projects</span>
        <button className={styles.refreshBtn} onClick={loadProjects} title="Refresh">
          ↻
        </button>
      </div>
      <div className={styles.list}>
        {loading && <div className={styles.status}>Scanning...</div>}
        {error && <div className={styles.error}>{error}</div>}
        {projects.map((p) => (
          <div key={p.path}>
            <div className={styles.projectRow}>
              <button
                className={styles.expandBtn}
                onClick={() => toggleExpand(p.path)}
              >
                {expandedProject === p.path ? "▾" : "▸"}
              </button>
              <button
                className={styles.project}
                onClick={() => onProjectSelect(p.path)}
              >
                <div className={styles.projectName}>
                  {p.has_changes && <span className={styles.dot} />}
                  {p.name}
                </div>
                <div className={styles.projectBranch}>{p.branch}</div>
              </button>
            </div>
            {expandedProject === p.path && branches.length > 0 && (
              <div className={styles.branchList}>
                {branches.map((b) => (
                  <div
                    key={b.name}
                    className={`${styles.branchItem} ${b.is_head ? styles.branchActive : ""}`}
                  >
                    <span className={styles.branchIcon}>{b.is_head ? "●" : "○"}</span>
                    <span>{b.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {!loading && projects.length === 0 && !error && (
          <div className={styles.status}>No projects found</div>
        )}
      </div>
    </div>
  );
}
