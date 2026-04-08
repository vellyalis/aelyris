import styles from "./TerminalArea.module.css";

export function TerminalArea() {
  return (
    <div className={styles.terminalArea}>
      <div className={styles.placeholder}>
        <p>Aether Terminal</p>
        <p className={styles.sub}>Phase 1 — ターミナル実装準備中</p>
      </div>
    </div>
  );
}
