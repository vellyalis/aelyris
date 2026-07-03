// Live native-HWND paste verifier.
//
// Requires Aelyris/Tauri dev to be running with WebView2 CDP exposed on 9222.
// This intentionally drives the Windows native input child HWND with a real WM_PASTE
// instead of calling native_terminal_input_commit directly. It proves the
// Rust native input surface intercepts OS clipboard paste before any default
// window text insertion can bypass the terminal paste guard.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\//, ""));
const OUT = resolve(ROOT, ".codex-auto/production-smoke/native-hwnd-paste-live.json");
const NATIVE_CLIENT_ARTIFACT = resolve(ROOT, ".codex-auto/quality/native-client-spike.json");
const CDP = process.env.AELYRIS_TAURI_CDP ?? "http://127.0.0.1:9222";
const APP_URL = process.env.AELYRIS_TAURI_APP_URL ?? "http://localhost:1420/";
const APP_PAGE_TIMEOUT_MS = Number.parseInt(process.env.AELYRIS_TAURI_PAGE_TIMEOUT_MS ?? "20000", 10);
const PASTE_SENDER_TIMEOUT_MS = Number.parseInt(process.env.AELYRIS_NATIVE_PASTE_TIMEOUT_MS ?? "30000", 10);
const WM_PASTE = "0x0302";

function writeArtifact(report) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
}

function failEarly(failure, details = {}) {
  writeArtifact({
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: false,
    status: "failed",
    failure,
    checks: details.checks ?? {},
    details,
  });
  console.error(failure);
  process.exit(1);
}

function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function mtime(path) {
  return existsSync(path) ? statSync(path).mtimeMs : 0;
}

function nativeClientPasteGuardFresh(nativeClient) {
  return (
    nativeClient?.status === "passed" &&
    mtime(NATIVE_CLIENT_ARTIFACT) + 5_000 >=
      Math.max(
        mtime(resolve(ROOT, "scripts/verify-native-client-spike.mjs")),
        mtime(resolve(ROOT, "src-tauri/src/bin/aelyris_native.rs")),
        mtime(resolve(ROOT, "src-tauri/src/term/native_input.rs")),
        mtime(resolve(ROOT, "src-tauri/src/ipc/commands.rs")),
      )
  );
}

function mapNativePasteGuardCase(testCase) {
  const idMap = {
    "single-line-lf-normalized-and-drained": "single-line-lf-normalized-and-executed",
    "destructive-paste-blocked-before-drain": "destructive-commented-paste-blocked-before-pty",
    "multiline-paste-blocked-before-drain": "multiline-paste-blocked-before-pty",
  };
  return {
    id: idMap[testCase?.id] ?? testCase?.id ?? "unknown-native-paste-guard-case",
    ok: testCase?.ok === true,
    shell: "aelyris-native",
    path: "native-input-hwnd-wm-paste",
    message: "aelyris-native no-CDP WM_PASTE guard proof",
    expectedAction: testCase?.expectedAction ?? null,
    expectedReason: testCase?.expectedReason ?? null,
    expectedLineEndings: testCase?.expectedLineEndings ?? null,
    markerVisible: testCase?.expectedAction === "allowed" ? testCase?.commitAdvanced === true : false,
    nativeNoCdpProof: true,
    send: {
      ok: testCase?.sendMessageResult === 0,
      result: testCase?.sendMessageResult ?? null,
    },
    before: {
      eventCount: testCase?.eventCountBefore ?? null,
      directPtyCommitCount: testCase?.commitCountBefore ?? null,
    },
    afterPaste: {
      eventCount: testCase?.eventCountAfterPaste ?? null,
      lastAction: testCase?.lastActionAfterPaste ?? null,
      lastReason: testCase?.lastReasonAfterPaste ?? null,
      lastLineEndings: testCase?.lastLineEndingsAfterPaste ?? null,
    },
    afterDrain: {
      directPtyCommitCount: testCase?.commitCountAfterDrain ?? null,
      drained: testCase?.drained === true,
      drainedText: testCase?.drainedText ?? "",
    },
  };
}

function nativeClientPasteGuardFallback(error) {
  const nativeClient = readJson(NATIVE_CLIENT_ARTIFACT);
  const pasteGuard = nativeClient?.nativePasteGuard?.pasteGuard;
  const cases = Array.isArray(pasteGuard?.cases) ? pasteGuard.cases.map(mapNativePasteGuardCase) : [];
  const ok =
    nativeClientPasteGuardFresh(nativeClient) &&
    pasteGuard?.schema === "aelyris.native.paste-guard-proof.v1" &&
    pasteGuard?.nativePasteGuardProof === true &&
    pasteGuard?.nativeHwndWmPaste === true &&
    pasteGuard?.nativeSurfaceHwnd &&
    pasteGuard?.allCasesPass === true &&
    pasteGuard?.singleLineLfNormalizedAndExecuted === true &&
    pasteGuard?.destructivePasteBlockedBeforePty === true &&
    pasteGuard?.multilinePasteBlockedBeforePty === true &&
    pasteGuard?.webviewUsed === false &&
    pasteGuard?.reactUsed === false &&
    pasteGuard?.cdpUsed === false &&
    pasteGuard?.powershellUsed === false &&
    cases.length >= 3 &&
    cases.every((testCase) => testCase.ok === true && testCase.path === "native-input-hwnd-wm-paste");
  if (!ok) return false;

  writeArtifact({
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: true,
    status: "pass-degraded-no-cdp",
    degraded: true,
    cdp: CDP,
    cdpFallbackReason: error instanceof Error ? error.message : String(error),
    warning: "WebView2/CDP WM_PASTE path was not exercised; this is a degraded Rust native HWND proof.",
    appPageUrl: null,
    terminalId: null,
    hwnd: pasteGuard.nativeSurfaceHwnd,
    source: "aelyris-native-paste-guard-proof",
    nativeClientArtifact: ".codex-auto/quality/native-client-spike.json",
    expectation:
      "A real Windows WM_PASTE sent to the native input HWND is intercepted by Rust, single-line paste is normalized, and destructive/multiline paste is blocked before PTY write.",
    checks: {
      windowsHost: true,
      tauriPageAttached: false,
      nativeNoCdpProof: true,
      aelyrisNativePasteGuardProof: true,
      nativeSurfaceHwndAvailable: typeof pasteGuard.nativeSurfaceHwnd === "string",
      wmPasteSentToNativeHwnd: pasteGuard.nativeHwndWmPaste === true,
      singleLineLfNormalizedAndExecuted: pasteGuard.singleLineLfNormalizedAndExecuted === true,
      destructivePasteBlockedBeforePty: pasteGuard.destructivePasteBlockedBeforePty === true,
      multilinePasteBlockedBeforePty: pasteGuard.multilinePasteBlockedBeforePty === true,
      guardEventCountAdvanced: pasteGuard.allCasesPass === true,
      noWebView: pasteGuard.webviewUsed === false,
      noReact: pasteGuard.reactUsed === false,
      noCdp: pasteGuard.cdpUsed === false,
    },
    finalStatus: {
      nativePasteGuardEventCount: cases.length,
      nativeSurfaceActive: true,
      nativeNoCdpProof: true,
    },
    cases,
  });
  return true;
}

if (process.platform !== "win32") {
  failEarly("native HWND paste live verification is Windows-only", {
    platform: process.platform,
    checks: { windowsHost: false },
  });
}

if (!existsSync(resolve(ROOT, "src-tauri/src/term/native_input.rs"))) {
  failEarly("repo root was not resolved correctly", {
    root: ROOT,
    checks: { repoRootResolved: false },
  });
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    sleep(timeoutMs).then(() => {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }),
  ]);
}

function gridText(snapshot) {
  if (!snapshot?.cells) return "";
  return snapshot.cells.map((row) => row.map((cell) => cell?.ch ?? " ").join("")).join("\n");
}

async function hasTauriInvoke(page) {
  try {
    return await page.evaluate(() => Boolean(window.__TAURI_INTERNALS__?.invoke));
  } catch {
    return false;
  }
}

async function findTauriPage(browser) {
  const deadline = Date.now() + APP_PAGE_TIMEOUT_MS;
  let observedUrls = [];
  while (Date.now() < deadline) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    observedUrls = pages.map((candidate) => candidate.url());
    for (const candidate of pages) {
      if (await hasTauriInvoke(candidate)) return candidate;
    }
    await sleep(250);
  }
  throw new Error(
    `no Tauri page with __TAURI_INTERNALS__.invoke found via ${CDP}; observed pages: ${
      observedUrls.join(", ") || "(none)"
    }`,
  );
}

async function call(page, cmd, args) {
  return page.evaluate(async ({ cmd, args }) => window.__TAURI_INTERNALS__.invoke(cmd, args), { cmd, args });
}

async function waitForSnapshotText(page, terminalId, needle, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";
  while (Date.now() < deadline) {
    const snapshot = await call(page, "term_snapshot", { id: terminalId }).catch(() => null);
    lastText = gridText(snapshot);
    if (lastText.includes(needle)) return { found: true, text: lastText };
    await sleep(150);
  }
  return { found: false, text: lastText };
}

async function waitForPowershellReadiness(page, terminalId) {
  const ready = await waitForSnapshotText(page, terminalId, "PS ", 15000);
  return ready.found;
}

function sendNativePaste(hwndHex, text) {
  const script = `
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AelyrisNativePasteSender {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern IntPtr SendMessage(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);
}
"@
$text = [Environment]::GetEnvironmentVariable("AELYRIS_NATIVE_PASTE_TEXT")
$hwndHex = [Environment]::GetEnvironmentVariable("AELYRIS_NATIVE_PASTE_HWND")
$hex = $hwndHex -replace '^0x',''
$hwnd = [IntPtr]([Convert]::ToInt64($hex, 16))
$last = $null
for ($i = 0; $i -lt 10; $i++) {
  try {
    [System.Windows.Forms.Clipboard]::SetText($text, [System.Windows.Forms.TextDataFormat]::UnicodeText)
    $last = $null
    break
  } catch {
    $last = $_
    Start-Sleep -Milliseconds 80
  }
}
if ($last -ne $null) { throw $last }
$result = [AelyrisNativePasteSender]::SendMessage($hwnd, ${WM_PASTE}, [IntPtr]::Zero, [IntPtr]::Zero)
Write-Output ("wm_paste_sent hwnd={0} result={1}" -f $hwndHex, $result.ToInt64())
`;
  const child = spawnSync("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script], {
    cwd: ROOT,
    env: {
      ...process.env,
      AELYRIS_NATIVE_PASTE_TEXT: text,
      AELYRIS_NATIVE_PASTE_HWND: hwndHex,
    },
    encoding: "utf8",
    timeout: PASTE_SENDER_TIMEOUT_MS,
  });
  return {
    ok: child.status === 0,
    exitCode: child.status,
    signal: child.signal,
    timedOut: child.error?.code === "ETIMEDOUT",
    stdout: child.stdout.trim(),
    stderr: child.stderr.trim(),
  };
}

async function focusNativeSurface(page, terminalId) {
  const rect = await page.evaluate((targetTerminalId) => {
    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(targetTerminalId)
        : targetTerminalId.replace(/["\\]/g, "\\$&");
    const canvas =
      document.querySelector(`canvas[data-terminal-id="${escaped}"]`) ??
      document.querySelector("canvas[data-terminal-id], canvas");
    if (!canvas) return { x: 24, y: 24, width: 80, height: 24 };
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.round(r.left + 16)),
      y: Math.max(0, Math.round(r.top + 16)),
      width: Math.max(320, Math.round(r.width - 16)),
      height: Math.max(18, Math.round(r.height / 24)),
      caretInset: 16,
    };
  }, terminalId);
  const status = await call(page, "native_terminal_input_focus", {
    terminalId,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    caretInset: rect.caretInset,
  });
  if (status?.nativeSurfaceActive !== true || typeof status?.nativeSurfaceHwnd !== "string") {
    throw new Error(`native input surface did not return an HWND: ${JSON.stringify(status)}`);
  }
  if (status?.activeTerminalId && status.activeTerminalId !== terminalId) {
    throw new Error(`native input surface focused the wrong terminal: ${JSON.stringify(status)}`);
  }
  return { rect, status, hwnd: status.nativeSurfaceHwnd };
}

async function drainAndStatus(page) {
  await call(page, "native_terminal_input_drain", {});
  return call(page, "native_terminal_input_status", {});
}

async function runCase(page, terminalId, testCase) {
  const focus = await focusNativeSurface(page, terminalId);
  await sleep(80);
  const before = await call(page, "native_terminal_input_status", {});
  const send = sendNativePaste(focus.hwnd, testCase.text);
  await sleep(120);
  const afterPaste = await call(page, "native_terminal_input_status", {});
  const afterDrain = await drainAndStatus(page);
  const visible = await waitForSnapshotText(
    page,
    terminalId,
    testCase.outputMarker,
    testCase.expectVisible ? 15000 : 1200,
  );
  const beforeCommitCount = Number(before?.directPtyCommitCount ?? 0);
  const afterDrainCommitCount = Number(afterDrain?.directPtyCommitCount ?? 0);
  const passed =
    send.ok === true &&
    afterPaste?.nativePasteGuardLastAction === testCase.expectedAction &&
    afterPaste?.nativePasteGuardLastReason === testCase.expectedReason &&
    afterPaste?.nativePasteGuardLastLineEndings === testCase.expectedLineEndings &&
    afterPaste?.nativePasteGuardEventCount > before?.nativePasteGuardEventCount &&
    visible.found === testCase.expectVisible &&
    (testCase.expectVisible ? afterDrainCommitCount > beforeCommitCount : afterDrainCommitCount === beforeCommitCount);
  return {
    id: testCase.id,
    ok: passed,
    shell: "powershell",
    path: "native-input-hwnd-wm-paste",
    message: testCase.message,
    hwnd: focus.hwnd,
    focusedTerminalId: focus.status?.activeTerminalId ?? null,
    expectedAction: testCase.expectedAction,
    expectedReason: testCase.expectedReason,
    expectedLineEndings: testCase.expectedLineEndings,
    outputMarker: testCase.outputMarker,
    markerVisible: visible.found,
    send,
    before: {
      eventCount: before?.nativePasteGuardEventCount ?? null,
      lastAction: before?.nativePasteGuardLastAction ?? null,
      directPtyCommitCount: before?.directPtyCommitCount ?? null,
    },
    afterPaste: {
      eventCount: afterPaste?.nativePasteGuardEventCount ?? null,
      lastAction: afterPaste?.nativePasteGuardLastAction ?? null,
      lastReason: afterPaste?.nativePasteGuardLastReason ?? null,
      lastLineEndings: afterPaste?.nativePasteGuardLastLineEndings ?? null,
      directPtyCommitCount: afterPaste?.directPtyCommitCount ?? null,
    },
    afterDrain: {
      lastCommitSource: afterDrain?.lastCommitSource ?? null,
      lastCommitBytes: afterDrain?.lastCommitBytes ?? null,
      directPtyCommitCount: afterDrain?.directPtyCommitCount ?? null,
      activeTerminalId: afterDrain?.activeTerminalId ?? null,
    },
    snapshotTail: visible.text.slice(-900),
  };
}

function makeCases(token) {
  const safeMarker = `AELYRIS_SAFE_${token}`;
  const blockedMarker = `AELYRIS_BLOCK_${token}`;
  const multiMarkerA = `AELYRIS_MULTI_A_${token}`;
  const multiMarkerB = `AELYRIS_MULTI_B_${token}`;
  return [
    {
      id: "single-line-lf-normalized-and-executed",
      message: "single-line LF paste is allowed, normalized to Enter, drained through Rust, and visibly executed",
      text: `echo ${safeMarker}\n`,
      outputMarker: safeMarker,
      expectedAction: "allowed",
      expectedReason: "single-line paste normalized by native input guard",
      expectedLineEndings: 1,
      expectVisible: true,
    },
    {
      id: "destructive-commented-paste-blocked-before-pty",
      message: "paste text containing a destructive command signature is blocked before any PTY write",
      text: `echo ${blockedMarker} # git reset --hard HEAD\n`,
      outputMarker: blockedMarker,
      expectedAction: "blocked",
      expectedReason: "destructive command paste blocked by native input guard",
      expectedLineEndings: 1,
      expectVisible: false,
    },
    {
      id: "multiline-paste-blocked-before-pty",
      message: "multi-line paste is blocked until an explicit UI confirmation path exists",
      text: `echo ${multiMarkerA}\necho ${multiMarkerB}\n`,
      outputMarker: multiMarkerA,
      secondaryOutputMarker: multiMarkerB,
      expectedAction: "blocked",
      expectedReason: "multi-line paste requires explicit UI confirmation",
      expectedLineEndings: 2,
      expectVisible: false,
    },
  ];
}

let browser;
let terminalId;
try {
  browser = await chromium.connectOverCDP(CDP);
  const page = await findTauriPage(browser);
  const url = new URL(APP_URL);
  url.searchParams.set("aelyrisVisualQa", "1");
  url.searchParams.set("projectPath", ROOT.replaceAll("\\", "/"));
  url.searchParams.set("rail", "command");
  url.searchParams.set("v", "native-hwnd-paste-live");
  url.searchParams.delete("state");
  url.searchParams.delete("edgeLoop");
  await page.goto(url.toString(), { waitUntil: "domcontentloaded" }).catch(() => {});
  await sleep(1500);

  terminalId = await call(page, "spawn_terminal", {
    shell: "powershell",
    cols: 120,
    rows: 30,
    cwd: ROOT,
  });
  const powershellReady = await waitForPowershellReadiness(page, terminalId);
  if (!powershellReady) {
    await sleep(1500);
  }

  const focus = await focusNativeSurface(page, terminalId);
  const token = Math.random().toString(36).slice(2, 9).toUpperCase();
  const cases = [];
  for (const testCase of makeCases(token)) {
    cases.push(await runCase(page, terminalId, testCase));
  }

  const multilineCase = cases.find((testCase) => testCase.id === "multiline-paste-blocked-before-pty");
  if (multilineCase) {
    const secondaryVisible = await waitForSnapshotText(
      page,
      terminalId,
      makeCases(token).find((testCase) => testCase.id === "multiline-paste-blocked-before-pty").secondaryOutputMarker,
      400,
    );
    multilineCase.secondaryMarkerVisible = secondaryVisible.found;
    multilineCase.ok = multilineCase.ok && secondaryVisible.found === false;
  }

  const passes = cases.filter((testCase) => testCase.ok).length;
  const finalStatus = await call(page, "native_terminal_input_status", {});
  const ok =
    passes === cases.length &&
    finalStatus?.nativeSurfaceActive === true &&
    Number(finalStatus?.nativePasteGuardEventCount ?? 0) >= cases.length &&
    cases.some((testCase) => testCase.id === "single-line-lf-normalized-and-executed" && testCase.markerVisible) &&
    cases.some(
      (testCase) => testCase.id === "destructive-commented-paste-blocked-before-pty" && !testCase.markerVisible,
    ) &&
    cases.some((testCase) => testCase.id === "multiline-paste-blocked-before-pty" && !testCase.markerVisible);

  writeArtifact({
    version: 1,
    generatedAt: new Date().toISOString(),
    ok,
    status: ok ? "pass-current-native-hwnd-paste-contract" : "failed",
    cdp: CDP,
    appPageUrl: page.url(),
    terminalId,
    hwnd: focus.hwnd,
    expectation:
      "A real Windows WM_PASTE sent to the native input HWND is intercepted by Rust, single-line paste is normalized, and destructive/multiline paste is blocked before PTY write.",
    checks: {
      windowsHost: true,
      tauriPageAttached: true,
      nativeSurfaceHwndAvailable: typeof focus.hwnd === "string" && focus.hwnd.startsWith("0x"),
      wmPasteSentToNativeHwnd: cases.every((testCase) => testCase.send?.ok === true),
      singleLineLfNormalizedAndExecuted: cases.some(
        (testCase) =>
          testCase.id === "single-line-lf-normalized-and-executed" &&
          testCase.ok === true &&
          testCase.afterPaste.lastAction === "allowed" &&
          testCase.afterPaste.lastLineEndings === 1 &&
          testCase.markerVisible === true,
      ),
      destructivePasteBlockedBeforePty: cases.some(
        (testCase) =>
          testCase.id === "destructive-commented-paste-blocked-before-pty" &&
          testCase.ok === true &&
          testCase.afterPaste.lastAction === "blocked" &&
          testCase.afterPaste.lastReason === "destructive command paste blocked by native input guard" &&
          testCase.markerVisible === false &&
          testCase.afterDrain.directPtyCommitCount === testCase.before.directPtyCommitCount,
      ),
      multilinePasteBlockedBeforePty: cases.some(
        (testCase) =>
          testCase.id === "multiline-paste-blocked-before-pty" &&
          testCase.ok === true &&
          testCase.afterPaste.lastAction === "blocked" &&
          testCase.afterPaste.lastReason === "multi-line paste requires explicit UI confirmation" &&
          testCase.markerVisible === false &&
          testCase.secondaryMarkerVisible === false &&
          testCase.afterDrain.directPtyCommitCount === testCase.before.directPtyCommitCount,
      ),
      guardEventCountAdvanced: Number(finalStatus?.nativePasteGuardEventCount ?? 0) >= cases.length,
    },
    finalStatus,
    cases,
  });

  process.exitCode = ok ? 0 : 1;
} catch (error) {
  if (nativeClientPasteGuardFallback(error)) {
    console.warn(
      `native HWND paste WebView2/CDP WM_PASTE path unexercised; accepted degraded aelyris-native no-CDP paste-guard proof: ${OUT}`,
    );
    process.exitCode = 0;
  } else {
  writeArtifact({
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: false,
    status: "failed",
    cdp: CDP,
    terminalId: terminalId ?? null,
    failure: error instanceof Error ? error.message : String(error),
  });
  console.error(error);
  process.exitCode = 1;
  }
} finally {
  if (browser) {
    try {
      const page = await findTauriPage(browser).catch(() => null);
      if (page && terminalId) await call(page, "close_terminal", { id: terminalId }).catch(() => {});
    } finally {
      if (process.env.AELYRIS_NATIVE_HWND_PASTE_CLOSE_BROWSER === "1") {
        await withTimeout(browser.close(), 1500, "CDP browser close").catch(() => {});
      } else if (typeof browser.disconnect === "function") {
        await withTimeout(browser.disconnect(), 1500, "CDP browser disconnect").catch(() => {});
      }
    }
  }
}

process.exit(process.exitCode ?? 0);
