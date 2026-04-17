import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Phase 3A-2 — mirror each keystroke into a local buffer so the UI can
 * query the fish-style suggest engine for a continuation, and accept it
 * on Tab.
 *
 * This hook only tracks buffer state — it does NOT send anything to the
 * PTY. The normal `useTerminalCanvasInput` listener still handles that
 * on the same element. We attach in the capture phase so Tab-with-
 * suggestion can stopPropagation before the default `\t` is written.
 *
 * Buffer lifecycle (when `enabled`):
 *   - printable char  → append
 *   - Backspace       → drop last char
 *   - Enter (`\r`)    → commit + clear (fires `onCommit`)
 *   - Arrows / Esc /
 *     Ctrl+C / Ctrl+D → clear (abandon prediction)
 *   - Tab w/ suggestion → accept: call onAccept(suggestion), extend buffer,
 *                         preventDefault so no `\t` reaches the shell
 *   - Ctrl+Shift+*    → ignored (app shortcuts; app layer handles them)
 *   - IME composing   → ignored (don't corrupt partial input)
 *
 * Limitations (documented for follow-ups):
 *   - Single-line only. Backslash-continuation / heredocs not tracked.
 *   - PTY echo drift isn't reconciled — if the shell silently eats a char
 *     (e.g. password prompt), the buffer will be ahead of the real input.
 *     Enter resets everything so the worst case is one stale suggestion.
 *   - Paste events aren't mirrored (Ctrl+V → PTY bracketed paste). That
 *     string is effectively invisible to the suggester, which is fine —
 *     large paste is usually not a prefix you want completed.
 */
export interface UseInputMirrorArgs {
  element: HTMLElement | null;
  enabled: boolean;
  /** Current remaining-suffix suggestion, or null when nothing to offer. */
  suggestion: string | null;
  /** Fires when the user accepts `suggestion` — write it to the PTY. */
  onAccept: (suffix: string) => void;
  /** Fires when Enter is pressed with a non-empty buffer. */
  onCommit?: (command: string) => void;
}

export interface UseInputMirrorResult {
  buffer: string;
  /** Manually clear the buffer (e.g. when the user focuses another pane). */
  reset: () => void;
}

export function useInputMirror({
  element,
  enabled,
  suggestion,
  onAccept,
  onCommit,
}: UseInputMirrorArgs): UseInputMirrorResult {
  const [buffer, setBuffer] = useState("");

  const suggestionRef = useRef<string | null>(suggestion);
  suggestionRef.current = suggestion;
  const onAcceptRef = useRef(onAccept);
  onAcceptRef.current = onAccept;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const reset = useCallback(() => setBuffer(""), []);

  // Clear whenever we flip to disabled so the buffer can't leak stale
  // keystrokes into the next enabled window.
  useEffect(() => {
    if (!enabled) setBuffer("");
  }, [enabled]);

  useEffect(() => {
    if (!element) return;

    const handler = (ev: KeyboardEvent) => {
      if (!enabledRef.current) return;
      if (ev.isComposing || ev.keyCode === 229) return;
      if (ev.metaKey) return;
      // App shortcuts (palette, splits, IME bar, search) bubble to window —
      // don't touch the buffer. Tab is the one shift-escape we care about,
      // but Ctrl+Shift+Tab still belongs to the app.
      if (ev.ctrlKey && ev.shiftKey) return;

      // Tab accept — only meaningful when we actually have a suggestion.
      if (ev.key === "Tab" && !ev.shiftKey && !ev.altKey && !ev.ctrlKey) {
        const sug = suggestionRef.current;
        if (sug && sug.length > 0) {
          ev.preventDefault();
          ev.stopPropagation();
          onAcceptRef.current(sug);
          setBuffer((b) => b + sug);
          return;
        }
        // No suggestion → let the default `\t` keystroke pass through.
        return;
      }

      // Ctrl+Space accept (same as Tab, used by users who map Tab elsewhere).
      if (ev.ctrlKey && !ev.altKey && ev.key === " ") {
        const sug = suggestionRef.current;
        if (sug && sug.length > 0) {
          ev.preventDefault();
          ev.stopPropagation();
          onAcceptRef.current(sug);
          setBuffer((b) => b + sug);
          return;
        }
        return;
      }

      if (ev.key === "Enter") {
        setBuffer((b) => {
          const trimmed = b.trim();
          if (trimmed) onCommitRef.current?.(trimmed);
          return "";
        });
        return;
      }

      if (ev.key === "Backspace") {
        setBuffer((b) => b.slice(0, -1));
        return;
      }

      if (
        ev.key === "Escape" ||
        ev.key === "ArrowUp" ||
        ev.key === "ArrowDown" ||
        ev.key === "ArrowLeft" ||
        ev.key === "ArrowRight" ||
        ev.key === "Home" ||
        ev.key === "End"
      ) {
        setBuffer("");
        return;
      }

      if (ev.ctrlKey && !ev.altKey) {
        // Ctrl+C / Ctrl+D / Ctrl+U / Ctrl+W — all abandon the in-flight
        // command one way or another. Clear to stay safe.
        if (ev.key === "c" || ev.key === "d" || ev.key === "u" || ev.key === "w") {
          setBuffer("");
        }
        // Any other Ctrl combo: ignore (not a visible glyph).
        return;
      }

      if (ev.altKey) return;

      // Printable glyph (single code point).
      if (ev.key.length === 1) {
        const ch = ev.key;
        setBuffer((b) => b + ch);
      }
    };

    element.addEventListener("keydown", handler, true);
    return () => element.removeEventListener("keydown", handler, true);
  }, [element]);

  return { buffer, reset };
}
