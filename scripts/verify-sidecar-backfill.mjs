// Sidecar scrollback backfill verification via CDP attach.
//
// Two phases orchestrated by the caller around a hard app kill:
//   --phase seed    With the app live: ensure a sidecar terminal exists,
//                   write a unique marker through write_terminal, and assert
//                   it renders in term_snapshot. Marker is persisted to the
//                   artifact for the verify phase.
//   --phase verify  After the app was force-killed (sidecar daemon kept
//                   alive) and relaunched: WITHOUT writing anything, assert
//                   the adopted terminal's term_snapshot already contains the
//                   seeded marker — proving daemon-side scrollback backfill.
//
// Requires `pnpm tauri:dev` running with CDP on 9222.
// Run: pnpm node scripts/verify-sidecar-backfill.mjs --phase seed|verify

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const CDP = process.env.AELYRIS_BACKFILL_CDP ?? "http://127.0.0.1:9222";
const OUT = process.env.AELYRIS_BACKFILL_OUT ?? ".codex-auto/production-smoke/verify-sidecar-backfill.json";
const PHASE = process.argv.includes("--phase") ? process.argv[process.argv.indexOf("--phase") + 1] : "seed";

function loadArtifact() {
  try {
    return JSON.parse(readFileSync(resolve(OUT), "utf8"));
  } catch {
    return null;
  }
}

function writeArtifact(report) {
  const path = resolve(OUT);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function connectWithRetry() {
  let lastErr;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return await chromium.connectOverCDP(CDP);
    } catch (err) {
      lastErr = err;
      await sleep(2000);
    }
  }
  throw lastErr;
}

async function findAelyrisPage(browser) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const hasInternals = await page
          .evaluate(() => typeof window.__TAURI_INTERNALS__?.invoke === "function")
          .catch(() => false);
        if (hasInternals) return page;
      }
    }
    await sleep(1000);
  }
  throw new Error("no page with __TAURI_INTERNALS__ found over CDP");
}

async function listTerminals(page) {
  return page.evaluate(async () => {
    const ids = await window.__TAURI_INTERNALS__.invoke("list_terminals", {}).catch(() => []);
    return Array.isArray(ids) ? ids : [];
  });
}

async function snapshotText(page, id) {
  return page.evaluate(async (terminalId) => {
    const snap = await window.__TAURI_INTERNALS__.invoke("term_snapshot", { id: terminalId }).catch(() => null);
    if (!snap?.cells) return null;
    return snap.cells.map((row) => row.map((c) => c.ch).join("")).join("\n");
  }, id);
}

async function findMarker(page, marker, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let ids = [];
  while (Date.now() < deadline) {
    ids = await listTerminals(page);
    for (const id of ids) {
      const text = await snapshotText(page, id);
      if (text?.includes(marker)) {
        const sample = text.split("\n").find((line) => line.includes(marker)) ?? "";
        return { id, sample: sample.trimEnd().slice(0, 120), ids };
      }
    }
    await sleep(500);
  }
  return { id: null, sample: null, ids };
}

async function seed(page) {
  let ids = await listTerminals(page);
  if (ids.length === 0) {
    const spawned = await page.evaluate(async () =>
      window.__TAURI_INTERNALS__.invoke("spawn_terminal", {
        shell: "powershell",
        cols: 120,
        rows: 30,
        cwd: null,
      }),
    );
    console.log(`[backfill] spawned terminal ${spawned}`);
    await sleep(4000);
    ids = await listTerminals(page);
  }
  if (ids.length === 0) throw new Error("no terminal available to seed");

  const marker = `BACKFILL_${Date.now().toString(36).toUpperCase()}`;
  const target = ids[0];
  await page.evaluate(
    async ({ id, data }) => window.__TAURI_INTERNALS__.invoke("write_terminal", { id, data }),
    { id: target, data: `echo ${marker}\r` },
  );
  const hit = await findMarker(page, marker, 15000);
  if (!hit.id) throw new Error(`marker ${marker} did not render after write_terminal on ${target}`);
  console.log(`[backfill] seed OK: marker ${marker} visible in ${hit.id}`);
  return { marker, terminalId: hit.id, terminalIds: hit.ids };
}

async function verify(page, seeded) {
  if (!seeded?.marker) throw new Error("seed artifact missing; run --phase seed first");
  // Adoption + backfill happen during backend startup; allow time for the
  // sidecar probe, adoption, and the capture round-trip.
  const hit = await findMarker(page, seeded.marker, 30000);
  if (!hit.id) {
    throw new Error(
      `marker ${seeded.marker} not found after restart (terminals seen: ${JSON.stringify(hit.ids)}) — backfill failed`,
    );
  }
  console.log(`[backfill] verify OK: marker ${seeded.marker} restored in ${hit.id} ("${hit.sample}")`);
  return { restoredTerminalId: hit.id, sample: hit.sample, terminalIds: hit.ids };
}

async function main() {
  const prior = loadArtifact();
  const report = prior && PHASE === "verify" ? prior : { version: 1, taskId: "verify-sidecar-backfill" };
  report.cdp = CDP;
  report[`${PHASE}StartedAt`] = new Date().toISOString();

  const browser = await connectWithRetry();
  try {
    const page = await findAelyrisPage(browser);
    if (PHASE === "seed") {
      report.seed = await seed(page);
      report.status = "seeded";
    } else {
      report.verify = await verify(page, report.seed);
      report.status = "pass";
    }
  } catch (err) {
    report.status = PHASE === "seed" ? "seed-failed" : "fail";
    report.error = String(err?.message ?? err);
    throw err;
  } finally {
    report[`${PHASE}CompletedAt`] = new Date().toISOString();
    const path = writeArtifact(report);
    console.log(`[backfill] artifact: ${path} (${report.status})`);
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`[backfill] ${PHASE} failed: ${err?.message ?? err}`);
  process.exit(1);
});
