import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import {
  type AuthenticatedPromptConsentPacket,
  deriveAuthenticatedPromptConsentPacket,
  parseAuthenticatedPromptConsentReport,
  parseAuthenticatedPromptPreflightMatrixReport,
} from "../../shared/lib/authenticatedPromptConsent";
import { resolveProjectFilePath } from "../../shared/lib/projectArtifacts";
import { isTauriRuntime } from "../../shared/lib/tauriRuntime";

export function useAuthenticatedPromptEvidence(projectPath: string) {
  const [authenticatedPromptConsentPacket, setAuthenticatedPromptConsentPacket] =
    useState<AuthenticatedPromptConsentPacket>(() => deriveAuthenticatedPromptConsentPacket(null));

  useEffect(() => {
    let active = true;
    let generation = 0;
    let inFlight = false;
    if (!projectPath || !isTauriRuntime()) {
      setAuthenticatedPromptConsentPacket(deriveAuthenticatedPromptConsentPacket(null));
      return () => {
        active = false;
        generation += 1;
      };
    }
    const consentPath = resolveProjectFilePath(
      projectPath,
      ".codex-auto/production-smoke/authenticated-ai-cli-prompt-smoke.json",
    );
    const matrixPath = resolveProjectFilePath(
      projectPath,
      ".codex-auto/production-smoke/authenticated-ai-cli-preflight-matrix.json",
    );
    const refresh = () => {
      if (!active || inFlight) return;
      inFlight = true;
      const pollGeneration = ++generation;
      void Promise.resolve({ invoke: tauriInvoke })
        .then(({ invoke }) =>
          Promise.allSettled([
            invoke<string>("read_file", { path: consentPath }),
            invoke<string>("read_file", { path: matrixPath }),
          ]),
        )
        .then(([consentResult, matrixResult]) => {
          if (!active || pollGeneration !== generation) return;
          setAuthenticatedPromptConsentPacket(
            deriveAuthenticatedPromptConsentPacket(
              parseAuthenticatedPromptConsentReport(consentResult.status === "fulfilled" ? consentResult.value : ""),
              parseAuthenticatedPromptPreflightMatrixReport(
                matrixResult.status === "fulfilled" ? matrixResult.value : "",
              ),
            ),
          );
        })
        .catch(() => {
          if (active && pollGeneration === generation) {
            setAuthenticatedPromptConsentPacket(deriveAuthenticatedPromptConsentPacket(null));
          }
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

  return authenticatedPromptConsentPacket;
}
