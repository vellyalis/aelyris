export const FALLBACK_TELEMETRY_EVENT = "aelyris:fallback-telemetry";

export type FallbackSeverity = "info" | "warning" | "error";
export type FallbackBoundary = "native" | "webview-fallback" | "local-fallback" | "unavailable";

export interface FallbackTelemetryDetail {
  source: string;
  operation: string;
  severity: FallbackSeverity;
  message: string;
  timestamp: number;
  userVisible?: boolean;
  boundary?: FallbackBoundary;
  nativeBoundaryEscaped?: boolean;
}

const lastReportedAt = new Map<string, number>();

export function formatFallbackError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function reportFallback(
  detail: Omit<FallbackTelemetryDetail, "timestamp">,
  options: { throttleMs?: number } = {},
): FallbackTelemetryDetail {
  const timestamp =
    typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  const entry: FallbackTelemetryDetail = { ...detail, timestamp };
  const throttleMs = options.throttleMs ?? 2_000;
  const key = `${entry.source}:${entry.operation}:${entry.message}`;
  const previous = lastReportedAt.get(key) ?? -Infinity;
  if (timestamp - previous < throttleMs) return entry;
  lastReportedAt.set(key, timestamp);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<FallbackTelemetryDetail>(FALLBACK_TELEMETRY_EVENT, { detail: entry }));
  }
  return entry;
}

export function reportInvokeFailure(args: {
  source: string;
  operation: string;
  err: unknown;
  severity?: FallbackSeverity;
  userVisible?: boolean;
  boundary?: FallbackBoundary;
  nativeBoundaryEscaped?: boolean;
}): FallbackTelemetryDetail {
  return reportFallback({
    source: args.source,
    operation: args.operation,
    severity: args.severity ?? "warning",
    message: formatFallbackError(args.err),
    userVisible: args.userVisible,
    boundary: args.boundary,
    nativeBoundaryEscaped: args.nativeBoundaryEscaped,
  });
}
