import { invoke } from "@tauri-apps/api/core";
import { Clipboard, Image as ImageIcon, Paperclip, X } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { reportInvokeFailure } from "../../shared/lib/fallbackTelemetry";
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
  /** Disable input when the backing PTY is not writable. */
  disabled?: boolean;
  /** Override for tests — defaults to Tauri's file dialog. */
  pickAttachmentFiles?: () => Promise<string[]>;
  /** Override for tests — defaults to `save_temp_image` IPC. */
  saveClipboardImage?: (dataUrl: string) => Promise<string>;
  /** Override for tests — defaults to native Win32 clipboard image IPC. */
  readNativeClipboardImage?: () => Promise<string | null>;
}

const DEFAULT_MAX_HISTORY = 50;
const TEXTAREA_MAX_ROWS = 5;
const CANDIDATE_POPUP_GUARD_PX = 440;
const CANDIDATE_POPUP_HEIGHT_GUARD_PX = 260;
const handledPasteEvents = new WeakSet<Event>();

interface TextareaImeAnchor {
  x: number;
  y: number;
  candidateX: number;
  candidateY: number;
}

interface AttachmentChip {
  id: string;
  path: string;
  label: string;
  token: string;
}

interface AttachmentStatus {
  tone: "info" | "error";
  message: string;
}

const CARET_MIRROR_STYLE_PROPS = [
  "borderBottomWidth",
  "borderLeftWidth",
  "borderRightWidth",
  "borderTopWidth",
  "boxSizing",
  "fontFamily",
  "fontFeatureSettings",
  "fontKerning",
  "fontSize",
  "fontStretch",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "tabSize",
  "textAlign",
  "textIndent",
  "textTransform",
  "wordSpacing",
] as const;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clampImeBarCandidateX(caretX: number, inputLeft: number, inputRight: number): number {
  const safeLeft = Number.isFinite(inputLeft) ? inputLeft : 0;
  const safeRight = Number.isFinite(inputRight) ? Math.max(safeLeft, inputRight) : safeLeft;
  const guardedRight = Math.max(safeLeft, safeRight - CANDIDATE_POPUP_GUARD_PX);
  return clamp(caretX, safeLeft, guardedRight);
}

export function clampImeBarCandidateY(caretY: number, viewportHeight: number): number {
  const safeViewportHeight = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  const safeCaret = Number.isFinite(caretY) ? Math.max(0, caretY) : 0;
  const guardedBottom = Math.max(0, safeViewportHeight - CANDIDATE_POPUP_HEIGHT_GUARD_PX);
  return Math.min(safeCaret, guardedBottom);
}

function copyTextareaCaretStyles(target: HTMLElement, style: CSSStyleDeclaration) {
  for (const prop of CARET_MIRROR_STYLE_PROPS) {
    target.style[prop] = style[prop];
  }
}

async function defaultPickAttachmentFiles(): Promise<string[]> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    directory: false,
    multiple: true,
    title: "Add files or images",
  });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

function defaultSaveClipboardImage(dataUrl: string): Promise<string> {
  return invoke<string>("save_temp_image", { data: dataUrl });
}

function defaultReadNativeClipboardImage(): Promise<string | null> {
  return invoke<string | null>("save_clipboard_image");
}

function quoteAttachmentPath(path: string): string {
  const escaped = path.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function attachmentLabel(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? path;
}

function removeAttachmentToken(value: string, token: string): string {
  const index = value.indexOf(token);
  if (index < 0) return value;
  let start = index;
  let end = index + token.length;
  if (start > 0 && /\s/.test(value[start - 1] ?? "")) start -= 1;
  else if (end < value.length && /\s/.test(value[end] ?? "")) end += 1;
  return `${value.slice(0, start)}${value.slice(end)}`.replace(/\s{2,}/g, " ").trim();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read clipboard image"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

function clipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = Array.from(data.files ?? []).filter((file) => file.type.startsWith("image/"));
  if (files.length > 0) return files;
  return Array.from(data.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}

function attachmentErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim().length > 0) return err.message;
  if (typeof err === "string" && err.trim().length > 0) return err;
  return fallback;
}

export function measureTextareaImeAnchor(textarea: HTMLTextAreaElement): TextareaImeAnchor | null {
  if (typeof document === "undefined") return null;
  const rect = textarea.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  const marker = document.createElement("span");

  mirror.setAttribute("aria-hidden", "true");
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordBreak = "break-word";
  mirror.style.overflowWrap = "break-word";
  mirror.style.overflow = "hidden";
  mirror.style.top = "0";
  mirror.style.left = "-10000px";
  mirror.style.width = `${rect.width}px`;
  mirror.style.minHeight = `${rect.height}px`;
  copyTextareaCaretStyles(mirror, style);

  const selectionStart = clamp(textarea.selectionStart ?? textarea.value.length, 0, textarea.value.length);
  mirror.textContent = textarea.value.slice(0, selectionStart);
  marker.dataset.imeCaretMarker = "true";
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  try {
    const lineHeight = parseFloat(style.lineHeight || "0") || 20;
    const markerLeft = marker.offsetLeft;
    const markerTop = marker.offsetTop;
    const x = rect.left + markerLeft - textarea.scrollLeft;
    const y = rect.top + markerTop - textarea.scrollTop + lineHeight;
    const clampedX = clamp(x, rect.left, Math.max(rect.left, rect.right - 1));
    const clampedY = clamp(y, rect.top, Math.max(rect.top, rect.bottom + lineHeight));
    return {
      x: clampedX,
      y: clampedY,
      candidateX: clampImeBarCandidateX(clampedX, rect.left, rect.right),
      candidateY: clampImeBarCandidateY(clampedY, window.innerHeight),
    };
  } finally {
    mirror.remove();
  }
}

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
  {
    onSubmit,
    onRequestCanvasFocus,
    autoFocus = false,
    maxHistory = DEFAULT_MAX_HISTORY,
    disabled = false,
    pickAttachmentFiles = defaultPickAttachmentFiles,
    saveClipboardImage = defaultSaveClipboardImage,
    readNativeClipboardImage = defaultReadNativeClipboardImage,
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [composing, setComposing] = useState(false);
  const [focused, setFocused] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentChip[]>([]);
  const [attachmentStatus, setAttachmentStatus] = useState<AttachmentStatus | null>(null);
  const attachmentBusyRef = useRef(false);

  const historyRef = useRef<string[]>([]);
  // `null` means "not navigating history" — new keystrokes shouldn't be
  // treated as editing a historical entry until the user explicitly
  // Up-arrows into one.
  const historyIndexRef = useRef<number | null>(null);
  const draftRef = useRef<string>("");

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        if (!disabled) textareaRef.current?.focus();
      },
      hasFocus: () => document.activeElement === textareaRef.current,
    }),
    [disabled],
  );

  useLayoutEffect(() => {
    if (autoFocus && !disabled) textareaRef.current?.focus();
  }, [autoFocus, disabled]);

  useEffect(() => {
    if (!disabled) return;
    setComposing(false);
    setFocused(false);
    textareaRef.current?.blur();
  }, [disabled]);

  const pushImeBarPosition = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta || disabled) return;
    const anchor = measureTextareaImeAnchor(ta);
    if (!anchor) return;
    invoke("set_ime_position", {
      x: anchor.x,
      y: anchor.y,
      candidateX: anchor.candidateX,
      candidateY: anchor.candidateY,
    }).catch((err) => {
      reportInvokeFailure({
        source: "ime-input-bar",
        operation: "set_ime_position",
        err,
        severity: "warning",
      });
    });
  }, [disabled]);

  const pushImeBarPositionNowAndNextFrame = useCallback(() => {
    pushImeBarPosition();
    window.requestAnimationFrame(pushImeBarPosition);
  }, [pushImeBarPosition]);

  const insertAttachmentPaths = useCallback(
    (paths: readonly string[]) => {
      if (disabled || paths.length === 0) return;
      const ta = textareaRef.current;
      const current = ta?.value ?? value;
      const selectionStart = ta?.selectionStart ?? current.length;
      const selectionEnd = ta?.selectionEnd ?? selectionStart;
      const chips = paths.map((path) => {
        const token = quoteAttachmentPath(path);
        return {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          path,
          label: attachmentLabel(path),
          token,
        };
      });
      const token = chips.map((chip) => chip.token).join(" ");
      const needsLeadingSpace = selectionStart > 0 && !/\s$/.test(current.slice(0, selectionStart));
      const needsTrailingSpace = selectionEnd < current.length && !/^\s/.test(current.slice(selectionEnd));
      const insertion = `${needsLeadingSpace ? " " : ""}${token}${needsTrailingSpace ? " " : ""}`;
      const next = `${current.slice(0, selectionStart)}${insertion}${current.slice(selectionEnd)}`;
      setAttachments((prev) => [...prev, ...chips]);
      setAttachmentStatus(null);
      setValue(next);
      window.requestAnimationFrame(() => {
        const input = textareaRef.current;
        if (!input) return;
        input.focus();
        const caret = selectionStart + insertion.length;
        input.setSelectionRange(caret, caret);
        pushImeBarPosition();
      });
    },
    [disabled, pushImeBarPosition, value],
  );

  const removeAttachment = useCallback((chip: AttachmentChip) => {
    setAttachments((prev) => prev.filter((item) => item.id !== chip.id));
    setAttachmentStatus(null);
    setValue((current) => removeAttachmentToken(current, chip.token));
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const addFiles = useCallback(async () => {
    if (disabled || attachmentBusyRef.current) return;
    attachmentBusyRef.current = true;
    setAttachmentBusy(true);
    try {
      insertAttachmentPaths(await pickAttachmentFiles());
    } catch (err) {
      setAttachmentStatus({ tone: "error", message: attachmentErrorMessage(err, "ファイルを追加できませんでした") });
    } finally {
      attachmentBusyRef.current = false;
      setAttachmentBusy(false);
    }
  }, [disabled, insertAttachmentPaths, pickAttachmentFiles]);

  const addClipboardImages = useCallback(
    async (files: readonly File[]) => {
      if (disabled || attachmentBusyRef.current || files.length === 0) return;
      attachmentBusyRef.current = true;
      setAttachmentBusy(true);
      try {
        const paths: string[] = [];
        for (const file of files) {
          const dataUrl = await readFileAsDataUrl(file);
          paths.push(await saveClipboardImage(dataUrl));
        }
        insertAttachmentPaths(paths);
      } catch (err) {
        setAttachmentStatus({ tone: "error", message: attachmentErrorMessage(err, "画像を追加できませんでした") });
      } finally {
        attachmentBusyRef.current = false;
        setAttachmentBusy(false);
      }
    },
    [disabled, insertAttachmentPaths, saveClipboardImage],
  );

  const pasteClipboardImage = useCallback(async () => {
    if (disabled || attachmentBusyRef.current) return;
    attachmentBusyRef.current = true;
    setAttachmentBusy(true);
    try {
      const path = await readNativeClipboardImage();
      if (path) {
        insertAttachmentPaths([path]);
      } else {
        setAttachmentStatus({ tone: "info", message: "画像は見つかりませんでした" });
      }
    } catch (err) {
      setAttachmentStatus({
        tone: "error",
        message: attachmentErrorMessage(err, "クリップボード画像を追加できませんでした"),
      });
    } finally {
      attachmentBusyRef.current = false;
      setAttachmentBusy(false);
    }
  }, [disabled, insertAttachmentPaths, readNativeClipboardImage]);

  // Auto-grow up to TEXTAREA_MAX_ROWS, then scroll. Measure after each
  // value change; scrollHeight reflects the content height regardless of
  // the `rows` attribute.
  // biome-ignore lint/correctness/useExhaustiveDependencies: textarea height must be remeasured after every value change.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight || "0") || 20;
    const maxHeight = lineHeight * TEXTAREA_MAX_ROWS;
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
  }, [value]);

  useEffect(() => {
    if (attachments.length === 0) return;
    setAttachments((prev) => prev.filter((chip) => value.includes(chip.token)));
  }, [attachments.length, value]);

  const submit = useCallback(() => {
    if (disabled) return;
    const text = textareaRef.current?.value ?? value;
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
    setAttachments([]);
    setAttachmentStatus(null);
    setValue("");
  }, [disabled, value, onSubmit, maxHistory]);

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

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (disabled) return;
      setValue(e.target.value);
      // Any free-form edit breaks the "navigating history" state. Also
      // clear the stashed draft so the invariant "draftRef is only
      // meaningful while historyIndexRef !== null" always holds.
      historyIndexRef.current = null;
      draftRef.current = "";
    },
    [disabled],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (handledPasteEvents.has(e.nativeEvent)) return;
      handledPasteEvents.add(e.nativeEvent);
      const images = clipboardImageFiles(e.clipboardData);
      if (images.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        void addClipboardImages(images);
        return;
      }

      const text = e.clipboardData.getData("text/plain") || e.clipboardData.getData("text");
      if (!text || !/[\r\n]/.test(text)) return;

      e.preventDefault();
      e.stopPropagation();
      onSubmit(text.replace(/\r\n|\r|\n/g, "\r"));
    },
    [addClipboardImages, onSubmit],
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const onNativePaste = (event: ClipboardEvent) => {
      if (handledPasteEvents.has(event)) return;
      handledPasteEvents.add(event);
      const images = clipboardImageFiles(event.clipboardData);
      if (images.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        void addClipboardImages(images);
        return;
      }

      const text = event.clipboardData?.getData("text/plain") || event.clipboardData?.getData("text") || "";
      if (!text || !/[\r\n]/.test(text)) return;

      event.preventDefault();
      event.stopPropagation();
      onSubmit(text.replace(/\r\n|\r|\n/g, "\r"));
    };
    textarea.addEventListener("paste", onNativePaste);
    return () => textarea.removeEventListener("paste", onNativePaste);
  }, [addClipboardImages, onSubmit]);

  const indicator = composing ? "あ" : "A";
  // Resting placeholder stays short so narrow panes (split-right ×2)
  // don't truncate or wrap. The full key-binding crib drops in only
  // when the user focuses the bar and there's nothing typed yet —
  // otherwise it reads as visual noise on every pane all the time.
  const placeholder = disabled
    ? "Process exited"
    : focused && value.length === 0
      ? "Enter で送信  ·  Shift+Enter で改行  ·  Esc でターミナル  ·  ↑↓ で履歴"
      : "メッセージを入力";
  return (
    <fieldset
      className={`${styles.bar} ${focused ? styles.focused : ""} ${disabled ? styles.disabled : ""}`}
      aria-label="ターミナル入力バー"
      aria-disabled={disabled}
    >
      {attachments.length > 0 && (
        <section className={styles.attachmentDock} aria-label="添付ファイル">
          {attachments.map((chip) => (
            <span key={chip.id} className={styles.attachmentChip} title={chip.path}>
              <Paperclip size={11} aria-hidden="true" />
              <span>{chip.label}</span>
              <button
                type="button"
                className={styles.removeAttachment}
                onClick={() => removeAttachment(chip)}
                aria-label={`${chip.label} を削除`}
                title="添付を削除"
              >
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          ))}
        </section>
      )}
      {attachmentStatus && (
        <div className={styles.attachmentStatus} data-tone={attachmentStatus.tone} role="status" aria-live="polite">
          {attachmentStatus.message}
        </div>
      )}
      <div className={styles.inputRow}>
        <span
          className={`${styles.indicator} ${composing ? styles.indicatorComposing : ""}`}
          role="img"
          aria-label={composing ? "IME composing" : "ASCII"}
        >
          {indicator}
        </span>
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => void addFiles()}
          disabled={disabled || attachmentBusy}
          aria-label="写真とファイルを追加"
          title="写真とファイルを追加"
        >
          <Paperclip size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.toolButton}
          onClick={() => void pasteClipboardImage()}
          disabled={disabled || attachmentBusy}
          aria-label="クリップボード画像を追加"
          title="クリップボード画像を追加"
        >
          {attachmentBusy ? <ImageIcon size={13} aria-hidden="true" /> : <Clipboard size={13} aria-hidden="true" />}
        </button>
        <textarea
          ref={textareaRef}
          className={styles.input}
          rows={1}
          value={value}
          onChange={handleChange}
          onCompositionStart={() => {
            if (disabled) return;
            setComposing(true);
            /* WebView2 has a documented bug where IME candidate windows
             * for `<textarea>` inputs anchor at stale coordinates — for
             * us that meant the popup appeared in the bottom-right of
             * the window (over the right-panel) when typing in this
             * bar (dogfood screenshot, 2026-05-03). The Tauri side
             * provides `set_ime_position` which calls
             * `ImmSetCompositionWindow` directly; we point it at the
             * caret position of *this* textarea so the candidate list
             * sits where the user is actually typing. */
            pushImeBarPositionNowAndNextFrame();
          }}
          onCompositionUpdate={pushImeBarPositionNowAndNextFrame}
          onCompositionEnd={() => setComposing(false)}
          onFocus={() => {
            if (!disabled) setFocused(true);
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="ターミナル入力"
        />
        <kbd className={styles.hint} aria-hidden>
          ⌃⇧J
        </kbd>
      </div>
    </fieldset>
  );
});
