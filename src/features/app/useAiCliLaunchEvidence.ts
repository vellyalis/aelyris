import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import type { AiCliLaunchPreflightEvidence, AiCliProbeEvidence } from "../../shared/lib/aiCliLaunchPlanner";
import { reportInvokeFailure } from "../../shared/lib/fallbackTelemetry";
import { isTauriRuntime } from "../../shared/lib/tauriRuntime";
import {
  parseJsonArtifact,
  resolveProjectFilePath,
  type RightRailAiCliLaunchEvidenceState,
} from "../right-rail/rightRailModel";

const EMPTY_EVIDENCE: RightRailAiCliLaunchEvidenceState = { evidence: null, preflight: null };

export function useAiCliLaunchEvidence(projectPath: string) {
  const [launchEvidence, setLaunchEvidence] = useState<RightRailAiCliLaunchEvidenceState>(EMPTY_EVIDENCE);

  useEffect(() => {
    let active = true;
    if (!projectPath || !isTauriRuntime()) {
      setLaunchEvidence(EMPTY_EVIDENCE);
      return () => {
        active = false;
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
      void Promise.resolve({ invoke: tauriInvoke })
        .then(({ invoke }) => Promise.allSettled(paths.map((path) => invoke<string>("read_file", { path }))))
        .then(([probe, nativeInput, imeResult, reconnect, mux, boundary]) => {
          if (!active) return;
          const parsed = <T,>(result: PromiseSettledResult<string>) =>
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
          if (!active) return;
          setLaunchEvidence(EMPTY_EVIDENCE);
          reportInvokeFailure({ source: "app", operation: "read_ai_cli_launch_evidence", err, severity: "warning" });
        });
    };
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [projectPath]);

  return launchEvidence;
}
