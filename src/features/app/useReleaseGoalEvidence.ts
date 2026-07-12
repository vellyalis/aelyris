import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { resolveProjectFilePath } from "../right-rail/rightRailModel";
import { reportInvokeFailure } from "../../shared/lib/fallbackTelemetry";
import {
  deriveFinalGoalRequirementProofs,
  deriveFinalGoalResidualRisk,
  deriveFinalGoalSafeGate,
  deriveReleaseQualityGoalInputs,
  type FinalGoalRequirementProof,
  type FinalGoalResidualRisk,
  type FinalGoalSafeGate,
  parseFinalGoalAuditReport,
  parseFinalGoalSafeSummaryReport,
  parseReleaseQualityReport,
  type ReleaseQualityGoalInputs,
} from "../../shared/lib/releaseQuality";
import { isTauriRuntime } from "../../shared/lib/tauriRuntime";

const REFRESH_INTERVAL_MS = 60_000;

export function useReleaseGoalEvidence(projectPath: string) {
  const [releaseQualityGoalInputs, setReleaseQualityGoalInputs] = useState<ReleaseQualityGoalInputs | null>(null);
  const [finalGoalResidualRisk, setFinalGoalResidualRisk] = useState<FinalGoalResidualRisk | null>(null);
  const [finalGoalRequirementProofs, setFinalGoalRequirementProofs] = useState<FinalGoalRequirementProof[]>([]);
  const [finalGoalSafeGate, setFinalGoalSafeGate] = useState<FinalGoalSafeGate | null>(null);

  useEffect(() => {
    let active = true;
    if (!projectPath || !isTauriRuntime()) {
      setReleaseQualityGoalInputs(null);
      setFinalGoalResidualRisk(null);
      setFinalGoalRequirementProofs([]);
      setFinalGoalSafeGate(null);
      return () => {
        active = false;
      };
    }

    const read = (path: string) => Promise.resolve({ invoke: tauriInvoke }).then(({ invoke }) =>
      invoke<string>("read_file", { path }),
    );
    const refresh = () => {
      void read(resolveProjectFilePath(projectPath, ".codex-auto/quality/release-quality-score.json"))
        .then((text) => {
          if (active) setReleaseQualityGoalInputs(deriveReleaseQualityGoalInputs(parseReleaseQualityReport(text)));
        })
        .catch((err) => {
          if (!active) return;
          setReleaseQualityGoalInputs(deriveReleaseQualityGoalInputs(null));
          reportInvokeFailure({ source: "app", operation: "read_release_quality_score", err, severity: "warning" });
        });
      void read(resolveProjectFilePath(projectPath, ".codex-auto/quality/final-goal-audit.json"))
        .then((text) => {
          if (!active) return;
          const report = parseFinalGoalAuditReport(text);
          setFinalGoalResidualRisk(deriveFinalGoalResidualRisk(report));
          setFinalGoalRequirementProofs(deriveFinalGoalRequirementProofs(report));
        })
        .catch((err) => {
          if (!active) return;
          setFinalGoalResidualRisk(deriveFinalGoalResidualRisk(null));
          setFinalGoalRequirementProofs(deriveFinalGoalRequirementProofs(null));
          reportInvokeFailure({ source: "app", operation: "read_final_goal_audit", err, severity: "warning" });
        });
      void read(resolveProjectFilePath(projectPath, ".codex-auto/quality/final-goal-safe-summary.json"))
        .then((text) => {
          if (active) setFinalGoalSafeGate(deriveFinalGoalSafeGate(parseFinalGoalSafeSummaryReport(text)));
        })
        .catch((err) => {
          if (!active) return;
          setFinalGoalSafeGate(deriveFinalGoalSafeGate(null));
          reportInvokeFailure({ source: "app", operation: "read_final_goal_safe_gate", err, severity: "warning" });
        });
    };

    refresh();
    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [projectPath]);

  return { finalGoalRequirementProofs, finalGoalResidualRisk, finalGoalSafeGate, releaseQualityGoalInputs };
}
