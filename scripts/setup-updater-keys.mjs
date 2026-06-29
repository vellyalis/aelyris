// scripts/setup-updater-keys.mjs
//
// One-time bootstrap for the Tauri auto-updater (post-0.2.2 Tier 🔴 #3).
//
// What it does:
//   1. Asserts the Tauri CLI is on PATH (or instructs how to install it).
//   2. Runs `tauri signer generate -w <out>/aelyris-updater.key` to mint
//      an Ed25519 keypair under `<repo>/.aelyris-updater/` (gitignored).
//   3. Prints the public key and shows the exact JSON edit needed in
//      `src-tauri/tauri.conf.json` to swap the placeholder pubkey for
//      the real one.
//   4. Prints the env-var snippet (PowerShell + bash) that subsequent
//      `pnpm tauri build` invocations need so the .sig files land
//      next to the bundles.
//
// What it does NOT do:
//   - Edit tauri.conf.json automatically. The user must apply the change
//     themselves so they review the swap before committing.
//   - Touch the `.aelyris-updater/` directory if the key already exists —
//     re-running with an existing key would invalidate every previously
//     released update.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(new URL(".", import.meta.url).pathname, "..");
const KEY_DIR = join(REPO_ROOT, ".aelyris-updater");
const KEY_PATH = join(KEY_DIR, "aelyris-updater.key");
const PUB_PATH = `${KEY_PATH}.pub`;

function run(command, args) {
  return new Promise((res, rej) => {
    const child = spawn(command, args, { stdio: "inherit", shell: process.platform === "win32" });
    child.on("error", rej);
    child.on("exit", (code) =>
      code === 0 ? res() : rej(new Error(`${command} exited with ${code}`)),
    );
  });
}

async function main() {
  if (existsSync(KEY_PATH)) {
    console.error(
      `error: ${KEY_PATH} already exists. Re-running would invalidate every previously\n` +
        `signed update. If you really want a fresh key, delete the .aelyris-updater/ directory\n` +
        `manually first and accept that all installed Aelyris builds will refuse new updates\n` +
        `until they are reinstalled with the new pubkey.`,
    );
    process.exit(1);
  }

  if (!existsSync(KEY_DIR)) {
    mkdirSync(KEY_DIR, { recursive: true });
  }

  console.log("→ generating Ed25519 keypair via tauri signer generate");
  await run("pnpm", ["exec", "tauri", "signer", "generate", "-w", KEY_PATH]);

  if (!existsSync(PUB_PATH)) {
    throw new Error(`expected public key at ${PUB_PATH} but it is missing`);
  }
  const pub = readFileSync(PUB_PATH, "utf8").trim();

  console.log("");
  console.log("✓ keypair written to .aelyris-updater/ (gitignored)");
  console.log("");
  console.log("Next steps:");
  console.log("  1. Edit src-tauri/tauri.conf.json → plugins.updater.pubkey");
  console.log("     Replace the placeholder with this exact value:");
  console.log("");
  console.log(`        "pubkey": "${pub}",`);
  console.log("");
  console.log("  2. Before each `pnpm tauri build` that should emit signed");
  console.log("     update artifacts, set the private key in the environment:");
  console.log("");
  console.log("     PowerShell:");
  console.log(`        $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content '${KEY_PATH}' -Raw`);
  console.log('        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<your-password>"');
  console.log("");
  console.log("     Bash:");
  console.log(`        export TAURI_SIGNING_PRIVATE_KEY="$(cat '${KEY_PATH}')"`);
  console.log('        export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<your-password>"');
  console.log("");
  console.log("  3. After the build, run:");
  console.log("        node scripts/generate-update-manifest.mjs --version <semver>");
  console.log("");
  console.log("See docs/auto_updater_setup.md for the full release flow.");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
