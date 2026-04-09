import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import styles from "./WatchdogDialog.module.css";

interface WatchdogDialogProps {
  visible: boolean;
  onClose: () => void;
}

export function WatchdogDialog({ visible, onClose }: WatchdogDialogProps) {
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);

  if (!visible) return null;

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
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
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
      </div>
    </div>
  );
}
