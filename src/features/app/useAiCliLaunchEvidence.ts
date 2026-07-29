import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import type { AiCliLaunchPreflightEvidence, AiCliProbeEvidence } from "../../shared/lib/aiCliLaunchPlanner";
import { reportInvokeFailure } from "../../shared/lib/fallbackTelemetry";
import { parseJsonArtifact, resolveProjectFilePath } from "../../shared/lib/projectArtifacts";
import { isTauriRuntime } from "../../shared/lib/tauriRuntime";
import type { RightRailAiCliLaunchEvidenceState } from "../right-rail/rightRailTypes";

const EMPTY_EVIDENCE: RightRailAiCliLaunchEvidenceState = { evidence: null, preflight: null };

export function useAiCliLaunchEvidence(projectPath: string) {
  const [launchEvidence, setLaunchEvidence] = useState<RightRailAiCliLaunchEvidenceState>(EMPTY_EVIDENCE);

  useEffect(() => {
    let active = true;
    let generation = 0;
    let inFlight = false;
    if (!projectPath || !isTauriRuntime()) {
      setLaunchEvidence(EMPTY_EVIDENCE);
      return () => {
        active = false;
        generation += 1;
      };
    }
    const paths = [
      ".codex-auto/production-smoke/real-ai-cli-binary-probe.json",
      ".codex-auto/production-smoke/native-terminal-input-host.json",
      ".codex-auto/production-smoke/verify-ime.json",
      ".codex-auto/production-smoke/process-reconnect-command-evidence.json",
      ".codex-auto/quality/mux-live-process-preservation.json",
      ".codex-auto/production-smoke/interactive-ai-cli-boundary.json",
    ].map((path) => resolveProjectFilePath(projectPath, path));
    const refresh = () => {
      if (!active || inFlight) return;
      inFlight = true;
      const pollGeneration = ++generation;
      void Promise.resolve({ invoke: tauriInvoke })
        .then(({ invoke }) => Promise.allSettled(paths.map((path) => invoke<string>("read_file", { path }))))
        .then(([probe, nativeInput, imeResult, reconnect, mux, boundary]) => {
          if (!active || pollGeneration !== generation) return;
          const parsed = <T>(result: PromiseSettledResult<string>) =>
            result.status === "fulfilled" ? parseJsonArtifact<T>(result.value) : null;
          const evidence = parsed<AiCliProbeEvidence>(probe);
          const nativeInputHost = parsed<NonNullable<AiCliLaunchPreflightEvidence["nativeInputHost"]>>(nativeInput);
          const ime = parsed<NonNullable<AiCliLaunchPreflightEvidence["ime"]>>(imeResult);
          const processReconnect = parsed<NonNullable<AiCliLaunchPreflightEvidence["processReconnect"]>>(reconnect);
          const muxLiveProcessPreservation =
            parsed<NonNullable<AiCliLaunchPreflightEvidence["muxLiveProcessPreservation"]>>(mux);
          const interactiveBoundary =
            parsed<NonNullable<AiCliLaunchPreflightEvidence["interactiveBoundary"]>>(boundary);
          const preflight =
            nativeInputHost || ime || processReconnect || muxLiveProcessPreservation || interactiveBoundary
              ? { nativeInputHost, ime, processReconnect, muxLiveProcessPreservation, interactiveBoundary }
              : null;
          setLaunchEvidence({ evidence, preflight });
        })
        .catch((err) => {
          if (!active || pollGeneration !== generation) return;
          setLaunchEvidence(EMPTY_EVIDENCE);
          reportInvokeFailure({ source: "app", operation: "read_ai_cli_launch_evidence", err, severity: "warning" });
        })
        .finally(() => {
          if (pollGeneration === generation) inFlight = false;
        });
    };
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      generation += 1;
      window.clearInterval(interval);
    };
  }, [projectPath]);

  return launchEvidence;
}
