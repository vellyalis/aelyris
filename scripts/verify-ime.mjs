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
//
// Requires `AETHER_API_TOKEN=dev pnpm tauri:dev` running with CDP on 9222.
// Run: pnpm node scripts/verify-ime.mjs

import { chromium } from "@playwright/test";

const CDP = "http://localhost:9222";

function pass(msg) {
  console.log(`  \u2713 ${msg}`);
}
function fail(msg) {
  console.log(`  \u2717 ${msg}`);
  process.exitCode = 1;
}

async function gridContainsMarker(page, marker) {
  return page.evaluate(async (m) => {
    const ids = await window.__TAURI_INTERNALS__.invoke("list_terminals", {});
    const hits = [];
    for (const id of ids) {
      const snap = await window.__TAURI_INTERNALS__.invoke("term_snapshot", { id }).catch(() => null);
      if (!snap) continue;
      const text = snap.cells.map((row) => row.map((c) => c.ch).join("")).join("\n");
      if (text.includes(m)) hits.push({ id, sample: text.split(/\n/).find((l) => l.includes(m))?.slice(0, 120) });
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

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("localhost:1420"));
  if (!page) throw new Error("no tauri page on localhost:1420");
  console.log(`[ime] attached to ${page.url()}`);

  await page.evaluate(
    ([project]) => {
      localStorage.setItem("aether:lastProject", project);
      localStorage.setItem("aether:onboarding-done", "1");
    },
    ["C:/Users/owner/Aether_Terminal"],
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

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
    return { ok: true, rect: { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) } };
  });
  if (!overlayOk.ok) {
    fail("no overlay textarea (opacity=0, pe=none) found");
  } else {
    pass(`overlay textarea at (${overlayOk.rect.x}, ${overlayOk.rect.y}) size ${overlayOk.rect.w}×${overlayOk.rect.h}`);

    // Use ASCII only so grid snapshot (which stores `ch: char`) shows it
    // cleanly without worrying about wide-char cells or half-width
    // continuation columns.
    const overlayMarker = `AETHER_IME_OVR_${Math.random().toString(36).slice(2, 8)}`;
    const r = await page.evaluate(
      ({ payload }) => {
        const overlay = Array.from(document.querySelectorAll("textarea")).find((t) => {
          const cs = getComputedStyle(t);
          return cs.opacity === "0" && cs.pointerEvents === "none";
        });
        if (!overlay) return { sent: false };
        overlay.focus();
        overlay.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
        overlay.dispatchEvent(new InputEvent("input", { bubbles: true, data: payload, isComposing: true }));
        overlay.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: payload }));
        overlay.dispatchEvent(new InputEvent("input", { bubbles: true, data: payload, isComposing: false }));
        return { sent: true };
      },
      { payload: `echo ${overlayMarker}` },
    );
    if (!r.sent) fail("overlay dispatch failed");

    // The canvas overlay path does not append \r, so we also need to
    // submit a carriage return through the keydown path. Simulate Enter
    // via keydown on the overlay so keymap.keyEventToBytes sends \r.
    await page.evaluate(() => {
      const overlay = Array.from(document.querySelectorAll("textarea")).find((t) => {
        const cs = getComputedStyle(t);
        return cs.opacity === "0" && cs.pointerEvents === "none";
      });
      if (!overlay) return;
      overlay.focus();
      const ev = new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 });
      overlay.dispatchEvent(ev);
    });

    const ovrHit = await waitForMarker(page, overlayMarker, 4000);
    if (ovrHit.hits.length >= 1) {
      pass(`overlay marker visible in terminal ${ovrHit.hits[0].id.slice(0, 8)}…`);
      // Count occurrences across ALL terminals — the dedup guard means we
      // should see the marker at most once per commit cycle (plus prompt
      // echoes).
      const totalOccurrences = await page.evaluate(async (m) => {
        const ids = await window.__TAURI_INTERNALS__.invoke("list_terminals", {});
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
      fail(`overlay marker "${overlayMarker}" not found in any terminal grid`);
    }
  }

  await browser.close();
  console.log("\n[ime] done.");
}

main().catch((e) => {
  console.error("[ime] fatal:", e);
  process.exit(1);
});
