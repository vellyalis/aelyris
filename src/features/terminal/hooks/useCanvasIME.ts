import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef } from "react";
import { reportFallback, reportInvokeFailure } from "../../../shared/lib/fallbackTelemetry";
import { writeClipboardText } from "../../../shared/lib/nativeClipboard";
import {
  classifyTerminalPasteInput,
  countTerminalPasteLineEndings,
  normalizeTerminalPasteInput,
  TERMINAL_PASTE_GUARD_EVENT,
  type TerminalPasteGuard,
} from "../../../shared/lib/terminalInput";
import { keyEventToBytes } from "../keymap";

/**
 * Phase B of the native-IME work — attaches keyboard + composition listeners
 * to an invisible `<textarea>` overlay so that IME (Japanese / Chinese /
 * Korean) composition can land somewhere the browser recognises as a text
 * input. Without a real text input element, `compositionstart` / `input`
 * events never fire and multi-byte characters cannot be typed at all.
 *
 * Event split:
 * - Plain printable keys (`'a'`, `'あ'` from IME)         → `input` event path.
 * - Special keys (Enter, Arrow*, Ctrl+C, Tab, …)         → `keydown` path.
 * - IME composition (keyCode=229, isComposing)           → ignored by keydown;
 *   the committed text arrives via `input` with `isComposing === false`.
 *
 * The `keydown` handler intentionally does NOT forward plain printables; if
 * it did, typing `a` would send `a` twice (once from keydown, once from
 * input).  `keymap.keyEventToBytes` already returns `null` for IME events.
 */

export type WriteBytesFn = (id: string, data: string) => void;

const FALLBACK_COMPOSITION_COMMIT_DELAY_MS = 32;
const NATIVE_PREEDIT_POLL_MS = 32;
const MAX_IME_DIAGNOSTIC_EVENTS = 80;

export const IME_DIAGNOSTIC_EVENT = "aelyris:ime-diagnostic";
export const IME_DIAGNOSTIC_TOGGLE_EVENT = "aelyris:ime-diagnostic-toggle";
export const IME_DIAGNOSTIC_STORAGE_KEY = "aelyris:debug:ime";
export const IME_DIAGNOSTIC_OVERLAY_STORAGE_KEY = "aelyris:debug:imeOverlay";
export const NATIVE_INPUT_SURFACE_STORAGE_KEY = "aelyris:terminal:nativeInputSurface";
export const NATIVE_INPUT_SURFACE_DEFAULT_ENABLED = true;
export const TERMINAL_PREFIX_COMMAND_EVENT = "aelyris:terminal-prefix-command";
export const TERMINAL_CLIPBOARD_PASTE_EVENT = "aelyris:terminal-clipboard-paste";

function isTerminalPasteShortcut(e: KeyboardEvent): boolean {
  const key = e.key.toLowerCase();
  return (e.ctrlKey && key === "v") || (e.shiftKey && e.key === "Insert");
}

async function readClipboardText(): Promise<string> {
  let nativeError: unknown = null;
  try {
    return await invoke<string>("read_clipboard_text");
  } catch (err) {
    nativeError = err;
    reportInvokeFailure({
      source: "terminal.clipboard",
      operation: "read_clipboard_text",
      err,
      severity: "warning",
      userVisible: true,
      boundary: "native",
    });
  }
  try {
    if (typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function") {
      reportFallback({
        source: "terminal.clipboard",
        operation: "read_clipboard_text_browser_fallback",
        severity: "warning",
        message: "Native clipboard read failed; using browser clipboard fallback.",
        userVisible: true,
        boundary: "webview-fallback",
        nativeBoundaryEscaped: true,
      });
      return await navigator.clipboard.readText();
    }
  } catch (err) {
    reportInvokeFailure({
      source: "terminal.clipboard",
      operation: "browser_read_clipboard_text",
      err,
      severity: "error",
      userVisible: true,
      boundary: "webview-fallback",
      nativeBoundaryEscaped: true,
    });
  }
  const message = nativeError instanceof Error ? nativeError.message : "No clipboard read path available";
  reportFallback({
    source: "terminal.clipboard",
    operation: "read_clipboard_text_unavailable",
    severity: "error",
    message,
    userVisible: true,
    boundary: "unavailable",
  });
  return "";
}

export type ImeDiagnosticPhase =
  | "keydown"
  | "input"
  | "compositionstart"
  | "compositionupdate"
  | "compositionend"
  | "paste"
  | "blur"
  | "commit";

export type ImeDiagnosticWritePath =
  | "canvas"
  | "canvas-keymap"
  | "ime-composition"
  | "ime-commit"
  | "paste"
  | "focus"
  | "terminal-prefix"
  | "ignored";

export interface ImeDiagnosticDetail {
  phase: ImeDiagnosticPhase;
  terminalId: string;
  timestamp: number;
  composing: boolean;
  active: boolean;
  valueLength: number;
  scrollLeft: number;
  selectionStart: number | null;
  selectionEnd: number | null;
  anchorLeft: string;
  anchorTop: string;
  anchorWidth: string;
  anchorHeight: string;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  candidateLeft: string | null;
  candidateTop: string | null;
  anchorMode?: string | null;
  key?: string;
  keyCode?: number;
  inputType?: string | null;
  isComposing?: boolean;
  dataLength?: number | null;
  sentLength?: number;
  normalizedLineBreaks?: number;
  riskSeverity?: string;
  riskClasses?: string[];
  pasteGuardAction?: "allowed" | "confirmed" | "cancelled" | "blocked";
  ignored?: boolean;
  dropped?: boolean;
  writePath?: ImeDiagnosticWritePath;
  reason?: string;
}

declare global {
  interface Window {
    __AELYRIS_IME_DEBUG__?: boolean;
    __AELYRIS_IME_DEBUG_OVERLAY__?: boolean;
    __AELYRIS_IME_EVENTS__?: ImeDiagnosticDetail[];
    __AELYRIS_ENABLE_IME_DEBUG__?: () => void;
    __AELYRIS_DISABLE_IME_DEBUG__?: () => void;
    __AELYRIS_COPY_IME_EVENTS__?: () => Promise<boolean>;
    __AELYRIS_SHOW_IME_DEBUG_OVERLAY__?: () => void;
    __AELYRIS_HIDE_IME_DEBUG_OVERLAY__?: () => void;
    __AELYRIS_NATIVE_INPUT_SURFACE__?: boolean;
  }
}

function eventTimestamp(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export function imeDiagnosticsEnabled(win: Window | null | undefined = typeof window !== "undefined" ? window : null) {
  if (!win) return false;
  if (win.__AELYRIS_IME_DEBUG__ === true) return true;
  try {
    const value = win.localStorage.getItem(IME_DIAGNOSTIC_STORAGE_KEY);
    return value === "1" || value === "true";
  } catch {
    return false;
  }
}

export function imeDiagnosticsOverlayEnabled(
  win: Window | null | undefined = typeof window !== "undefined" ? window : null,
) {
  if (!win) return false;
  if (win.__AELYRIS_IME_DEBUG_OVERLAY__ === true) return true;
  try {
    const value = win.localStorage.getItem(IME_DIAGNOSTIC_OVERLAY_STORAGE_KEY);
    return value === "1" || value === "true";
  } catch {
    return false;
  }
}

export function nativeTerminalInputSurfaceEnabled(
  win: Window | null | undefined = typeof window !== "undefined" ? window : null,
) {
  if (!win) return false;
  if (win.__AELYRIS_NATIVE_INPUT_SURFACE__ === true) return true;
  if (win.__AELYRIS_NATIVE_INPUT_SURFACE__ === false) return false;
  try {
    const value = win.localStorage.getItem(NATIVE_INPUT_SURFACE_STORAGE_KEY);
    if (value === "1" || value === "true") return true;
    if (value === "0" || value === "false") return false;
  } catch {
    /* localStorage can be unavailable in tests or hardened WebViews. */
  }
  const tauriRuntime = (win as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  return NATIVE_INPUT_SURFACE_DEFAULT_ENABLED && tauriRuntime !== undefined;
}

export function setImeDiagnosticsOverlayVisible(win: Window = window, visible: boolean) {
  win.__AELYRIS_IME_DEBUG_OVERLAY__ = visible;
  try {
    if (visible) {
      win.localStorage.setItem(IME_DIAGNOSTIC_OVERLAY_STORAGE_KEY, "1");
    } else {
      win.localStorage.removeItem(IME_DIAGNOSTIC_OVERLAY_STORAGE_KEY);
    }
  } catch {
    /* localStorage can be unavailable in tests or hardened WebViews. */
  }
  win.dispatchEvent(new CustomEvent(IME_DIAGNOSTIC_TOGGLE_EVENT, { detail: { enabled: imeDiagnosticsEnabled(win) } }));
}

export function enableImeDiagnostics(win: Window = window, options?: { showOverlay?: boolean }) {
  win.__AELYRIS_IME_DEBUG__ = true;
  try {
    win.localStorage.setItem(IME_DIAGNOSTIC_STORAGE_KEY, "1");
  } catch {
    /* localStorage can be unavailable in tests or hardened WebViews. */
  }
  if (options?.showOverlay) {
    setImeDiagnosticsOverlayVisible(win, true);
  }
  win.dispatchEvent(new CustomEvent(IME_DIAGNOSTIC_TOGGLE_EVENT, { detail: { enabled: true } }));
}

export function disableImeDiagnostics(win: Window = window) {
  win.__AELYRIS_IME_DEBUG__ = false;
  win.__AELYRIS_IME_DEBUG_OVERLAY__ = false;
  try {
    win.localStorage.removeItem(IME_DIAGNOSTIC_STORAGE_KEY);
    win.localStorage.removeItem(IME_DIAGNOSTIC_OVERLAY_STORAGE_KEY);
  } catch {
    /* localStorage can be unavailable in tests or hardened WebViews. */
  }
  win.dispatchEvent(new CustomEvent(IME_DIAGNOSTIC_TOGGLE_EVENT, { detail: { enabled: false } }));
}

export async function copyImeDiagnostics(win: Window = window): Promise<boolean> {
  const events = win.__AELYRIS_IME_EVENTS__ ?? [];
  if (events.length === 0) return false;
  const payload = JSON.stringify(events, null, 2);
  try {
    await writeClipboardText(payload, {
      source: "terminal.ime-diagnostics",
      fallbackMessage: "Native clipboard write failed; using browser clipboard fallback for IME diagnostics.",
      userVisible: true,
    });
    return true;
  } catch {
    return false;
  }
}

export function installImeDiagnosticHelpers(win: Window = window) {
  win.__AELYRIS_ENABLE_IME_DEBUG__ = () => enableImeDiagnostics(win);
  win.__AELYRIS_DISABLE_IME_DEBUG__ = () => disableImeDiagnostics(win);
  win.__AELYRIS_COPY_IME_EVENTS__ = () => copyImeDiagnostics(win);
  win.__AELYRIS_SHOW_IME_DEBUG_OVERLAY__ = () => setImeDiagnosticsOverlayVisible(win, true);
  win.__AELYRIS_HIDE_IME_DEBUG_OVERLAY__ = () => setImeDiagnosticsOverlayVisible(win, false);
}

function imeDataLength(value: string | null | undefined): number | null {
  return typeof value === "string" ? value.length : null;
}

function recordImeDiagnostic(
  textarea: HTMLTextAreaElement,
  terminalId: string,
  composing: boolean,
  detail: Omit<
    ImeDiagnosticDetail,
    | "terminalId"
    | "timestamp"
    | "composing"
    | "active"
    | "valueLength"
    | "scrollLeft"
    | "selectionStart"
    | "selectionEnd"
    | "anchorLeft"
    | "anchorTop"
    | "anchorWidth"
    | "anchorHeight"
    | "viewportWidth"
    | "viewportHeight"
    | "devicePixelRatio"
    | "candidateLeft"
    | "candidateTop"
  >,
) {
  const win = textarea.ownerDocument.defaultView ?? (typeof window !== "undefined" ? window : null);
  if (!win || !imeDiagnosticsEnabled(win)) return;

  const entry: ImeDiagnosticDetail = {
    ...detail,
    terminalId,
    timestamp: eventTimestamp(),
    composing,
    active: textarea.ownerDocument.activeElement === textarea,
    valueLength: textarea.value.length,
    scrollLeft: textarea.scrollLeft,
    selectionStart: textarea.selectionStart ?? null,
    selectionEnd: textarea.selectionEnd ?? null,
    anchorLeft: textarea.style.left,
    anchorTop: textarea.style.top,
    anchorWidth: textarea.style.width,
    anchorHeight: textarea.style.height,
    viewportWidth: win.innerWidth,
    viewportHeight: win.innerHeight,
    devicePixelRatio: win.devicePixelRatio,
    candidateLeft: textarea.dataset.imeCandidateX ?? null,
    candidateTop: textarea.dataset.imeCandidateY ?? null,
    anchorMode: textarea.dataset.imeAnchorMode ?? null,
  };

  const ring = win.__AELYRIS_IME_EVENTS__ ?? [];
  ring.push(entry);
  if (ring.length > MAX_IME_DIAGNOSTIC_EVENTS) {
    ring.splice(0, ring.length - MAX_IME_DIAGNOSTIC_EVENTS);
  }
  win.__AELYRIS_IME_EVENTS__ = ring;
  win.dispatchEvent(new CustomEvent<ImeDiagnosticDetail>(IME_DIAGNOSTIC_EVENT, { detail: entry }));
  // Keep console output opt-in with the same flag so dogfood sessions can
  // capture a precise event trace without polluting normal terminal use.
  console.debug?.("[Aelyris IME]", entry);
}

const defaultWriteBytes: WriteBytesFn = (id, data) => {
  invoke("native_terminal_input_commit", { terminalId: id, data, source: "webview-ime-bridge" }).catch((err) => {
    reportInvokeFailure({
      source: "terminal-ime",
      operation: "native_terminal_input_commit",
      err,
      severity: "error",
    });
  });
};

function isTerminalPrefixKey(e: KeyboardEvent): boolean {
  return e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && (e.key === "b" || e.key === "B");
}

function dispatchTerminalPrefixCommand(textarea: HTMLTextAreaElement, terminalId: string, command: string): void {
  textarea.dispatchEvent(
    new CustomEvent(TERMINAL_PREFIX_COMMAND_EVENT, {
      bubbles: true,
      detail: { terminalId, command },
    }),
  );
}

function resolveMuxKeymapEvent(terminalId: string, e: KeyboardEvent): Promise<string | null> {
  return invoke<MuxKeymapResponse>("mux_process_keymap_event", {
    terminalId,
    key: e.key,
    ctrlKey: e.ctrlKey,
    altKey: e.altKey,
    shiftKey: e.shiftKey,
    metaKey: e.metaKey,
  })
    .then((response) =>
      response.kind === "dispatch" && typeof response.command === "string" && response.command.length > 0
        ? response.command
        : null,
    )
    .catch((err) => {
      reportInvokeFailure({
        source: "terminal-ime",
        operation: "mux_process_keymap_event",
        err,
        severity: "warning",
      });
      return null;
    });
}

function dispatchPasteGuardEvent(
  textarea: HTMLTextAreaElement,
  terminalId: string,
  guard: TerminalPasteGuard,
  action: ImeDiagnosticDetail["pasteGuardAction"],
) {
  const win = textarea.ownerDocument.defaultView ?? (typeof window !== "undefined" ? window : null);
  win?.dispatchEvent(
    new CustomEvent(TERMINAL_PASTE_GUARD_EVENT, {
      detail: {
        terminalId,
        action,
        shouldBlock: guard.shouldBlock,
        shouldConfirm: guard.shouldConfirm,
        reason: guard.reason,
        risk: {
          classes: guard.risk.classes,
          severity: guard.risk.severity,
          requiresApproval: guard.risk.requiresApproval,
          allowExecution: guard.risk.allowExecution,
          lineCount: guard.risk.lineCount,
          multiline: guard.risk.multiline,
          preview: guard.risk.preview,
          redacted: guard.risk.redactedCommand !== guard.risk.command,
        },
      },
    }),
  );
}

function confirmPasteGuard(textarea: HTMLTextAreaElement, guard: TerminalPasteGuard): boolean {
  if (!guard.shouldConfirm) return true;
  const win = textarea.ownerDocument.defaultView ?? (typeof window !== "undefined" ? window : null);
  if (typeof win?.confirm !== "function") return false;
  return win.confirm(
    [
      "Paste this command into the terminal?",
      `Risk: ${guard.risk.severity}`,
      `Classes: ${guard.risk.classes.join(", ")}`,
      guard.reason,
      guard.risk.preview,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

/**
 * A key event should be consumed by `keydown` (rather than left to the
 * `input` event) when it either has a modifier the text-input layer wouldn't
 * emit (Ctrl/Alt/Meta), or when it's a named editing key whose default
 * browser behaviour doesn't produce an `input` event with the PTY byte we
 * want (arrows, Enter-as-\r, Escape, Backspace-as-\x7f, F-keys, …).
 */
export function isSpecialKeyEvent(e: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
}): boolean {
  if (e.isComposing || e.keyCode === 229) return false;
  if (e.ctrlKey || e.altKey || e.metaKey) return true;
  // Anything whose `key` isn't a single code point is "special" (Enter,
  // ArrowUp, Escape, F1, Backspace, Tab, Home, …).  Plain printable chars
  // have single-character keys.
  return e.key.length !== 1;
}

export interface UseCanvasIMEArgs {
  terminalId: string | null;
  textarea: HTMLTextAreaElement | null;
  writeBytes?: WriteBytesFn;
  onCompositionTextChange?: (text: string) => void;
  onCompositionActiveChange?: (active: boolean) => void;
}

interface MuxKeymapResponse {
  kind: "prefixStarted" | "sequencePending" | "dispatch" | "tableChanged" | "passThrough" | "cancelled" | "timeout";
  table?: string | null;
  command?: string | null;
}

interface NativeTerminalPreedit {
  terminalId: string | null;
  active: boolean;
  text: string;
}

export function useCanvasIME({
  terminalId,
  textarea,
  writeBytes = defaultWriteBytes,
  onCompositionTextChange,
  onCompositionActiveChange,
}: UseCanvasIMEArgs) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    installImeDiagnosticHelpers(window);
  }, []);

  // Hold `writeBytes` in a ref so its identity does NOT appear in the
  // effect's dependency array. If it did, any parent passing an inline
  // function literal (common in tests, easy in production) would
  // re-register all five listeners on every render — and an unlucky
  // re-register during a live `compositionstart → …` flow would reset
  // `composingRef` / `pendingCompositionRef` below and silently drop the
  // in-flight IME commit.
  const writeBytesRef = useRef(writeBytes);
  writeBytesRef.current = writeBytes;
  const onCompositionTextChangeRef = useRef(onCompositionTextChange);
  onCompositionTextChangeRef.current = onCompositionTextChange;
  const onCompositionActiveChangeRef = useRef(onCompositionActiveChange);
  onCompositionActiveChangeRef.current = onCompositionActiveChange;

  // Track composition state across listeners via refs so handlers stay
  // stable under React's re-renders.
  const composingRef = useRef(false);
  const prefixArmedRef = useRef(false);
  // Remembers the most recent interim composition text so we can fall back
  // to it on `compositionend` if the browser/IME fires the two events in the
  // TSF order `input(isComposing, data=final)` → `compositionend(data="")`.
  const pendingCompositionRef = useRef<string>("");
  // When we commit from `compositionend`, Chromium fires a trailing
  // `input(isComposing=false, data=final)` with the same text. This flag
  // tells that next `input` handler to drop the duplicate.
  const skipNextCommittedInputRef = useRef<string | null>(null);
  const skipNextCommittedInputTimerRef = useRef<number | null>(null);
  // Some Windows IME paths fire `compositionend(data="")` before the final
  // non-composing input. Do not immediately commit stale interim preedit
  // text in that case; give the browser one macrotask to deliver final input.
  const pendingCompositionCommitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (textarea || !terminalId || !nativeTerminalInputSurfaceEnabled()) return;
    let cancelled = false;
    const clearNativePreedit = () => {
      onCompositionTextChangeRef.current?.("");
      onCompositionActiveChangeRef.current?.(false);
    };
    // One request at a time: a slow backend must not pile up queued IPC
    // calls behind the fixed polling cadence.
    let inFlight = false;
    const syncNativePreedit = () => {
      if (inFlight) return;
      inFlight = true;
      invoke<NativeTerminalPreedit>("native_terminal_input_preedit")
        .then((preedit) => {
          if (cancelled) return;
          const ownsTerminal = preedit?.terminalId === terminalId;
          if (!ownsTerminal || !preedit.active) {
            clearNativePreedit();
            return;
          }
          onCompositionActiveChangeRef.current?.(true);
          onCompositionTextChangeRef.current?.(preedit.text ?? "");
        })
        .catch((err) => {
          if (cancelled) return;
          clearNativePreedit();
          reportInvokeFailure({
            source: "terminal-ime",
            operation: "native_terminal_input_preedit",
            err,
            severity: "warning",
            userVisible: false,
          });
        })
        .finally(() => {
          inFlight = false;
        });
    };
    syncNativePreedit();
    const id = window.setInterval(syncNativePreedit, NATIVE_PREEDIT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      clearNativePreedit();
    };
  }, [textarea, terminalId]);

  useEffect(() => {
    if (!textarea || !terminalId) return;

    const clearPendingCompositionCommit = () => {
      if (pendingCompositionCommitTimerRef.current === null) return;
      window.clearTimeout(pendingCompositionCommitTimerRef.current);
      pendingCompositionCommitTimerRef.current = null;
    };

    const clearSkipNextCommittedInput = () => {
      if (skipNextCommittedInputTimerRef.current !== null) {
        window.clearTimeout(skipNextCommittedInputTimerRef.current);
        skipNextCommittedInputTimerRef.current = null;
      }
      skipNextCommittedInputRef.current = null;
    };

    const armSkipNextCommittedInput = (text: string) => {
      clearSkipNextCommittedInput();
      skipNextCommittedInputRef.current = text;
      skipNextCommittedInputTimerRef.current = window.setTimeout(() => {
        skipNextCommittedInputTimerRef.current = null;
        skipNextCommittedInputRef.current = null;
      }, 160);
    };

    const clearCompositionState = () => {
      composingRef.current = false;
      pendingCompositionRef.current = "";
      textarea.value = "";
      onCompositionTextChangeRef.current?.("");
      onCompositionActiveChangeRef.current?.(false);
    };

    const resetComposition = () => {
      clearPendingCompositionCommit();
      clearCompositionState();
    };

    const updateCompositionText = (text: string) => {
      onCompositionActiveChangeRef.current?.(true);
      pendingCompositionRef.current = text;
      onCompositionTextChangeRef.current?.(text);
    };

    const pasteTextToTerminal = (text: string, reason: "clipboard-shortcut" | "context-menu-paste") => {
      if (!text) {
        recordImeDiagnostic(textarea, terminalId, false, {
          phase: "paste",
          sentLength: 0,
          normalizedLineBreaks: 0,
          pasteGuardAction: "blocked",
          writePath: "ignored",
          ignored: true,
          dropped: false,
          reason: "empty-or-non-text-paste-ignored",
        });
        return;
      }
      const hadComposition =
        composingRef.current ||
        pendingCompositionRef.current.length > 0 ||
        pendingCompositionCommitTimerRef.current !== null;
      resetComposition();
      const pasteGuard = classifyTerminalPasteInput(text);
      if (pasteGuard.shouldBlock) {
        dispatchPasteGuardEvent(textarea, terminalId, pasteGuard, "blocked");
        recordImeDiagnostic(textarea, terminalId, false, {
          phase: "paste",
          sentLength: 0,
          normalizedLineBreaks: pasteGuard.lineEndingCount,
          riskSeverity: pasteGuard.risk.severity,
          riskClasses: pasteGuard.risk.classes,
          pasteGuardAction: "blocked",
          writePath: "ignored",
          ignored: true,
          dropped: true,
          reason: "paste-risk-blocked",
        });
        return;
      }
      if (pasteGuard.shouldConfirm && !confirmPasteGuard(textarea, pasteGuard)) {
        dispatchPasteGuardEvent(textarea, terminalId, pasteGuard, "cancelled");
        recordImeDiagnostic(textarea, terminalId, false, {
          phase: "paste",
          sentLength: 0,
          normalizedLineBreaks: pasteGuard.lineEndingCount,
          riskSeverity: pasteGuard.risk.severity,
          riskClasses: pasteGuard.risk.classes,
          pasteGuardAction: "cancelled",
          writePath: "ignored",
          ignored: true,
          dropped: true,
          reason: "paste-risk-cancelled",
        });
        return;
      }
      const normalizedText = normalizeTerminalPasteInput(text);
      const normalizedLineBreaks = countTerminalPasteLineEndings(text);
      writeBytesRef.current(terminalId, normalizedText);
      dispatchPasteGuardEvent(textarea, terminalId, pasteGuard, pasteGuard.shouldConfirm ? "confirmed" : "allowed");
      recordImeDiagnostic(textarea, terminalId, false, {
        phase: "paste",
        sentLength: normalizedText.length,
        normalizedLineBreaks,
        riskSeverity: pasteGuard.risk.severity,
        riskClasses: pasteGuard.risk.classes,
        pasteGuardAction: pasteGuard.shouldConfirm ? "confirmed" : "allowed",
        writePath: "paste",
        reason: hadComposition ? "paste-cancelled-composition" : reason,
      });
    };

    const pasteClipboardTextToTerminal = (reason: "clipboard-shortcut" | "context-menu-paste") => {
      void readClipboardText().then((text) => pasteTextToTerminal(text, reason));
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // IME composition keys: let the IME handle them entirely.
      if (composingRef.current || e.isComposing || e.keyCode === 229) {
        recordImeDiagnostic(textarea, terminalId, composingRef.current, {
          phase: "keydown",
          writePath: "ignored",
          key: e.key,
          keyCode: e.keyCode,
          isComposing: e.isComposing,
          ignored: true,
          dropped: true,
          reason: "ime-composition-key",
        });
        return;
      }

      if (isTerminalPasteShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        pasteClipboardTextToTerminal("clipboard-shortcut");
        return;
      }

      if (prefixArmedRef.current) {
        prefixArmedRef.current = false;
        e.preventDefault();
        e.stopPropagation();
        void resolveMuxKeymapEvent(terminalId, e).then((command) => {
          if (command) dispatchTerminalPrefixCommand(textarea, terminalId, command);
        });
        recordImeDiagnostic(textarea, terminalId, composingRef.current, {
          phase: "keydown",
          writePath: "terminal-prefix",
          key: e.key,
          keyCode: e.keyCode,
          isComposing: e.isComposing,
          ignored: true,
          reason: "terminal-prefix-command",
        });
        return;
      }
      if (isTerminalPrefixKey(e)) {
        prefixArmedRef.current = true;
        e.preventDefault();
        e.stopPropagation();
        void resolveMuxKeymapEvent(terminalId, e);
        recordImeDiagnostic(textarea, terminalId, composingRef.current, {
          phase: "keydown",
          writePath: "terminal-prefix",
          key: e.key,
          keyCode: e.keyCode,
          isComposing: e.isComposing,
          ignored: true,
          reason: "terminal-prefix-arm",
        });
        return;
      }
      if (!isSpecialKeyEvent(e)) {
        // Plain printable — let the `input` event handle it.  keymap.ts
        // would return the char itself here, which would double-send.
        recordImeDiagnostic(textarea, terminalId, composingRef.current, {
          phase: "keydown",
          writePath: "ignored",
          key: e.key,
          keyCode: e.keyCode,
          isComposing: e.isComposing,
          ignored: true,
          reason: "printable-input-path",
        });
        return;
      }

      // A pending empty-compositionend fallback represents stale preedit
      // text waiting one macrotask for the real committed input. If the
      // user sends an editing/control key first (Backspace, Escape, Enter,
      // arrows), that preedit must not resurrect after the key has already
      // been applied to the PTY.
      clearPendingCompositionCommit();
      const bytes = keyEventToBytes(e);
      if (bytes === null) {
        recordImeDiagnostic(textarea, terminalId, composingRef.current, {
          phase: "keydown",
          writePath: "ignored",
          key: e.key,
          keyCode: e.keyCode,
          isComposing: e.isComposing,
          ignored: true,
          dropped: true,
          reason: "unmapped-key",
        });
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      writeBytesRef.current(terminalId, bytes);
      recordImeDiagnostic(textarea, terminalId, composingRef.current, {
        phase: "keydown",
        key: e.key,
        keyCode: e.keyCode,
        isComposing: e.isComposing,
        sentLength: bytes.length,
        writePath: "canvas-keymap",
      });
    };

    const onInput = (e: Event) => {
      const ev = e as InputEvent;
      clearPendingCompositionCommit();
      recordImeDiagnostic(textarea, terminalId, composingRef.current, {
        phase: "input",
        writePath: ev.isComposing || composingRef.current ? "ime-composition" : "canvas",
        inputType: ev.inputType,
        isComposing: ev.isComposing,
        dataLength: imeDataLength(ev.data),
      });
      // During composition, record the latest interim text so we can
      // recover it on `compositionend` if the browser/IME commits through
      // the interim path (Windows TSF: some Japanese IMEs fire the final
      // `input` while `isComposing` is still `true`, then `compositionend`
      // with an empty `data`).
      if (ev.isComposing) {
        // A few WebView2/TSF paths can deliver a late composing input after
        // an empty `compositionend` without replaying `compositionstart`.
        // Treat that input as re-entering composition so a later final input
        // commits through the guarded composition path instead of plain text
        // bookkeeping.
        composingRef.current = true;
        const text =
          textarea.value.length > 0
            ? textarea.value
            : typeof ev.data === "string"
              ? ev.data
              : (ev.inputType ?? "").toLowerCase().includes("delete")
                ? ""
                : pendingCompositionRef.current;
        updateCompositionText(text);
        return;
      }

      if (composingRef.current) {
        const data = textarea.value || ev.data || pendingCompositionRef.current;
        resetComposition();
        if (!data || data.length === 0) return;
        writeBytesRef.current(terminalId, data);
        recordImeDiagnostic(textarea, terminalId, false, {
          phase: "commit",
          inputType: ev.inputType,
          isComposing: ev.isComposing,
          sentLength: data.length,
          writePath: "ime-commit",
        });
        return;
      }

      const data = ev.data ?? textarea.value;
      textarea.value = "";
      if (!data || data.length === 0) return;

      // Chromium fires `compositionend` before the final `input` event;
      // we already sent the committed text from the compositionend handler,
      // so drop the duplicate echo here.
      if (skipNextCommittedInputRef.current === data) {
        clearSkipNextCommittedInput();
        recordImeDiagnostic(textarea, terminalId, false, {
          phase: "commit",
          writePath: "ignored",
          inputType: ev.inputType,
          isComposing: ev.isComposing,
          dataLength: data.length,
          ignored: true,
          dropped: true,
          reason: "duplicate-trailing-input",
        });
        return;
      }
      clearSkipNextCommittedInput();

      writeBytesRef.current(terminalId, data);
      recordImeDiagnostic(textarea, terminalId, false, {
        phase: "commit",
        inputType: ev.inputType,
        isComposing: ev.isComposing,
        sentLength: data.length,
        writePath: "canvas",
      });
    };

    const onCompositionStart = () => {
      clearPendingCompositionCommit();
      composingRef.current = true;
      pendingCompositionRef.current = "";
      clearSkipNextCommittedInput();
      onCompositionTextChangeRef.current?.("");
      onCompositionActiveChangeRef.current?.(true);
      recordImeDiagnostic(textarea, terminalId, composingRef.current, {
        phase: "compositionstart",
        writePath: "ime-composition",
      });
    };

    const onCompositionUpdate = (e: CompositionEvent) => {
      // Windows WebView2 + Japanese IME can update the preedit string via
      // `compositionupdate` without firing an `input(isComposing)` event on
      // every tick. If we only listen to `input`, the OS candidate window
      // shows text while the terminal line stays blank.
      composingRef.current = true;
      const text = textarea.value.length > 0 ? textarea.value : e.data;
      updateCompositionText(text);
      recordImeDiagnostic(textarea, terminalId, composingRef.current, {
        phase: "compositionupdate",
        writePath: "ime-composition",
        dataLength: imeDataLength(e.data),
      });
    };

    const onCompositionEnd = (e: CompositionEvent) => {
      const hadComposition =
        composingRef.current ||
        pendingCompositionRef.current.length > 0 ||
        pendingCompositionCommitTimerRef.current !== null;
      if (!hadComposition) {
        textarea.value = "";
        recordImeDiagnostic(textarea, terminalId, false, {
          phase: "compositionend",
          writePath: "ignored",
          dataLength: imeDataLength(e.data),
          ignored: true,
          reason: "compositionend-without-composition",
        });
        return;
      }
      // Prefer the compositionend event's own `data` (Chromium / WebKit
      // spec-compliant path). If it is empty, do not trust the textarea's
      // live value as the commit. Windows TSF/WebView2 often leaves stale
      // preedit text there while the real committed string arrives in the
      // next non-composing input event; committing the live value immediately
      // is what makes long Japanese input appear stuck or undeletable.
      const text = e.data;
      const pendingText = pendingCompositionRef.current;
      recordImeDiagnostic(textarea, terminalId, composingRef.current, {
        phase: "compositionend",
        writePath: "ime-composition",
        dataLength: imeDataLength(e.data),
      });
      clearPendingCompositionCommit();
      clearCompositionState();
      if (!text || text.length === 0) {
        if (pendingText.length > 0) {
          pendingCompositionCommitTimerRef.current = window.setTimeout(() => {
            pendingCompositionCommitTimerRef.current = null;
            writeBytesRef.current(terminalId, pendingText);
            skipNextCommittedInputRef.current = pendingText;
            recordImeDiagnostic(textarea, terminalId, false, {
              phase: "commit",
              sentLength: pendingText.length,
              writePath: "ime-commit",
              reason: "fallback-compositionend-empty",
            });
            armSkipNextCommittedInput(pendingText);
          }, FALLBACK_COMPOSITION_COMMIT_DELAY_MS);
        }
        return;
      }

      writeBytesRef.current(terminalId, text);
      recordImeDiagnostic(textarea, terminalId, false, {
        phase: "commit",
        sentLength: text.length,
        writePath: "ime-commit",
        reason: "compositionend",
      });
      // Arm the dedup flag so the trailing `input(!isComposing, data=text)`
      // we expect on Chromium doesn't send the same characters twice.
      armSkipNextCommittedInput(text);
    };

    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text") ?? e.clipboardData?.getData("text/plain");
      if (!text) {
        e.preventDefault();
        e.stopPropagation();
        recordImeDiagnostic(textarea, terminalId, false, {
          phase: "paste",
          sentLength: 0,
          normalizedLineBreaks: 0,
          pasteGuardAction: "blocked",
          writePath: "ignored",
          ignored: true,
          dropped: false,
          reason: "empty-or-non-text-paste-ignored",
        });
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const hadComposition =
        composingRef.current ||
        pendingCompositionRef.current.length > 0 ||
        pendingCompositionCommitTimerRef.current !== null;
      resetComposition();
      const pasteGuard = classifyTerminalPasteInput(text);
      if (pasteGuard.shouldBlock) {
        dispatchPasteGuardEvent(textarea, terminalId, pasteGuard, "blocked");
        recordImeDiagnostic(textarea, terminalId, false, {
          phase: "paste",
          sentLength: 0,
          normalizedLineBreaks: pasteGuard.lineEndingCount,
          riskSeverity: pasteGuard.risk.severity,
          riskClasses: pasteGuard.risk.classes,
          pasteGuardAction: "blocked",
          writePath: "ignored",
          ignored: true,
          dropped: true,
          reason: "paste-risk-blocked",
        });
        return;
      }
      if (pasteGuard.shouldConfirm && !confirmPasteGuard(textarea, pasteGuard)) {
        dispatchPasteGuardEvent(textarea, terminalId, pasteGuard, "cancelled");
        recordImeDiagnostic(textarea, terminalId, false, {
          phase: "paste",
          sentLength: 0,
          normalizedLineBreaks: pasteGuard.lineEndingCount,
          riskSeverity: pasteGuard.risk.severity,
          riskClasses: pasteGuard.risk.classes,
          pasteGuardAction: "cancelled",
          writePath: "ignored",
          ignored: true,
          dropped: true,
          reason: "paste-risk-cancelled",
        });
        return;
      }
      const normalizedText = normalizeTerminalPasteInput(text);
      const normalizedLineBreaks = countTerminalPasteLineEndings(text);
      writeBytesRef.current(terminalId, normalizedText);
      dispatchPasteGuardEvent(textarea, terminalId, pasteGuard, pasteGuard.shouldConfirm ? "confirmed" : "allowed");
      recordImeDiagnostic(textarea, terminalId, false, {
        phase: "paste",
        sentLength: normalizedText.length,
        normalizedLineBreaks,
        riskSeverity: pasteGuard.risk.severity,
        riskClasses: pasteGuard.risk.classes,
        pasteGuardAction: pasteGuard.shouldConfirm ? "confirmed" : "allowed",
        writePath: "paste",
        reason: hadComposition ? "paste-cancelled-composition" : undefined,
      });
    };

    const onClipboardPasteRequest = () => {
      pasteClipboardTextToTerminal("context-menu-paste");
    };

    const onBlur = () => {
      recordImeDiagnostic(textarea, terminalId, composingRef.current, {
        phase: "blur",
        writePath: "focus",
      });
      if (
        composingRef.current ||
        pendingCompositionRef.current.length > 0 ||
        pendingCompositionCommitTimerRef.current !== null
      ) {
        recordImeDiagnostic(textarea, terminalId, composingRef.current, {
          phase: "blur",
          writePath: "focus",
          reason: "preserve-composition",
        });
        return;
      }
      resetComposition();
    };

    textarea.addEventListener("keydown", onKeyDown);
    textarea.addEventListener("input", onInput);
    textarea.addEventListener("compositionstart", onCompositionStart);
    textarea.addEventListener("compositionupdate", onCompositionUpdate);
    textarea.addEventListener("compositionend", onCompositionEnd);
    textarea.addEventListener("paste", onPaste);
    textarea.addEventListener(TERMINAL_CLIPBOARD_PASTE_EVENT, onClipboardPasteRequest);
    textarea.addEventListener("blur", onBlur);

    return () => {
      clearPendingCompositionCommit();
      clearSkipNextCommittedInput();
      textarea.removeEventListener("keydown", onKeyDown);
      textarea.removeEventListener("input", onInput);
      textarea.removeEventListener("compositionstart", onCompositionStart);
      textarea.removeEventListener("compositionupdate", onCompositionUpdate);
      textarea.removeEventListener("compositionend", onCompositionEnd);
      textarea.removeEventListener("paste", onPaste);
      textarea.removeEventListener(TERMINAL_CLIPBOARD_PASTE_EVENT, onClipboardPasteRequest);
      textarea.removeEventListener("blur", onBlur);
    };
  }, [terminalId, textarea]);
}

export interface UseImePositionArgs {
  /** Terminal id used by the native input surface. */
  terminalId?: string | null;
  /** Fallback WebView textarea element. Null when the native HWND surface is active. */
  textarea: HTMLTextAreaElement | null;
  /** Focus owner for the native HWND surface. */
  focusElement?: HTMLElement | null;
  /** Whether the native HWND input surface is the active/default input path. */
  nativeInputSurface?: boolean;
  /** Row/col in terminal grid. */
  cursor: { row: number; col: number } | null;
  /** Additional cells occupied by live IME preedit text after the terminal cursor. */
  compositionCellOffset?: number;
  /** Visible terminal grid dimensions. */
  cols: number;
  rows: number;
  /** Cell dimensions in CSS pixels. */
  cellWidth: number;
  cellHeight: number;
  /** Canvas bounding rect origin, used to convert cell coord to screen coord. */
  canvas: HTMLCanvasElement | null;
}

const CANDIDATE_POPUP_GUARD_PX = 440;
const CANDIDATE_POPUP_HEIGHT_GUARD_PX = 260;
const IME_ANCHOR_MIN_WIDTH_PX = 2;

function clampAxis(value: number, maxExclusive: number): number {
  if (!Number.isFinite(value)) return 0;
  const max = Math.max(0, maxExclusive - 1);
  return Math.min(max, Math.max(0, Math.trunc(value)));
}

export function clampTerminalCursor(
  cursor: { row: number; col: number },
  cols: number,
  rows: number,
): { row: number; col: number } {
  return {
    row: clampAxis(cursor.row, rows),
    col: clampAxis(cursor.col, cols),
  };
}

export function imeCandidateAnchorX(caretX: number, canvasWidth: number): number {
  const safeWidth = Number.isFinite(canvasWidth) ? Math.max(0, canvasWidth) : 0;
  const safeCaret = Number.isFinite(caretX) ? Math.max(0, caretX) : 0;
  const guardedRight = Math.max(0, safeWidth - CANDIDATE_POPUP_GUARD_PX);
  return Math.min(safeCaret, guardedRight);
}

export function imeCandidateAnchorXForViewport(
  caretX: number,
  canvasLeft: number,
  canvasWidth: number,
  viewportLeft: number,
  viewportWidth: number,
): number {
  const safeCanvasLeft = Number.isFinite(canvasLeft) ? canvasLeft : 0;
  const safeViewportLeft = Number.isFinite(viewportLeft) ? viewportLeft : 0;
  const safeViewportWidth = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
  const viewportGuardedRight = safeViewportLeft + Math.max(0, safeViewportWidth - CANDIDATE_POPUP_GUARD_PX);
  const localAnchor = imeCandidateAnchorX(caretX, canvasWidth);
  const guardedScreenAnchor = Math.min(safeCanvasLeft + localAnchor, viewportGuardedRight);
  return Math.max(0, guardedScreenAnchor - safeCanvasLeft);
}

export function imeCandidateAnchorY(screenY: number, viewportHeight: number): number {
  const safeViewportHeight = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  const safeScreenY = Number.isFinite(screenY) ? Math.max(0, screenY) : 0;
  const guardedBottom = Math.max(0, safeViewportHeight - CANDIDATE_POPUP_HEIGHT_GUARD_PX);
  return Math.min(safeScreenY, guardedBottom);
}

export function imeCandidateAnchorYForViewport(screenY: number, viewportTop: number, viewportHeight: number): number {
  const safeViewportTop = Number.isFinite(viewportTop) ? viewportTop : 0;
  const safeViewportHeight = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  const safeScreenY = Number.isFinite(screenY) ? Math.max(0, screenY) : 0;
  const guardedBottom = safeViewportTop + Math.max(0, safeViewportHeight - CANDIDATE_POPUP_HEIGHT_GUARD_PX);
  return Math.min(safeScreenY, guardedBottom);
}

export function imeTextareaAnchorWidth(anchorX: number, canvasWidth: number): number {
  const safeWidth = Number.isFinite(canvasWidth) ? Math.max(0, canvasWidth) : 0;
  const safeAnchor = Number.isFinite(anchorX) ? Math.min(Math.max(0, anchorX), safeWidth) : 0;
  const runway = Math.max(0, safeWidth - safeAnchor);
  return Math.max(IME_ANCHOR_MIN_WIDTH_PX, runway);
}

export function imeTextareaCaretInset(caretX: number, anchorX: number, canvasWidth: number): number {
  const safeWidth = Number.isFinite(canvasWidth) ? Math.max(0, canvasWidth) : 0;
  const safeCaret = Number.isFinite(caretX) ? Math.min(Math.max(0, caretX), safeWidth) : 0;
  const safeAnchor = Number.isFinite(anchorX) ? Math.min(Math.max(0, anchorX), safeWidth) : 0;
  return Math.max(0, Math.round(safeCaret - safeAnchor));
}

function rememberImeCandidateAnchor(textarea: HTMLTextAreaElement, candidateX: number, candidateY: number) {
  textarea.dataset.imeCandidateX = `${Math.round(candidateX)}`;
  textarea.dataset.imeCandidateY = `${Math.round(candidateY)}`;
}

function imeCompositionCellSpan(text: string | null | undefined): number {
  if (!text) return 0;
  let cells = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    cells += code > 0x7f ? 2 : 1;
  }
  return cells;
}

function currentImeViewport(): { left: number; top: number; width: number; height: number } {
  const viewport = window.visualViewport;
  return {
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
  };
}

/**
 * Keep the invisible textarea aligned with the PTY cursor, and tell Windows
 * (via the `set_ime_position` IPC) where to park the IME candidate window so
 * it sits directly under the caret rather than in the top-left corner.
 *
 * Important: `set_ime_position` writes the **window-wide** IMM context via
 * `ImmSetCompositionWindow` / `ImmSetCandidateWindow`, so once it fires the
 * coordinates persist for *every* focused text input until something
 * overrides them. If we keep calling it on PTY-cursor changes while the user
 * is actually typing into a different input (e.g. `IMEInputBar` at the bottom
 * of the pane), the OS pops the candidate list at the PTY caret instead of
 * next to the IMEInputBar's textarea — exactly the dogfood bug screenshot
 * (2026-05-03) where the candidate window appeared in the bottom-right of
 * the window over the right-panel.
 *
 * Guard: only push coordinates while *our* hidden textarea is the active
 * element. When focus moves elsewhere we stop emitting and the OS reverts
 * to the focused element's natural position on the next composition.
 */
export function useImePosition({
  terminalId,
  textarea,
  focusElement,
  nativeInputSurface = nativeTerminalInputSurfaceEnabled(),
  cursor,
  compositionCellOffset = 0,
  cols,
  rows,
  cellWidth,
  cellHeight,
  canvas,
}: UseImePositionArgs) {
  const cursorRow = cursor?.row ?? null;
  const cursorCol = cursor?.col ?? null;
  const safeCompositionCellOffset = Number.isFinite(compositionCellOffset)
    ? Math.max(0, Math.trunc(compositionCellOffset))
    : 0;
  /* Push the canvas-cursor IMM position through the IPC. Codex review
   * (round 4) caught that the previous "fire on cursor move only" loop
   * left stale IMM coordinates when the user pinged-pinged between the
   * IMEInputBar and the canvas without the PTY cursor moving — the
   * candidate window would still pop near the IMEInputBar on the next
   * canvas composition because we never re-emitted. Centralising the
   * push lets us reuse it from the focus / compositionstart hooks
   * below. */
  const pushImePosition = useCallback(
    (compositionCellOffsetOverride?: number) => {
      if (!cursor || !canvas) return;
      const activeElement = typeof document === "undefined" ? null : document.activeElement;
      if (typeof document !== "undefined") {
        const ownsFallbackFocus = textarea !== null && activeElement === textarea;
        const ownsNativeFocus =
          nativeInputSurface &&
          (activeElement === focusElement || activeElement === canvas || activeElement === canvas.parentElement);
        if (!ownsFallbackFocus && !ownsNativeFocus) return;
      }
      const safeCursor = clampTerminalCursor(cursor, cols, rows);
      const rect = canvas.getBoundingClientRect();
      const canvasWidth = cols * cellWidth;
      const liveCompositionCellOffset =
        typeof compositionCellOffsetOverride === "number" && Number.isFinite(compositionCellOffsetOverride)
          ? Math.max(0, Math.trunc(compositionCellOffsetOverride))
          : safeCompositionCellOffset;
      const compositionAwareCol = Math.min(Math.max(0, cols - 1), safeCursor.col + liveCompositionCellOffset);
      const caretX = compositionAwareCol * cellWidth;
      const caretY = safeCursor.row * cellHeight + cellHeight;
      const viewport = currentImeViewport();
      const candidateX = imeCandidateAnchorXForViewport(caretX, rect.left, canvasWidth, viewport.left, viewport.width);
      const nativeAnchorWidth = imeTextareaAnchorWidth(candidateX, canvasWidth);
      const nativeCaretInset = imeTextareaCaretInset(caretX, candidateX, canvasWidth);
      const screenX = rect.left + caretX;
      const screenY = rect.top + caretY;
      const candidateScreenX = rect.left + candidateX;
      const candidateScreenY = imeCandidateAnchorYForViewport(screenY, viewport.top, viewport.height);
      if (textarea) {
        rememberImeCandidateAnchor(textarea, candidateScreenX, candidateScreenY);
        invoke("set_ime_position", {
          x: Math.min(screenX, candidateScreenX),
          y: candidateScreenY,
          candidateX: candidateScreenX,
          candidateY: candidateScreenY,
        }).catch((err) => {
          reportInvokeFailure({
            source: "terminal-ime",
            operation: "set_ime_position",
            err,
            severity: "warning",
          });
        });
      }
      if (terminalId && nativeInputSurface) {
        invoke("native_terminal_input_focus", {
          terminalId,
          x: rect.left + candidateX,
          y: rect.top + safeCursor.row * cellHeight,
          width: nativeAnchorWidth,
          height: cellHeight,
          caretInset: nativeCaretInset,
        }).catch((err) => {
          reportInvokeFailure({
            source: "terminal-ime",
            operation: "native_terminal_input_focus",
            err,
            severity: "warning",
          });
        });
      }
    },
    [
      terminalId,
      textarea,
      focusElement,
      nativeInputSurface,
      cursor,
      cols,
      rows,
      canvas,
      cellWidth,
      cellHeight,
      safeCompositionCellOffset,
    ],
  );

  useEffect(() => {
    if (!terminalId || !nativeInputSurface) return;
    const drain = () => {
      invoke("native_terminal_input_drain").catch((err) => {
        reportInvokeFailure({
          source: "terminal-ime",
          operation: "native_terminal_input_drain",
          err,
          severity: "warning",
          userVisible: false,
        });
      });
    };
    const id = window.setInterval(drain, 32);
    return () => window.clearInterval(id);
  }, [terminalId, nativeInputSurface]);

  // Mirror the cursor position to the textarea's CSS box (so the
  // browser-native IME path has a sensible default anchor) and steer
  // IMM when we own focus.
  useEffect(() => {
    if (!textarea || cursorRow === null || cursorCol === null || !canvas) return;
    const safeCursor = clampTerminalCursor({ row: cursorRow, col: cursorCol }, cols, rows);
    const canvasWidth = cols * cellWidth;
    const rect = canvas.getBoundingClientRect();
    const viewport = currentImeViewport();
    const caretX = safeCursor.col * cellWidth;
    const anchorX = imeCandidateAnchorXForViewport(caretX, rect.left, canvasWidth, viewport.left, viewport.width);
    const anchorWidth = imeTextareaAnchorWidth(anchorX, canvasWidth);
    const caretInset = imeTextareaCaretInset(caretX, anchorX, canvasWidth);
    textarea.style.left = `${anchorX}px`;
    textarea.style.top = `${safeCursor.row * cellHeight}px`;
    textarea.style.width = `${anchorWidth}px`;
    textarea.style.paddingLeft = `${caretInset}px`;
    rememberImeCandidateAnchor(textarea, rect.left + anchorX, rect.top + safeCursor.row * cellHeight + cellHeight);
    pushImePosition();
  }, [textarea, cursorRow, cursorCol, cols, rows, cellWidth, cellHeight, canvas, pushImePosition]);

  // Re-push on focus / compositionstart so a focus return from
  // IMEInputBar or any other text input that called `set_ime_position`
  // re-anchors the IMM context to the canvas caret. Without this, the
  // first canvas composition after a focus return would still open the
  // candidate window at the previous input's coordinates.
  useEffect(() => {
    const fallbackTextarea = textarea;
    const target = nativeInputSurface ? (focusElement ?? canvas) : textarea;
    if (!target) return;
    const reanchor = (compositionCellOffsetOverride?: number) => {
      pushImePosition(compositionCellOffsetOverride);
      window.requestAnimationFrame(() => pushImePosition(compositionCellOffsetOverride));
    };
    const reanchorDefault = () => reanchor();
    const reanchorComposition = (event: Event) => {
      if (!fallbackTextarea) return;
      const compositionEvent = event as CompositionEvent;
      reanchor(imeCompositionCellSpan(compositionEvent.data || fallbackTextarea.value));
    };
    const reanchorWhileComposing = (event: Event) => {
      if (!fallbackTextarea) return;
      const inputEvent = event as InputEvent;
      if (inputEvent.isComposing) reanchor(imeCompositionCellSpan(inputEvent.data || fallbackTextarea.value));
    };
    target.addEventListener("focus", reanchorDefault);
    if (fallbackTextarea) {
      fallbackTextarea.addEventListener("compositionstart", reanchorDefault);
      fallbackTextarea.addEventListener("compositionupdate", reanchorComposition);
      fallbackTextarea.addEventListener("input", reanchorWhileComposing);
    }
    window.addEventListener("resize", reanchorDefault);
    window.addEventListener("scroll", reanchorDefault, true);
    window.visualViewport?.addEventListener("resize", reanchorDefault);
    window.visualViewport?.addEventListener("scroll", reanchorDefault);
    const ResizeObserverCtor = window.ResizeObserver;
    const resizeObserver = ResizeObserverCtor ? new ResizeObserverCtor(() => reanchor()) : null;
    if (resizeObserver) {
      if (canvas) resizeObserver.observe(canvas);
      if (canvas?.parentElement) resizeObserver.observe(canvas.parentElement);
      if (fallbackTextarea?.parentElement) resizeObserver.observe(fallbackTextarea.parentElement);
      if (focusElement) resizeObserver.observe(focusElement);
    }
    return () => {
      target.removeEventListener("focus", reanchorDefault);
      if (fallbackTextarea) {
        fallbackTextarea.removeEventListener("compositionstart", reanchorDefault);
        fallbackTextarea.removeEventListener("compositionupdate", reanchorComposition);
        fallbackTextarea.removeEventListener("input", reanchorWhileComposing);
      }
      window.removeEventListener("resize", reanchorDefault);
      window.removeEventListener("scroll", reanchorDefault, true);
      window.visualViewport?.removeEventListener("resize", reanchorDefault);
      window.visualViewport?.removeEventListener("scroll", reanchorDefault);
      resizeObserver?.disconnect();
    };
  }, [textarea, focusElement, canvas, nativeInputSurface, pushImePosition]);
}
