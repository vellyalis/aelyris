import { useState, useEffect, useRef, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { create } from "zustand";
import styles from "./PromptDialog.module.css";

interface PromptState {
  open: boolean;
  title: string;
  placeholder: string;
  defaultValue: string;
  resolve: ((value: string | null) => void) | null;
}

interface PromptStore extends PromptState {
  show: (opts: { title: string; placeholder?: string; defaultValue?: string }) => Promise<string | null>;
  close: (value: string | null) => void;
}

export const usePromptStore = create<PromptStore>((set, get) => ({
  open: false,
  title: "",
  placeholder: "",
  defaultValue: "",
  resolve: null,
  show: (opts) =>
    new Promise<string | null>((resolve) => {
      set({
        open: true,
        title: opts.title,
        placeholder: opts.placeholder ?? "",
        defaultValue: opts.defaultValue ?? "",
        resolve,
      });
    }),
  close: (value) => {
    const { resolve } = get();
    resolve?.(value);
    set({ open: false, resolve: null });
  },
}));

export function PromptDialog() {
  const { open, title, placeholder, defaultValue, close } = usePromptStore();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, defaultValue]);

  const handleSubmit = useCallback(() => {
    if (value.trim()) close(value.trim());
  }, [value, close]);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) close(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.panel} aria-describedby={undefined}>
          <Dialog.Title className={styles.title}>{title}</Dialog.Title>
          <input
            ref={inputRef}
            className={styles.input}
            placeholder={placeholder}
            aria-label={title}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
          />
          <div className={styles.actions}>
            <button className={styles.cancelBtn} onClick={() => close(null)}>Cancel</button>
            <button className={styles.submitBtn} onClick={handleSubmit} disabled={!value.trim()}>OK</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Drop-in replacement for window.prompt() */
export function showPrompt(title: string, opts?: { placeholder?: string; defaultValue?: string }): Promise<string | null> {
  return usePromptStore.getState().show({ title, placeholder: opts?.placeholder, defaultValue: opts?.defaultValue });
}
