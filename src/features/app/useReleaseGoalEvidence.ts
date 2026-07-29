import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { reportInvokeFailure } from "../../shared/lib/fallbackTelemetry";
import { resolveProjectFilePath } from "../../shared/lib/projectArtifacts";
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

interface ReleaseGoalEvidenceState {
  releaseQualityGoalInputs: ReleaseQualityGoalInputs | null;
  finalGoalResidualRisk: FinalGoalResidualRisk | null;
  finalGoalRequirementProofs: FinalGoalRequirementProof[];
  finalGoalSafeGate: FinalGoalSafeGate | null;
}

const EMPTY_EVIDENCE: ReleaseGoalEvidenceState = {
  releaseQualityGoalInputs: deriveReleaseQualityGoalInputs(null),
  finalGoalResidualRisk: deriveFinalGoalResidualRisk(null),
  finalGoalRequirementProofs: deriveFinalGoalRequirementProofs(null),
  finalGoalSafeGate: deriveFinalGoalSafeGate(null),
};

export function useReleaseGoalEvidence(projectPath: string) {
  const [evidence, setEvidence] = useState<ReleaseGoalEvidenceState>(EMPTY_EVIDENCE);

  useEffect(() => {
    let active = true;
    let generation = 0;
    let inFlight = false;
    if (!projectPath || !isTauriRuntime()) {
      setEvidence(EMPTY_EVIDENCE);
      return () => {
        active = false;
        generation += 1;
      };
    }

    const read = (path: string) =>
      Promise.resolve({ invoke: tauriInvoke }).then(({ invoke }) => invoke<string>("read_file", { path }));
    const refresh = () => {
      if (!active || inFlight) return;
      inFlight = true;
      const pollGeneration = ++generation;
      void Promise.allSettled([
        read(resolveProjectFilePath(projectPath, ".codex-auto/quality/release-quality-score.json")),
        read(resolveProjectFilePath(projectPath, ".codex-auto/quality/final-goal-audit.json")),
        read(resolveProjectFilePath(projectPath, ".codex-auto/quality/final-goal-safe-summary.json")),
      ])
        .then(([releaseResult, finalAuditResult, safeGateResult]) => {
          if (!active || pollGeneration !== generation) return;
          if (
            releaseResult.status !== "fulfilled" ||
            finalAuditResult.status !== "fulfilled" ||
            safeGateResult.status !== "fulfilled"
          ) {
            if (releaseResult.status === "rejected") {
              reportInvokeFailure({
                source: "app",
                operation: "read_release_quality_score",
                err: releaseResult.reason,
                severity: "warning",
              });
            }
            if (finalAuditResult.status === "rejected") {
              reportInvokeFailure({
                source: "app",
                operation: "read_final_goal_audit",
                err: finalAuditResult.reason,
                severity: "warning",
              });
            }
            if (safeGateResult.status === "rejected") {
              reportInvokeFailure({
                source: "app",
                operation: "read_final_goal_safe_gate",
                err: safeGateResult.reason,
                severity: "warning",
              });
            }
            setEvidence(EMPTY_EVIDENCE);
            return;
          }

          const releaseReport = parseReleaseQualityReport(releaseResult.value);
          const finalAuditReport = parseFinalGoalAuditReport(finalAuditResult.value);
          const safeGateReport = parseFinalGoalSafeSummaryReport(safeGateResult.value);
          if (!releaseReport || !finalAuditReport || !safeGateReport) {
            setEvidence(EMPTY_EVIDENCE);
            return;
          }

          setEvidence({
            releaseQualityGoalInputs: deriveReleaseQualityGoalInputs(releaseReport),
            finalGoalResidualRisk: deriveFinalGoalResidualRisk(finalAuditReport),
            finalGoalRequirementProofs: deriveFinalGoalRequirementProofs(finalAuditReport),
            finalGoalSafeGate: deriveFinalGoalSafeGate(safeGateReport),
          });
        })
        .catch((err) => {
          if (!active || pollGeneration !== generation) return;
          setEvidence(EMPTY_EVIDENCE);
          reportInvokeFailure({
            source: "app",
            operation: "read_release_goal_evidence",
            err,
            severity: "warning",
          });
        })
        .finally(() => {
          if (pollGeneration === generation) inFlight = false;
        });
    };

    refresh();
    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      generation += 1;
      window.clearInterval(interval);
    };
  }, [projectPath]);

  return evidence;
}
