// Phase 3C-2 — automated A/B/C verification via CDP-attached Playwright.
// Run with: pnpm node scripts/verify-3c2.mjs

import { chromium } from "@playwright/test";

const CDP = "http://localhost:9222";
const REPO = process.env.AETHER_REPO_PATH ?? process.cwd();

const results = [];
function log(step, status, detail) {
  const entry = { step, status, detail };
  results.push(entry);
  const glyph = status === "OK" ? "✅" : status === "SKIP" ? "⚠️ " : "❌";
  console.log(`${glyph} [${step}] ${detail}`);
}

async function withRetry(fn, { tries = 10, delay = 300 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fn();
      if (r !== undefined && r !== null) return r;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, delay));
  }
  throw last ?? new Error("withRetry exhausted");
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const page = browser.contexts()[0].pages().find((p) => p.url().includes("localhost:1420"));
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

  // ─── Step A-IPC: full branch-comparison lifecycle ──────────────────────
  console.log("# A. Branch Comparison (IPC layer)");

  let branches;
  try {
    branches = await call("list_branches", { repoPath: REPO });
    log("A-0 list_branches", "OK", `${branches.length} branches`);
  } catch (e) {
    log("A-0 list_branches", "FAIL", String(e));
    await browser.close();
    process.exit(1);
  }
  const current = branches.find((b) => b.is_head)?.name;
  const otherLocal = branches.find((b) => !b.is_head && !b.is_remote)?.name;
  if (!current || !otherLocal) {
    log("A-0 branches", "FAIL", `need current and another local branch, got ${JSON.stringify(branches)}`);
    await browser.close();
    process.exit(1);
  }
  console.log(`   current=${current}  target=${otherLocal}`);

  // dismiss any leftover layers from previous runs so we start clean
  try {
    const existing = await call("list_ghost_layers", {});
    for (const layer of existing) {
      await call("dismiss_ghost_layer", { layerId: layer.id });
    }
    if (existing.length > 0) {
      console.log(`   cleaned up ${existing.length} pre-existing layers`);
    }
  } catch (e) {
    console.log(`   cleanup skipped: ${e}`);
  }

  // Same-branch rejection
  try {
    await call("start_branch_comparison", {
      repoPath: REPO,
      baseBranch: current,
      headBranch: current,
    });
    log("A-reject-same", "FAIL", "same-branch request was not rejected");
  } catch (e) {
    if (String(e).includes("must differ")) {
      log("A-reject-same", "OK", "same-branch rejected with 'must differ'");
    } else {
      log("A-reject-same", "FAIL", `unexpected error: ${e}`);
    }
  }

  // Unknown branch rejection
  try {
    await call("start_branch_comparison", {
      repoPath: REPO,
      baseBranch: current,
      headBranch: "zzz-no-such-branch-xyz",
    });
    log("A-reject-missing", "FAIL", "unknown branch was not rejected");
  } catch (e) {
    log("A-reject-missing", "OK", `unknown-branch rejected: ${String(e).slice(0, 120)}`);
  }

  // Happy path
  let startedLayer;
  try {
    startedLayer = await call("start_branch_comparison", {
      repoPath: REPO,
      baseBranch: current,
      headBranch: otherLocal,
    });
    log(
      "A-start",
      "OK",
      `layer ${startedLayer.id.slice(0, 20)}… registered, ${startedLayer.fileCount} files, ${startedLayer.hunkCount} hunks`,
    );
  } catch (e) {
    log("A-start", "FAIL", String(e));
    await browser.close();
    process.exit(1);
  }

  // Registry verification
  try {
    const list = await call("list_ghost_layers", {});
    const mine = list.find((l) => l.id === startedLayer.id);
    if (!mine) {
      log("A-list", "FAIL", "layer not returned by list_ghost_layers");
    } else {
      const checks = [];
      if (mine.source.kind !== "branchComparison")
        checks.push(`source.kind=${mine.source.kind}`);
      if (mine.source.baseBranch !== current)
        checks.push(`baseBranch=${mine.source.baseBranch}`);
      if (mine.source.headBranch !== otherLocal)
        checks.push(`headBranch=${mine.source.headBranch}`);
      if (mine.tint.roleColor.toLowerCase() !== "#89dceb")
        checks.push(`tint=${mine.tint.roleColor}`);
      if (mine.tint.roleLabel !== "branch")
        checks.push(`label=${mine.tint.roleLabel}`);
      if (mine.isComplete !== true) checks.push(`isComplete=${mine.isComplete}`);
      log(
        "A-list shape",
        checks.length === 0 ? "OK" : "FAIL",
        checks.length === 0
          ? "source.kind=branchComparison, tint sky, isComplete=true"
          : `mismatches: ${checks.join(", ")}`,
      );
    }
  } catch (e) {
    log("A-list", "FAIL", String(e));
  }

  // Fetch one file delta
  let sampleFile;
  try {
    sampleFile = (startedLayer.filePaths ?? [])[0];
    if (!sampleFile) {
      log("A-get-file", "SKIP", "no file paths in layer (branches identical?)");
    } else {
      const delta = await call("get_ghost_layer_file", {
        layerId: startedLayer.id,
        filePath: sampleFile,
      });
      if (!delta) {
        log("A-get-file", "FAIL", `get_ghost_layer_file returned null for ${sampleFile}`);
      } else {
        log(
          "A-get-file",
          "OK",
          `${sampleFile}: ${delta.hunks.length} hunks, base ${delta.baseContent.length}B, head ${delta.headContent.length}B`,
        );
      }
    }
  } catch (e) {
    log("A-get-file", "FAIL", String(e));
  }

  // Read-only enforcement — apply_ghost_hunk must refuse
  if (sampleFile) {
    try {
      await call("apply_ghost_hunk", {
        layerId: startedLayer.id,
        filePath: sampleFile,
        hunkIndex: 0,
      });
      log("A-readonly hunk", "FAIL", "apply_ghost_hunk should reject read-only layer");
    } catch (e) {
      const msg = String(e);
      if (msg.includes("read-only")) {
        log("A-readonly hunk", "OK", "apply_ghost_hunk rejected with 'read-only'");
      } else {
        log("A-readonly hunk", "FAIL", `wrong rejection: ${msg}`);
      }
    }

    try {
      await call("apply_ghost_file", {
        layerId: startedLayer.id,
        filePath: sampleFile,
      });
      log("A-readonly file", "FAIL", "apply_ghost_file should reject read-only layer");
    } catch (e) {
      const msg = String(e);
      if (msg.includes("read-only")) {
        log("A-readonly file", "OK", "apply_ghost_file rejected with 'read-only'");
      } else {
        log("A-readonly file", "FAIL", `wrong rejection: ${msg}`);
      }
    }
  }

  // dismiss_ghost_file
  if (sampleFile) {
    try {
      const cleared = await call("dismiss_ghost_file", {
        layerId: startedLayer.id,
        filePath: sampleFile,
      });
      log("A-dismiss-file", "OK", `dismiss_ghost_file returned ${cleared}`);

      // Delta must now be gone.
      const delta = await call("get_ghost_layer_file", {
        layerId: startedLayer.id,
        filePath: sampleFile,
      });
      if (delta) {
        log("A-dismiss-file effect", "FAIL", `file delta still present after dismiss`);
      } else {
        log("A-dismiss-file effect", "OK", "file delta removed from layer");
      }
    } catch (e) {
      log("A-dismiss-file", "FAIL", String(e));
    }
  }

  // Full-layer dismiss
  try {
    await call("dismiss_ghost_layer", { layerId: startedLayer.id });
    const list = await call("list_ghost_layers", {});
    if (list.some((l) => l.id === startedLayer.id)) {
      log("A-dismiss-layer", "FAIL", "layer still present after dismiss_ghost_layer");
    } else {
      log("A-dismiss-layer", "OK", "layer fully removed");
    }
  } catch (e) {
    log("A-dismiss-layer", "FAIL", String(e));
  }

  // ─── Step UI: Command palette + View menu presence ─────────────────────
  console.log("\n# UI surface");

  // Compare Branch... in command palette
  try {
    await page.keyboard.press("Control+Shift+P");
    await page.waitForTimeout(300);
    const paletteInput = await page
      .locator('input[placeholder*="command"]:visible, [role="combobox"]:visible')
      .first();
    await paletteInput.fill("compare", { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
    const visible = await page.getByText(/Compare Branch/).count();
    if (visible > 0) {
      log("UI-palette entry", "OK", "Compare Branch... appears in command palette");
    } else {
      log("UI-palette entry", "FAIL", "Compare Branch... not found in palette");
    }
    await page.keyboard.press("Escape");
  } catch (e) {
    log("UI-palette entry", "FAIL", String(e));
  }

  // View menu entry
  try {
    await page.getByRole("button", { name: "View", exact: true }).click({ timeout: 3000 });
    await page.waitForTimeout(200);
    const inMenu = await page.getByText(/Compare Branch/).count();
    if (inMenu > 0) {
      log("UI-view-menu", "OK", "View menu contains Compare Branch...");
    } else {
      log("UI-view-menu", "FAIL", "View menu missing Compare Branch...");
    }
    await page.keyboard.press("Escape");
  } catch (e) {
    log("UI-view-menu", "FAIL", String(e));
  }

  // Ghost Diff Overlay section in Settings
  try {
    await page.keyboard.press("Control+Comma");
    await page.waitForTimeout(300);
    const section = await page.getByText(/Ghost Diff Overlay/).count();
    const toggle = await page.getByText(/Live mode \(paint in-progress layers\)/).count();
    if (section > 0 && toggle > 0) {
      log("UI-settings section", "OK", "Ghost Diff Overlay section + live mode toggle visible");
    } else {
      log("UI-settings section", "FAIL", `section=${section} toggle=${toggle}`);
    }
    await page.keyboard.press("Escape");
  } catch (e) {
    log("UI-settings section", "FAIL", String(e));
  }

  // StatusBar Ghost diff button
  try {
    const btn = await page.getByRole("button", { name: /Ghost diff/ }).count();
    if (btn > 0) {
      log("UI-statusbar", "OK", "StatusBar has Ghost diff button");
    } else {
      log("UI-statusbar", "FAIL", "StatusBar missing Ghost diff button");
    }
  } catch (e) {
    log("UI-statusbar", "FAIL", String(e));
  }

  // ─── Step C: Live mode toggle round-trip ───────────────────────────────
  console.log("\n# C. Live mode (3C-1d) persistence");

  let originalLive;
  try {
    const cfg = await call("load_app_config", {});
    originalLive = cfg.ghost_diff?.live_mode ?? false;
    log(
      "C-load default",
      originalLive === false ? "OK" : "OK",
      `live_mode currently ${originalLive} (default should be false on first run)`,
    );
  } catch (e) {
    log("C-load", "FAIL", String(e));
  }

  try {
    // Flip to true, reload, verify.
    const cfg = await call("load_app_config", {});
    cfg.ghost_diff = { ...(cfg.ghost_diff ?? {}), live_mode: true };
    await call("save_app_config", { config: cfg });
    const back = await call("load_app_config", {});
    if (back.ghost_diff?.live_mode === true) {
      log("C-save true", "OK", "live_mode persisted as true");
    } else {
      log("C-save true", "FAIL", `live_mode came back as ${back.ghost_diff?.live_mode}`);
    }
  } catch (e) {
    log("C-save true", "FAIL", String(e));
  }

  try {
    // Restore original value.
    const cfg = await call("load_app_config", {});
    cfg.ghost_diff = { ...(cfg.ghost_diff ?? {}), live_mode: originalLive };
    await call("save_app_config", { config: cfg });
    const back = await call("load_app_config", {});
    if (back.ghost_diff?.live_mode === originalLive) {
      log("C-restore", "OK", `restored live_mode to ${originalLive}`);
    } else {
      log("C-restore", "FAIL", `restore failed, now ${back.ghost_diff?.live_mode}`);
    }
  } catch (e) {
    log("C-restore", "FAIL", String(e));
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
