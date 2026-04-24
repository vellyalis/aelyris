import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle } from "lucide-react";
import { useEffect, useRef } from "react";
import { create } from "zustand";
import styles from "./ConfirmDialog.module.css";

type ConfirmTone = "default" | "danger";

interface ConfirmState {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: ConfirmTone;
  resolve: ((ok: boolean) => void) | null;
}

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}

interface ConfirmStore extends ConfirmState {
  show: (opts: ConfirmOptions) => Promise<boolean>;
  close: (ok: boolean) => void;
}

export const useConfirmStore = create<ConfirmStore>((set, get) => ({
  open: false,
  title: "",
  description: "",
  confirmLabel: "OK",
  cancelLabel: "Cancel",
  tone: "default",
  resolve: null,
  show: (opts) =>
    new Promise<boolean>((resolve) => {
      set({
        open: true,
        title: opts.title,
        description: opts.description ?? "",
        confirmLabel: opts.confirmLabel ?? "Confirm",
        cancelLabel: opts.cancelLabel ?? "Cancel",
        tone: opts.tone ?? "default",
        resolve,
      });
    }),
  close: (ok) => {
    const { resolve } = get();
    resolve?.(ok);
    set({ open: false, resolve: null });
  },
}));

export function ConfirmDialog() {
  const { open, title, description, confirmLabel, cancelLabel, tone, close } = useConfirmStore();
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the safe action (Cancel) by default — destructive dialogs must
  // never preselect the destructive button. Overrides Radix's default
  // "focus the first focusable child" behaviour where the confirm button
  // happens to come first in source order.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => cancelRef.current?.focus());
    }
  }, [open]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) close(false);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={`${styles.panel} ${tone === "danger" ? styles.panelDanger : ""}`}
          aria-describedby={description ? "confirm-desc" : undefined}
        >
          <div className={styles.header}>
            {tone === "danger" && <AlertTriangle size={20} aria-hidden="true" className={styles.icon} />}
            <Dialog.Title className={styles.title}>{title}</Dialog.Title>
          </div>
          {description && (
            <Dialog.Description id="confirm-desc" className={styles.description}>
              {description}
            </Dialog.Description>
          )}
          <div className={styles.actions}>
            <button type="button" ref={cancelRef} className={styles.cancelBtn} onClick={() => close(false)}>
              {cancelLabel}
            </button>
            <button
              type="button"
              className={`${styles.confirmBtn} ${tone === "danger" ? styles.confirmBtnDanger : ""}`}
              onClick={() => close(true)}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Drop-in replacement for window.confirm() with proper focus management
 *  and a danger variant for destructive actions. */
export function showConfirm(opts: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().show(opts);
}
