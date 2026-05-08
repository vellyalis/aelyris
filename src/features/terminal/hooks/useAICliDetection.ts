import { useCallback, useRef, useState } from "react";

/**
 * Commands whose invocation switches the foreground into a TUI AI CLI.
 * Match is at the start of the echoed command, so e.g. `claude --resume` hits.
 */
const AI_CLI_COMMAND = /^(?:claude|claude-code|codex|gemini|aider|cursor-agent|mentat|goose)\b/i;
const ANSI_ESCAPE = "\\u001b";
const ANSI_CSI_SEQUENCE = new RegExp(`${ANSI_ESCAPE}\\[[0-9;?]*[A-Za-z]`, "g");
const ALT_SCREEN_SEQUENCE = new RegExp(`${ANSI_ESCAPE}\\[\\?(?:1047|1048|1049)[hl]`);
const LEADING_CSI_SEQUENCE = new RegExp(`^${ANSI_ESCAPE}\\[[0-9;?]*[A-Za-z]`);
const AI_CLI_SCREEN_MARKER = /\b(?:Claude Code|Gemini CLI|Codex(?: CLI)?)\b/i;
const AI_CLI_INPUT_MARKER =
  /(?:Type your message|Ask me anything|Message Codex|Send a message|Enter your prompt|What can I help)/i;
const TUI_BOX_MARKER = /[╭╮╰╯│┌┐└┘]/;

/**
 * Prompts that plausibly belong to a host shell and may carry an AI CLI
 * command in the capture group.  Intentionally permissive: we also match
 * generic `$ `, `> `, `❯ ` so Git Bash / WSL second-line prompts are picked
 * up.  Safety against false positives comes from the AI_CLI_COMMAND check
 * *and* the `!inSession` guard — a line like `$ claude` inside a TUI frame
 * is a no-op while we are already in session.
 */
const START_PROMPT: readonly RegExp[] = [
  /^PS [A-Za-z]:\\[^>]*>\s*(.*)$/, // PowerShell
  /^[A-Za-z]:\\[^>]*>\s*(.*)$/, // CMD
  /^[^\s@]+@[^\s]+[:\s][^\s][^#$]*[#$]\s+(.*)$/, // bash/zsh user@host
  /^\$\s+(.*)$/, // bare `$ cmd`   (Git Bash 2-line, simple zsh)
  /^#\s+(.*)$/, // root `# cmd`
  /^[>❯λ➜→]\s+(.*)$/, // chevron / lambda
];

/**
 * Prompts we accept as an unambiguous "we have returned to the host shell"
 * signal.  Strict — we only recognise shapes that cannot plausibly be
 * drawn by an AI TUI (no bare `> ` or `❯ `, because Claude/Codex both use
 * `> ` for their input box and a SIGWINCH redraw would otherwise close
 * the IME bar).  Git Bash users get a small downside here: if their PS1
 * collapses to a bare `$ ` after exiting claude, the session won't auto-
 * close, but the Ctrl+Shift+J toggle still works.
 */
const END_PROMPT: readonly RegExp[] = [
  /^PS [A-Za-z]:\\[^>]*>\s*/, // PowerShell
  /^[A-Za-z]:\\[^>]*>\s*/, // CMD
  /^[^\s@]+@[^\s]+[:\s][^\s][^#$]*[#$]\s+/, // bash/zsh user@host
];

function matchStartCommand(line: string): string | null {
  const trimmed = line.trimStart();
  for (const pattern of START_PROMPT) {
    const m = trimmed.match(pattern);
    if (m) return (m[1] ?? "").trim();
  }
  return null;
}

function matchesEndPrompt(line: string): boolean {
  const trimmed = line.trimStart();
  for (const pattern of END_PROMPT) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

function matchesAiCliScreen(rawText: string, cleanText: string): boolean {
  if (!AI_CLI_SCREEN_MARKER.test(cleanText)) return false;
  return ALT_SCREEN_SEQUENCE.test(rawText) || AI_CLI_INPUT_MARKER.test(cleanText) || TUI_BOX_MARKER.test(cleanText);
}

export interface UseAICliDetection {
  /** True while a known AI CLI is believed to be in the foreground. */
  readonly active: boolean;
  /** Feed a raw PTY output chunk (already UTF-8 decoded). */
  readonly feed: (text: string) => void;
  /** Feed a raw user-input chunk (what xterm.onData delivers). */
  readonly feedInput: (data: string) => void;
  /** Force-reset the detector (e.g. PTY restart). */
  readonly reset: () => void;
}

/**
 * Detects foreground AI CLI invocations by observing PTY output.  ConPTY
 * echoes the user's submitted command on the same line as the prompt, so
 * `PS C:\path> claude` appears as a single line — we match the prompt,
 * capture whatever follows it, and if that starts with a known AI CLI
 * name we declare the session started.
 *
 * Start vs. end use different pattern sets on purpose:
 *
 * - **Start** uses permissive prompt shapes (even `> ` / `❯ ` count) so
 *   we catch unusual PS1 configurations.  The AI_CLI_COMMAND check plus
 *   the `!inSession` guard prevents false positives from TUI frames.
 *
 * - **End** is strict — only PowerShell / CMD / `user@host:…$` shapes
 *   qualify.  A claude/codex repaint (triggered by e.g. pane split → PTY
 *   resize → SIGWINCH) writes `> ` into its own input box, and *must not*
 *   read as a session end or the IME bar would vanish on every resize.
 */
export function useAICliDetection(): UseAICliDetection {
  const [active, setActive] = useState(false);
  const inSessionRef = useRef(false);
  // Accumulates printable chars the user types at the shell.  On Enter we
  // check this buffer against AI_CLI_COMMAND — a far more reliable signal
  // than output parsing on narrow panes, where PSReadLine wraps the prompt
  // across multiple lines with embedded newlines and the "prompt + echoed
  // command" can no longer be matched by a single-line prompt regex.
  const inputBufferRef = useRef("");

  const feed = useCallback((text: string) => {
    if (!text) return;
    // Strip CSI sequences before line splitting so prompt regex anchors work.
    const clean = text.replace(ANSI_CSI_SEQUENCE, "");
    if (!inSessionRef.current && matchesAiCliScreen(text, clean)) {
      inSessionRef.current = true;
      setActive(true);
      return;
    }
    const lines = clean.split(/\r?\n/);
    for (const rawLine of lines) {
      // PSReadLine repaints the current input by writing `\r<prompt><buf>`
      // for every keystroke, so a single logical line between two `\n` bursts
      // may hold a dozen stacked snapshots like
      //   `\rPS C:\> c\rPS C:\> cl\rPS C:\> claude`.
      // Only the substring after the last `\r` reflects the final on-screen
      // state, so that's what we feed to the matchers.  Without this step,
      // the prompt regex's `(.*)` capture eats all the earlier snapshots as
      // "command", and AI_CLI_COMMAND fails because the captured string
      // starts with `\r…` instead of `claude`.
      const line = rawLine.slice(rawLine.lastIndexOf("\r") + 1);
      if (!line.trim()) continue;

      if (!inSessionRef.current) {
        const cmd = matchStartCommand(line);
        if (cmd && AI_CLI_COMMAND.test(cmd)) {
          inSessionRef.current = true;
          setActive(true);
        }
      } else if (matchesEndPrompt(line)) {
        inSessionRef.current = false;
        setActive(false);
      }
    }
  }, []);

  /**
   * Input-side detector — watches user keystrokes and activates when the
   * line the user submits at the shell starts with an AI CLI command.
   * Only relevant when NOT already in a session (AI CLIs eat keystrokes
   * themselves and shouldn't drive our state).
   *
   * Handles the minimal set of line-editing controls so the buffer stays
   * accurate for normal typed invocations:
   *
   *   \r / \n         Enter — commit and evaluate the buffer
   *   \x7f / \b       Backspace — delete last char
   *   \x03            Ctrl-C — abandon the line
   *   \x15            Ctrl-U — clear the line
   *   \x17            Ctrl-W — delete last word (PSReadLine / bash style)
   *   \x1b…           Escape sequences (arrow keys, etc.) — skipped
   *
   * History navigation and tab completion can bypass this tracker — if a
   * user fires up `claude` via `Up+Enter` the input path misses it.  The
   * output-based detector still catches that case when the prompt isn't
   * wrapped.
   */
  const feedInput = useCallback((data: string) => {
    if (inSessionRef.current) return;
    if (!data) return;

    for (let i = 0; i < data.length; i++) {
      const ch = data[i];
      if (ch === "\r" || ch === "\n") {
        const line = inputBufferRef.current.trim();
        inputBufferRef.current = "";
        if (line && AI_CLI_COMMAND.test(line)) {
          inSessionRef.current = true;
          setActive(true);
          return;
        }
      } else if (ch === "\x7f" || ch === "\b") {
        inputBufferRef.current = inputBufferRef.current.slice(0, -1);
      } else if (ch === "\x03" || ch === "\x15") {
        inputBufferRef.current = "";
      } else if (ch === "\x17") {
        // Ctrl-W: delete the last whitespace-separated word.
        const s = inputBufferRef.current.replace(/\s*\S*$/, "");
        inputBufferRef.current = s;
      } else if (ch === "\x1b") {
        // Skip the full escape sequence (CSI: \x1b[...A-Za-z, or 2-char
        // simple: \x1bX).  Arrow keys etc. do not change the buffer.
        const tail = data.slice(i);
        const csiMatch = tail.match(LEADING_CSI_SEQUENCE);
        if (csiMatch) {
          i += csiMatch[0].length - 1;
        } else if (tail.length >= 2) {
          i += 1;
        }
      } else if (ch >= " ") {
        inputBufferRef.current += ch;
      }
    }
  }, []);

  const reset = useCallback(() => {
    inSessionRef.current = false;
    inputBufferRef.current = "";
    setActive(false);
  }, []);

  return { active, feed, feedInput, reset };
}
