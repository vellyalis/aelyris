import { getCurrentWindow } from "@tauri-apps/api/window";
import styles from "./TitleBar.module.css";

function getWindow() {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

export function TitleBar() {
  const handleMinimize = () => getWindow()?.minimize();
  const handleMaximize = async () => {
    const win = getWindow();
    if (!win) return;
    const isMax = await win.isMaximized();
    isMax ? win.unmaximize() : win.maximize();
  };
  const handleClose = () => getWindow()?.close();

  return (
    <div className={styles.titlebar} data-tauri-drag-region>
      <div className={styles.title}>Aether Terminal</div>
      <div className={styles.controls}>
        <button
          className={styles.controlBtn}
          onClick={handleMinimize}
          aria-label="Minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1">
            <rect width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className={styles.controlBtn}
          onClick={handleMaximize}
          aria-label="Maximize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect
              width="9"
              height="9"
              x="0.5"
              y="0.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        </button>
        <button
          className={`${styles.controlBtn} ${styles.closeBtn}`}
          onClick={handleClose}
          aria-label="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
            <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
