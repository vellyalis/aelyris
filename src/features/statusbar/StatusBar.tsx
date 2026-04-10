import { GitBranch, FileText, Cpu } from "lucide-react";
import styles from "./StatusBar.module.css";

interface StatusBarProps {
  shell: string;
  branch: string;
  changedCount: number;
  encoding?: string;
  agentStatus?: string;
}

export function StatusBar({ shell, branch, changedCount, encoding = "UTF-8", agentStatus }: StatusBarProps) {
  return (
    <div className={styles.statusbar}>
      <div className={styles.left}>
        <span className={styles.item}>{shell}</span>
        {branch && (
          <span className={styles.item}>
            <GitBranch size={11} />
            {branch}
          </span>
        )}
        {changedCount > 0 && (
          <span className={styles.item}>
            <FileText size={11} />
            {changedCount} changed
          </span>
        )}
      </div>
      <div className={styles.right}>
        {agentStatus && (
          <span className={styles.item}>
            <Cpu size={11} />
            {agentStatus}
          </span>
        )}
        <span className={styles.item}>{encoding}</span>
        <span className={styles.item}>LF</span>
        <span className={styles.item}>Aether v0.1.0</span>
      </div>
    </div>
  );
}
