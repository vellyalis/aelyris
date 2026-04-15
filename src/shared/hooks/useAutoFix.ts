import { useCallback, useRef } from "react";
import { useToastStore } from "../store/toastStore";
import type { DetectedError } from "../lib/errorDetector";

interface UseAutoFixOptions {
  onStartAgent: (prompt: string) => Promise<string | undefined>;
  projectPath: string;
  enabled?: boolean;
}

/**
 * Hook that provides auto-fix functionality for detected terminal errors.
 *
 * Flow:
 * 1. Terminal detects an error via errorDetector
 * 2. Toast notification appears with "Auto-fix" action button
 * 3. User clicks the button (or auto-fix triggers if enabled)
 * 4. An AI agent is spawned with a targeted fix prompt
 * 5. Agent makes changes in the current project
 *
 * Future: auto-create worktree for isolation, run tests after fix.
 */
export function useAutoFix({ onStartAgent, projectPath, enabled = false }: UseAutoFixOptions) {
  const cooldownRef = useRef(0);

  const triggerFix = useCallback(async (error: DetectedError) => {
    const now = Date.now();
    // Cooldown: 30 seconds between auto-fix triggers
    if (now - cooldownRef.current < 30_000) return;
    cooldownRef.current = now;

    const prompt = [
      `Fix the following error in ${projectPath}:`,
      "",
      `Error type: ${error.type}`,
      `Message: ${error.message}`,
      "",
      "Instructions:",
      "1. Read the relevant file(s) to understand the context",
      "2. Fix the error with minimal changes",
      "3. Run tests to verify the fix",
    ].join("\n");

    const sessionId = await onStartAgent(prompt);
    if (sessionId) {
      useToastStore.getState().add({
        type: "info",
        title: "Auto-fix started",
        description: `Agent working on: ${error.message.slice(0, 60)}`,
      });
    }
  }, [onStartAgent, projectPath]);

  const handleError = useCallback((error: DetectedError) => {
    if (enabled) {
      // Auto-trigger without user interaction
      triggerFix(error);
    }
    // Manual trigger is handled via toast action button in TerminalArea
  }, [enabled, triggerFix]);

  return { triggerFix, handleError };
}
