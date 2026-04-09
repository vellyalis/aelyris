import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "motion/react";
import styles from "./WatchdogDialog.module.css";

interface WatchdogDialogProps {
  visible: boolean;
  onClose: () => void;
}

export function WatchdogDialog({ visible, onClose }: WatchdogDialogProps) {
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await invoke("create_watchdog", { name: name.trim(), instructions: instructions.trim() });
      setName("");
      setInstructions("");
      onClose();
    } catch { /* ignore */ }
    setSaving(false);
  };

  return (
    <AnimatePresence>
    {visible && (
    <motion.div className={styles.overlay} onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
      <motion.div className={styles.dialog} onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}>
        <h3 className={styles.title}>Create Watchdog</h3>

        <label className={styles.label}>Name</label>
        <input
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Oreo"
          autoFocus
        />

        <label className={styles.label}>Instructions (optional)</label>
        <textarea
          className={styles.textarea}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Approve everything"
          rows={3}
        />

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button className={styles.createBtn} onClick={handleCreate} disabled={saving || !name.trim()}>
            {saving ? "Creating..." : "Create"}
          </button>
        </div>
      </motion.div>
    </motion.div>
    )}
    </AnimatePresence>
  );
}
