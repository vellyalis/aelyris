import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const node = process.platform === "win32" ? "node.exe" : "node";
const args = new Set(process.argv.slice(2));
const freshLive = args.has("--fresh-live") || process.env.AETHER_RELEASE_FRESH_LIVE === "1";

function format(command, commandArgs) {
  return [command, ...commandArgs].join(" ");
}

function run(label, command, commandArgs) {
  const spawnCommand = process.platform === "win32" && command.endsWith(".cmd") ? "cmd.exe" : command;
  const spawnArgs =
    process.platform === "win32" && command.endsWith(".cmd")
      ? ["/d", "/s", "/c", command, ...commandArgs]
      : commandArgs;
  console.log(`\n[production-release] ${label}`);
  console.log(`[production-release] $ ${format(command, commandArgs)}`);
  return new Promise((resolve, reject) => {
    const child = spawn(spawnCommand, spawnArgs, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

async function main() {
  await run("Release gate with Native IME evidence", node, ["scripts/verify-release-gate.mjs", "--with-ime"]);

  if (freshLive) {
    await run("Fresh live Tauri/WebView2 workstation smoke", pnpm, ["verify:production:live"]);
  } else {
    console.log("\n[production-release] Fresh live smoke skipped.");
    console.log("[production-release] Pass --fresh-live or set AETHER_RELEASE_FRESH_LIVE=1 to require a live Tauri/CDP run.");
  }

  await run("Production risk closure evidence", pnpm, ["verify:production:close-risks"]);
  await run("Supply-chain audit", pnpm, ["verify:supply-chain"]);
  await run("Strict release doctor", pnpm, ["verify:release:doctor", "--", "--strict-signing", "--fail-on-warn"]);
  console.log("\n[production-release] Production release gate passed.");
}

main().catch((error) => {
  console.error(`\n[production-release] ${error.message ?? error}`);
  process.exit(1);
});
