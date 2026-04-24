import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import styles from "./IMEInputBar.module.css";

export interface IMEInputBarHandle {
  /** Move keyboard focus into the bar's textarea. */
  focus(): void;
  /** Read whether the bar's textarea currently has focus. */
  hasFocus(): boolean;
}

interface IMEInputBarProps {
  /**
   * Send the composed line(s) to the PTY. Caller chooses whether to append `\r`
   * — this component passes the raw text plus `\r`, because the one use case is
   * "submit a command or a prompt", which is always newline-terminated.
   */
  onSubmit: (text: string) => void;
  /**
   * Escape (or blur trigger). Parent should redirect focus to the terminal
   * canvas so direct keystroke input resumes.
   */
  onRequestCanvasFocus?: () => void;
  /** Grab focus on mount. Defaults to `false` — parent decides explicitly. */
  autoFocus?: boolean;
  /** Persistent across the pane lifetime. Upper bound on retained history. */
  maxHistory?: number;
}

const DEFAULT_MAX_HISTORY = 50;
const TEXTAREA_MAX_ROWS = 5;

/**
 * Permanent IME-safe input bar for the terminal pane.
 *
 * Why this exists: the native `<canvas>` renderer (Phase 2) has no composition
 * event handling, so Japanese / Chinese / Korean input cannot be typed
 * directly into the terminal — the composed text has nowhere to land. This
 * component provides a normal HTML `<textarea>` where IME works natively, and
 * ships the user's committed line to the PTY on Enter.
 *
 * Design notes:
 * - Always rendered; no visibility toggle. The cost of a ~40px fixed bar is
 *   lower than the UX cost of a bar that appears/disappears based on shell
 *   heuristics.
 * - `Enter`  — submit.
 * - `Shift+Enter` — insert literal newline (for AI CLI multi-line prompts).
 * - `ArrowUp` / `ArrowDown` — browse submission history when the cursor is at
 *   the start / end of an empty-or-history-matched buffer. This intentionally
 *   does NOT forward to PTY history — it's bar-local.
 * - `Escape`  — call `onRequestCanvasFocus`; parent typically focuses the
 *   terminal canvas.
 * - An `あ` / `A` indicator reflects active IME composition so users know
 *   whether their next Enter will commit to the IME or to the bar.
 */
export const IMEInputBar = forwardRef<IMEInputBarHandle, IMEInputBarProps>(function IMEInputBar(
  { onSubmit, onRequestCanvasFocus, autoFocus = false, maxHistory = DEFAULT_MAX_HISTORY },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [composing, setComposing] = useState(false);
  const [focused, setFocused] = useState(false);

  const historyRef = useRef<string[]>([]);
  // `null` means "not navigating history" — new keystrokes shouldn't be
  // treated as editing a historical entry until the user explicitly
  // Up-arrows into one.
  const historyIndexRef = useRef<number | null>(null);
  const draftRef = useRef<string>("");

  useImperativeHandle(
    ref,
    () => ({
      focus: () => textareaRef.current?.focus(),
      hasFocus: () => document.activeElement === textareaRef.current,
    }),
    [],
  );

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  // Auto-grow up to TEXTAREA_MAX_ROWS, then scroll. Measure after each
  // value change; scrollHeight reflects the content height regardless of
  // the `rows` attribute.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight || "0") || 20;
    const maxHeight = lineHeight * TEXTAREA_MAX_ROWS;
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
  }, [value]);

  const submit = useCallback(() => {
    const text = value;
    // Intentionally allow a bare Enter submit (`text === ""`) — users
    // hitting Enter on a blank bar usually mean "send a newline to the
    // shell/AI CLI to advance its prompt".
    onSubmit(`${text}\r`);
    if (text.length > 0) {
      // Trim purely trailing duplicates to keep ↑ navigation useful.
      const hist = historyRef.current;
      if (hist[hist.length - 1] !== text) {
        hist.push(text);
        if (hist.length > maxHistory) hist.shift();
      }
    }
    historyIndexRef.current = null;
    draftRef.current = "";
    setValue("");
  }, [value, onSubmit, maxHistory]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // IME composition Enter belongs to the IME.
      if (composing || e.nativeEvent.isComposing || e.keyCode === 229) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onRequestCanvasFocus?.();
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        submit();
        return;
      }

      // History navigation — only when the text-cursor is at the appropriate
      // end of the buffer, so that the bar still allows in-line caret
      // movement across a wrapped / multi-line draft.
      const ta = e.currentTarget;
      const atStart = ta.selectionStart === 0 && ta.selectionEnd === 0;
      const atEnd = ta.selectionStart === ta.value.length && ta.selectionEnd === ta.value.length;

      if (e.key === "ArrowUp" && atStart) {
        const hist = historyRef.current;
        if (hist.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        if (historyIndexRef.current === null) {
          // Read the live DOM value — it's always current even if React
          // hasn't re-rendered yet, and survives future edits to this
          // callback's dep array.
          draftRef.current = textareaRef.current?.value ?? value;
          historyIndexRef.current = hist.length - 1;
        } else if (historyIndexRef.current > 0) {
          historyIndexRef.current -= 1;
        }
        setValue(hist[historyIndexRef.current] ?? "");
        return;
      }

      if (e.key === "ArrowDown" && atEnd) {
        const hist = historyRef.current;
        if (historyIndexRef.current === null) return;
        e.preventDefault();
        e.stopPropagation();
        if (historyIndexRef.current < hist.length - 1) {
          historyIndexRef.current += 1;
          setValue(hist[historyIndexRef.current] ?? "");
        } else {
          historyIndexRef.current = null;
          setValue(draftRef.current);
        }
        return;
      }
    },
    [composing, submit, value, onRequestCanvasFocus],
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    // Any free-form edit breaks the "navigating history" state. Also
    // clear the stashed draft so the invariant "draftRef is only
    // meaningful while historyIndexRef !== null" always holds.
    historyIndexRef.current = null;
    draftRef.current = "";
  }, []);

  const indicator = composing ? "あ" : "A";

  return (
    <div className={`${styles.bar} ${focused ? styles.focused : ""}`} role="group" aria-label="ターミナル入力バー">
      <span className={styles.indicator} aria-label={composing ? "IME composing" : "ASCII"}>
        {indicator}
      </span>
      <textarea
        ref={textareaRef}
        className={styles.input}
        rows={1}
        value={value}
        onChange={handleChange}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
        placeholder="Enter で送信 / Shift+Enter で改行 / Esc でターミナル / ↑↓ で履歴"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label="ターミナル入力"
      />
      <span className={styles.hint} aria-hidden>
        Ctrl+Shift+J
      </span>
    </div>
  );
});
