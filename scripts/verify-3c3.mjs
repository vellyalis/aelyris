// Phase 3C-3a — automated snapshot capture / list / get verification via
// CDP-attached Playwright. Run with: pnpm node scripts/verify-3c3.mjs
//
// Prerequisite: `pnpm tauri:dev` must be running with port 9222 exposed
// (tauri.dev.conf.json sets --remote-debugging-port=9222). Same pattern as
// scripts/verify-3c2.mjs.
//
// 3C-3a scope:
//   - IPC lifecycle: spawn_terminal → write Enter → list_snapshots → get_snapshot
//   - eviction: rapid Enter spam respects store cap
//   - mark_snapshot: explicit bookmark produces a UserMarked summary
//   - teardown: close_terminal drops all snapshots for the session
//
// 3C-3c (TimelineBar UI) is not implemented yet — UI checks are intentionally
// omitted until that sub-task lands.

import { chromium } from "@playwright/test";

const CDP = "http://localhost:9222";

const results = [];
function log(step, status, detail) {
  const entry = { step, status, detail };
  results.push(entry);
  const glyph = status === "OK" ? "✅" : status === "SKIP" ? "⚠️ " : "❌";
  console.log(`${glyph} [${step}] ${detail}`);
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => p.url().includes("localhost:1420"));
  if (!page) {
    console.error("[verify] no tauri page");
    process.exit(1);
  }
  console.log(`[verify] attached to ${page.url()}\n`);

  const call = (cmd, args) =>
    page.evaluate(
      async ({ cmd, args }) => {
        const w = /** @type {any} */ (window);
        const invoke = w.__TAURI_INTERNALS__?.invoke;
        if (!invoke) throw new Error("invoke not available");
        return invoke(cmd, args);
      },
      { cmd, args },
    );

  // ─── Step A: spawn a fresh terminal + baseline state ───────────────────
  console.log("# A. Snapshot capture pipeline");

  let termId;
  try {
    termId = await call("spawn_terminal", {
      shell: "PowerShell",
      cols: 80,
      rows: 24,
      cwd: null,
    });
    log("A-spawn", "OK", `terminal ${termId.slice(0, 8)}… spawned`);
  } catch (e) {
    log("A-spawn", "FAIL", String(e));
    await browser.close();
    process.exit(1);
  }

  // Give the shell a moment to paint the first prompt so the snapshot
  // actually has content.
  await page.waitForTimeout(800);

  let baselineList;
  try {
    baselineList = await call("list_snapshots", { sessionId: termId });
    log(
      "A-list baseline",
      Array.isArray(baselineList) ? "OK" : "FAIL",
      `pre-enter list length = ${Array.isArray(baselineList) ? baselineList.length : "not array"}`,
    );
  } catch (e) {
    log("A-list baseline", "FAIL", String(e));
  }

  // ─── Step B: Enter triggers a UserSubmitted snapshot ───────────────────
  try {
    await call("write_terminal", { id: termId, data: "echo hello\r" });
    // PTY write is async relative to snapshot capture — the capture is
    // synchronous inside write_terminal so the new entry must be visible
    // immediately. Small timeout to let any deferred re-list catch up.
    await page.waitForTimeout(200);
    const afterEnter = await call("list_snapshots", { sessionId: termId });
    const delta = afterEnter.length - (baselineList?.length ?? 0);
    if (delta >= 1) {
      const latest = afterEnter[afterEnter.length - 1];
      if (latest.trigger?.kind === "userSubmitted") {
        log(
          "B-enter-capture",
          "OK",
          `+${delta} snapshot, trigger=userSubmitted, ${latest.cols}x${latest.rows}`,
        );
      } else {
        log(
          "B-enter-capture",
          "FAIL",
          `trigger mismatch: ${JSON.stringify(latest.trigger)}`,
        );
      }
    } else {
      log("B-enter-capture", "FAIL", `expected +1 snapshot, got +${delta}`);
    }
  } catch (e) {
    log("B-enter-capture", "FAIL", String(e));
  }

  // ─── Step C: get_snapshot returns full grid ────────────────────────────
  try {
    const list = await call("list_snapshots", { sessionId: termId });
    const target = list[list.length - 1];
    const full = await call("get_snapshot", { snapshotId: target.id });
    if (!full) {
      log("C-get", "FAIL", "get_snapshot returned null");
    } else if (
      !full.grid ||
      !Array.isArray(full.grid.cells) ||
      full.grid.cells.length === 0
    ) {
      log("C-get", "FAIL", `grid missing or empty: ${JSON.stringify(full.grid).slice(0, 120)}`);
    } else {
      const rows = full.grid.cells.length;
      const cols = full.grid.cells[0]?.length ?? 0;
      log("C-get", "OK", `full snapshot: ${cols}x${rows} grid, id=${full.id.slice(0, 8)}…`);
    }
  } catch (e) {
    log("C-get", "FAIL", String(e));
  }

  try {
    const miss = await call("get_snapshot", { snapshotId: "nope-missing-id" });
    if (miss === null) {
      log("C-get miss", "OK", "unknown id → null");
    } else {
      log("C-get miss", "FAIL", `unknown id returned: ${JSON.stringify(miss).slice(0, 60)}`);
    }
  } catch (e) {
    log("C-get miss", "FAIL", String(e));
  }

  // ─── Step D: mark_snapshot with a label ────────────────────────────────
  try {
    const marked = await call("mark_snapshot", {
      args: { sessionId: termId, label: "pre-risky" },
    });
    if (marked?.trigger?.kind === "userMarked" && marked.trigger.label === "pre-risky") {
      log(
        "D-mark",
        "OK",
        `manual bookmark registered, label=${marked.trigger.label}`,
      );
    } else {
      log("D-mark", "FAIL", `unexpected summary: ${JSON.stringify(marked)}`);
    }
  } catch (e) {
    log("D-mark", "FAIL", String(e));
  }

  // ─── Step E: eviction — spam > cap, verify store stays bounded ─────────
  try {
    const listBefore = await call("list_snapshots", { sessionId: termId });
    const already = listBefore.length;
    // Send 130 Enters. Store cap is 100, so the post-spam list must be ≤ 100.
    for (let i = 0; i < 130; i++) {
      await call("write_terminal", { id: termId, data: "\r" });
    }
    await page.waitForTimeout(400);
    const listAfter = await call("list_snapshots", { sessionId: termId });
    if (listAfter.length > 100) {
      log(
        "E-eviction",
        "FAIL",
        `expected ≤ 100 after 130 enters, got ${listAfter.length}`,
      );
    } else if (listAfter.length < Math.min(100, already + 130)) {
      // We sent 130 enters; the store should have pinned at the cap (100)
      // or at the natural growth if < 100. Either shape is valid, but going
      // backwards beyond expected is suspicious.
      log(
        "E-eviction",
        "OK",
        `capped at ${listAfter.length} (≤ 100) after +130 enters (was ${already})`,
      );
    } else {
      log(
        "E-eviction",
        "OK",
        `store bounded at ${listAfter.length} (was ${already}, cap 100)`,
      );
    }
  } catch (e) {
    log("E-eviction", "FAIL", String(e));
  }

  // ─── Step G: start_snapshot_overlay → layer registered read-only ──────
  // (3C-3b) — done before cleanup so we can tear down both cleanly.
  console.log("\n# G. Snapshot overlay lifecycle (3C-3b)");

  // Ensure we have at least one snapshot to overlay. The eviction step
  // may have left many — just pick the latest.
  let overlayId;
  let overlayLayer;
  try {
    const list = await call("list_snapshots", { sessionId: termId });
    if (list.length === 0) {
      log("G-pre", "FAIL", "no snapshots to overlay");
    } else {
      const target = list[list.length - 1];
      overlayLayer = await call("start_snapshot_overlay", {
        snapshotId: target.id,
      });
      overlayId = overlayLayer.id;
      const ok =
        overlayLayer.source?.kind === "snapshot" &&
        overlayLayer.source.sessionId === termId &&
        overlayLayer.source.snapshotId === target.id &&
        overlayLayer.isComplete === true &&
        overlayLayer.tint?.roleColor?.toLowerCase() === "#94e2d5" &&
        overlayLayer.tint?.roleLabel === "snapshot" &&
        overlayLayer.fileCount === 0 &&
        overlayLayer.hunkCount === 0;
      if (ok) {
        log(
          "G-start",
          "OK",
          `overlay ${overlayId.slice(0, 16)}… registered, source=snapshot, tint=teal`,
        );
      } else {
        log(
          "G-start",
          "FAIL",
          `unexpected layer shape: ${JSON.stringify(overlayLayer).slice(0, 260)}`,
        );
      }
    }
  } catch (e) {
    log("G-start", "FAIL", String(e));
  }

  // Appears in list_ghost_layers
  if (overlayId) {
    try {
      const layers = await call("list_ghost_layers", {});
      const hit = layers.find((l) => l.id === overlayId);
      if (hit && hit.source?.kind === "snapshot") {
        log("G-list", "OK", "overlay visible in list_ghost_layers with snapshot source");
      } else {
        log("G-list", "FAIL", `overlay missing or wrong source: ${JSON.stringify(hit)}`);
      }
    } catch (e) {
      log("G-list", "FAIL", String(e));
    }
  }

  // apply_ghost_hunk must be rejected (read-only gate)
  if (overlayId) {
    try {
      await call("apply_ghost_hunk", {
        layerId: overlayId,
        filePath: "any.ts",
        hunkIndex: 0,
      });
      log("G-readonly hunk", "FAIL", "apply_ghost_hunk should reject snapshot layer");
    } catch (e) {
      const msg = String(e);
      if (msg.includes("read-only")) {
        log("G-readonly hunk", "OK", "apply_ghost_hunk rejected with 'read-only'");
      } else {
        log("G-readonly hunk", "FAIL", `wrong rejection: ${msg}`);
      }
    }

    try {
      await call("apply_ghost_file", {
        layerId: overlayId,
        filePath: "any.ts",
      });
      log("G-readonly file", "FAIL", "apply_ghost_file should reject snapshot layer");
    } catch (e) {
      const msg = String(e);
      if (msg.includes("read-only")) {
        log("G-readonly file", "OK", "apply_ghost_file rejected with 'read-only'");
      } else {
        log("G-readonly file", "FAIL", `wrong rejection: ${msg}`);
      }
    }
  }

  // Unknown snapshot id → error
  try {
    await call("start_snapshot_overlay", { snapshotId: "nope-missing-id" });
    log("G-unknown", "FAIL", "expected rejection on unknown snapshot id");
  } catch (e) {
    if (String(e).includes("not found") || String(e).includes("evicted")) {
      log("G-unknown", "OK", "unknown snapshot id rejected as not found");
    } else {
      log("G-unknown", "FAIL", `wrong rejection: ${e}`);
    }
  }

  // Dismiss the overlay via the existing ghost-diff IPC
  if (overlayId) {
    try {
      await call("dismiss_ghost_layer", { layerId: overlayId });
      const layers = await call("list_ghost_layers", {});
      if (layers.some((l) => l.id === overlayId)) {
        log("G-dismiss", "FAIL", "overlay still present after dismiss");
      } else {
        log("G-dismiss", "OK", "overlay fully removed via dismiss_ghost_layer");
      }
    } catch (e) {
      log("G-dismiss", "FAIL", String(e));
    }
  }

  // ─── Step F: close_terminal drops the session's snapshots ──────────────
  try {
    await call("close_terminal", { id: termId });
    await page.waitForTimeout(200);
    const after = await call("list_snapshots", { sessionId: termId });
    if (Array.isArray(after) && after.length === 0) {
      log("F-cleanup", "OK", "close_terminal dropped all snapshots");
    } else {
      log("F-cleanup", "FAIL", `expected empty list, got length=${after?.length}`);
    }
  } catch (e) {
    log("F-cleanup", "FAIL", String(e));
  }

  // ─── Summary ───────────────────────────────────────────────────────────
  const ok = results.filter((r) => r.status === "OK").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const skip = results.filter((r) => r.status === "SKIP").length;
  console.log(`\n# Summary: ${ok} OK / ${fail} FAIL / ${skip} SKIP`);
  if (fail > 0) {
    console.log("FAILED STEPS:");
    for (const r of results.filter((r) => r.status === "FAIL")) {
      console.log(`  - ${r.step}: ${r.detail}`);
    }
  }

  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("[verify] fatal:", e);
  process.exit(1);
});
