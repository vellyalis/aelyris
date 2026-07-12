import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import {
  type AuthenticatedPromptConsentPacket,
  deriveAuthenticatedPromptConsentPacket,
  parseAuthenticatedPromptConsentReport,
  parseAuthenticatedPromptPreflightMatrixReport,
} from "../../shared/lib/authenticatedPromptConsent";
import { isTauriRuntime } from "../../shared/lib/tauriRuntime";
import { resolveProjectFilePath } from "../right-rail/rightRailModel";

export function useAuthenticatedPromptEvidence(projectPath: string) {
  const [authenticatedPromptConsentPacket, setAuthenticatedPromptConsentPacket] =
    useState<AuthenticatedPromptConsentPacket>(() => deriveAuthenticatedPromptConsentPacket(null));

  useEffect(() => {
    let active = true;
    if (!projectPath || !isTauriRuntime()) {
      setAuthenticatedPromptConsentPacket(deriveAuthenticatedPromptConsentPacket(null));
      return () => {
        active = false;
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
      void Promise.resolve({ invoke: tauriInvoke })
        .then(({ invoke }) =>
          Promise.allSettled([
            invoke<string>("read_file", { path: consentPath }),
            invoke<string>("read_file", { path: matrixPath }),
          ]),
        )
        .then(([consentResult, matrixResult]) => {
          if (!active) return;
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
          if (active) setAuthenticatedPromptConsentPacket(deriveAuthenticatedPromptConsentPacket(null));
        });
    };
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [projectPath]);

  return authenticatedPromptConsentPacket;
}
