import { useCallback, useRef, useState } from "react";

/**
 * Commands whose invocation switches the foreground into a TUI AI CLI.
 * Match is at the start of the echoed command, so e.g. `claude --resume` hits.
 */
const AI_CLI_COMMAND = /^(?:claude|claude-code|codex|gemini|aider|cursor-agent|mentat|goose)\b/i;

/**
 * Prompts that plausibly belong to a host shell and may carry an AI CLI
 * command in the capture group.  Intentionally permissive: we also match
 * generic `$ `, `> `, `❯ ` so Git Bash / WSL second-line prompts are picked
 * up.  Safety against false positives comes from the AI_CLI_COMMAND check
 * *and* the `!inSession` guard — a line like `$ claude` inside a TUI frame
 * is a no-op while we are already in session.
 */
const START_PROMPT: readonly RegExp[] = [
  /^PS [A-Za-z]:\\[^>]*>\s*(.*)$/,                  // PowerShell
  /^[A-Za-z]:\\[^>]*>\s*(.*)$/,                      // CMD
  /^[^\s@]+@[^\s]+[:\s][^\s][^#$]*[#$]\s+(.*)$/,    // bash/zsh user@host
  /^\$\s+(.*)$/,                                     // bare `$ cmd`   (Git Bash 2-line, simple zsh)
  /^#\s+(.*)$/,                                      // root `# cmd`
  /^[>❯λ➜→]\s+(.*)$/,                               // chevron / lambda
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
  /^PS [A-Za-z]:\\[^>]*>\s*/,                        // PowerShell
  /^[A-Za-z]:\\[^>]*>\s*/,                            // CMD
  /^[^\s@]+@[^\s]+[:\s][^\s][^#$]*[#$]\s+/,          // bash/zsh user@host
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

export interface UseAICliDetection {
  /** True while a known AI CLI is believed to be in the foreground. */
  readonly active: boolean;
  /** Feed a raw PTY output chunk (already UTF-8 decoded). */
  readonly feed: (text: string) => void;
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

  const feed = useCallback((text: string) => {
    if (!text) return;
    // Strip CSI sequences before line splitting so prompt regex anchors work.
    const clean = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
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

  const reset = useCallback(() => {
    inSessionRef.current = false;
    setActive(false);
  }, []);

  return { active, feed, reset };
}
