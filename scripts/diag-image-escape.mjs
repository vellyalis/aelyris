// Diagnostic: send Kitty escape via PowerShell into the live PTY and observe
// what the grid actually contains. Tells us whether ConPTY swallowed the
// escape (no garbage), our scanner ate the wrong bytes (some garbage stays),
// or the pipeline worked but snapshot wiring is broken (HELLO row clean,
// images still empty).
//
// Run prerequisite: `pnpm tauri:dev` is up and port 9222 is reachable.

import { chromium } from "playwright";

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";

const browser = await chromium.connectOverCDP("http://localhost:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes("localhost:1420"));
if (!page) {
  console.error("no Tauri page found");
  process.exit(1);
}

const call = (cmd, args) =>
  page.evaluate(
    async ({ cmd, args }) => {
      const w = window;
      return w.__TAURI_INTERNALS__.invoke(cmd, args);
    },
    { cmd, args }
  );

const tid = await call("spawn_terminal", {
  shell: "powershell",
  cols: 120,
  rows: 30,
  cwd: "C:\\Users\\owner\\Aether_Terminal",
});
console.log("spawned terminal:", tid);

await new Promise((r) => setTimeout(r, 800));

// Phase 1: HELLO_BEFORE — confirm shell alive
await call("write_terminal", { id: tid, data: "echo HELLO_BEFORE\r" });
await new Promise((r) => setTimeout(r, 600));

// Phase 2: Kitty escape via [Console]::Out.Write
const kitty = `[Console]::Out.Write("\`e_Gf=100,a=T,t=d,i=9991;${TINY_PNG_B64}\`e\\")\r`;
await call("write_terminal", { id: tid, data: kitty });
await new Promise((r) => setTimeout(r, 600));

// Phase 3: HELLO_AFTER — confirm shell still alive after escape
await call("write_terminal", { id: tid, data: "echo HELLO_AFTER\r" });
await new Promise((r) => setTimeout(r, 800));

// Snapshot.
const snap = await call("term_snapshot", { id: tid });

// Render grid as ASCII to see what landed.
console.log("--- snapshot ---");
console.log("rows:", snap.rows, "cols:", snap.cols);
console.log("images:", JSON.stringify(snap.images ?? "[absent]"));
console.log("--- grid (non-blank rows only) ---");
for (let r = 0; r < snap.rows; r++) {
  let line = "";
  for (const cell of snap.cells[r]) line += cell.ch ?? " ";
  const trimmed = line.replace(/\s+$/, "");
  if (trimmed) console.log(`r${r.toString().padStart(2)}: ${trimmed}`);
}

// Also dump bytes around `_G` — if our scanner ate the escape but didn't
// register the image, the grid won't show garbage but images will be empty.
const fullText = snap.cells
  .map((row) => row.map((c) => c.ch ?? " ").join(""))
  .join("\n");
const idx = fullText.indexOf("_G");
console.log("--- _G search in grid ---");
if (idx >= 0) {
  console.log("FOUND `_G` in grid at offset", idx, "context:", fullText.slice(Math.max(0, idx - 8), idx + 32));
} else {
  console.log("no `_G` in grid (escape was either consumed or dropped pre-engine)");
}

// Probe image store directly: if anything got registered, the snapshot
// wiring is the bug. If nothing did, the escape never reached the engine
// (likely ConPTY APC drop) or the scanner failed to consume it.
console.log("--- term_image_data probe (id 1..50) ---");
let anyHit = false;
for (let imageId = 1; imageId <= 50; imageId++) {
  const data = await call("term_image_data", { id: tid, imageId });
  if (data) {
    console.log(`HIT imageId=${imageId} format=${data.format} bytes=${data.dataBase64.length} dim=${data.widthPx}x${data.heightPx}`);
    anyHit = true;
  }
}
if (!anyHit) console.log("no entries in image store for ids 1..50");

// SGR escape (CSI, not APC) — ConPTY normalises CSI but always passes it
// through. If RED_TEXT appears, ConPTY's general escape pipeline is alive
// and our drop is APC-specific (= Kitty graphics specific).
console.log("--- SGR escape control probe ---");
await call("write_terminal", {
  id: tid,
  data: `[Console]::Out.Write("\`e[31mRED_TEXT\`e[0m")\r`,
});
await new Promise((r) => setTimeout(r, 600));
const snap2 = await call("term_snapshot", { id: tid });
const text2 = snap2.cells.map((row) => row.map((c) => c.ch ?? " ").join("")).join("\n");
const redIdx = text2.indexOf("RED_TEXT");
console.log(redIdx >= 0 ? `SGR escape PASSED: RED_TEXT visible at offset ${redIdx}` : "SGR escape FAILED");

await call("close_terminal", { id: tid });
await browser.close();
