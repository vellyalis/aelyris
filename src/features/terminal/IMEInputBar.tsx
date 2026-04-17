import { useEffect, useRef, useState } from "react";
import styles from "./IMEInputBar.module.css";

interface IMEInputBarProps {
  /** Send text to PTY. Text is raw user input; caller decides whether to append \r. */
  onSubmit: (text: string) => void;
  /** Called when user closes the bar (Esc). */
  onClose: () => void;
}

/**
 * Dedicated IME-safe input field.
 *
 * Why: xterm.js positions its IME helper textarea at the PTY cursor location,
 * which in AI CLIs (claude, gemini, codex) does not match where the user is
 * visually typing. The IME candidate popup therefore appears at the wrong
 * screen position. This component bypasses xterm entirely — the user types
 * into a normal HTML input (where IME works natively), and only the committed
 * text is sent to the PTY on Enter.
 *
 * Toggle with Ctrl+Shift+J from the terminal.
 */
export function IMEInputBar({ onSubmit, onClose }: IMEInputBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const composingRef = useRef(false);

  useEffect(() => {
    // Autofocus on mount so typing goes straight into the bar.
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    if (!value) {
      // Empty Enter: still send \r so the shell/CLI gets a newline.
      onSubmit("\r");
      return;
    }
    onSubmit(value + "\r");
    setValue("");
  };

  return (
    <div className={styles.bar} role="dialog" aria-label="IME入力モード">
      <span className={styles.icon}>あ</span>
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={() => { composingRef.current = false; }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
            return;
          }
          if (e.key === "Enter") {
            // Ignore Enter while IME composition is ongoing — that Enter
            // belongs to the IME for committing the candidate.
            if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
            e.preventDefault();
            e.stopPropagation();
            submit();
          }
        }}
        placeholder="IME入力モード — Enterで送信 / Escで閉じる"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <span className={styles.hint}>Ctrl+Shift+J</span>
      <button
        type="button"
        className={styles.close}
        onClick={onClose}
        aria-label="IME入力モードを閉じる"
        tabIndex={-1}
      >
        ×
      </button>
    </div>
  );
}
