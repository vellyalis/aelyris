import { type Dispatch, type SetStateAction, useEffect, useRef } from "react";
import {
  loadRightRailEdgeFeedbackHistory,
  rightRailEdgeFeedbackStorageKey,
  saveRightRailEdgeFeedbackHistory,
} from "./rightRailModel";
import type { RightRailEdgeScoreFeedbackEntry } from "./rightRailTypes";

export function useRightRailFeedbackPersistence(
  projectPath: string,
  history: RightRailEdgeScoreFeedbackEntry[],
  setHistory: Dispatch<SetStateAction<RightRailEdgeScoreFeedbackEntry[]>>,
): void {
  const hydratedKeyRef = useRef<string | null>(null);
  const skipSaveKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const key = rightRailEdgeFeedbackStorageKey(projectPath);
    hydratedKeyRef.current = key;
    skipSaveKeyRef.current = key;
    setHistory(loadRightRailEdgeFeedbackHistory(projectPath));
  }, [projectPath, setHistory]);

  useEffect(() => {
    const key = rightRailEdgeFeedbackStorageKey(projectPath);
    if (!key || hydratedKeyRef.current !== key) return;
    if (skipSaveKeyRef.current === key) {
      skipSaveKeyRef.current = null;
      return;
    }
    saveRightRailEdgeFeedbackHistory(projectPath, history);
  }, [history, projectPath]);
}
