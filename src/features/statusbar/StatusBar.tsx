import styles from "./StatusBar.module.css";

export function StatusBar() {
  return (
    <div className={styles.statusbar}>
      <div className={styles.left}>
        <span className={styles.item}>PowerShell</span>
      </div>
      <div className={styles.right}>
        <span className={styles.item}>Aether v0.1.0</span>
      </div>
    </div>
  );
}
