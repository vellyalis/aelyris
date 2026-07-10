import { describe, expect, it } from "vitest";
import {
  deriveAuthenticatedPromptConsentPacket,
  parseAuthenticatedPromptConsentReport,
  parseAuthenticatedPromptPreflightMatrixReport,
} from "../shared/lib/authenticatedPromptConsent";

describe("authenticated prompt consent packet", () => {
  it("turns the opt-in smoke artifact into a ready no-token consent packet", () => {
    const report = parseAuthenticatedPromptConsentReport(
      JSON.stringify({
        ok: false,
        status: "requires_opt_in",
        provider: "codex",
        wouldSpendTokens: true,
        checks: {
          requiredEnv: "AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini",
          tokenSpendingExecutionBlocked: true,
          safeNoPromptSent: true,
          consentPacketReady: true,
          nonTokenPreflightReady: true,
        },
        nonTokenPreflight: {
          ready: true,
          checks: {
            realProviderBinary: true,
            commandSessionCapability: true,
            interactiveBoundary: true,
            nativeInputHost: true,
            ime: true,
            postLaunchChaos: true,
          },
        },
        nextCommand: {
          command: "pnpm verify:goal:operator:token-smoke",
          env: {
            AELYRIS_AUTH_PROMPT_PROVIDER: "codex",
          },
        },
      }),
    );

    const packet = deriveAuthenticatedPromptConsentPacket(report);

    expect(packet.status).toBe("ready");
    expect(packet.label).toBe("Consent packet ready");
    expect(packet.provider).toBe("codex");
    expect(packet.preflightReady).toBe(true);
    expect(packet.safeNoPromptSent).toBe(true);
    expect(packet.wouldSpendTokens).toBe(true);
    expect(packet.requiredEnv).toBe("AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini");
    expect(packet.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("merges the provider preflight matrix into the consent packet", () => {
    const report = parseAuthenticatedPromptConsentReport(
      JSON.stringify({
        ok: false,
        status: "requires_opt_in",
        provider: "codex",
        wouldSpendTokens: true,
        checks: {
          requiredEnv: "AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini",
          safeNoPromptSent: true,
          consentPacketReady: true,
          nonTokenPreflightReady: true,
        },
        nonTokenPreflight: {
          ready: true,
          checks: {
            realProviderBinary: true,
            commandSessionCapability: true,
            interactiveBoundary: true,
            nativeInputHost: true,
            ime: true,
            postLaunchChaos: true,
          },
        },
      }),
    );
    const matrix = parseAuthenticatedPromptPreflightMatrixReport(
      JSON.stringify({
        ok: true,
        status: "pass",
        checks: {
          allProvidersReady: true,
        },
        providerMatrix: ["codex", "claude", "gemini"].map((provider) => ({
          provider,
          ready: true,
          checks: {
            realProviderBinary: true,
            interactiveBoundary: true,
            launchPlannerProviderReady: true,
            nativeInputHost: true,
            ime: true,
            postLaunchChaos: true,
            promptTokenBlocked: true,
          },
          optInCommand: {
            command: "pnpm verify:goal:operator:token-smoke",
            env: {
              AELYRIS_AUTH_PROMPT_PROVIDER: provider,
            },
          },
        })),
        artifacts: {
          ime: {
            path: ".codex-auto/production-smoke/verify-ime.json",
            exists: true,
            fresh: true,
            ageMs: 1200,
            expiresAt: "2026-05-21T00:00:00.000Z",
            blockingReason: null,
            refreshCommand: "node scripts/verify-ime.mjs",
            refreshReason: "Refreshes the Japanese IME and paste-position proof without running a prompt.",
            costClass: "no-token",
          },
        },
      }),
    );

    const packet = deriveAuthenticatedPromptConsentPacket(report, matrix);

    expect(packet.status).toBe("ready");
    expect(packet.detail).toBe("codex, claude, gemini preflight green · operator wrapper will mint a one-use packet");
    expect(packet.providerReadiness.map((entry) => [entry.provider, entry.status])).toEqual([
      ["codex", "ready"],
      ["claude", "ready"],
      ["gemini", "ready"],
    ]);
    expect(packet.providerReadiness[1]?.requiredEnv).toContain("AELYRIS_AUTH_PROMPT_PROVIDER=claude");
    expect(packet.artifactReadiness).toEqual([
      expect.objectContaining({
        id: "ime",
        fresh: true,
        refreshCommand: "node scripts/verify-ime.mjs",
        costClass: "no-token",
      }),
    ]);
    expect(packet.artifactFreshness).toMatchObject({
      status: "green",
      label: "Proof freshness radar",
      freshCount: 1,
      staleCount: 0,
      totalCount: 1,
      nextRefresh: {
        id: "ime",
        refreshCommand: "node scripts/verify-ime.mjs",
        costClass: "no-token",
        fresh: true,
      },
    });
    expect(packet.artifactFreshness.detail).toContain("All no-token proofs fresh");
  });

  it("keeps a blocked provider matrix visible instead of treating consent as ready", () => {
    const report = parseAuthenticatedPromptConsentReport(
      JSON.stringify({
        ok: false,
        status: "requires_opt_in",
        provider: "codex",
        checks: {
          safeNoPromptSent: true,
          consentPacketReady: true,
          nonTokenPreflightReady: true,
        },
        nonTokenPreflight: {
          ready: true,
          checks: {
            realProviderBinary: true,
            commandSessionCapability: true,
          },
        },
      }),
    );
    const matrix = parseAuthenticatedPromptPreflightMatrixReport(
      JSON.stringify({
        ok: false,
        status: "failed",
        checks: {
          allProvidersReady: false,
        },
        providerMatrix: [
          {
            provider: "gemini",
            ready: false,
            checks: {
              realProviderBinary: true,
              interactiveBoundary: false,
            },
          },
        ],
        artifacts: {
          interactiveAiCliBoundary: {
            path: ".codex-auto/production-smoke/interactive-ai-cli-boundary.json",
            exists: true,
            fresh: false,
            ageMs: 90_000_000,
            expiresAt: "2026-05-20T00:00:00.000Z",
            blockingReason: "stale",
            refreshCommand: "pnpm verify:terminal:ai-cli-boundary",
            refreshReason: "Refreshes the sidecar command-session boundary proof.",
            costClass: "no-token",
          },
          realAiCliBinaryProbe: {
            path: ".codex-auto/production-smoke/real-ai-cli-binary-probe.json",
            exists: true,
            fresh: true,
            ageMs: 120,
            expiresAt: "2026-05-21T00:00:00.000Z",
            blockingReason: null,
            refreshCommand: "pnpm verify:terminal:real-ai-cli",
            refreshReason: "Refreshes the real Codex/Claude/Gemini binary capability probe.",
            costClass: "no-token",
          },
        },
      }),
    );

    const packet = deriveAuthenticatedPromptConsentPacket(report, matrix);

    expect(packet.status).toBe("incomplete");
    expect(packet.preflightReady).toBe(false);
    expect(packet.providerReadiness).toEqual([
      {
        provider: "gemini",
        status: "blocked",
        failedChecks: ["interactiveBoundary"],
        command: "pnpm verify:goal:operator:token-smoke",
        requiredEnv: "",
      },
    ]);
    expect(packet.artifactReadiness[0]).toEqual(
      expect.objectContaining({
        id: "interactiveAiCliBoundary",
        fresh: false,
        blockingReason: "stale",
        refreshCommand: "pnpm verify:terminal:ai-cli-boundary",
      }),
    );
    expect(packet.artifactFreshness).toMatchObject({
      status: "attention",
      label: "Proof freshness needs refresh",
      freshCount: 1,
      staleCount: 1,
      totalCount: 2,
      nextRefresh: {
        id: "interactiveAiCliBoundary",
        refreshCommand: "pnpm verify:terminal:ai-cli-boundary",
        fresh: false,
      },
    });
    expect(packet.artifactReadiness.at(-1)).toEqual(
      expect.objectContaining({
        id: "realAiCliBinaryProbe",
        fresh: true,
      }),
    );
  });

  it("does not hide a missing consent artifact", () => {
    const packet = deriveAuthenticatedPromptConsentPacket(null);

    expect(packet.status).toBe("missing");
    expect(packet.preflightReady).toBe(false);
    expect(packet.safeNoPromptSent).toBe(true);
    expect(packet.detail).toContain("Run pnpm verify:terminal:authenticated-ai-cli-preflight-matrix");
    expect(packet.artifactFreshness).toMatchObject({
      status: "unavailable",
      label: "Proof freshness unavailable",
      totalCount: 0,
      nextRefresh: null,
    });
    expect(packet.artifactFreshness.detail).toBe(
      "Run pnpm verify:terminal:authenticated-ai-cli-preflight-matrix before consent",
    );
    expect(packet.artifactFreshness.detail).not.toContain("authenticated-ai-cli-preflight before consent");
  });

  it("keeps incomplete preflight visible instead of treating consent as ready", () => {
    const report = parseAuthenticatedPromptConsentReport(
      JSON.stringify({
        ok: false,
        status: "requires_opt_in",
        provider: "claude",
        wouldSpendTokens: true,
        checks: {
          safeNoPromptSent: true,
          consentPacketReady: true,
          nonTokenPreflightReady: false,
        },
        nonTokenPreflight: {
          ready: false,
          checks: {
            realProviderBinary: true,
            commandSessionCapability: false,
          },
        },
      }),
    );

    const packet = deriveAuthenticatedPromptConsentPacket(report);

    expect(packet.status).toBe("incomplete");
    expect(packet.preflightReady).toBe(false);
    expect(packet.checks.find((check) => check.id === "command-session")?.status).toBe("fail");
  });

  it("treats a consented but preflight-blocked run as safe and incomplete", () => {
    const report = parseAuthenticatedPromptConsentReport(
      JSON.stringify({
        ok: false,
        status: "preflight_blocked",
        provider: "codex",
        wouldSpendTokens: true,
        checks: {
          consent: true,
          safeNoPromptSent: true,
          consentPacketReady: false,
          nonTokenPreflightReady: false,
          preflightReadyBeforePrompt: false,
        },
        nonTokenPreflight: {
          ready: false,
          checks: {
            realProviderBinary: true,
            commandSessionCapability: true,
            interactiveBoundary: false,
          },
        },
      }),
    );

    const packet = deriveAuthenticatedPromptConsentPacket(report);

    expect(packet.status).toBe("incomplete");
    expect(packet.preflightReady).toBe(false);
    expect(packet.safeNoPromptSent).toBe(true);
    expect(packet.detail).toBe("codex consent preflight needs attention");
  });

  it("treats a consented but provider-missing run as safe and incomplete", () => {
    const report = parseAuthenticatedPromptConsentReport(
      JSON.stringify({
        ok: false,
        status: "provider_required",
        provider: "codex",
        wouldSpendTokens: true,
        checks: {
          consent: true,
          explicitProvider: false,
          tokenSpendingExecutionBlocked: true,
          safeNoPromptSent: true,
          consentPacketReady: false,
          nonTokenPreflightReady: true,
          preflightReadyBeforePrompt: false,
        },
        nonTokenPreflight: {
          ready: true,
          checks: {
            realProviderBinary: true,
            commandSessionCapability: true,
          },
        },
      }),
    );

    const packet = deriveAuthenticatedPromptConsentPacket(report);

    expect(packet.status).toBe("incomplete");
    expect(packet.preflightReady).toBe(true);
    expect(packet.safeNoPromptSent).toBe(true);
    expect(packet.detail).toBe("codex consent preflight needs attention");
  });
});
