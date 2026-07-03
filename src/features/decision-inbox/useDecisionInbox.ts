import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentFleetSession } from "../../shared/lib/agentFleet";
import {
  buildDecisionInbox,
  type DecisionWorkflowStatus,
  type HumanDecisionItem,
} from "../../shared/lib/decisionInbox";
import { reportInvokeFailure } from "../../shared/lib/fallbackTelemetry";
import { isTauriRuntime } from "../../shared/lib/tauriRuntime";
import { toast } from "../../shared/store/toastStore";
import type { AuditEventRecord } from "../../shared/types/audit";
import type { RightRailRouteConfirmation } from "../right-rail/rightRailModel";

type ShowRightRailRouteConfirmation = (confirmation: Omit<RightRailRouteConfirmation, "createdAt">) => void;

interface UseDecisionInboxOptions {
  projectPath: string;
  rightRailSessions: AgentFleetSession[];
  scopedOperationalAuditEvents: AuditEventRecord[];
  rightRailUsesFixtures: boolean;
  refreshAgentFleet: () => Promise<void>;
  showRightRailRouteConfirmation: ShowRightRailRouteConfirmation;
}

export function useDecisionInbox({
  projectPath,
  rightRailSessions,
  scopedOperationalAuditEvents,
  rightRailUsesFixtures,
  refreshAgentFleet,
  showRightRailRouteConfirmation,
}: UseDecisionInboxOptions) {
  const [workflowStatuses, setWorkflowStatuses] = useState<DecisionWorkflowStatus[]>([]);

  useEffect(() => {
    let active = true;
    if (!projectPath || !isTauriRuntime()) {
      setWorkflowStatuses([]);
      return () => {
        active = false;
      };
    }

    const refresh = () => {
      Promise.resolve({ invoke: tauriInvoke })
        .then(({ invoke }) => invoke<DecisionWorkflowStatus[]>("list_running_workflows", { projectPath }))
        .then((statuses) => {
          if (active) setWorkflowStatuses(statuses);
        })
        .catch((err) => {
          if (!active) return;
          reportInvokeFailure({
            source: "app",
            operation: "list_running_workflows",
            err,
            severity: "warning",
          });
        });
    };

    refresh();
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [projectPath]);

  const decisionInbox = useMemo(
    () =>
      buildDecisionInbox({
        sessions: rightRailSessions,
        auditEvents: scopedOperationalAuditEvents,
        workflows: workflowStatuses,
      }),
    [rightRailSessions, scopedOperationalAuditEvents, workflowStatuses],
  );

  // Resolve a waiting interactive agent gate from the Decision Inbox. Only a
  // confirmed Claude selectable MENU carries a captured prompt, prompt key, and
  // ptyId. The backend re-checks that same prompt key before writing the menu
  // keystroke through the P0-4 gate (approve = option 1, deny = Esc) and audits
  // it. We do NOT clear the item: it leaves the inbox when the agent re-emits
  // its run status.
  const handleDecideDecision = useCallback(
    async (item: HumanDecisionItem, decision: "approve" | "deny") => {
      if (rightRailUsesFixtures) {
        showRightRailRouteConfirmation({
          widget: "decision-inbox",
          title: decision === "approve" ? "Approval preview" : "Denial preview",
          detail: "Fixture session — no live agent to signal.",
        });
        return;
      }
      const ptyId = item.ptyId;
      if (!ptyId) {
        toast.error("No live agent pane", "This decision has no addressable agent terminal.");
        return;
      }
      try {
        await tauriInvoke("resolve_interactive_approval", {
          terminalId: ptyId,
          decision,
          expectedPromptKey: item.approvalPromptKey,
        });
        showRightRailRouteConfirmation({
          widget: "decision-inbox",
          title: decision === "approve" ? "Approval sent" : "Denial sent",
          detail: item.title,
        });
      } catch (err) {
        const message = String(err);
        if (message.includes("stale_approval")) {
          toast.error("Approval changed", "The agent prompt changed before this decision was delivered.");
          await refreshAgentFleet();
          throw err;
        }
        toast.error("Decision delivery failed", message);
        // Re-throw so the inbox row re-enables its buttons for a retry instead
        // of latching on a delivery that never reached the agent.
        throw err;
      }
    },
    [refreshAgentFleet, rightRailUsesFixtures, showRightRailRouteConfirmation],
  );

  return {
    decisionInbox,
    handleDecideDecision,
    workflowStatuses,
  };
}
