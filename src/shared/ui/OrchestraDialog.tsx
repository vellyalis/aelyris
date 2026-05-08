import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "zustand";

import { ORCHESTRA_ROLES, type OrchestraRoleId } from "../lib/orchestrator";
import styles from "./OrchestraDialog.module.css";

/** Result returned by `showOrchestra()`. */
export interface OrchestraResult {
  task: string;
  roles: OrchestraRoleId[];
}

interface OrchestraState {
  open: boolean;
  defaultTask: string;
  defaultRoles: OrchestraRoleId[];
  resolve: ((value: OrchestraResult | null) => void) | null;
}

interface OrchestraStore extends OrchestraState {
  show: (opts?: { defaultTask?: string; defaultRoles?: OrchestraRoleId[] }) => Promise<OrchestraResult | null>;
  close: (value: OrchestraResult | null) => void;
}

const DEFAULT_ROLES: OrchestraRoleId[] = ["implementer", "tester", "reviewer"];

export const useOrchestraStore = create<OrchestraStore>((set, get) => ({
  open: false,
  defaultTask: "",
  defaultRoles: DEFAULT_ROLES,
  resolve: null,
  show: (opts) =>
    new Promise<OrchestraResult | null>((resolve) => {
      set({
        open: true,
        defaultTask: opts?.defaultTask ?? "",
        defaultRoles: opts?.defaultRoles ?? DEFAULT_ROLES,
        resolve,
      });
    }),
  close: (value) => {
    const { resolve } = get();
    resolve?.(value);
    set({ open: false, resolve: null });
  },
}));

export function OrchestraDialog() {
  const { open, defaultTask, defaultRoles, close } = useOrchestraStore();
  const [task, setTask] = useState("");
  const [selected, setSelected] = useState<Set<OrchestraRoleId>>(() => new Set(defaultRoles));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setTask(defaultTask);
    setSelected(new Set(defaultRoles));
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [open, defaultTask, defaultRoles]);

  const toggleRole = useCallback((id: OrchestraRoleId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = task.trim();
    if (!trimmed || selected.size === 0) return;
    const roles: OrchestraRoleId[] = ORCHESTRA_ROLES.map((r) => r.id).filter((id) => selected.has(id));
    close({ task: trimmed, roles });
  }, [task, selected, close]);

  const canSubmit = task.trim().length > 0 && selected.size > 0;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) close(null);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.panel} aria-describedby={undefined}>
          <Dialog.Title className={styles.title}>
            <span className={styles.conductor}>♫</span> Orchestra mode
          </Dialog.Title>
          <div className={styles.subtitle}>Dispatch multiple agents in parallel, each with a specific role.</div>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            placeholder="What should the team work on?"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (canSubmit) handleSubmit();
              }
              if (e.key === "Escape") close(null);
            }}
            rows={5}
          />
          <div className={styles.rolesHeader}>Roles to dispatch</div>
          <div className={styles.roles}>
            {ORCHESTRA_ROLES.map((role) => {
              const checked = selected.has(role.id);
              return (
                <label
                  key={role.id}
                  className={`${styles.role} ${checked ? styles.roleChecked : ""}`}
                  style={{ "--role-color": role.color } as React.CSSProperties}
                >
                  <input
                    type="checkbox"
                    className={styles.roleCheckbox}
                    checked={checked}
                    onChange={() => toggleRole(role.id)}
                  />
                  <span className={styles.roleIcon} style={{ background: role.color }}>
                    {role.icon}
                  </span>
                  <span className={styles.roleBody}>
                    <span className={styles.roleLabel}>{role.label}</span>
                    <span className={styles.roleModel}>{role.model}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <div className={styles.hint}>
            Ctrl+Enter to dispatch · Esc to cancel · Each role gets its own prompt template.
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={() => close(null)}>
              Cancel
            </button>
            <button type="button" className={styles.submitBtn} onClick={handleSubmit} disabled={!canSubmit}>
              Dispatch {selected.size} agent{selected.size === 1 ? "" : "s"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Imperative helper mirroring `showHandoff()` / `showPrompt()`. */
export function showOrchestra(opts?: {
  defaultTask?: string;
  defaultRoles?: OrchestraRoleId[];
}): Promise<OrchestraResult | null> {
  return useOrchestraStore.getState().show(opts);
}
