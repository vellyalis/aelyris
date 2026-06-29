export type AuthenticatedPromptConsentStatus = "ready" | "missing" | "incomplete" | "pass" | "failed";

const AUTHENTICATED_PROMPT_PREFLIGHT_MATRIX_COMMAND = "pnpm verify:terminal:authenticated-ai-cli-preflight-matrix";

export interface AuthenticatedPromptConsentCheck {
  id: string;
  label: string;
  status: "pass" | "fail" | "unknown";
}

export interface AuthenticatedPromptProviderReadiness {
  provider: string;
  status: "ready" | "blocked";
  failedChecks: string[];
  command: string;
  requiredEnv: string;
}

export interface AuthenticatedPromptPreflightArtifactReadiness {
  id: string;
  path: string;
  exists: boolean;
  fresh: boolean;
  ageMs: number | null;
  expiresAt: string;
  blockingReason: string;
  refreshCommand: string;
  refreshReason: string;
  costClass: string;
}

export interface AuthenticatedPromptArtifactFreshnessTarget {
  id: string;
  path: string;
  expiresAt: string;
  refreshCommand: string;
  refreshReason: string;
  costClass: string;
  fresh: boolean;
}

export interface AuthenticatedPromptArtifactFreshnessRadar {
  status: "green" | "attention" | "unavailable";
  label: string;
  detail: string;
  freshCount: number;
  staleCount: number;
  totalCount: number;
  nextRefresh: AuthenticatedPromptArtifactFreshnessTarget | null;
}

export interface AuthenticatedPromptConsentPacket {
  status: AuthenticatedPromptConsentStatus;
  label: string;
  detail: string;
  provider: string;
  command: string;
  requiredEnv: string;
  preflightReady: boolean;
  safeNoPromptSent: boolean;
  wouldSpendTokens: boolean;
  checks: AuthenticatedPromptConsentCheck[];
  providerReadiness: AuthenticatedPromptProviderReadiness[];
  artifactReadiness: AuthenticatedPromptPreflightArtifactReadiness[];
  artifactFreshness: AuthenticatedPromptArtifactFreshnessRadar;
}

interface AuthenticatedPromptSmokeReport {
  ok?: boolean;
  status?: string;
  provider?: string;
  wouldSpendTokens?: boolean;
  checks?: Record<string, unknown>;
  nextCommand?: {
    command?: string;
    env?: Record<string, unknown>;
  };
  nonTokenPreflight?: {
    ready?: boolean;
    checks?: Record<string, unknown>;
  };
}

interface AuthenticatedPromptProviderMatrixEntry {
  provider: string;
  ready: boolean;
  checks: Record<string, unknown>;
  optInCommand?: {
    command?: string;
    env?: Record<string, unknown>;
  };
}

interface AuthenticatedPromptPreflightMatrixReport {
  ok?: boolean;
  status?: string;
  providers?: string[];
  checks?: Record<string, unknown>;
  providerMatrix?: AuthenticatedPromptProviderMatrixEntry[];
  artifactReadiness?: AuthenticatedPromptPreflightArtifactReadiness[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bool(value: unknown): boolean {
  return value === true;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function check(id: string, label: string, value: unknown): AuthenticatedPromptConsentCheck {
  return {
    id,
    label,
    status: value === true ? "pass" : value === false ? "fail" : "unknown",
  };
}

function envPhrase(env: Record<string, unknown> | undefined): string {
  if (!env) return "";
  return Object.entries(env)
    .map(([key, value]) => `${key}=${text(value)}`)
    .filter((value) => !value.endsWith("="))
    .join(" ");
}

function providerListLabel(providers: readonly AuthenticatedPromptProviderReadiness[], fallback: string): string {
  const ready = providers.filter((entry) => entry.status === "ready").map((entry) => entry.provider);
  if (ready.length > 0) return ready.join(", ");
  return fallback;
}

function parseProviderMatrixEntry(value: unknown): AuthenticatedPromptProviderMatrixEntry | null {
  if (!isRecord(value)) return null;
  const provider = text(value.provider);
  if (!provider) return null;
  const optInCommand = isRecord(value.optInCommand)
    ? {
        command: text(value.optInCommand.command),
        env: isRecord(value.optInCommand.env) ? value.optInCommand.env : {},
      }
    : undefined;
  return {
    provider,
    ready: value.ready === true,
    checks: isRecord(value.checks) ? value.checks : {},
    optInCommand,
  };
}

function parseArtifactReadinessEntry(id: string, value: unknown): AuthenticatedPromptPreflightArtifactReadiness | null {
  if (!isRecord(value)) return null;
  return {
    id,
    path: text(value.path),
    exists: bool(value.exists),
    fresh: bool(value.fresh),
    ageMs: typeof value.ageMs === "number" && Number.isFinite(value.ageMs) ? value.ageMs : null,
    expiresAt: text(value.expiresAt),
    blockingReason: text(value.blockingReason),
    refreshCommand: text(value.refreshCommand),
    refreshReason: text(value.refreshReason),
    costClass: text(value.costClass),
  };
}

export function parseAuthenticatedPromptConsentReport(textValue: string): AuthenticatedPromptSmokeReport | null {
  try {
    const parsed: unknown = JSON.parse(textValue);
    if (!isRecord(parsed)) return null;
    const checks = isRecord(parsed.checks) ? parsed.checks : {};
    const nextCommand = isRecord(parsed.nextCommand)
      ? {
          command: text(parsed.nextCommand.command),
          env: isRecord(parsed.nextCommand.env) ? parsed.nextCommand.env : {},
        }
      : undefined;
    const nonTokenPreflight = isRecord(parsed.nonTokenPreflight)
      ? {
          ready: bool(parsed.nonTokenPreflight.ready),
          checks: isRecord(parsed.nonTokenPreflight.checks) ? parsed.nonTokenPreflight.checks : {},
        }
      : undefined;
    return {
      ok: bool(parsed.ok),
      status: text(parsed.status),
      provider: text(parsed.provider),
      wouldSpendTokens: bool(parsed.wouldSpendTokens),
      checks,
      nextCommand,
      nonTokenPreflight,
    };
  } catch {
    return null;
  }
}

export function parseAuthenticatedPromptPreflightMatrixReport(
  textValue: string,
): AuthenticatedPromptPreflightMatrixReport | null {
  try {
    const parsed: unknown = JSON.parse(textValue);
    if (!isRecord(parsed)) return null;
    return {
      ok: bool(parsed.ok),
      status: text(parsed.status),
      providers: Array.isArray(parsed.providers)
        ? parsed.providers.filter((provider): provider is string => typeof provider === "string")
        : [],
      checks: isRecord(parsed.checks) ? parsed.checks : {},
      providerMatrix: Array.isArray(parsed.providerMatrix)
        ? parsed.providerMatrix
            .map((entry) => parseProviderMatrixEntry(entry))
            .filter((entry): entry is AuthenticatedPromptProviderMatrixEntry => entry != null)
        : [],
      artifactReadiness: isRecord(parsed.artifacts)
        ? Object.entries(parsed.artifacts)
            .map(([id, value]) => parseArtifactReadinessEntry(id, value))
            .filter((entry): entry is AuthenticatedPromptPreflightArtifactReadiness => entry != null)
        : [],
    };
  } catch {
    return null;
  }
}

function deriveProviderReadiness(
  matrix: AuthenticatedPromptPreflightMatrixReport | null | undefined,
): AuthenticatedPromptProviderReadiness[] {
  if (!matrix?.providerMatrix?.length) return [];
  return matrix.providerMatrix.map((entry) => {
    const failedChecks = Object.entries(entry.checks)
      .filter(([, value]) => value !== true)
      .map(([key]) => key);
    const command = entry.optInCommand?.command || "pnpm verify:terminal:authenticated-ai-cli-prompt";
    return {
      provider: entry.provider,
      status: entry.ready && failedChecks.length === 0 ? "ready" : "blocked",
      failedChecks,
      command,
      requiredEnv: envPhrase(entry.optInCommand?.env),
    };
  });
}

function deriveArtifactReadiness(
  matrix: AuthenticatedPromptPreflightMatrixReport | null | undefined,
): AuthenticatedPromptPreflightArtifactReadiness[] {
  return [...(matrix?.artifactReadiness ?? [])].sort((left, right) => {
    if (left.fresh !== right.fresh) return left.fresh ? 1 : -1;
    return left.id.localeCompare(right.id);
  });
}

function artifactExpiryMs(entry: Pick<AuthenticatedPromptPreflightArtifactReadiness, "expiresAt">): number {
  const value = Date.parse(entry.expiresAt);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function artifactRefreshTarget(
  entry: AuthenticatedPromptPreflightArtifactReadiness,
): AuthenticatedPromptArtifactFreshnessTarget {
  return {
    id: entry.id,
    path: entry.path,
    expiresAt: entry.expiresAt,
    refreshCommand: entry.refreshCommand,
    refreshReason: entry.refreshReason,
    costClass: entry.costClass,
    fresh: entry.fresh,
  };
}

function deriveArtifactFreshnessRadar(
  artifactReadiness: readonly AuthenticatedPromptPreflightArtifactReadiness[],
): AuthenticatedPromptArtifactFreshnessRadar {
  if (artifactReadiness.length === 0) {
    return {
      status: "unavailable",
      label: "Proof freshness unavailable",
      detail: `Run ${AUTHENTICATED_PROMPT_PREFLIGHT_MATRIX_COMMAND} before consent`,
      freshCount: 0,
      staleCount: 0,
      totalCount: 0,
      nextRefresh: null,
    };
  }

  const stale = artifactReadiness.filter((entry) => !entry.fresh);
  const fresh = artifactReadiness.filter((entry) => entry.fresh);
  const nextRefreshSource = [...(stale.length > 0 ? stale : fresh)].sort((left, right) => {
    const byExpiry = artifactExpiryMs(left) - artifactExpiryMs(right);
    return byExpiry === 0 ? left.id.localeCompare(right.id) : byExpiry;
  })[0];
  const nextRefresh = nextRefreshSource ? artifactRefreshTarget(nextRefreshSource) : null;
  const nextDetail = nextRefresh ? `${nextRefresh.id} · ${nextRefresh.refreshCommand}` : "refresh command unavailable";

  return {
    status: stale.length > 0 ? "attention" : "green",
    label: stale.length > 0 ? "Proof freshness needs refresh" : "Proof freshness radar",
    detail:
      stale.length > 0
        ? `${stale.length}/${artifactReadiness.length} stale · ${nextDetail}`
        : `All no-token proofs fresh · next ${nextDetail}`,
    freshCount: fresh.length,
    staleCount: stale.length,
    totalCount: artifactReadiness.length,
    nextRefresh,
  };
}

export function deriveAuthenticatedPromptConsentPacket(
  report: AuthenticatedPromptSmokeReport | null,
  matrix?: AuthenticatedPromptPreflightMatrixReport | null,
): AuthenticatedPromptConsentPacket {
  const providerReadiness = deriveProviderReadiness(matrix);
  const artifactReadiness = deriveArtifactReadiness(matrix);
  const artifactFreshness = deriveArtifactFreshnessRadar(artifactReadiness);
  if (!report) {
    return {
      status: "missing",
      label: "Consent packet missing",
      detail: "Run pnpm verify:terminal:authenticated-ai-cli-prompt without consent first",
      provider: "unknown",
      command: "pnpm verify:terminal:authenticated-ai-cli-prompt",
      requiredEnv: "AELYRIS_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS",
      preflightReady: false,
      safeNoPromptSent: true,
      wouldSpendTokens: true,
      checks: [],
      providerReadiness,
      artifactReadiness,
      artifactFreshness,
    };
  }

  const checks = report.checks ?? {};
  const preflightChecks = report.nonTokenPreflight?.checks ?? {};
  const matrixReady =
    matrix === undefined ||
    (matrix !== null && matrix.ok === true && matrix.status === "pass" && matrix.checks?.allProvidersReady === true);
  const preflightReady = bool(checks.nonTokenPreflightReady) && bool(report.nonTokenPreflight?.ready) && matrixReady;
  const safeNoPromptSent = bool(checks.safeNoPromptSent);
  const consentPacketReady = bool(checks.consentPacketReady);
  const command = report.nextCommand?.command || "pnpm verify:terminal:authenticated-ai-cli-prompt";
  const requiredEnv =
    text(checks.requiredEnv) ||
    `AELYRIS_AUTH_PROMPT_CONSENT=${text(report.nextCommand?.env?.AELYRIS_AUTH_PROMPT_CONSENT)}`;
  const status: AuthenticatedPromptConsentStatus =
    report.status === "pass" && report.ok === true
      ? "pass"
      : report.status === "failed"
        ? "failed"
        : consentPacketReady && preflightReady && safeNoPromptSent
          ? "ready"
          : "incomplete";
  const provider = report.provider || text(report.nextCommand?.env?.AELYRIS_AUTH_PROMPT_PROVIDER) || "unknown";

  return {
    status,
    label:
      status === "pass"
        ? "Authenticated prompt proven"
        : status === "ready"
          ? "Consent packet ready"
          : status === "failed"
            ? "Authenticated prompt failed"
            : "Consent packet incomplete",
    detail:
      status === "ready"
        ? `${providerListLabel(providerReadiness, provider)} preflight green · prompt blocked until explicit consent`
        : status === "pass"
          ? `${provider} prompt marker and cleanup passed`
          : `${provider} consent preflight needs attention`,
    provider,
    command,
    requiredEnv,
    preflightReady,
    safeNoPromptSent,
    wouldSpendTokens: report.wouldSpendTokens !== false,
    checks: [
      check("safe-no-prompt", "No prompt sent", checks.safeNoPromptSent),
      check("preflight", "Non-token preflight", preflightReady),
      check("real-cli", "Real CLI binary", preflightChecks.realProviderBinary),
      check("command-session", "Command session", preflightChecks.commandSessionCapability),
      check("ime", "Native IME", preflightChecks.ime),
      check("chaos", "Post-launch chaos", preflightChecks.postLaunchChaos),
    ],
    providerReadiness,
    artifactReadiness,
    artifactFreshness,
  };
}
