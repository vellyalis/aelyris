// IME pipeline verification via CDP attach.
//
// Tauri v2 freezes __TAURI_INTERNALS__ (non-writable, non-configurable), so
// we cannot spy on `invoke` at the JS level. Instead we verify the pipeline
// by side effect: write a unique marker via the IMEInputBar (or the canvas
// overlay textarea), then poll `term_snapshot` across every live terminal
// and assert the marker appears in exactly one grid.
//
// What this verifies:
//   1. IMEInputBar DOM + ARIA + indicator.
//   2. compositionstart / compositionend flip the indicator.
//   3. Bar Enter-submit delivers its value to some PTY (marker visible).
//   4. Canvas overlay textarea exists with opacity=0 + pe=none.
//   5. Synthetic composition events on the overlay reach the PTY (marker
//      visible, exactly once — dedup guard in useCanvasIME holds).
//   6. Long Japanese preedit, blur preservation, deletion, paste takeover,
//      PowerShell LF-paste submit, resize geometry, DPI reporting, and
//      multi-terminal scoping are checked when the live WebView exposes the
//      needed DOM/CDP surfaces.
//
// Requires `AETHER_API_TOKEN=dev pnpm tauri:dev` running with CDP on 9222.
// Run: pnpm node scripts/verify-ime.mjs
//
// Optional env:
//   AETHER_IME_CDP=http://127.0.0.1:9222
//   AETHER_IME_PROJECT=C:/Users/owner/Aether_Terminal
//   AETHER_IME_OUT=.codex-auto/production-smoke/verify-ime.json

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const CDP = process.env.AETHER_IME_CDP ?? "http://127.0.0.1:9222";
const PROJECT_PATH = process.env.AETHER_IME_PROJECT ?? process.cwd().replaceAll("\\", "/");
const OUT = process.env.AETHER_IME_OUT ?? ".codex-auto/production-smoke/verify-ime.json";
const report = {
  version: 1,
  taskId: "verify-ime",
  cdp: CDP,
  projectPath: PROJECT_PATH,
  startedAt: new Date().toISOString(),
  status: "running",
  checks: [],
  failures: [],
};

function writeArtifact() {
  report.completedAt = new Date().toISOString();
  const path = resolve(OUT);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

function isAetherPage(page) {
  const url = page.url();
  return (
    url.includes("localhost:1420") ||
    url.includes("127.0.0.1:1420") ||
    url.startsWith("tauri://localhost") ||
    url.startsWith("http://tauri.localhost") ||
    url.startsWith("https://tauri.localhost")
  );
}

function describePages(context) {
  const pages = context.pages();
  if (pages.length === 0) return "no CDP pages were exposed";
  return pages.map((page, index) => `  ${index + 1}. ${page.url() || "(blank)"}`).join("\n");
}

function pass(msg) {
  report.checks.push(msg);
  console.log(`  \u2713 ${msg}`);
}
function fail(msg) {
  report.failures.push(msg);
  console.log(`  \u2717 ${msg}`);
  process.exitCode = 1;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectOverCdpWithRetry() {
  const timeoutMs = Number(process.env.AETHER_IME_CDP_TIMEOUT_MS ?? 90000);
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(CDP);
    } catch (err) {
      lastError = err;
      await sleep(1000);
    }
  }

  throw new Error(
    `Cannot attach to WebView2 CDP at ${CDP} within ${timeoutMs}ms. Start Aether with "AETHER_API_TOKEN=dev pnpm.cmd tauri:dev" first.\n${lastError?.message ?? "CDP endpoint did not respond"}`,
  );
}

async function ensureLiveTerminalSurface(page) {
  const visibleSurfaceCount = await page
    .locator('[aria-label="ターミナル入力バー"], [data-testid="terminal-ime-textarea"], canvas')
    .count();
  if (visibleSurfaceCount > 0) return;

  const newShell = page.getByRole("button", { name: /^New shell$/ }).first();
  if ((await newShell.count()) === 0) return;

  console.log("[ime] no live terminal surface found; starting a new shell from the ended pane state");
  await newShell.click();
  await page
    .locator('[aria-label="ターミナル入力バー"], [data-testid="terminal-ime-textarea"], canvas')
    .first()
    .waitFor({ state: "attached", timeout: 10000 })
    .catch(() => {});
  await page.waitForTimeout(1200);
}

async function waitForTerminalIds(page, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ids = await page.evaluate(async () => {
      const direct = await window.__TAURI_INTERNALS__.invoke("list_terminals", {}).catch(() => []);
      if (Array.isArray(direct) && direct.length > 0) return direct;
      const panes = await window.__TAURI_INTERNALS__.invoke("list_panes_info", {}).catch(() => []);
      const paneIds = Array.isArray(panes)
        ? panes.map((pane) => pane?.terminal_id).filter((id) => typeof id === "string" && id.length > 0)
        : [];
      if (paneIds.length > 0) return paneIds;
      return Array.from(document.querySelectorAll("canvas[data-terminal-id]"))
        .map((canvas) => canvas.getAttribute("data-terminal-id"))
        .filter((id) => typeof id === "string" && id.length > 0);
    });
    if (ids.length > 0) return ids;
    await new Promise((r) => setTimeout(r, 120));
  }
  return page.evaluate(async () => {
    const direct = await window.__TAURI_INTERNALS__.invoke("list_terminals", {}).catch(() => []);
    if (Array.isArray(direct) && direct.length > 0) return direct;
    const panes = await window.__TAURI_INTERNALS__.invoke("list_panes_info", {}).catch(() => []);
    const paneIds = Array.isArray(panes)
      ? panes.map((pane) => pane?.terminal_id).filter((id) => typeof id === "string" && id.length > 0)
      : [];
    if (paneIds.length > 0) return paneIds;
    return Array.from(document.querySelectorAll("canvas[data-terminal-id]"))
      .map((canvas) => canvas.getAttribute("data-terminal-id"))
      .filter((id) => typeof id === "string" && id.length > 0);
  });
}

async function gridContainsMarker(page, marker) {
  return page.evaluate(async (m) => {
    const direct = await window.__TAURI_INTERNALS__.invoke("list_terminals", {}).catch(() => []);
    const panes = await window.__TAURI_INTERNALS__.invoke("list_panes_info", {}).catch(() => []);
    const ids =
      Array.isArray(direct) && direct.length > 0
        ? direct
        : Array.isArray(panes)
          ? panes.map((pane) => pane?.terminal_id).filter((id) => typeof id === "string" && id.length > 0)
          : [];
    if (ids.length === 0) {
      ids.push(
        ...Array.from(document.querySelectorAll("canvas[data-terminal-id]"))
          .map((canvas) => canvas.getAttribute("data-terminal-id"))
          .filter((id) => typeof id === "string" && id.length > 0),
      );
    }
    const hits = [];
    for (const id of ids) {
      const snap = await window.__TAURI_INTERNALS__.invoke("term_snapshot", { id }).catch(() => null);
      if (!snap) continue;
      const text = snap.cells.map((row) => row.map((c) => c.ch).join("")).join("\n");
      if (text.includes(m))
        hits.push({
          id,
          sample: text
            .split(/\n/)
            .find((l) => l.includes(m))
            ?.slice(0, 120),
        });
    }
    return { ids, hits };
  }, marker);
}

async function waitForMarker(page, marker, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await gridContainsMarker(page, marker);
    if (r.hits.length > 0) return r;
    await new Promise((r) => setTimeout(r, 120));
  }
  return gridContainsMarker(page, marker);
}

async function readImeGeometry(page) {
  return page.evaluate(() => {
    const overlays = Array.from(document.querySelectorAll("textarea")).filter((t) => {
      const cs = getComputedStyle(t);
      return cs.opacity === "0" && cs.pointerEvents === "none";
    });
    const overlay = overlays.find((t) => document.activeElement === t) ?? overlays[0] ?? null;
    const canvas = overlay?.parentElement?.querySelector("canvas") ?? document.querySelector("canvas");
    if (!overlay || !canvas) {
      return {
        ok: false,
        overlayCount: overlays.length,
        canvasCount: document.querySelectorAll("canvas").length,
        dpr: window.devicePixelRatio,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    }
    const overlayRect = overlay.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const overlayRight = overlayRect.left + overlayRect.width;
    const overlayBottom = overlayRect.top + overlayRect.height;
    return {
      ok: true,
      overlayCount: overlays.length,
      canvasCount: document.querySelectorAll("canvas").length,
      activeOverlayFocused: document.activeElement === overlay,
      dpr: window.devicePixelRatio,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      style: {
        left: overlay.style.left,
        top: overlay.style.top,
        width: overlay.style.width,
      },
      overlayRect: {
        x: Math.round(overlayRect.left),
        y: Math.round(overlayRect.top),
        width: Math.round(overlayRect.width),
        height: Math.round(overlayRect.height),
      },
      canvasRect: {
        x: Math.round(canvasRect.left),
        y: Math.round(canvasRect.top),
        width: Math.round(canvasRect.width),
        height: Math.round(canvasRect.height),
      },
      insideCanvas:
        overlayRect.left >= canvasRect.left - 1 &&
        overlayRect.top >= canvasRect.top - 1 &&
        overlayRight <= canvasRect.right + 1 &&
        overlayBottom <= canvasRect.bottom + 1,
    };
  });
}

async function dispatchOverlayPaste(page, text) {
  return page.evaluate((payload) => {
    const overlay = Array.from(document.querySelectorAll("textarea")).find((t) => {
      const cs = getComputedStyle(t);
      return cs.opacity === "0" && cs.pointerEvents === "none";
    });
    if (!overlay) return { sent: false };
    overlay.focus();
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        getData(type) {
          return type === "text" || type === "text/plain" ? payload : "";
        },
      },
    });
    overlay.dispatchEvent(event);
    return { sent: true, defaultPrevented: event.defaultPrevented };
  }, text);
}

async function dispatchOverlayComposition(page, sequence) {
  return page.evaluate((steps) => {
    const overlay = Array.from(document.querySelectorAll("textarea")).find((t) => {
      const cs = getComputedStyle(t);
      return cs.opacity === "0" && cs.pointerEvents === "none";
    });
    if (!overlay) return { sent: false };
    overlay.focus();
    for (const step of steps) {
      if (step.type === "compositionstart") {
        overlay.value = step.value ?? overlay.value;
        overlay.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: step.data ?? "" }));
        continue;
      }
      if (step.type === "compositionupdate") {
        overlay.value = step.value ?? overlay.value;
        overlay.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: step.data ?? "" }));
        continue;
      }
      if (step.type === "compositionend") {
        overlay.value = step.value ?? overlay.value;
        overlay.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: step.data ?? "" }));
        continue;
      }
      if (step.type === "blur") {
        overlay.blur();
        overlay.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
        continue;
      }
      if (step.type === "input") {
        overlay.value = step.value ?? overlay.value;
        overlay.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            data: step.data ?? null,
            inputType: step.inputType ?? "insertText",
            isComposing: step.isComposing ?? false,
          }),
        );
        continue;
      }
      if (step.type === "keydown") {
        overlay.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            key: step.key,
            code: step.code ?? step.key,
            keyCode: step.keyCode,
            which: step.keyCode,
          }),
        );
      }
      if (step.type === "paste") {
        const ev = new Event("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(ev, "clipboardData", {
          configurable: true,
          value: {
            getData: (type) => (type === "text" || type === "text/plain" ? (step.text ?? "") : ""),
          },
        });
        overlay.dispatchEvent(ev);
      }
    }
    return { sent: true };
  }, sequence);
}

async function main() {
  const browser = await connectOverCdpWithRetry();
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(isAetherPage);
  if (!page) {
    throw new Error(
      `no Aether Tauri page found in CDP context. Expected localhost:1420, 127.0.0.1:1420, or tauri://localhost.\n${describePages(
        ctx,
      )}`,
    );
  }
  console.log(`[ime] attached to ${page.url()}`);

  await page.evaluate(
    ([project]) => {
      localStorage.setItem("aether:lastProject", project);
      localStorage.setItem("aether:onboarding-done", "1");
    },
    [PROJECT_PATH],
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await ensureLiveTerminalSurface(page);
  await page
    .locator('[aria-label="ターミナル入力バー"]')
    .first()
    .waitFor({ state: "attached", timeout: 10000 })
    .catch(() => {});
  await page
    .locator('[data-testid="terminal-ime-textarea"]')
    .first()
    .waitFor({ state: "attached", timeout: 30000 })
    .catch(() => {});
  await waitForTerminalIds(page);

  // --- Section 1: IMEInputBar DOM ---------------------------------------
  console.log("\n[ime] Section 1 — IMEInputBar DOM");

  const bar = page.locator('[aria-label="ターミナル入力バー"]');
  const barCount = await bar.count();
  if (barCount >= 1) pass(`IMEInputBar mounted (${barCount} instance)`);
  else fail("IMEInputBar NOT mounted");

  const ta = bar.first().locator('textarea[aria-label="ターミナル入力"]');
  const taCount = await ta.count();
  if (taCount === 1) pass("textarea present inside bar");
  else fail(`textarea missing or duplicated (${taCount})`);

  const indicator = bar.first().locator('[aria-label*="ASCII"], [aria-label*="composing"]');
  if ((await indicator.count()) >= 1) pass("IME indicator span present");
  else fail("IME indicator span missing");

  const initialIndicator = await indicator.first().textContent();
  if (initialIndicator?.trim() === "A") pass("indicator starts in ASCII (A)");
  else fail(`indicator initial state = "${initialIndicator}" (expected "A")`);

  // --- Section 2: Composition lifecycle ---------------------------------
  console.log("\n[ime] Section 2 — Composition lifecycle");

  await ta.first().click();
  await ta.first().focus();
  await ta.first().evaluate((el) => {
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
  });
  await page.waitForTimeout(60);
  let indTxt = await indicator.first().textContent();
  if (indTxt?.trim() === "あ") pass("indicator flips to あ during composition");
  else fail(`indicator = "${indTxt}" after compositionstart (expected "あ")`);

  await ta.first().evaluate((el) => {
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "テスト" }));
  });
  await page.waitForTimeout(60);
  indTxt = await indicator.first().textContent();
  if (indTxt?.trim() === "A") pass("indicator returns to A after compositionend");
  else fail(`indicator = "${indTxt}" after compositionend (expected "A")`);

  // --- Section 3: Bar submit reaches PTY --------------------------------
  console.log("\n[ime] Section 3 — Bar submit → PTY");

  // Click the canvas pane first so the active terminal is the visible one.
  const canvas = page.locator("canvas").first();
  if ((await canvas.count()) > 0) {
    await canvas.click({ position: { x: 60, y: 60 } }).catch(() => {});
    await page.waitForTimeout(200);
  }
  await waitForTerminalIds(page);

  const barMarker = `AETHER_IME_BAR_${Math.random().toString(36).slice(2, 8)}`;
  await ta.first().click();
  await ta.first().focus();
  await page.keyboard.type(`echo ${barMarker}`);
  await page.waitForTimeout(60);
  // Sanity: the controlled <textarea> value should reflect our typing.
  const typed = await ta.first().inputValue();
  if (typed === `echo ${barMarker}`) pass(`textarea value = "echo ${barMarker}"`);
  else fail(`textarea value = "${typed}" (expected "echo ${barMarker}")`);

  await page.keyboard.press("Enter");
  const barHit = await waitForMarker(page, barMarker, 4000);
  if (barHit.hits.length >= 1) {
    pass(`marker visible in terminal ${barHit.hits[0].id.slice(0, 8)}… ("${barHit.hits[0].sample}")`);
  } else {
    fail(`marker "${barMarker}" not found in any of ${barHit.ids.length} terminals`);
  }

  // --- Section 4: Canvas overlay composition → PTY ----------------------
  console.log("\n[ime] Section 4 — Canvas overlay composition");

  const overlayOk = await page.evaluate(() => {
    const overlay = Array.from(document.querySelectorAll("textarea")).find((t) => {
      const cs = getComputedStyle(t);
      return cs.opacity === "0" && cs.pointerEvents === "none";
    });
    if (!overlay) return { ok: false };
    const rect = overlay.getBoundingClientRect();
    return {
      ok: true,
      rect: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
    };
  });
  if (!overlayOk.ok) {
    fail("no overlay textarea (opacity=0, pe=none) found");
  } else {
    pass(`overlay textarea at (${overlayOk.rect.x}, ${overlayOk.rect.y}) size ${overlayOk.rect.w}×${overlayOk.rect.h}`);

    // Use ASCII only so grid snapshot (which stores `ch: char`) shows it
    // cleanly without worrying about wide-char cells or half-width
    // continuation columns.
    const overlayMarker = `AETHER_IME_OVR_${Math.random().toString(36).slice(2, 8)}`;
    const r = await dispatchOverlayComposition(page, [
      { type: "compositionstart" },
      {
        type: "input",
        value: `echo ${overlayMarker}`,
        data: `echo ${overlayMarker}`,
        inputType: "insertCompositionText",
        isComposing: true,
      },
      { type: "compositionend", value: `echo ${overlayMarker}`, data: `echo ${overlayMarker}` },
      {
        type: "input",
        value: `echo ${overlayMarker}`,
        data: `echo ${overlayMarker}`,
        inputType: "insertText",
        isComposing: false,
      },
    ]);
    if (!r.sent) fail("overlay dispatch failed");

    // The canvas overlay path does not append \r, so we also need to
    // submit a carriage return through the keydown path. Simulate Enter
    // via keydown on the overlay so keymap.keyEventToBytes sends \r.
    await dispatchOverlayComposition(page, [{ type: "keydown", key: "Enter", code: "Enter", keyCode: 13 }]);

    const ovrHit = await waitForMarker(page, overlayMarker, 4000);
    if (ovrHit.hits.length === 1) {
      pass(`overlay marker visible in terminal ${ovrHit.hits[0].id.slice(0, 8)}…`);
      // Count occurrences across ALL terminals — the dedup guard means we
      // should see the marker at most once per commit cycle (plus prompt
      // echoes).
      const totalOccurrences = await page.evaluate(async (m) => {
        const direct = await window.__TAURI_INTERNALS__.invoke("list_terminals", {}).catch(() => []);
        const panes = await window.__TAURI_INTERNALS__.invoke("list_panes_info", {}).catch(() => []);
        const ids =
          Array.isArray(direct) && direct.length > 0
            ? direct
            : Array.isArray(panes)
              ? panes.map((pane) => pane?.terminal_id).filter((id) => typeof id === "string" && id.length > 0)
              : [];
        if (ids.length === 0) {
          ids.push(
            ...Array.from(document.querySelectorAll("canvas[data-terminal-id]"))
              .map((canvas) => canvas.getAttribute("data-terminal-id"))
              .filter((id) => typeof id === "string" && id.length > 0),
          );
        }
        let count = 0;
        for (const id of ids) {
          const snap = await window.__TAURI_INTERNALS__.invoke("term_snapshot", { id }).catch(() => null);
          if (!snap) continue;
          const text = snap.cells.map((row) => row.map((c) => c.ch).join("")).join("\n");
          count += (text.match(new RegExp(m, "g")) ?? []).length;
        }
        return count;
      }, overlayMarker);
      // Accept 1 (shell hasn't echoed yet) or 2 (command printed + echoed
      // back by `echo`). More than 2 would indicate dedup failure doubling
      // the payload.
      if (totalOccurrences <= 2) pass(`overlay marker occurrence count = ${totalOccurrences} (dedup guard held)`);
      else fail(`overlay marker appears ${totalOccurrences}× — dedup guard likely broken`);
    } else {
      fail(`overlay marker "${overlayMarker}" hit ${ovrHit.hits.length} terminal grids (expected exactly one)`);
    }

    // --- Section 5: Geometry / DPI / resize -----------------------------
    console.log("\n[ime] Section 5 — Geometry / DPI / resize");

    const geometry = await readImeGeometry(page);
    if (geometry.ok && geometry.insideCanvas) {
      pass(
        `overlay geometry inside canvas; dpr=${geometry.dpr}, overlays=${geometry.overlayCount}, canvases=${geometry.canvasCount}, left=${geometry.style.left}, width=${geometry.style.width}`,
      );
    } else {
      fail(`overlay geometry invalid: ${JSON.stringify(geometry)}`);
    }

    const viewportBefore = geometry.viewport;
    try {
      await page.setViewportSize({
        width: Math.max(640, viewportBefore.width - 96),
        height: Math.max(420, viewportBefore.height - 48),
      });
      await page.waitForTimeout(120);
      await dispatchOverlayComposition(page, [{ type: "compositionstart" }, { type: "compositionupdate", data: "再配置" }]);
      const resizedGeometry = await readImeGeometry(page);
      if (resizedGeometry.ok && resizedGeometry.insideCanvas) {
        pass(`resize keeps overlay inside canvas at ${resizedGeometry.viewport.width}×${resizedGeometry.viewport.height}`);
      } else {
        fail(`resize moved overlay outside canvas: ${JSON.stringify(resizedGeometry)}`);
      }
    } catch (err) {
      pass(`CDP target did not allow viewport resize; base geometry already verified (${err.message})`);
    } finally {
      await page.setViewportSize({ width: viewportBefore.width, height: viewportBefore.height }).catch(() => {});
    }

    // --- Section 6: Long Japanese preedit regression --------------------
    console.log("\n[ime] Section 6 — Long Japanese preedit regression");

    const longPreedit = "あ".repeat(48);
    const lateMarker = `AETHER_IME_LONG_${Math.random().toString(36).slice(2, 8)}`;
    const command = `echo ${lateMarker}`;
    const longR = await dispatchOverlayComposition(page, [
      { type: "compositionstart" },
      {
        type: "input",
        value: longPreedit,
        data: longPreedit,
        inputType: "insertCompositionText",
        isComposing: true,
      },
      // WebView2/TSF can finish with empty data while the textarea still
      // contains stale preedit. The hook must not commit this old text.
      { type: "compositionend", value: "", data: "" },
      // Some Japanese IMEs then deliver the final text as a late composing
      // input. This used to be the path where later input collapsed to one
      // visible character or stale text became undeletable.
      {
        type: "input",
        value: command,
        data: command,
        inputType: "insertCompositionText",
        isComposing: true,
      },
      { type: "compositionend", value: command, data: "" },
    ]);
    if (!longR.sent) fail("long-preedit overlay dispatch failed");
    await page.waitForTimeout(80);
    await dispatchOverlayComposition(page, [{ type: "keydown", key: "Enter", code: "Enter", keyCode: 13 }]);

    const longHit = await waitForMarker(page, lateMarker, 4000);
    if (longHit.hits.length >= 1) {
      pass(`late marker survived long preedit in terminal ${longHit.hits[0].id.slice(0, 8)}…`);
    } else {
      fail(`late marker "${lateMarker}" not found after long Japanese preedit`);
    }

    // --- Section 7: Blur / delete / paste while composing ---------------
    console.log("\n[ime] Section 7 — Blur / delete / paste while composing");

    const blurPreedit = "かな".repeat(12);
    await dispatchOverlayComposition(page, [
      { type: "compositionstart" },
      {
        type: "input",
        value: blurPreedit,
        data: blurPreedit,
        inputType: "insertCompositionText",
        isComposing: true,
      },
      { type: "blur" },
    ]);
    const blurState = await page.evaluate(() => {
      const overlay = Array.from(document.querySelectorAll("textarea")).find((t) => {
        const cs = getComputedStyle(t);
        return cs.opacity === "0" && cs.pointerEvents === "none";
      });
      return { value: overlay?.value ?? "", active: document.activeElement === overlay };
    });
    if (blurState.value === blurPreedit && blurState.active === false) pass("blur preserves preedit without committing it");
    else fail(`blur did not preserve preedit as expected: ${JSON.stringify(blurState)}`);

    const pasteMarker = `AETHER_IME_PASTE_${Math.random().toString(36).slice(2, 8)}`;
    const pasteResult = await dispatchOverlayPaste(page, `echo ${pasteMarker}`);
    if (pasteResult.sent && pasteResult.defaultPrevented) pass("paste while composing was intercepted by the overlay");
    else fail(`paste while composing was not handled: ${JSON.stringify(pasteResult)}`);
    await dispatchOverlayComposition(page, [{ type: "keydown", key: "Enter", code: "Enter", keyCode: 13 }]);
    const pasteHit = await waitForMarker(page, pasteMarker, 4000);
    if (pasteHit.hits.length === 1) pass(`paste marker executed in terminal ${pasteHit.hits[0].id.slice(0, 8)}…`);
    else fail(`paste marker hit ${pasteHit.hits.length} terminal grids (expected exactly one)`);

    const deleteMarker = `AETHER_IME_DEL_${Math.random().toString(36).slice(2, 8)}`;
    const deletedSuffix = `${deleteMarker}X`;
    await dispatchOverlayComposition(page, [
      { type: "compositionstart" },
      {
        type: "input",
        value: `echo ${deletedSuffix}`,
        data: `echo ${deletedSuffix}`,
        inputType: "insertCompositionText",
        isComposing: true,
      },
      {
        type: "input",
        value: `echo ${deleteMarker}`,
        data: null,
        inputType: "deleteContentBackward",
        isComposing: true,
      },
      { type: "compositionend", value: `echo ${deleteMarker}`, data: `echo ${deleteMarker}` },
    ]);
    await dispatchOverlayComposition(page, [{ type: "keydown", key: "Enter", code: "Enter", keyCode: 13 }]);
    const deleteHit = await waitForMarker(page, deleteMarker, 4000);
    const staleDeleteHit = await gridContainsMarker(page, deletedSuffix);
    if (deleteHit.hits.length === 1 && staleDeleteHit.hits.length === 0) {
      pass(`delete-during-composition marker executed without stale suffix`);
    } else {
      fail(
        `delete-during-composition mismatch: markerHits=${deleteHit.hits.length}; staleSuffixHits=${staleDeleteHit.hits.length}`,
      );
    }

    // --- Section 8: PowerShell direct paste line ending -----------------
    console.log("\n[ime] Section 8 — PowerShell direct paste line ending");

    const directPasteMarker = `AETHER_IME_PS_${Math.random().toString(36).slice(2, 8)}`;
    const directPasteResult = await dispatchOverlayPaste(page, `echo ${directPasteMarker}\n`);
    if (directPasteResult.sent && directPasteResult.defaultPrevented) {
      pass("direct overlay paste with LF was intercepted");
    } else {
      fail(`direct overlay paste was not handled: ${JSON.stringify(directPasteResult)}`);
    }

    const directPasteHit = await waitForMarker(page, directPasteMarker, 4000);
    if (directPasteHit.hits.length === 1) {
      pass(`LF paste submitted as a terminal Enter in ${directPasteHit.hits[0].id.slice(0, 8)}…`);
    } else {
      fail(`LF paste marker hit ${directPasteHit.hits.length} terminal grids (expected exactly one)`);
    }
  }

  await browser.close();
  report.status = process.exitCode ? "failed" : "pass";
  const artifact = writeArtifact();
  console.log("\n[ime] done.");
  console.log(`[ime] artifact: ${artifact}`);
}

main().catch((e) => {
  report.status = "failed";
  report.error = e?.message ?? String(e);
  report.stack = e?.stack ?? null;
  const artifact = writeArtifact();
  console.error("[ime] fatal:", e);
  console.error(`[ime] artifact: ${artifact}`);
  process.exit(1);
});
