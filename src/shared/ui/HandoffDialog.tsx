import { useState, useEffect, useRef, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { create } from "zustand";
import { MODEL_OPTIONS, getModelById } from "../types/model";
import { ORCHESTRA_ROLES, type OrchestraRoleId } from "../lib/orchestrator";
import styles from "./HandoffDialog.module.css";

export interface HandoffResult {
  prompt: string;
  modelId: string;
  /** Selected Orchestra role for the target session, or null for no role. */
  role: OrchestraRoleId | null;
}

interface HandoffState {
  open: boolean;
  sourceName: string;
  sourceId: string | null;
  defaultPrompt: string;
  defaultModelId: string;
  defaultRole: OrchestraRoleId | null;
  resolve: ((value: HandoffResult | null) => void) | null;
}

interface HandoffStore extends HandoffState {
  show: (opts: {
    sourceName: string;
    sourceId?: string;
    defaultPrompt?: string;
    defaultModelId?: string;
    defaultRole?: OrchestraRoleId | null;
  }) => Promise<HandoffResult | null>;
  close: (value: HandoffResult | null) => void;
}

export const useHandoffStore = create<HandoffStore>((set, get) => ({
  open: false,
  sourceName: "",
  sourceId: null,
  defaultPrompt: "",
  defaultModelId: "claude-sonnet",
  defaultRole: null,
  resolve: null,
  show: (opts) =>
    new Promise<HandoffResult | null>((resolve) => {
      set({
        open: true,
        sourceName: opts.sourceName,
        sourceId: opts.sourceId ?? null,
        defaultPrompt: opts.defaultPrompt ?? "",
        defaultModelId: opts.defaultModelId ?? "claude-sonnet",
        defaultRole: opts.defaultRole ?? null,
        resolve,
      });
    }),
  close: (value) => {
    const { resolve } = get();
    resolve?.(value);
    set({ open: false, resolve: null });
  },
}));

export function HandoffDialog() {
  const { open, sourceName, defaultPrompt, defaultModelId, defaultRole, close } = useHandoffStore();
  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState(defaultModelId);
  const [role, setRole] = useState<OrchestraRoleId | "">("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setPrompt(defaultPrompt);
      setModelId(defaultModelId);
      setRole(defaultRole ?? "");
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    }
  }, [open, defaultPrompt, defaultModelId, defaultRole]);

  const handleSubmit = useCallback(() => {
    const trimmed = prompt.trim();
    if (trimmed) {
      close({
        prompt: trimmed,
        modelId,
        role: role === "" ? null : (role as OrchestraRoleId),
      });
    }
  }, [prompt, modelId, role, close]);

  const model = getModelById(modelId);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) close(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.panel} aria-describedby={undefined}>
          <Dialog.Title className={styles.title}>
            Hand off from <span className={styles.source}>{sourceName}</span>
          </Dialog.Title>
          <div className={styles.modelRow}>
            <label className={styles.modelLabel}>Target model</label>
            <div className={styles.modelSelectWrap}>
              <select
                className={styles.modelSelect}
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              <span
                className={styles.modelDot}
                style={{ background: model?.color ?? "var(--ctp-blue)" }}
              />
            </div>
            <label className={styles.modelLabel} style={{ marginLeft: "var(--space-4)" }}>
              Role
            </label>
            <select
              className={styles.modelSelect}
              value={role}
              onChange={(e) => setRole(e.target.value as OrchestraRoleId | "")}
              aria-label="Target Orchestra role"
            >
              <option value="">— none —</option>
              {ORCHESTRA_ROLES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.icon} {r.label}
                </option>
              ))}
            </select>
          </div>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            placeholder="Message to send to the new agent..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleSubmit();
              }
              if (e.key === "Escape") close(null);
            }}
            rows={8}
          />
          <div className={styles.hint}>
            <span>Ctrl+Enter to send · Esc to cancel</span>
          </div>
          <div className={styles.actions}>
            <button className={styles.cancelBtn} onClick={() => close(null)}>Cancel</button>
            <button className={styles.submitBtn} onClick={handleSubmit} disabled={!prompt.trim()}>
              Hand off
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Imperative helper, mirroring showPrompt(). */
export function showHandoff(opts: {
  sourceName: string;
  sourceId?: string;
  defaultPrompt?: string;
  defaultModelId?: string;
  defaultRole?: OrchestraRoleId | null;
}): Promise<HandoffResult | null> {
  return useHandoffStore.getState().show(opts);
}
