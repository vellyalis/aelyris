import { useCallback, useRef, useState } from "react";
import { detectPrompt } from "../commandBlock";

/**
 * Commands whose invocation switches the foreground into a TUI AI CLI.
 * Match is at the start of the echoed command, so e.g. `claude --resume` hits.
 */
const AI_CLI_COMMAND = /^(?:claude|claude-code|codex|gemini|aider|cursor-agent|mentat|goose)\b/i;

export interface UseAICliDetection {
  /** True while a known AI CLI is believed to be in the foreground. */
  readonly active: boolean;
  /** Feed a raw PTY output chunk (already UTF-8 decoded). */
  readonly feed: (text: string) => void;
  /** Force-reset the detector (e.g. PTY restart). */
  readonly reset: () => void;
}

/**
 * Detects foreground AI CLI invocations by observing shell-prompt lines in
 * PTY output.  ConPTY echoes the user's submitted command back on the same
 * line as the prompt, so `PS C:\path> claude` appears as a single line — we
 * parse it with `detectPrompt` and check whether the command starts with a
 * known AI CLI name.
 *
 * A session starts when such a line arrives while we are not in one, and
 * ends when a subsequent shell prompt appears without an AI CLI command
 * (i.e. the user is back at the shell).  We intentionally do not sniff
 * banner strings — they vary by version, locale, and colour mode, and
 * anchoring on the shell prompt is both cheaper and more stable.
 */
export function useAICliDetection(): UseAICliDetection {
  const [active, setActive] = useState(false);
  const inSessionRef = useRef(false);

  const feed = useCallback((text: string) => {
    if (!text) return;
    // Strip CSI sequences before line splitting so prompt regex anchors work.
    const clean = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
    const lines = clean.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      const prompt = detectPrompt(line);
      if (!prompt) continue;

      const isAI = AI_CLI_COMMAND.test(prompt.command);
      if (!inSessionRef.current && isAI) {
        inSessionRef.current = true;
        setActive(true);
      } else if (inSessionRef.current && !isAI) {
        // Any shell prompt without an AI CLI command means we exited the
        // AI session (user typed Ctrl+C, /exit, or the CLI finished).
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
