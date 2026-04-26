// Spike (ROADMAP_POST_0_2_4 #1, side-channel detour viability):
// emit OSC 1338 payloads of increasing size through bash + printf and
// observe whether ConPTY forwards them to the engine intact.
//
// Pairs with the temporary `[aether-engine] OSC buffer` instrumentation
// in `term::engine::TermEngine::advance` — read the tauri dev log after
// running this to see what arrived.

import { chromium } from "playwright";

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

// Probe sizes (payload bytes inside the OSC, BEL terminator). Includes
// values around plausible ConPTY OSC buffer caps (4 KB, 8 KB, 64 KB).
const sizes = [400, 420, 440, 460, 480, 496, 504, 510, 512];

for (const size of sizes) {
  // Build a base64-shaped payload of exactly `size` bytes (just A's;
  // the parser doesn't care, we just want to test transport).
  const payload = "A".repeat(size);
  // OSC 1338 is unallocated — pick a high number to avoid collision.
  // Format: ESC ] 1338 ; <SIZE> ; <payload> BEL.
  // The leading SIZE marker lets the engine eprintln tell at a glance
  // whether it received the full byte count.
  const cmd = `printf '\\e]1338;${size};${payload}\\a'\n`;
  console.log(`=> emit OSC 1338 with ${size}B payload`);
  await call("write_terminal", { id: tid, data: cmd });
  // Generous wait so the OSC reaches the engine before next emit.
  await new Promise((r) => setTimeout(r, 600));
}

console.log("--- final snapshot ---");
const snap = await call("term_snapshot", { id: tid });
console.log("rows:", snap.rows, "cols:", snap.cols);
let nonblank = 0;
for (let r = 0; r < snap.rows; r++) {
  let line = "";
  for (const c of snap.cells[r]) line += c.ch ?? " ";
  const trimmed = line.replace(/\s+$/, "");
  if (trimmed) nonblank++;
  // Show only a snippet so we don't dump the giant input echo.
  if (trimmed && trimmed.length > 0 && trimmed.length < 200) {
    console.log(`r${r.toString().padStart(2)}: ${trimmed}`);
  }
}
console.log(`(non-blank rows: ${nonblank})`);

await call("close_terminal", { id: tid });
await browser.close();
console.log("\nNow inspect /tmp/tauri-dev3.log for `[aether-engine] OSC buffer` lines.");
