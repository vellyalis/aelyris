import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import styles from "./WebInspector.module.css";

interface WebInspectorProps {
  visible: boolean;
  onClose: () => void;
}

export function WebInspector({ visible, onClose }: WebInspectorProps) {
  const [url, setUrl] = useState("http://localhost:3000");
  const [currentUrl, setCurrentUrl] = useState("http://localhost:3000");

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className={styles.panel}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        >
          <div className={styles.header}>
            <button className={styles.navBtn} onClick={() => setCurrentUrl(url)}>
              →
            </button>
            <input
              className={styles.urlBar}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setCurrentUrl(url)}
              placeholder="http://localhost:3000"
            />
            <button className={styles.navBtn} onClick={() => setCurrentUrl(currentUrl)}>
              ↻
            </button>
            <button className={styles.closeBtn} onClick={onClose}>
              ×
            </button>
          </div>
          <iframe
            className={styles.frame}
            src={currentUrl}
            title="Web Inspector"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
