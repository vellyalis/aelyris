import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import styles from "./PRInspector.module.css";

interface PullRequest {
  number: number;
  title: string;
  state: string;
  author: { login?: string };
  headRefName: string;
  url: string;
}

interface PRInspectorProps {
  visible: boolean;
  projectPath: string;
  onClose: () => void;
  onViewDiff?: (diff: string, prNumber: number) => void;
  onStartReview?: (prompt: string) => void;
}

export function PRInspector({ visible, projectPath, onClose, onViewDiff, onStartReview }: PRInspectorProps) {
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPr, setExpandedPr] = useState<number | null>(null);
  const [diff, setDiff] = useState<string | null>(null);

  const loadPRs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<PullRequest[]>("list_pull_requests", { cwd: projectPath });
      setPrs(result);
    } catch (err) {
      setError(String(err));
    }
    setLoading(false);
  }, [projectPath]);

  useEffect(() => { if (visible) loadPRs(); }, [loadPRs, visible]);

  if (!visible) return null;

  const viewDiff = async (prNumber: number) => {
    if (expandedPr === prNumber) { setExpandedPr(null); setDiff(null); return; }
    setExpandedPr(prNumber);
    try {
      const d = await invoke<string>("get_pr_diff", { cwd: projectPath, prNumber });
      setDiff(d);
      onViewDiff?.(d, prNumber);
    } catch { setDiff("Failed to load diff"); }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Pull Requests</span>
        <button className={styles.refreshBtn} onClick={loadPRs}>↻</button>
        <button className={styles.refreshBtn} onClick={onClose}>×</button>
      </div>
      <div className={styles.list}>
        {loading && <div className={styles.status}>Loading PRs...</div>}
        {error && <div className={styles.error}>{error}</div>}
        {prs.map((pr) => (
          <div key={pr.number}>
            <button className={styles.prCard} onClick={() => viewDiff(pr.number)}>
              <span className={styles.prNumber}>#{pr.number}</span>
              <span className={styles.prTitle}>{pr.title}</span>
              <span className={styles.prBranch}>{pr.headRefName}</span>
            </button>
            {expandedPr === pr.number && diff && (
              <>
                <pre className={styles.diffPreview}>{diff.slice(0, 2000)}{diff.length > 2000 ? "\n..." : ""}</pre>
                {onStartReview && (
                  <button
                    className={styles.reviewBtn}
                    onClick={() => onStartReview(`Review PR #${pr.number}: ${pr.title}\n\nDiff:\n${diff.slice(0, 8000)}`)}
                  >
                    Review with Agent
                  </button>
                )}
              </>
            )}
          </div>
        ))}
        {!loading && prs.length === 0 && !error && (
          <div className={styles.status}>No open PRs</div>
        )}
      </div>
    </div>
  );
}
