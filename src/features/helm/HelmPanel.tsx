import styles from "./HelmPanel.module.css";

export function HelmPanel() {
  return (
    <div className={styles.helm}>
      <div className={styles.header}>Helm</div>
      <div className={styles.content}>
        <div className={styles.placeholder}>Roadmap & Tasks</div>
      </div>
    </div>
  );
}
