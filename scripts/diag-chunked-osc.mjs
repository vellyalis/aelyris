// End-to-end smoke gate for the chunked-OSC inline-image protocol.
//
// Run prerequisite: `pnpm tauri:dev` is up and port 9222 is reachable.
// Walks four combinations (PowerShell + Git Bash) × (1×1 + 32×32 PNG)
// and asserts each one round-trips an image entry through the engine.
// Exits 0 only when all four PASS — suitable as a pre-release smoke
// gate or a Sprint-2 acceptance check.
//
// Companion of:
//   - scripts/aether-imgcat.ps1 / .sh  (the emitter)
//   - e2e/fixtures/inline-image-{1x1,32x32}.png  (the inputs)
//   - scripts/diag-image-escape.mjs  (the original Kitty-APC diag,
//     kept as a regression reproducer for the dropped APC path)

import { chromium } from "playwright";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname.replace(/^\//, ""));
const FIXTURE_TINY = resolve(REPO_ROOT, "e2e/fixtures/inline-image-1x1.png");
const FIXTURE_LARGE = resolve(REPO_ROOT, "e2e/fixtures/inline-image-32x32.png");

for (const f of [FIXTURE_TINY, FIXTURE_LARGE]) {
  if (!existsSync(f)) {
    console.error(`fixture missing: ${f}\nRun: node scripts/build-image-fixtures.mjs`);
    process.exit(1);
  }
}

const browser = await chromium.connectOverCDP("http://localhost:9222");
const ctx = browser.contexts()[0];
const page = ctx?.pages().find((p) => p.url().includes("localhost:1420"));
if (!page) {
  console.error("no Tauri page found at localhost:1420");
  process.exit(1);
}

const call = (cmd, args) =>
  page.evaluate(
    async ({ cmd, args }) => window.__TAURI_INTERNALS__.invoke(cmd, args),
    { cmd, args },
  );

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    // Let the prompt settle so the emitter's output lands cleanly.
    await sleep(800);
    await call("write_terminal", { id: tid, data: command + "\r" });

    // Poll up to 8 s for an images entry to surface.
    const deadline = Date.now() + 8000;
    let snap = null;
    while (Date.now() < deadline) {
      snap = await call("term_snapshot", { id: tid });
      if (snap?.images?.length > 0) break;
      await sleep(150);
    }
    if (!snap?.images?.length) {
      console.error(`[${label}] FAIL — no images surfaced after 8 s`);
      return false;
    }

    const ref = snap.images[0];
    if (!Number.isInteger(ref.id) || ref.id < 0) {
      console.error(`[${label}] FAIL — invalid ImageRef.id: ${ref.id}`);
      return false;
    }
    if (!Number.isFinite(ref.widthPx) || ref.widthPx <= 0) {
      console.error(`[${label}] FAIL — invalid widthPx: ${ref.widthPx}`);
      return false;
    }

    const data = await call("term_image_data", { id: tid, imageId: ref.id });
    if (!data) {
      console.error(`[${label}] FAIL — term_image_data returned null for id=${ref.id}`);
      return false;
    }
    if (data.format !== "png") {
      console.error(`[${label}] FAIL — expected format=png, got ${data.format}`);
      return false;
    }
    const decoded = Buffer.from(data.dataBase64, "base64");
    const sig = Array.from(decoded.subarray(0, 8))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (sig !== "89504e470d0a1a0a") {
      console.error(`[${label}] FAIL — PNG signature mismatch: ${sig}`);
      return false;
    }
    console.log(
      `[${label}] PASS — image id=${ref.id} ${data.widthPx}x${data.heightPx} ` +
        `(${decoded.length} raw bytes round-tripped)`,
    );
    return true;
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
const psPath = resolve(REPO_ROOT, "scripts/aether-imgcat.ps1");
const shPath = resolve(REPO_ROOT, "scripts/aether-imgcat.sh");

const cases = [
  {
    label: "powershell + 1x1",
    shell: "powershell",
    command: `powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}" "${FIXTURE_TINY}"`,
  },
  {
    label: "powershell + 32x32",
    shell: "powershell",
    command: `powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}" "${FIXTURE_LARGE}"`,
  },
  {
    label: "gitbash + 1x1",
    shell: "gitbash",
    // Convert backslashes for bash. The fixture path is already POSIX-
    // friendly because it lives under the repo, but the absolute repo
    // root may have backslashes when REPO_ROOT was resolved on Windows.
    command: `bash '${shPath.replace(/\\/g, "/")}' '${FIXTURE_TINY.replace(/\\/g, "/")}'`,
  },
  {
    label: "gitbash + 32x32",
    shell: "gitbash",
    command: `bash '${shPath.replace(/\\/g, "/")}' '${FIXTURE_LARGE.replace(/\\/g, "/")}'`,
  },
];

let passes = 0;
for (const c of cases) {
  const ok = await runCase(c);
  if (ok) passes++;
}

await browser.close();

console.log(`\n${passes}/${cases.length} cases PASS`);
process.exit(passes === cases.length ? 0 : 1);
