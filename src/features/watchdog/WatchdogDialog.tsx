import * as Dialog from "@radix-ui/react-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Plus, ShieldCheck, ShieldX, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
    rules: [{ pattern: "Read", approve: true, description: "File reads only" }],
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
      invoke<WatchdogRules>("get_watchdog_rules")
        .then(setRules)
        .catch(() => {});
    }
  }, [visible]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await invoke("save_watchdog_rules", { rules });
      onClose();
    } catch {
      /* ignore */
    }
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
      auto_approve: r.auto_approve.map((rule, i) => (i === index ? { ...rule, approve: !rule.approve } : rule)),
    }));
  }, []);

  const applyPreset = useCallback((preset: (typeof PRESETS)[number]) => {
    setRules((r) => ({ ...r, enabled: true, auto_approve: [...preset.rules] }));
  }, []);

  return (
    <Dialog.Root
      open={visible}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.dialog} aria-describedby={undefined}>
          <Dialog.Title className={styles.title}>Watchdog Rules</Dialog.Title>

          {/* Enable toggle */}
          <div className={styles.toggleRow}>
            <span className={styles.label}>Watchdog Enabled</span>
            <button
              type="button"
              className={`${styles.toggle} ${rules.enabled ? styles.toggleOn : ""}`}
              onClick={() => setRules((r) => ({ ...r, enabled: !r.enabled }))}
              aria-pressed={rules.enabled}
              aria-label="Toggle Watchdog"
            >
              {rules.enabled ? "ON" : "OFF"}
            </button>
          </div>

          {/* Presets */}
          <div className={styles.presets}>
            {PRESETS.map((p) => (
              <button
                type="button"
                key={p.name}
                className={styles.presetBtn}
                onClick={() => applyPreset(p)}
                title={p.description}
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* Rules list */}
          <div className={styles.rulesList}>
            {rules.auto_approve.map((rule, i) => (
              <div key={i} className={styles.ruleRow}>
                <button
                  type="button"
                  className={styles.ruleToggle}
                  onClick={() => toggleRuleApproval(i)}
                  aria-pressed={rule.approve}
                  aria-label={rule.approve ? `Change ${rule.pattern} to deny` : `Change ${rule.pattern} to approve`}
                  title={rule.approve ? "Approve" : "Deny"}
                >
                  {rule.approve ? (
                    <ShieldCheck size={12} color="var(--ctp-green)" aria-hidden="true" />
                  ) : (
                    <ShieldX size={12} color="var(--ctp-red)" aria-hidden="true" />
                  )}
                </button>
                <span className={styles.rulePattern}>{rule.pattern}</span>
                <button
                  type="button"
                  className={styles.ruleDelete}
                  onClick={() => removeRule(i)}
                  aria-label={`Remove rule ${rule.pattern}`}
                >
                  <Trash2 size={10} aria-hidden="true" />
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
              aria-label="New rule pattern"
              onKeyDown={(e) => {
                if (e.key === "Enter") addRule();
              }}
            />
            <button
              type="button"
              className={styles.addBtn}
              onClick={addRule}
              disabled={!newPattern.trim()}
              aria-label="Add rule"
            >
              <Plus size={12} aria-hidden="true" />
            </button>
          </div>

          <div className={styles.actions}>
            <Dialog.Close asChild>
              <button type="button" className={styles.cancelBtn}>
                Cancel
              </button>
            </Dialog.Close>
            <button type="button" className={styles.createBtn} onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
