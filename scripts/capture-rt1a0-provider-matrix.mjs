import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright";

const ROOT = resolve(process.cwd());
const CDP_PORT = Number(process.env.AELYRIS_WEBVIEW2_CDP_PORT ?? 9222);
const FIXTURE_PATH = "src-tauri/src/agent/__fixtures__/rt1a0-provider-matrix.json";
const CAPTURE_DIR = ".codex-auto/runtime-core";
const PROVIDERS = [
  {
    provider: "claude",
    model: "sonnet",
    command: "spawn_interactive_agent(model=sonnet, initialPrompt=null) -> claude --model sonnet",
    signal: /Claude Code/i,
  },
  {
    provider: "codex",
    model: "codex-mini",
    command: "spawn_interactive_agent(model=codex-mini, initialPrompt=null) -> codex",
    signal: /OpenAI Codex|>\s*_\s*OpenAI Codex/i,
  },
  {
    provider: "gemini",
    model: "gemini-2.5-pro",
    command: "spawn_interactive_agent(model=gemini-2.5-pro, initialPrompt=null) -> gemini",
    signal: /Gemini CLI/i,
  },
];

function fullPath(path) {
  return join(ROOT, path);
}

function sha256(value) {
  return createHash("sha256")
    .update(String(value ?? ""), "utf8")
    .digest("hex");
}

function sanitizeText(value) {
  return String(value ?? "")
    .replace(/(generated ephemeral token:\s*)[0-9a-f-]{20,}/gi, "$1[REDACTED]")
    .replace(/(AELYRIS_API_TOKEN\s*[:=]\s*)[^\s"',}]+/gi, "$1[REDACTED]")
    .replace(/(api[_-]?token\s*[:=]\s*)[^\s"',}]+/gi, "$1[REDACTED]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[EMAIL_REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED_API_KEY]")
    .replace(/You've used[^\n\r]*/gi, "[USAGE_QUOTA_REDACTED]");
}

function gridText(snapshot) {
  if (!snapshot?.cells || !Array.isArray(snapshot.cells)) return "";
  return snapshot.cells
    .map((row) =>
      Array.isArray(row)
        ? row
            .map((cell) => cell?.ch ?? " ")
            .join("")
            .trimEnd()
        : "",
    )
    .join("\n")
    .trim();
}

function nonBlankCells(snapshot) {
  if (!snapshot?.cells || !Array.isArray(snapshot.cells)) return 0;
  let count = 0;
  for (const row of snapshot.cells) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      const ch = cell?.ch ?? " ";
      if (String(ch).trim().length > 0) count += 1;
    }
  }
  return count;
}

async function connectPage() {
  const version = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((response) => {
    if (!response.ok) throw new Error(`CDP /json/version failed: ${response.status}`);
    return response.json();
  });
  const browser = await chromium.connectOverCDP(version.webSocketDebuggerUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());
  return { browser, page };
}

async function invokeCapture(page, provider) {
  return page.evaluate(async ({ model }) => {
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== "function") {
      throw new Error("window.__TAURI_INTERNALS__.invoke is unavailable");
    }
    const spawned = await invoke("spawn_interactive_agent", {
      cwd: "C:\\Users\\owner\\Aether_Terminal",
      model,
      initialPrompt: null,
      branchName: null,
      cols: 120,
      rows: 30,
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 12000));
      const sessions = await invoke("list_interactive_agents", {});
      const session = sessions.find((item) => item.id === spawned.session_id) ?? null;
      const snapshot = await invoke("term_snapshot", { id: spawned.pty_id });
      let capture = "";
      try {
        capture = await invoke("capture_pane", {
          terminalId: spawned.pty_id,
          lines: 120,
          stripAnsiCodes: true,
        });
      } catch (_error) {
        capture = "";
      }
      return { spawned, session, snapshot, capture };
    } finally {
      try {
        await invoke("stop_interactive_agent", { id: spawned.session_id });
      } catch (_error) {
        // The verifier records launch evidence; cleanup failure should not hide capture data.
      }
    }
  }, provider);
}

function contextTelemetry(provider, session) {
  const source = session?.context_remaining?.source ?? "status_time_turn_proxy";
  if (provider === "claude") {
    return {
      confidence: session?.context_remaining?.confidence ?? "estimated",
      source,
      fallback: true,
      providerSpecificFixture: false,
    };
  }
  return {
    confidence: "unknown",
    source,
    fallback: true,
    providerSpecificFixture: false,
  };
}

function providerRow(provider, capture, artifactPath, capturedAt) {
  const text = gridText(capture.snapshot);
  const cleanText = sanitizeText(text);
  const providerSignal = provider.signal.test(cleanText);
  const reconnectOnly =
    cleanText.length > 0 && !providerSignal && /stream reconnected; output may have gaps/i.test(cleanText);
  const nonBlank = nonBlankCells(capture.snapshot);

  const artifact = {
    schema: "aelyris.rt1a0.provider-capture/v1",
    provider: provider.provider,
    model: provider.model,
    capturedAt,
    redacted: true,
    capture: {
      spawn: "spawn_interactive_agent",
      snapshot: "term_snapshot/GridSnapshot",
      backend: capture.spawned?.backend ?? null,
      cdp: `127.0.0.1:${CDP_PORT}`,
      tokenSpendingPromptExecuted: false,
    },
    launch: {
      ok: providerSignal && nonBlank > 0 && !reconnectOnly,
      status: capture.session?.status ?? "unknown",
      cli: capture.session?.cli ?? provider.provider,
      tokensUsed: capture.session?.tokens_used ?? null,
      nonBlankCells: nonBlank,
      providerSignal,
      reconnectOnly,
    },
    hashes: {
      gridTextSha256: sha256(cleanText),
      capturePaneSha256: sha256(sanitizeText(capture.capture)),
    },
    visibleExcerpt: cleanText.slice(0, 1000),
    contextTelemetry: contextTelemetry(provider.provider, capture.session),
  };
  writeFileSync(fullPath(artifactPath), `${JSON.stringify(artifact, null, 2)}\n`);

  return {
    provider: provider.provider,
    command: provider.command,
    model: provider.model,
    capture: {
      spawn: "spawn_interactive_agent",
      snapshot: "term_snapshot/GridSnapshot",
      artifactPath,
      backend: capture.spawned?.backend ?? null,
      cdp: `127.0.0.1:${CDP_PORT}`,
    },
    launch: {
      ok: artifact.launch.ok,
      status: artifact.launch.status,
      cli: artifact.launch.cli,
      tokensUsed: artifact.launch.tokensUsed,
      nonBlankCells: nonBlank,
      providerSignal,
      reconnectOnly,
    },
    tokenSpendingPromptExecuted: false,
    permissionMenu: {
      status: "not_observed",
      reason:
        "No token-spending prompt was executed by this RT-1a0 startup capture; permission-menu behavior remains a separate prompt-gated proof.",
    },
    contextTelemetry: artifact.contextTelemetry,
    redacted: true,
  };
}

mkdirSync(fullPath(CAPTURE_DIR), { recursive: true });

const capturedAt = new Date().toISOString();
const { browser, page } = await connectPage();
const rows = [];
try {
  for (const provider of PROVIDERS) {
    const capture = await invokeCapture(page, provider);
    const artifactPath = `${CAPTURE_DIR}/rt1a0-provider-${provider.provider}.json`;
    rows.push(providerRow(provider, capture, artifactPath, capturedAt));
  }
} finally {
  await browser.close();
}

const fixture = {
  schema: "aelyris.rt1a0.provider-matrix/v1",
  capturedAt,
  redacted: true,
  captureMode: "no-token-startup-visible-pty",
  providers: rows,
};
const ready = rows.every((row) => row.launch.ok === true && existsSync(fullPath(row.capture.artifactPath)));

if (ready) {
  mkdirSync(dirname(fullPath(FIXTURE_PATH)), { recursive: true });
  writeFileSync(fullPath(FIXTURE_PATH), `${JSON.stringify(fixture, null, 2)}\n`);
}

console.log(
  JSON.stringify(
    {
      ok: ready,
      fixturePath: ready ? FIXTURE_PATH : null,
      providers: rows.map((row) => ({
        provider: row.provider,
        ok: row.launch.ok,
        status: row.launch.status,
        artifactPath: row.capture.artifactPath,
      })),
    },
    null,
    2,
  ),
);

if (!ready) process.exit(1);
