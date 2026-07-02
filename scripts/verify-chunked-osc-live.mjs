// End-to-end live smoke gate for the chunked-OSC inline-image protocol.
//
// Run prerequisite: `pnpm tauri:dev` is up and port 9222 is reachable.
// Walks four combinations (PowerShell + Git Bash) × (1×1 + 32×32 PNG)
// and asserts each one round-trips an image entry through the engine.
// Exits 0 only when all four PASS — suitable as a pre-release smoke
// gate or a Sprint-2 acceptance check.
//
// Companion of:
//   - scripts/aelyris-imgcat.ps1 / .sh  (the emitter)
//   - e2e/fixtures/inline-image-{1x1,32x32}.png  (the inputs)
// This verifier supersedes the old Kitty-APC diagnostics; release proof
// should flow through this deterministic chunked OSC path.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\//, ""));
const OUT = resolve(REPO_ROOT, ".codex-auto/production-smoke/chunked-osc-live.json");
const FIXTURE_TINY = resolve(REPO_ROOT, "e2e/fixtures/inline-image-1x1.png");
const FIXTURE_LARGE = resolve(REPO_ROOT, "e2e/fixtures/inline-image-32x32.png");
const REQUIRED_CASE_COUNT = 4;
const REQUIRED_SHELLS = ["powershell", "gitbash"];

function writeArtifact(report) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
}

for (const f of [FIXTURE_TINY, FIXTURE_LARGE]) {
  if (!existsSync(f)) {
    writeArtifact({
      version: 1,
      generatedAt: new Date().toISOString(),
      ok: false,
      status: "failed",
      failure: `fixture missing: ${f}`,
      checks: {
        fixturesPresent: false,
      },
    });
    console.error(`fixture missing: ${f}\nRun: node scripts/build-image-fixtures.mjs`);
    process.exit(1);
  }
}

const CDP = process.env.AELYRIS_TAURI_CDP ?? "http://127.0.0.1:9222";
const APP_PAGE_TIMEOUT_MS = Number.parseInt(process.env.AELYRIS_TAURI_PAGE_TIMEOUT_MS ?? "15000", 10);
const SHELL_READY_TIMEOUT_MS = Number.parseInt(process.env.AELYRIS_CHUNKED_OSC_SHELL_READY_TIMEOUT_MS ?? "30000", 10);
const IMAGE_WAIT_MS = Number.parseInt(process.env.AELYRIS_CHUNKED_OSC_IMAGE_WAIT_MS ?? "15000", 10);

const browser = await chromium.connectOverCDP(CDP);

async function hasTauriInvoke(page) {
  try {
    return await page.evaluate(() => Boolean(window.__TAURI_INTERNALS__?.invoke));
  } catch {
    return false;
  }
}

async function findTauriPage() {
  const deadline = Date.now() + APP_PAGE_TIMEOUT_MS;
  let observedUrls = [];
  while (Date.now() < deadline) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    observedUrls = pages.map((candidate) => candidate.url());
    for (const candidate of pages) {
      if (await hasTauriInvoke(candidate)) {
        return candidate;
      }
    }
    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 250));
  }
  throw new Error(
    `no Tauri page with __TAURI_INTERNALS__.invoke found via ${CDP}; observed pages: ${
      observedUrls.join(", ") || "(none)"
    }`,
  );
}

const page = await findTauriPage();
const appPageUrl = page.url();

const call = (cmd, args) =>
  page.evaluate(async ({ cmd, args }) => window.__TAURI_INTERNALS__.invoke(cmd, args), { cmd, args });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function snapshotText(snap) {
  return (snap?.cells ?? [])
    .map((row) => row.map((cell) => cell?.ch ?? " ").join("").trimEnd())
    .join("\n");
}

async function waitForShellReady(id, shell) {
  const deadline = Date.now() + SHELL_READY_TIMEOUT_MS;
  let text = "";
  while (Date.now() < deadline) {
    const snap = await call("term_snapshot", { id });
    text = snapshotText(snap);
    if (shell === "powershell" && /PS\s+.*>\s*$/m.test(text)) return text;
    if (shell === "gitbash" && /\n\$\s*$/m.test(text)) return text;
    await sleep(250);
  }
  throw new Error(`shell did not become ready for ${shell}; sample=${text.slice(-600)}`);
}

/** Spawn a shell, run the emitter, poll for images, assert round-trip. */
async function runCase({ label, shell, command }) {
  const tid = await call("spawn_terminal", {
    shell,
    cols: 120,
    rows: 30,
    cwd: REPO_ROOT,
  });
  console.log(`[${label}] spawned ${shell} terminal: ${tid}`);
  try {
    await waitForShellReady(tid, shell);
    await call("write_terminal", { id: tid, data: `${command}\r` });

    const deadline = Date.now() + IMAGE_WAIT_MS;
    let snap = null;
    while (Date.now() < deadline) {
      snap = await call("term_snapshot", { id: tid });
      if (snap?.images?.length > 0) break;
      await sleep(150);
    }
    if (!snap?.images?.length) {
      const failure = `no images surfaced after ${IMAGE_WAIT_MS} ms`;
      console.error(`[${label}] FAIL — ${failure}`);
      return { label, shell, ok: false, failure };
    }

    const ref = snap.images[0];
    if (!Number.isInteger(ref.id) || ref.id < 0) {
      const failure = `invalid ImageRef.id: ${ref.id}`;
      console.error(`[${label}] FAIL — ${failure}`);
      return { label, shell, ok: false, failure };
    }
    if (!Number.isFinite(ref.widthPx) || ref.widthPx <= 0) {
      const failure = `invalid widthPx: ${ref.widthPx}`;
      console.error(`[${label}] FAIL — ${failure}`);
      return { label, shell, ok: false, failure };
    }

    const data = await call("term_image_data", { id: tid, imageId: ref.id });
    if (!data) {
      const failure = `term_image_data returned null for id=${ref.id}`;
      console.error(`[${label}] FAIL — ${failure}`);
      return { label, shell, ok: false, failure };
    }
    if (data.format !== "png") {
      const failure = `expected format=png, got ${data.format}`;
      console.error(`[${label}] FAIL — ${failure}`);
      return { label, shell, ok: false, failure };
    }
    const decoded = Buffer.from(data.dataBase64, "base64");
    const sig = Array.from(decoded.subarray(0, 8))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (sig !== "89504e470d0a1a0a") {
      const failure = `PNG signature mismatch: ${sig}`;
      console.error(`[${label}] FAIL — ${failure}`);
      return { label, shell, ok: false, failure };
    }
    console.log(
      `[${label}] PASS — image id=${ref.id} ${data.widthPx}x${data.heightPx} ` +
        `(${decoded.length} raw bytes round-tripped)`,
    );
    return {
      label,
      shell,
      ok: true,
      imageId: ref.id,
      format: data.format,
      widthPx: data.widthPx,
      heightPx: data.heightPx,
      rawBytes: decoded.length,
      pngSignature: sig,
    };
  } finally {
    try {
      await call("close_terminal", { id: tid });
    } catch {
      /* best effort */
    }
  }
}

// Build the per-shell emitter command. PowerShell needs the script
// invoked with -ExecutionPolicy Bypass for an unsigned local file;
// bash invokes the .sh through `bash` so chmod +x isn't required
// (Windows git doesn't preserve the executable bit anyway).
const psPath = resolve(REPO_ROOT, "scripts/aelyris-imgcat.ps1");
const shPath = resolve(REPO_ROOT, "scripts/aelyris-imgcat.sh");

function pathForGitBash(path) {
  const normalized = path.replace(/\\/g, "/");
  const match = /^([A-Za-z]):(\/.*)$/.exec(normalized);
  if (!match) return normalized;
  return `/${match[1].toLowerCase()}${match[2]}`;
}

const cases = [
  // Windows ConPTY can drop a child process' first output packet when it
  // is pure OSC control bytes. The shell-level anchor keeps the proof on
  // the real PTY path while preventing the first BEGIN frame from being
  // lost before the engine can parse it.
  {
    label: "powershell + 1x1",
    shell: "powershell",
    command: `Write-Host "." -NoNewline; powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}" "${FIXTURE_TINY}"`,
  },
  {
    label: "powershell + 32x32",
    shell: "powershell",
    command: `Write-Host "." -NoNewline; powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}" "${FIXTURE_LARGE}"`,
  },
  {
    label: "gitbash + 1x1",
    shell: "gitbash",
    command: `printf '.\\n'; bash '${pathForGitBash(shPath)}' '${pathForGitBash(FIXTURE_TINY)}'`,
  },
  {
    label: "gitbash + 32x32",
    shell: "gitbash",
    command: `printf '.\\n'; bash '${pathForGitBash(shPath)}' '${pathForGitBash(FIXTURE_LARGE)}'`,
  },
];

const results = [];
for (const c of cases) {
  results.push(await runCase(c));
}

await browser.close();

const passes = results.filter((result) => result.ok === true).length;
const shellsCovered = REQUIRED_SHELLS.every((shell) => results.some((result) => result.shell === shell));
const tinyCasesPassed = results.filter((result) => result.label.includes("1x1") && result.ok === true).length;
const largeCasesPassed = results.filter((result) => result.label.includes("32x32") && result.ok === true).length;
const ok =
  passes === REQUIRED_CASE_COUNT &&
  results.length === REQUIRED_CASE_COUNT &&
  shellsCovered &&
  tinyCasesPassed === REQUIRED_SHELLS.length &&
  largeCasesPassed === REQUIRED_SHELLS.length &&
  results.every((result) => result.format === "png" && result.pngSignature === "89504e470d0a1a0a");

writeArtifact({
  version: 1,
  generatedAt: new Date().toISOString(),
  ok,
  status: ok ? "pass-current-chunked-osc-live-contract" : "failed",
  cdp: CDP,
  appPageUrl,
  expectation:
    "PowerShell and Git Bash both round-trip 1x1 and 32x32 PNG inline images through the chunked OSC terminal path.",
  checks: {
    fixturesPresent: true,
    requiredCaseCountCovered: results.length === REQUIRED_CASE_COUNT,
    allCasesPassed: passes === REQUIRED_CASE_COUNT,
    shellsCovered,
    tinyFixturePassedForEveryShell: tinyCasesPassed === REQUIRED_SHELLS.length,
    largeFixturePassedForEveryShell: largeCasesPassed === REQUIRED_SHELLS.length,
    pngSignatureVerified: results.every((result) => result.ok !== true || result.pngSignature === "89504e470d0a1a0a"),
  },
  cases: results,
});

console.log(`\n${passes}/${cases.length} cases PASS`);
process.exit(ok ? 0 : 1);
