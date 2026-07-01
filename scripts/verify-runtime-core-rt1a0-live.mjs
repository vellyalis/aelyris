import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "runtime-core-rt1a0-live.json");
const FORMAL_FIXTURE = "src-tauri/src/agent/__fixtures__/rt1a0-claude-live-fixtures.json";
const CDP_PORT = Number(process.env.AELYRIS_WEBVIEW2_CDP_PORT ?? 9222);
const CONSENT_VALUE = "I_UNDERSTAND_THIS_MAY_SPEND_TOKENS";
const LOG_CANDIDATES = [
  ".codex-auto/runtime-core/rt1a0-tauri-app-webview-profile.log",
  ".codex-auto/runtime-core/rt1a0-tauri-app.log",
  ".codex-auto/runtime-core/rt1a0-rest-claude-probe.json",
  ".codex-auto/runtime-core/rt1a0-rest-claude-menu-wait.json",
  ".codex-auto/runtime-core/rt1a0-rest-claude-menu-proxy-clean.json",
];

function read(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function readJson(path) {
  return JSON.parse(read(path));
}

function tail(value, max = 3000) {
  const text = String(value ?? "");
  return text.length <= max ? text : text.slice(text.length - max);
}

function check(id, ok, detail, extra = {}) {
  return { id, ok: ok === true, detail, ...extra };
}

function fileMeta(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return { path, exists: false };
  const stats = statSync(full);
  return { path, exists: true, size: stats.size, mtimeMs: stats.mtimeMs };
}

function logEvidence() {
  return LOG_CANDIDATES.map((path) => {
    const meta = fileMeta(path);
    if (!meta.exists) return meta;
    const text = read(path);
    return {
      ...meta,
      webviewFatal:
        /failed to create webview|WebView2 error|HRESULT\(0x8000FFFF\)|HRESULT\(0x800700AA\)|fatal error/i.test(
          text,
        ),
      proxyConnectionRefused: /ConnectionRefused|ECONNREFUSED|HTTP_PROXY|HTTPS_PROXY/i.test(text),
      supplementalOnly: /rt1a0-rest-|REST|\/commands|command-risk approval/i.test(`${path}\n${text}`),
      tail: tail(text),
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

function validateFixture() {
  const meta = fileMeta(FORMAL_FIXTURE);
  if (!meta.exists) {
    return {
      meta,
      data: null,
      checks: [
        check(
          "formal-live-fixture-present",
          false,
          "RT-1a0 requires a redacted fixture captured through spawn_interactive_agent plus term_snapshot/GridSnapshot",
        ),
      ],
    };
  }

  let data = null;
  let parseError = null;
  try {
    data = readJson(FORMAL_FIXTURE);
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }
  const permission = data?.permissionMenu ?? {};
  const contextLeft = data?.contextLeft ?? {};
  const capture = data?.capture ?? {};
  const checks = [
    check("formal-live-fixture-present", true, "formal RT-1a0 live fixture exists"),
    check("formal-live-fixture-parseable", parseError == null, parseError ?? "fixture JSON is parseable"),
    check("fixture-redacted", data?.redacted === true, "fixture declares redaction before persistence"),
    check(
      "capture-uses-visible-agent-path",
      capture.spawn === "spawn_interactive_agent" && capture.snapshot === "term_snapshot",
      "fixture must come from visible interactive agent spawn plus term_snapshot/GridSnapshot",
      { actual: capture },
    ),
    check(
      "permission-menu-shape-captured",
      typeof permission.cursorGlyph === "string" &&
        permission.cursorGlyph.length > 0 &&
        permission.yesOptionKey === "1" &&
        permission.noOptionKey != null,
      "fixture captures cursor glyph and option numbers for Yes/No",
      { actual: permission },
    ),
    check(
      "digit-one-confirms-yes",
      permission.approveKey === "1" && permission.digitOneSelectsYes === true,
      "fixture confirms that the 1 key deterministically selects Yes",
      { actual: permission },
    ),
    check(
      "context-left-line-captured",
      typeof contextLeft.sample === "string" &&
        /%\s*context\s+left|context\s+left\s+until\s+auto-compact/i.test(contextLeft.sample) &&
        typeof contextLeft.pct === "number",
      "fixture captures the Claude context-left line from the grid snapshot",
      { actual: contextLeft },
    ),
  ];
  return { meta, data, parseError, checks };
}

const cdp = await canConnect(CDP_PORT);
const fixture = validateFixture();
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
    "REST /commands probes are supplemental only; formal RT-1a0 needs spawn_interactive_agent + term_snapshot/GridSnapshot",
  ),
  check(
    "webview-host-not-fatally-blocked",
    !webviewBlocked || fixtureOk,
    "known WebView2 creation errors block formal live fixture collection in this host",
  ),
];

const status = fixtureOk
  ? "pass-rt1a0-live-fixtures"
  : webviewBlocked
    ? "blocked-by-live-webview2-cdp"
    : cdp.ok
      ? "blocked-missing-rt1a0-live-fixture"
      : "blocked-cdp-not-listening";
const artifact = {
  ok: fixtureOk,
  status,
  generatedAt: new Date().toISOString(),
  phase: "RT-1a0",
  fixture: fixture.meta,
  cdp: { host: "127.0.0.1", port: CDP_PORT, listening: cdp.ok, error: cdp.error ?? null },
  tokenPolicy: {
    verifierSpendsTokens: false,
    liveCaptureRequiresExplicitConsent: true,
    consentEnv: "AELYRIS_RT1A0_ALLOW_TOKEN_SPEND",
    requiredConsentValue: CONSENT_VALUE,
    consentEnvPresent: tokenConsentEnvPresent,
  },
  formalCaptureContract: {
    spawn: "spawn_interactive_agent",
    measurement: "term_snapshot/GridSnapshot",
    structuredExchange: "files under .aelyris/handoff/ for later phases; no raw PTY byte scrape",
    supplementalOnly: ["capture_pane(stripAnsiCodes:true)", "REST /commands probes", "raw PTY bytes"],
  },
  checks,
  logs,
  nextUnblockCommand:
    "$env:AELYRIS_ENABLE_WEBVIEW2_CDP='1'; $env:AELYRIS_RT1A0_ALLOW_TOKEN_SPEND='I_UNDERSTAND_THIS_MAY_SPEND_TOKENS'; pnpm tauri:dev; then capture a redacted formal fixture at src-tauri/src/agent/__fixtures__/rt1a0-claude-live-fixtures.json using spawn_interactive_agent + term_snapshot",
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`);

if (!fixtureOk) {
  console.error(JSON.stringify(artifact, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(artifact, null, 2));
