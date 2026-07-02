import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, isAbsolute, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "runtime-core-rt1a0-live.json");
const REQUIRED_PROVIDERS = ["claude", "codex", "gemini"];
const FORMAL_MATRIX_FIXTURE = "src-tauri/src/agent/__fixtures__/rt1a0-provider-matrix.json";
const LEGACY_CLAUDE_FIXTURE = "src-tauri/src/agent/__fixtures__/rt1a0-claude-live-fixtures.json";
const CDP_PORT = Number(process.env.AELYRIS_WEBVIEW2_CDP_PORT ?? 9222);
const CONSENT_VALUE = "I_UNDERSTAND_THIS_MAY_SPEND_TOKENS";
const TELEMETRY_CONFIDENCE = new Set(["exact", "parsed", "estimated", "unknown"]);
const LOG_CANDIDATES = [
  ".codex-auto/runtime-core/rt1a0-tauri-dev-current.err.log",
  ".codex-auto/runtime-core/rt1a0-tauri-dev-current.out.log",
  ".codex-auto/runtime-core/rt1a0-tauri-app-webview-profile.log",
  ".codex-auto/runtime-core/rt1a0-tauri-app.log",
  ".codex-auto/runtime-core/rt1a0-rest-claude-probe.json",
  ".codex-auto/runtime-core/rt1a0-rest-claude-menu-wait.json",
  ".codex-auto/runtime-core/rt1a0-rest-claude-menu-proxy-clean.json",
];

function fullPath(path) {
  return isAbsolute(path) ? path : join(ROOT, path);
}

function read(path) {
  return readFileSync(fullPath(path), "utf8");
}

function readJson(path) {
  return JSON.parse(read(path));
}

function tail(value, max = 3000) {
  const text = String(value ?? "");
  return text.length <= max ? text : text.slice(text.length - max);
}

function redactSensitiveLogText(value) {
  return String(value ?? "")
    .replace(/(generated ephemeral token:\s*)[0-9a-f-]{20,}/gi, "$1[REDACTED]")
    .replace(/(AELYRIS_API_TOKEN\s*[:=]\s*)[^\s"',}]+/gi, "$1[REDACTED]")
    .replace(/(api[_-]?token\s*[:=]\s*)[^\s"',}]+/gi, "$1[REDACTED]");
}

function check(id, ok, detail, extra = {}) {
  return { id, ok: ok === true, detail, ...extra };
}

function fileMeta(path) {
  const full = fullPath(path);
  if (!existsSync(full)) return { path, exists: false };
  const stats = statSync(full);
  return { path, exists: true, size: stats.size, mtimeMs: stats.mtimeMs };
}

function logEvidence() {
  return LOG_CANDIDATES.map((path) => {
    const meta = fileMeta(path);
    if (!meta.exists) return meta;
    const text = read(path);
    const supplementalOnly =
      /rt1a0-rest-|\/commands|command-risk approval/i.test(`${path}\n${text}`) || /\bREST\b/.test(text);
    return {
      ...meta,
      webviewFatal:
        /failed to create webview|WebView2 error|HRESULT\(0x8000FFFF\)|HRESULT\(0x800700AA\)|fatal error/i.test(text),
      proxyConnectionRefused: /ConnectionRefused|ECONNREFUSED|HTTP_PROXY|HTTPS_PROXY/i.test(text),
      supplementalOnly,
      tail: supplementalOnly ? "[supplemental transcript omitted]" : redactSensitiveLogText(tail(text)),
    };
  });
}

function canConnect(port, host = "127.0.0.1", timeoutMs = 450) {
  return new Promise((resolveConnect) => {
    const socket = net.createConnection({ host, port });
    let done = false;
    const finish = (ok, error = null) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolveConnect({ ok, error });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false, "timeout"));
    socket.once("error", (error) => finish(false, error?.code ?? error?.message ?? String(error)));
  });
}

function normalizeProviderRows(data) {
  const rawRows = data?.providers ?? data?.providerMatrix ?? data?.matrix;
  if (Array.isArray(rawRows)) return rawRows;
  if (rawRows && typeof rawRows === "object") {
    return Object.entries(rawRows).map(([provider, row]) => ({ provider, ...(row ?? {}) }));
  }
  return [];
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function bool(value) {
  return typeof value === "boolean" ? value : null;
}

function providerValue(row, keys) {
  for (const key of keys) {
    const parts = key.split(".");
    let value = row;
    for (const part of parts) value = value?.[part];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function rowForProvider(rows, provider) {
  return rows.find((row) => String(row?.provider ?? "").toLowerCase() === provider) ?? null;
}

function artifactPathFor(row) {
  return text(
    providerValue(row, [
      "artifactPath",
      "fixturePath",
      "capture.artifactPath",
      "capture.fixturePath",
      "evidence.artifactPath",
      "evidence.fixturePath",
    ]),
  );
}

function artifactExists(path) {
  if (!path) return false;
  return existsSync(fullPath(path));
}

function captureUsesVisiblePath(row) {
  const spawn = text(providerValue(row, ["capture.spawn", "spawn"]));
  const snapshot = text(providerValue(row, ["capture.snapshot", "capture.measurement", "snapshot", "measurement"]));
  return (
    spawn === "spawn_interactive_agent" &&
    (/term_snapshot/i.test(snapshot) || /GridSnapshot/.test(snapshot) || snapshot === "term_snapshot")
  );
}

function permissionStatus(row) {
  const permission = row?.permissionMenu ?? row?.permission ?? {};
  const status = text(permission.status).toLowerCase();
  const supported = bool(permission.supported);
  if (status === "captured" || supported === true) {
    const cursorGlyph = text(permission.cursorGlyph);
    const yesOptionKey = text(permission.yesOptionKey);
    const noOptionKey = text(permission.noOptionKey);
    const approveKey = text(permission.approveKey);
    const digitOneSelectsYes = bool(permission.digitOneSelectsYes);
    return {
      status: "captured",
      ok:
        cursorGlyph.length > 0 &&
        yesOptionKey.length > 0 &&
        noOptionKey.length > 0 &&
        approveKey.length > 0 &&
        digitOneSelectsYes !== null,
      detail: "permission menu captures cursor glyph, option keys, approve key, and digit-one behavior",
      actual: permission,
    };
  }
  if (supported === false || ["unsupported", "not_supported", "not-observed", "not_observed"].includes(status)) {
    return {
      status: status || "unsupported",
      ok: text(permission.reason).length > 0 || text(permission.detail).length > 0,
      detail: "provider declares permission-menu capture unsupported or not observed with a reason",
      actual: permission,
    };
  }
  return {
    status: "missing",
    ok: false,
    detail: "provider must either capture permission-menu behavior or explain why it was unsupported/not observed",
    actual: permission,
  };
}

function contextTelemetry(row, provider, evidencePathExists) {
  const context = row?.contextTelemetry ?? row?.telemetry ?? row?.context ?? {};
  const confidence = text(context.confidence).toLowerCase();
  const source = text(context.source);
  const fallback = bool(context.fallback);
  const providerSpecificFixture = bool(context.providerSpecificFixture ?? row?.providerSpecificTelemetryFixture);
  const contextLeft = row?.contextLeft ?? context.contextLeft ?? {};
  const contextLeftSample = text(contextLeft.sample);
  const contextLeftPct = Number(contextLeft.pct);
  const confidenceKnown = TELEMETRY_CONFIDENCE.has(confidence);
  const fallbackSource = fallback === true || /fallback|status|turn|time|proxy/i.test(source);
  const nonClaudeStrongerTelemetryOk =
    provider === "claude" ||
    confidence === "unknown" ||
    (providerSpecificFixture === true && evidencePathExists === true);
  const nonClaudeFallbackOk = provider === "claude" || confidence !== "unknown" || fallbackSource;
  const claudeContextLeftOk =
    provider !== "claude" ||
    contextLeftSample.length === 0 ||
    (/%\s*context\s+left|context\s+left\s+until\s+auto-compact/i.test(contextLeftSample) &&
      Number.isFinite(contextLeftPct));

  return {
    ok: confidenceKnown && nonClaudeStrongerTelemetryOk && nonClaudeFallbackOk && claudeContextLeftOk,
    confidence,
    source,
    fallback,
    providerSpecificFixture,
    contextLeft: contextLeftSample.length
      ? {
          sample: contextLeftSample,
          pct: Number.isFinite(contextLeftPct) ? contextLeftPct : null,
        }
      : null,
    detail:
      provider === "claude"
        ? "Claude telemetry is classified and context-left parsing is fixture-backed when present"
        : "Codex/Gemini remain fallback+unknown unless provider-specific fixture proof upgrades telemetry",
  };
}

function validateProvider(provider, row, matrixRedacted) {
  if (!row) {
    return {
      provider,
      ok: false,
      status: "missing",
      checks: [check(`${provider}-row-present`, false, `RT-1a0 provider matrix is missing ${provider}`)],
    };
  }

  const evidencePath = artifactPathFor(row);
  const evidencePathExists = artifactExists(evidencePath);
  const command = text(providerValue(row, ["command", "capture.command", "launch.command", "probe.command"]));
  const launchOk = bool(providerValue(row, ["launch.ok", "probe.ok"]));
  const launchStatus = text(providerValue(row, ["launch.status", "probe.status", "status"]));
  const tokenSpendingPromptExecuted = bool(
    providerValue(row, ["tokenSpendingPromptExecuted", "token.spendingPromptExecuted", "prompt.tokenSpendingExecuted"]),
  );
  const model = text(providerValue(row, ["model", "capture.model", "launch.model"]));
  const permission = permissionStatus(row);
  const telemetry = contextTelemetry(row, provider, evidencePathExists);
  const redacted = matrixRedacted === true || row.redacted === true;

  const checks = [
    check(`${provider}-row-present`, true, `${provider} provider row is present`),
    check(
      `${provider}-visible-capture-path`,
      captureUsesVisiblePath(row),
      `${provider} fixture must come from spawn_interactive_agent plus term_snapshot/GridSnapshot`,
      { actual: row.capture ?? {} },
    ),
    check(
      `${provider}-launch-or-probe-result-recorded`,
      launchOk !== null || launchStatus.length > 0,
      `${provider} records launch/probe result`,
      {
        launch: row.launch ?? null,
        probe: row.probe ?? null,
        status: row.status ?? null,
      },
    ),
    check(`${provider}-command-recorded`, command.length > 0, `${provider} records the command used for capture`, {
      command,
    }),
    check(
      `${provider}-artifact-path-recorded`,
      evidencePath.length > 0 && evidencePathExists,
      `${provider} records an existing redacted artifact path`,
      { artifactPath: evidencePath || null, exists: evidencePathExists },
    ),
    check(
      `${provider}-token-execution-state-recorded`,
      tokenSpendingPromptExecuted !== null,
      `${provider} records whether token-spending prompt execution occurred`,
      { tokenSpendingPromptExecuted },
    ),
    check(`${provider}-permission-menu-contract`, permission.ok, permission.detail, {
      status: permission.status,
      actual: permission.actual,
    }),
    check(`${provider}-telemetry-classified`, telemetry.ok, telemetry.detail, {
      confidence: telemetry.confidence,
      source: telemetry.source,
      fallback: telemetry.fallback,
      providerSpecificFixture: telemetry.providerSpecificFixture,
      contextLeft: telemetry.contextLeft,
    }),
    check(`${provider}-redacted`, redacted, `${provider} fixture declares redaction before persistence`),
  ];

  return {
    provider,
    ok: checks.every((item) => item.ok),
    status: checks.every((item) => item.ok) ? "ready" : "blocked",
    command: command || null,
    model: model || null,
    artifactPath: evidencePath || null,
    tokenSpendingPromptExecuted,
    permissionStatus: permission.status,
    telemetryConfidence: telemetry.confidence || null,
    telemetrySource: telemetry.source || null,
    checks,
  };
}

function validateMatrixFixture() {
  const meta = fileMeta(FORMAL_MATRIX_FIXTURE);
  const legacyClaude = fileMeta(LEGACY_CLAUDE_FIXTURE);
  if (!meta.exists) {
    return {
      meta,
      legacyClaude,
      data: null,
      providerMatrix: REQUIRED_PROVIDERS.map((provider) => validateProvider(provider, null, false)),
      checks: [
        check(
          "formal-provider-matrix-present",
          false,
          "RT-1a0 requires a redacted provider matrix fixture for claude, codex, and gemini captured through spawn_interactive_agent plus term_snapshot/GridSnapshot",
          { expectedPath: FORMAL_MATRIX_FIXTURE, legacyClaudeFixture: legacyClaude },
        ),
      ],
    };
  }

  let data = null;
  let parseError = null;
  try {
    data = readJson(FORMAL_MATRIX_FIXTURE);
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }

  const rows = normalizeProviderRows(data);
  const matrixRedacted = data?.redacted === true;
  const providerMatrix = REQUIRED_PROVIDERS.map((provider) =>
    validateProvider(provider, rowForProvider(rows, provider), matrixRedacted),
  );
  const coveredProviders = rows.map((row) => String(row?.provider ?? "").toLowerCase()).filter(Boolean);
  const providerChecks = providerMatrix.flatMap((entry) => entry.checks);
  const checks = [
    check("formal-provider-matrix-present", true, "formal RT-1a0 provider matrix fixture exists"),
    check("formal-provider-matrix-parseable", parseError == null, parseError ?? "provider matrix JSON is parseable"),
    check("provider-matrix-redacted", matrixRedacted, "provider matrix declares redaction before persistence", {
      redacted: data?.redacted ?? null,
    }),
    check(
      "provider-matrix-covers-required-providers",
      REQUIRED_PROVIDERS.every((provider) => coveredProviders.includes(provider)),
      "provider matrix covers claude, codex, and gemini",
      { requiredProviders: REQUIRED_PROVIDERS, coveredProviders },
    ),
    ...providerChecks,
  ];

  return { meta, legacyClaude, data, parseError, providerMatrix, checks };
}

const cdp = await canConnect(CDP_PORT);
const fixture = validateMatrixFixture();
const logs = logEvidence();
const fixtureOk = fixture.checks.every((item) => item.ok);
const webviewBlocked = logs.some((entry) => entry.webviewFatal === true);
const supplementalOnly = logs.some((entry) => entry.supplementalOnly === true);
const tokenConsentEnvPresent = process.env.AELYRIS_RT1A0_ALLOW_TOKEN_SPEND === CONSENT_VALUE;

const checks = [
  ...fixture.checks,
  check(
    "safe-verifier-does-not-spend-tokens",
    true,
    "this verifier only validates fixture readiness and host state; live token-spending capture is a separate explicit operation",
    { tokenConsentEnvPresent },
  ),
  check("cdp-port-listening", cdp.ok, `WebView2 CDP port ${CDP_PORT} is ${cdp.ok ? "listening" : "not listening"}`, {
    error: cdp.error,
  }),
  check(
    "supplemental-rest-probes-not-accepted-as-formal-fixture",
    !supplementalOnly || fixtureOk,
    "REST /commands probes are supplemental only; formal RT-1a0 needs spawn_interactive_agent + term_snapshot/GridSnapshot provider matrix",
  ),
  check(
    "webview-host-not-fatally-blocked",
    !webviewBlocked || cdp.ok || fixtureOk,
    "known WebView2 creation errors block formal live fixture collection only when CDP is not currently reachable",
  ),
];

const missingProviders = fixture.providerMatrix.filter((entry) => entry.ok !== true).map((entry) => entry.provider);
const status = fixtureOk
  ? "pass-rt1a0-provider-matrix"
  : cdp.ok
    ? "blocked-missing-rt1a0-provider-matrix"
    : webviewBlocked
      ? "blocked-by-live-webview2-cdp"
      : "blocked-cdp-not-listening";
const artifact = {
  ok: fixtureOk,
  status,
  generatedAt: new Date().toISOString(),
  phase: "RT-1a0",
  requiredProviders: REQUIRED_PROVIDERS,
  missingProviders,
  fixture: fixture.meta,
  legacyClaudeFixture: fixture.legacyClaude,
  providerMatrix: fixture.providerMatrix.map(({ checks: _checks, ...entry }) => entry),
  cdp: { host: "127.0.0.1", port: CDP_PORT, listening: cdp.ok, error: cdp.error ?? null },
  tokenPolicy: {
    verifierSpendsTokens: false,
    liveCaptureRequiresExplicitConsent: true,
    consentEnv: "AELYRIS_RT1A0_ALLOW_TOKEN_SPEND",
    requiredConsentValue: CONSENT_VALUE,
    consentEnvPresent: tokenConsentEnvPresent,
  },
  formalCaptureContract: {
    fixturePath: FORMAL_MATRIX_FIXTURE,
    schema: "aelyris.rt1a0.provider-matrix/v1",
    providers: REQUIRED_PROVIDERS,
    spawn: "spawn_interactive_agent",
    measurement: "term_snapshot/GridSnapshot",
    structuredExchange: "files under .aelyris/handoff/ for later phases; no raw PTY byte scrape",
    providerRequirements: [
      "launch/probe result",
      "command used",
      "model if visible",
      "artifact path",
      "token-spending prompt execution boolean",
      "permission menu/numeric approval behavior when supported",
      "context/usage telemetry confidence exact|parsed|estimated|unknown",
    ],
    supplementalOnly: ["capture_pane(stripAnsiCodes:true)", "REST /commands probes", "raw PTY bytes"],
  },
  checks,
  logs,
  nextUnblockCommand:
    "$env:AELYRIS_ENABLE_WEBVIEW2_CDP='1'; $env:AELYRIS_RT1A0_ALLOW_TOKEN_SPEND='I_UNDERSTAND_THIS_MAY_SPEND_TOKENS'; pnpm tauri:dev; then capture a redacted provider matrix fixture at src-tauri/src/agent/__fixtures__/rt1a0-provider-matrix.json for claude, codex, and gemini using spawn_interactive_agent + term_snapshot",
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`);

if (!fixtureOk) {
  console.error(JSON.stringify(artifact, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(artifact, null, 2));
