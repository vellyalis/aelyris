import { motion, AnimatePresence } from "motion/react";
import logoSvg from "../../assets/logo.svg";
import styles from "./AboutDialog.module.css";

interface AboutDialogProps {
  visible: boolean;
  onClose: () => void;
}

export function AboutDialog({ visible, onClose }: AboutDialogProps) {
  return (
    <AnimatePresence>
    {visible && (
    <motion.div className={styles.overlay} onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
      <motion.div className={styles.dialog} onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}>
        <img src={logoSvg} alt="Aether" width={64} height={64} className={styles.logo} />
        <h2 className={styles.title}>Aether Terminal</h2>
        <p className={styles.version}>Version 0.1.0</p>
        <p className={styles.desc}>AI Workspace for Windows</p>
        <div className={styles.info}>
          <div className={styles.row}><span>Framework</span><span>Tauri v2 + React 19</span></div>
          <div className={styles.row}><span>Terminal</span><span>alacritty_terminal + Canvas 2D</span></div>
          <div className={styles.row}><span>Editor</span><span>Monaco Editor</span></div>
          <div className={styles.row}><span>Backend</span><span>Rust + ConPTY</span></div>
          <div className={styles.row}><span>Git</span><span>libgit2 (git2-rs)</span></div>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>Close</button>
      </motion.div>
    </motion.div>
    )}
    </AnimatePresence>
  );
}
