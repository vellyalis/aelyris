import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, GitBranch, Settings as SettingsIcon, Upload } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import logoPng from "../../assets/logo.png";
import styles from "./WelcomeScreen.module.css";

interface ProjectInfo {
  name: string;
  path: string;
  branch: string;
  has_changes: boolean;
}

interface WelcomeScreenProps {
  onOpenProject: (path: string) => void;
  /**
   * Open the global Settings dialog. Surfaced on the welcome screen
   * so theme / shell / font choices can be made before opening a
   * project — previously Settings was only reachable from the
   * project header bar, which left first-run users with no way to
   * pick a theme without first opening a folder.
   */
  onOpenSettings?: () => void;
}

// Frontend fallback if the Rust `default_project_scan_dirs` command fails
// for some reason (should never happen on Windows). These are intentionally
// generic; the previous revision shipped developer-machine paths
// (`H:/claude`, `C:/Users/example/…`) that leaked into every build.
const FALLBACK_SCAN_DIRS = ["."];
const SKELETON_KEYS = ["recent-skeleton-1", "recent-skeleton-2", "recent-skeleton-3", "recent-skeleton-4"];

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function WelcomeScreen({ onOpenProject, onOpenSettings }: WelcomeScreenProps) {
  const [recentProjects, setRecentProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Resolve platform-specific scan dirs from Rust (~/Documents,
      // ~/Desktop, ~) so the frontend ships no developer-machine paths.
      let scanDirs = FALLBACK_SCAN_DIRS;
      try {
        const dirs = await invoke<string[]>("default_project_scan_dirs");
        if (dirs.length > 0) scanDirs = dirs;
      } catch {
        /* fall through to fallback */
      }
      if (cancelled) return;
      try {
        const projects = await invoke<ProjectInfo[]>("discover_projects", { scanDirs });
        if (!cancelled) setRecentProjects(projects);
      } catch {
        /* ignore */
      }
      if (!cancelled) setLoading(false);
    })();

    // Try to get git user name for personalization
    invoke<string>("get_git_user_name")
      .then((name) => {
        if (!cancelled && name) setUserName(name);
      })
      .catch(() => {
        /* not available yet */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      // Only the Tauri-injected `path` on the dropped File object yields the
      // real OS path. The previous webkitGetAsEntry branch fired *first* with
      // a sandboxed virtual path (e.g. "/MyFolder") that onOpenProject can't
      // resolve, then this branch fired again with the real path — the
      // double-fire briefly opened a bogus project before settling.
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const path = (file as unknown as { path?: string }).path;
      if (path) onOpenProject(path.replace(/\\/g, "/"));
    },
    [onOpenProject],
  );

  const handleOpenFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Open Project Folder" });
      if (selected) {
        onOpenProject(typeof selected === "string" ? selected : selected[0]);
      }
    } catch {
      /* cancelled or not in Tauri */
    }
  };

  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: The welcome surface accepts OS folder drops; the explicit Open Folder button is the keyboard path. */
    <div
      className={`${styles.container} ${dragOver ? styles.dragOver : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <motion.div
        className={styles.center}
        initial={reduceMotion ? false : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 200, damping: 25 }}
      >
        <motion.div
          className={styles.logo}
          initial={reduceMotion ? false : { scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 20, delay: 0.05 }}
        >
          <img src={logoPng} alt="Aether" width={48} height={48} className={styles.logoIcon} />
          <h1 className={styles.title}>Aether Terminal</h1>
        </motion.div>
        <motion.p
          className={styles.greeting}
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={reduceMotion ? { duration: 0 } : { delay: 0.15 }}
        >
          {userName ? `${getGreeting()}, ${userName}.` : `${getGreeting()}.`}
        </motion.p>
        <p className={styles.subtitle}>Project terminal for shells, agents, edits, and review</p>

        <button type="button" className={styles.openBtn} onClick={handleOpenFolder}>
          <FolderOpen size={14} strokeWidth={1.75} aria-hidden="true" />
          Open Folder
        </button>
        <div className={`${styles.dropZone} ${dragOver ? styles.dropZoneActive : ""}`} aria-hidden="true">
          <Upload size={12} strokeWidth={1.75} aria-hidden="true" />
          <span>{dragOver ? "Release to open" : "or drop a folder here"}</span>
        </div>

        <section
          className={styles.recentSection}
          data-empty={!loading && recentProjects.length === 0}
          aria-labelledby="welcome-recent-projects"
        >
          <div id="welcome-recent-projects" className={styles.recentHeader}>
            Recent Projects
          </div>
          <div className={styles.recentList}>
            {loading &&
              SKELETON_KEYS.map((key, i) => (
                <div key={key} className={styles.skeletonCard}>
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
                initial={reduceMotion ? false : { opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={
                  reduceMotion ? { duration: 0 } : { delay: 0.1 + i * 0.04, type: "spring", stiffness: 300, damping: 25 }
                }
              >
                <div className={styles.projectAvatar}>{p.name.slice(0, 2).toUpperCase()}</div>
                <div className={styles.projectInfo}>
                  <div className={styles.projectName}>
                    {p.name}
                    {p.has_changes && (
                      <span
                        className={styles.changesDot}
                        title="Working tree has uncommitted changes"
                        role="img"
                        aria-label="Has uncommitted changes"
                      />
                    )}
                  </div>
                  <div className={styles.projectPath}>
                    {p.path}
                    <span className={styles.branch}>
                      <GitBranch size={10} strokeWidth={1.75} aria-hidden="true" />
                      {p.branch}
                    </span>
                  </div>
                </div>
              </motion.button>
            ))}
            {!loading && recentProjects.length === 0 && (
              <div className={styles.hint}>No projects found. Open a folder to get started.</div>
            )}
          </div>
        </section>
      </motion.div>
      {onOpenSettings && (
        <button
          type="button"
          className={styles.settingsCorner}
          onClick={onOpenSettings}
          aria-label="Open settings"
          title="Settings"
        >
          <SettingsIcon size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
