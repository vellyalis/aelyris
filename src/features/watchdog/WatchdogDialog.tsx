import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "motion/react";
import { ShieldCheck, ShieldX, Plus, Trash2 } from "lucide-react";
import styles from "./WatchdogDialog.module.css";

interface WatchdogRule {
  pattern: string;
  approve: boolean;
  description: string;
}

interface WatchdogRules {
  enabled: boolean;
  auto_approve: WatchdogRule[];
}

const PRESETS: { name: string; description: string; rules: WatchdogRule[] }[] = [
  {
    name: "Permissive",
    description: "Approve reads, searches, and git status",
    rules: [
      { pattern: "Read", approve: true, description: "File reads" },
      { pattern: "Glob", approve: true, description: "File search" },
      { pattern: "Grep", approve: true, description: "Content search" },
      { pattern: "Bash(git status*)", approve: true, description: "Git status" },
      { pattern: "Bash(npm run dev*)", approve: true, description: "Dev server" },
    ],
  },
  {
    name: "Strict",
    description: "Only approve file reads",
    rules: [
      { pattern: "Read", approve: true, description: "File reads only" },
    ],
  },
  {
    name: "Readonly",
    description: "Deny all writes",
    rules: [
      { pattern: "Read", approve: true, description: "File reads" },
      { pattern: "Glob", approve: true, description: "File search" },
      { pattern: "Grep", approve: true, description: "Content search" },
      { pattern: "Write", approve: false, description: "Block file writes" },
      { pattern: "Edit", approve: false, description: "Block file edits" },
      { pattern: "Bash(rm*)", approve: false, description: "Block deletions" },
    ],
  },
];

interface WatchdogDialogProps {
  visible: boolean;
  onClose: () => void;
}

export function WatchdogDialog({ visible, onClose }: WatchdogDialogProps) {
  const [rules, setRules] = useState<WatchdogRules>({ enabled: false, auto_approve: [] });
  const [newPattern, setNewPattern] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      invoke<WatchdogRules>("get_watchdog_rules").then(setRules).catch(() => {});
    }
  }, [visible]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await invoke("save_watchdog_rules", { rules });
      onClose();
    } catch { /* ignore */ }
    setSaving(false);
  }, [rules, onClose]);

  const addRule = useCallback(() => {
    if (!newPattern.trim()) return;
    setRules((r) => ({
      ...r,
      auto_approve: [...r.auto_approve, { pattern: newPattern.trim(), approve: true, description: "" }],
    }));
    setNewPattern("");
  }, [newPattern]);

  const removeRule = useCallback((index: number) => {
    setRules((r) => ({
      ...r,
      auto_approve: r.auto_approve.filter((_, i) => i !== index),
    }));
  }, []);

  const toggleRuleApproval = useCallback((index: number) => {
    setRules((r) => ({
      ...r,
      auto_approve: r.auto_approve.map((rule, i) =>
        i === index ? { ...rule, approve: !rule.approve } : rule
      ),
    }));
  }, []);

  const applyPreset = useCallback((preset: typeof PRESETS[number]) => {
    setRules((r) => ({ ...r, enabled: true, auto_approve: [...preset.rules] }));
  }, []);

  return (
    <AnimatePresence>
    {visible && (
    <motion.div className={styles.overlay} onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
      <motion.div className={styles.dialog} onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}>
        <h3 className={styles.title}>Watchdog Rules</h3>

        {/* Enable toggle */}
        <div className={styles.toggleRow}>
          <span className={styles.label}>Watchdog Enabled</span>
          <button
            className={`${styles.toggle} ${rules.enabled ? styles.toggleOn : ""}`}
            onClick={() => setRules((r) => ({ ...r, enabled: !r.enabled }))}
          >
            {rules.enabled ? "ON" : "OFF"}
          </button>
        </div>

        {/* Presets */}
        <div className={styles.presets}>
          {PRESETS.map((p) => (
            <button key={p.name} className={styles.presetBtn} onClick={() => applyPreset(p)} title={p.description}>
              {p.name}
            </button>
          ))}
        </div>

        {/* Rules list */}
        <div className={styles.rulesList}>
          {rules.auto_approve.map((rule, i) => (
            <div key={i} className={styles.ruleRow}>
              <button className={styles.ruleToggle} onClick={() => toggleRuleApproval(i)} title={rule.approve ? "Approve" : "Deny"}>
                {rule.approve
                  ? <ShieldCheck size={12} color="var(--ctp-green)" />
                  : <ShieldX size={12} color="var(--ctp-red)" />
                }
              </button>
              <span className={styles.rulePattern}>{rule.pattern}</span>
              <button className={styles.ruleDelete} onClick={() => removeRule(i)}>
                <Trash2 size={10} />
              </button>
            </div>
          ))}
        </div>

        {/* Add rule */}
        <div className={styles.addRow}>
          <input
            className={styles.input}
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            placeholder="Pattern (e.g. Bash(git*))"
            onKeyDown={(e) => { if (e.key === "Enter") addRule(); }}
          />
          <button className={styles.addBtn} onClick={addRule} disabled={!newPattern.trim()}>
            <Plus size={14} />
          </button>
        </div>

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button className={styles.createBtn} onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </motion.div>
    </motion.div>
    )}
    </AnimatePresence>
  );
}
