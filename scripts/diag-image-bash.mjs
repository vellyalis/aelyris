// Companion to diag-image-escape.mjs that uses bash + printf instead of
// PowerShell `[Console]::Out.Write`. Bash on Windows (Git Bash) writes
// stdout via plain WriteFile to its stdout handle — that bypasses the
// Win32 console API path PowerShell takes (where ConPTY may normalise
// even with PASSTHROUGH_MODE on). If image rendering works here but not
// in the PowerShell version, the issue is shell-specific, not pipeline-
// specific.

import { chromium } from "playwright";

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";

const browser = await chromium.connectOverCDP("http://localhost:9222");
const page = browser.contexts()[0].pages().find((p) => p.url().includes("localhost:1420"));
if (!page) {
  console.error("no Tauri page");
  process.exit(1);
}

const call = (cmd, args) =>
  page.evaluate(
    async ({ cmd, args }) => window.__TAURI_INTERNALS__.invoke(cmd, args),
    { cmd, args }
  );

const tid = await call("spawn_terminal", {
  shell: "gitbash",
  cols: 120,
  rows: 30,
  cwd: "C:\\Users\\owner\\Aether_Terminal",
});
console.log("spawned bash terminal:", tid);

await new Promise((r) => setTimeout(r, 1000));

// printf understands \e and \\ — write raw bytes for the Kitty escape.
// Wrap with HELLO_BEFORE / HELLO_AFTER to confirm shell pipeline alive.
await call("write_terminal", { id: tid, data: "echo HELLO_BEFORE\n" });
await new Promise((r) => setTimeout(r, 500));

const kittyCmd = `printf '\\e_Gf=100,a=T,t=d,i=9991;${TINY_PNG_B64}\\e\\\\'\n`;
await call("write_terminal", { id: tid, data: kittyCmd });
await new Promise((r) => setTimeout(r, 600));

await call("write_terminal", { id: tid, data: "echo HELLO_AFTER\n" });
await new Promise((r) => setTimeout(r, 800));

const snap = await call("term_snapshot", { id: tid });
console.log("--- snapshot ---");
console.log("rows:", snap.rows, "cols:", snap.cols);
console.log("images:", JSON.stringify(snap.images ?? "[absent]"));
console.log("--- grid ---");
for (let r = 0; r < snap.rows; r++) {
  let line = "";
  for (const c of snap.cells[r]) line += c.ch ?? " ";
  const trimmed = line.replace(/\s+$/, "");
  if (trimmed) console.log(`r${r.toString().padStart(2)}: ${trimmed}`);
}

console.log("--- term_image_data probe (id 1..200) ---");
let any = false;
for (let i = 1; i <= 200; i++) {
  const d = await call("term_image_data", { id: tid, imageId: i });
  if (d) {
    console.log(`HIT id=${i} format=${d.format} bytes=${d.dataBase64.length} dim=${d.widthPx}x${d.heightPx}`);
    any = true;
  }
}
if (!any) console.log("no entries");

await call("close_terminal", { id: tid });
await browser.close();
