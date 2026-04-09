import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
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

export function WelcomeScreen({ onOpenProject }: WelcomeScreenProps) {
  const [recentProjects, setRecentProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<ProjectInfo[]>("discover_projects", { scanDirs: SCAN_DIRS })
      .then((projects) => { setRecentProjects(projects); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleOpenFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: "Open Project Folder" });
      if (selected) {
        onOpenProject(typeof selected === "string" ? selected : selected[0]);
      }
    } catch { /* cancelled */ }
  };

  return (
    <div className={styles.container}>
      <div className={styles.center}>
        <div className={styles.logo}>
          <div className={styles.logoIcon}>AE</div>
          <h1 className={styles.title}>Aether Terminal</h1>
        </div>
        <p className={styles.subtitle}>AI Workspace for Windows</p>

        <button className={styles.openBtn} onClick={handleOpenFolder}>
          Open Folder
        </button>

        <div className={styles.recentHeader}>Recent Projects</div>
        <div className={styles.recentList}>
          {loading && <div className={styles.hint}>Scanning projects...</div>}
          {recentProjects.map((p) => (
            <button
              key={p.path}
              className={styles.projectCard}
              onClick={() => onOpenProject(p.path)}
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
            </button>
          ))}
          {!loading && recentProjects.length === 0 && (
            <div className={styles.hint}>No projects found. Open a folder to get started.</div>
          )}
        </div>
      </div>
    </div>
  );
}
