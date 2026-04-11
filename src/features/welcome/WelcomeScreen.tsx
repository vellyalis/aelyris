import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "motion/react";
import styles from "./WelcomeScreen.module.css";

interface ProjectInfo {
  name: string;
  path: string;
  branch: string;
  has_changes: boolean;
}

interface WelcomeScreenProps {
  onOpenProject: (path: string) => void;
}

const SCAN_DIRS = [
  "H:/claude",
  "C:/Users/owner/Documents",
  "C:/Users/owner",
];

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function WelcomeScreen({ onOpenProject }: WelcomeScreenProps) {
  const [recentProjects, setRecentProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState<string | null>(null);

  useEffect(() => {
    invoke<ProjectInfo[]>("discover_projects", { scanDirs: SCAN_DIRS })
      .then((projects) => { setRecentProjects(projects); setLoading(false); })
      .catch(() => setLoading(false));

    // Try to get git user name for personalization
    invoke<string>("get_git_user_name")
      .then((name) => { if (name) setUserName(name); })
      .catch(() => { /* not available yet */ });
  }, []);

  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const items = e.dataTransfer.items;
    if (items.length > 0) {
      const entry = items[0].webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        onOpenProject(entry.fullPath || entry.name);
      }
    }
    // Also try files
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const path = (files[0] as unknown as { path?: string }).path;
      if (path) onOpenProject(path.replace(/\\/g, "/"));
    }
  }, [onOpenProject]);

  const handleOpenFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Open Project Folder" });
      if (selected) {
        onOpenProject(typeof selected === "string" ? selected : selected[0]);
      }
    } catch { /* cancelled or not in Tauri */ }
  };

  return (
    <div
      className={`${styles.container} ${dragOver ? styles.dragOver : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <motion.div
        className={styles.center}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 25 }}
      >
        <motion.div
          className={styles.logo}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.05 }}
        >
          <div className={styles.logoIcon}>AE</div>
          <h1 className={styles.title}>Aether Terminal</h1>
        </motion.div>
        {userName && (
          <motion.p
            className={styles.greeting}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
          >
            {getGreeting()}, {userName}.
          </motion.p>
        )}
        <p className={styles.subtitle}>AI Workspace for Windows</p>

        <button className={styles.openBtn} onClick={handleOpenFolder}>
          Open Folder
        </button>
        <p className={styles.dropHint}>or drop a folder here</p>

        <div className={styles.recentHeader}>Recent Projects</div>
        <div className={styles.recentList}>
          {loading && Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={styles.skeletonCard}>
              <div className={styles.skeletonAvatar} />
              <div className={styles.skeletonText}>
                <div className={styles.skeletonLine} style={{ width: `${60 + i * 10}%` }} />
                <div className={styles.skeletonLine} style={{ width: `${40 + i * 8}%` }} />
              </div>
            </div>
          ))}
          {recentProjects.map((p, i) => (
            <motion.button
              key={p.path}
              className={styles.projectCard}
              onClick={() => onOpenProject(p.path)}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + i * 0.04, type: "spring", stiffness: 300, damping: 25 }}
            >
              <div className={styles.projectAvatar}>
                {p.name.slice(0, 2).toUpperCase()}
              </div>
              <div className={styles.projectInfo}>
                <div className={styles.projectName}>{p.name}</div>
                <div className={styles.projectPath}>
                  {p.path} · <span className={styles.branch}>⚡{p.branch}</span>
                </div>
              </div>
            </motion.button>
          ))}
          {!loading && recentProjects.length === 0 && (
            <div className={styles.hint}>No projects found. Open a folder to get started.</div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
