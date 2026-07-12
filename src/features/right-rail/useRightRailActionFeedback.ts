import { useCallback, useEffect, useRef, useState } from "react";
import type { RightRailAction } from "../../shared/lib/rightRailAdvisor";
import type { AuditJournalEventRecord } from "../../shared/types/audit";
import {
  createRightRailActionResult,
  createRightRailDestinationResult,
  RIGHT_RAIL_ACTION_HISTORY_LIMIT,
  type RightRailActionResult,
  type RightRailActionResultTone,
  type RightRailRouteConfirmation,
  type RightRailWidgetId,
} from "./rightRailModel";

export function useRightRailActionFeedback() {
  const [rightRailRouteConfirmation, setRightRailRouteConfirmation] = useState<RightRailRouteConfirmation | null>(null);
  const [rightRailActionResult, setRightRailActionResult] = useState<RightRailActionResult | null>(null);
  const [rightRailActionHistory, setRightRailActionHistory] = useState<RightRailActionResult[]>([]);
  const actionResultTimerRef = useRef<number | null>(null);
  const routeConfirmationTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (actionResultTimerRef.current != null) window.clearTimeout(actionResultTimerRef.current);
    if (routeConfirmationTimerRef.current != null) window.clearTimeout(routeConfirmationTimerRef.current);
  }, []);

  const showRightRailActionResult = useCallback((
    action: RightRailAction,
    tone: RightRailActionResultTone,
    detail: string,
    auditRecord: AuditJournalEventRecord | null = null,
  ) => {
    if (actionResultTimerRef.current != null) window.clearTimeout(actionResultTimerRef.current);
    const result = createRightRailActionResult(action, tone, detail, auditRecord);
    setRightRailActionResult(result);
    setRightRailActionHistory((history) => [result, ...history].slice(0, RIGHT_RAIL_ACTION_HISTORY_LIMIT));
    actionResultTimerRef.current = window.setTimeout(() => {
      setRightRailActionResult(null);
      actionResultTimerRef.current = null;
    }, 6_500);
  }, []);

  const showRightRailDestinationOutcome = useCallback((outcome: {
    label: string;
    detail: string;
    tone: RightRailActionResultTone;
    auditEventId?: number | null;
    auditCorrelationId?: string | null;
    routeWidget?: RightRailWidgetId | null;
    routeLabel?: string | null;
    routeDetail?: string | null;
  }) => {
    if (actionResultTimerRef.current != null) window.clearTimeout(actionResultTimerRef.current);
    const result = createRightRailDestinationResult(outcome);
    setRightRailActionResult(result);
    setRightRailActionHistory((history) => [result, ...history].slice(0, RIGHT_RAIL_ACTION_HISTORY_LIMIT));
    actionResultTimerRef.current = window.setTimeout(() => {
      setRightRailActionResult(null);
      actionResultTimerRef.current = null;
    }, 6_500);
  }, []);

  const showRightRailRouteConfirmation = useCallback((confirmation: Omit<RightRailRouteConfirmation, "createdAt">) => {
    if (routeConfirmationTimerRef.current != null) window.clearTimeout(routeConfirmationTimerRef.current);
    setRightRailRouteConfirmation({ ...confirmation, createdAt: Date.now() });
    routeConfirmationTimerRef.current = window.setTimeout(() => {
      setRightRailRouteConfirmation(null);
      routeConfirmationTimerRef.current = null;
    }, 5_500);
  }, []);

  return {
    rightRailActionHistory,
    rightRailActionResult,
    rightRailRouteConfirmation,
    showRightRailActionResult,
    showRightRailDestinationOutcome,
    showRightRailRouteConfirmation,
  };
}
