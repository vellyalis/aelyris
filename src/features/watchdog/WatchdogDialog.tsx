import * as Dialog from "@radix-ui/react-dialog";
import { invoke } from "@tauri-apps/api/core";
import { Plus, ShieldCheck, ShieldX, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "../../shared/store/toastStore";
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
  // Hold the disk snapshot so handleSave can spread it through and any future
  // field added by Rust round-trips even if the UI doesn't edit it yet —
  // mirrors the Settings.tsx data-loss fix.
  const [loadedRules, setLoadedRules] = useState<WatchdogRules | null>(null);
  const [newPattern, setNewPattern] = useState("");
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    // Reset the load snapshot on every open before starting the new
    // fetch. Without this, a second open that races (or whose load
    // rejects) leaves `loadedRules` populated with the previous
    // session's snapshot — handleSave's null guard then passes and
    // those *stale* rules overwrite whatever is now on disk (codex r2
    // P2). Clear synchronously so the guard fires until the new fetch
    // confirms it succeeded.
    setLoadedRules(null);
    let cancelled = false;
    invoke<WatchdogRules>("get_watchdog_rules")
      .then((loaded) => {
        if (cancelled) return;
        setLoadedRules(loaded);
        setRules(loaded);
      })
      .catch((err) => {
        if (cancelled) return;
        // Surface load failure so handleSave's null-guard doesn't silently
        // discard the user's edits — without this, the dialog looks like a
        // no-op and on retry the empty default rules would clobber disk.
        toast.error("Failed to load Watchdog rules", String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const handleSave = useCallback(async () => {
    if (!loadedRules) {
      // Open and immediately close before load resolves (or load failed).
      // Preserve disk contents by skipping save entirely — but warn the
      // user instead of silently sending an empty default ruleset that
      // would wipe their existing rules.
      toast.warning(
        "Watchdog rules not saved",
        "Rules have not finished loading yet — please reopen the dialog and try again.",
      );
      onClose();
      return;
    }
    setSaving(true);
    try {
      // Spread loadedRules so any future field added by Rust round-trips
      // even if the UI doesn't edit it yet.
      const merged: WatchdogRules = { ...loadedRules, ...rules };
      await invoke("save_watchdog_rules", { rules: merged });
      if (!mountedRef.current) return;
      setSaving(false);
      onClose();
    } catch (err) {
      if (!mountedRef.current) return;
      setSaving(false);
      toast.error("Failed to save Watchdog rules", String(err));
    }
  }, [rules, loadedRules, onClose]);

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
              <div key={rule.pattern} className={styles.ruleRow}>
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
