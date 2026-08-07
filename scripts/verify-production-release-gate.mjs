import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pnpmInvocation =
  process.platform === "win32"
    ? {
        command: process.env.ComSpec ?? "cmd.exe",
        prefixArgs: ["/d", "/s", "/c", "corepack", "pnpm"],
      }
    : { command: "pnpm", prefixArgs: [] };
const node = process.platform === "win32" ? "node.exe" : "node";
const args = new Set(process.argv.slice(2));
const reuseLive = args.has("--reuse-live") || process.env.AELYRIS_RELEASE_REUSE_LIVE === "1";
const reuseIme = args.has("--reuse-ime") || process.env.AELYRIS_RELEASE_REUSE_IME === "1";
const freshLive = !reuseLive || args.has("--fresh-live") || process.env.AELYRIS_RELEASE_FRESH_LIVE === "1";
const freshIme = !reuseIme || freshLive || args.has("--fresh-ime") || process.env.AELYRIS_RELEASE_FRESH_IME === "1";
const sleepCycle = args.has("--sleep-cycle") || process.env.AELYRIS_RELEASE_SLEEP_CYCLE === "1";

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

function runPnpm(label, args) {
  return run(label, pnpmInvocation.command, [...pnpmInvocation.prefixArgs, ...args]);
}

async function assertSupplyChainReleaseClean() {
  const artifactPath = path.join(repoRoot, ".codex-auto", "release-doctor", "supply-chain-audit.json");
  const data = JSON.parse(await readFile(artifactPath, "utf8"));
  if (data?.status !== "pass") {
    throw new Error(
      `Supply-chain audit is ${data?.status ?? "missing"}, not release-clean. Classified upstream-bound or environment-blocked supply-chain states are acceptable for goal handoff, but not for the production release gate.`,
    );
  }
}

async function main() {
  const releaseGateArgs = ["scripts/verify-release-gate.mjs"];
  if (freshIme) releaseGateArgs.push("--with-ime");
  await run(freshIme ? "Release gate with fresh Native IME evidence" : "Release gate", node, releaseGateArgs);

  if (freshLive) await runPnpm("Fresh live Tauri/WebView2 workstation smoke", ["verify:production:live"]);
  else
    console.log(
      "\n[production-release] Fresh live smoke explicitly reused via --reuse-live/AELYRIS_RELEASE_REUSE_LIVE=1.",
    );
  if (!freshIme) console.log("\n[production-release] Fresh Native IME CDP evidence explicitly reused via --reuse-ime.");

  if (sleepCycle) {
    await runPnpm("Guarded real OS sleep/resume cycle", ["verify:production:suspend:cycle"]);
  } else {
    await runPnpm("Real OS sleep/resume diagnostic", ["verify:production:suspend:diagnose"]);
    await runPnpm("Real OS sleep/resume evidence", ["verify:production:suspend"]);
  }
  await runPnpm("Strict release doctor before risk closure", [
    "verify:release:doctor",
    "--",
    "--strict-signing",
    "--fail-on-warn",
  ]);
  await runPnpm("Production risk closure evidence", ["verify:production:close-risks"]);
  await runPnpm("Supply-chain audit", ["verify:supply-chain"]);
  await assertSupplyChainReleaseClean();
  await runPnpm("Strict release doctor after risk closure", [
    "verify:release:doctor",
    "--",
    "--strict-signing",
    "--fail-on-warn",
    "--fail-accepted-release-risk",
  ]);
  console.log("\n[production-release] Production release gate passed.");
}

main().catch((error) => {
  console.error(`\n[production-release] ${error.message ?? error}`);
  process.exit(1);
});
