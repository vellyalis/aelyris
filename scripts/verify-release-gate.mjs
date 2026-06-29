import { execFile, spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const execFileAsync = promisify(execFile);
const args = new Set(process.argv.slice(2));
const withIme = args.has("--with-ime") || process.env.AELYRIS_RELEASE_WITH_IME === "1";
const preflightOnly = args.has("--preflight") || process.env.AELYRIS_RELEASE_PREFLIGHT === "1";
const allowDirtyWorktree = args.has("--allow-dirty") || process.env.AELYRIS_RELEASE_ALLOW_DIRTY === "1";
const skipFullVitest = args.has("--skip-full-vitest") || process.env.AELYRIS_RELEASE_SKIP_FULL_VITEST === "1";

const focusedVitestSuites = [
  "src/__tests__/backendSilentBugs.test.ts",
  "src/__tests__/useCanvasIME.test.ts",
  "src/__tests__/IMEInputBar.test.tsx",
  "src/__tests__/TerminalCanvasInput.test.tsx",
  "src/__tests__/PaneSwitcherDialog.test.tsx",
  "src/__tests__/ProcessManagerPanel.test.tsx",
  "src/__tests__/LivePanesPanel.test.tsx",
  "src/__tests__/AuditTimelinePanel.test.tsx",
  "src/__tests__/ReliabilityPanel.test.tsx",
  "src/__tests__/ContextPanel.test.tsx",
  "src/__tests__/WorkstationPulse.test.tsx",
  "src/__tests__/RunGraphPanel.test.tsx",
  "src/__tests__/ToolLedgerPanel.test.tsx",
  "src/__tests__/SettingsSaveMerge.test.tsx",
  "src/__tests__/ThemePaletteEditor.test.tsx",
  "src/__tests__/useThemeApplier.test.tsx",
  "src/__tests__/themePalette.test.ts",
  "src/__tests__/rightRailAdvisor.test.ts",
  "src/__tests__/appStore.test.ts",
];

const syntaxCheckedScripts = [
  "scripts/verify-dist-artifacts.mjs",
  "scripts/verify-ime.mjs",
  "scripts/release-doctor.mjs",
  "scripts/verify-release-gate.mjs",
  "scripts/verify-production-release-gate.mjs",
  "scripts/verify-supply-chain.mjs",
  "scripts/verify-mux-live-restore.mjs",
  "scripts/verify-mux-performance.mjs",
  "scripts/verify-scrollback-gates.mjs",
];

const requiredReleaseFiles = [
  "docs/release-build-playbook.md",
  "src-tauri/tauri.conf.json",
  "src-tauri/tauri.dist.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
];

const requiredPackageScripts = {
  "tauri:build:dist": "node scripts/build-pty-sidecar.mjs && tauri build --config src-tauri/tauri.dist.conf.json --no-sign",
  "verify:dist": "node scripts/verify-dist-artifacts.mjs",
  "verify:release:doctor": "node scripts/release-doctor.mjs",
  "verify:release:preflight": "node scripts/verify-release-gate.mjs --preflight",
  "verify:release": "node scripts/verify-release-gate.mjs",
  "verify:release:ime": "node scripts/verify-release-gate.mjs --with-ime",
  "verify:release:production": "node scripts/verify-production-release-gate.mjs",
  "verify:supply-chain": "node scripts/verify-supply-chain.mjs",
  "verify:mux-live": "node scripts/verify-mux-live-restore.mjs",
  "verify:mux-performance": "node scripts/verify-mux-performance.mjs",
  "verify:scrollback-gates": "cargo build --manifest-path src-tauri/pty-server/Cargo.toml --release && node scripts/verify-scrollback-gates.mjs",
};

function formatCommand(command, commandArgs) {
  return [command, ...commandArgs].join(" ");
}

function describeSpawnError(label, command, commandArgs, error) {
  const commandLine = formatCommand(command, commandArgs);
  const details = [`${label} could not start`, `command: ${commandLine}`, `error: ${error.message}`];

  if (error.code === "EPERM") {
    details.push(
      "hint: Windows blocked process creation. Check endpoint protection, PowerShell language-mode policy, and whether pnpm/esbuild/vitest binaries are quarantined.",
    );
  }

  return new Error(details.join("\n"));
}

function describeExitFailure(label, code) {
  const details = [`${label} failed with exit code ${code}`];

  if (label === "Focused workstation Vitest") {
    details.push(
      "hint: If the log shows `failed to load config` with `Error: spawn EPERM`, Vite could not start esbuild. Check endpoint protection, PowerShell language-mode policy, and quarantined pnpm/esbuild/vitest binaries before treating this as a test assertion failure.",
    );
  }

  if (label === "Rust backend check") {
    details.push(
      "hint: If this fails during the Windows link step with `LNK1104` on a temp `lnk*.tmp` file, retry after endpoint protection or temp-file policy stops blocking the linker.",
    );
  }

  return new Error(details.join("\n"));
}

async function fileExists(relativePath) {
  try {
    await access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
}

async function readDirtyWorktreeEntries() {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: repoRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 16,
  });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

async function verifyCleanWorktree() {
  if (allowDirtyWorktree) {
    console.warn("[release] Dirty worktree check bypassed by --allow-dirty/AELYRIS_RELEASE_ALLOW_DIRTY=1.");
    return;
  }
  let entries;
  try {
    entries = await readDirtyWorktreeEntries();
  } catch (error) {
    throw new Error(`[release] Could not inspect git worktree cleanliness: ${error.message}`);
  }
  if (entries.length === 0) return;
  const shown = entries.slice(0, 80).map((line) => `  - ${line}`);
  const hidden = entries.length > shown.length ? [`  ... ${entries.length - shown.length} more`] : [];
  throw new Error(
    [
      "Worktree must be clean before claiming production/release readiness.",
      "Commit, stash, or intentionally park active changes first; dirty source invalidates build evidence.",
      ...shown,
      ...hidden,
    ].join("\n"),
  );
}

async function run(label, command, commandArgs) {
  const spawnCommand = process.platform === "win32" && command.endsWith(".cmd") ? "cmd.exe" : command;
  const spawnArgs =
    process.platform === "win32" && command.endsWith(".cmd")
      ? ["/d", "/s", "/c", command, ...commandArgs]
      : commandArgs;
  console.log(`\n[release] ${label}`);
  console.log(`[release] $ ${formatCommand(command, commandArgs)}`);
  const started = Date.now();
  await new Promise((resolve, reject) => {
    const child = spawn(spawnCommand, spawnArgs, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });
    child.on("error", (error) => {
      reject(describeSpawnError(label, command, commandArgs, error));
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(describeExitFailure(label, code));
    });
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[release] ${label} passed in ${seconds}s`);
}

async function verifyReleaseContract() {
  const failures = [];
  const missingFiles = [];
  for (const file of requiredReleaseFiles) {
    if (!(await fileExists(file))) missingFiles.push(file);
  }
  if (missingFiles.length > 0) {
    failures.push("[release] Missing required release files:");
    for (const file of missingFiles) failures.push(`  - ${file}`);
  }

  const pkg = await readJson("package.json");
  const tauriConfig = await readJson("src-tauri/tauri.conf.json");
  const tauriDistConfig = await readJson("src-tauri/tauri.dist.conf.json");

  for (const [script, expected] of Object.entries(requiredPackageScripts)) {
    if (pkg.scripts?.[script] !== expected) {
      failures.push(
        `[release] package.json script ${script} mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(
          pkg.scripts?.[script],
        )}`,
      );
    }
  }

  if (pkg.version !== tauriConfig.version) {
    failures.push(
      `[release] package.json version (${pkg.version}) must match src-tauri/tauri.conf.json version (${tauriConfig.version})`,
    );
  }
  if (tauriConfig.productName !== "Aelyris") {
    failures.push(
      `[release] Tauri productName must be "Aelyris", got ${JSON.stringify(tauriConfig.productName)}`,
    );
  }
  if (tauriConfig.bundle?.active !== true) {
    failures.push(`[release] Tauri bundle.active must be true, got ${JSON.stringify(tauriConfig.bundle?.active)}`);
  }
  if (tauriDistConfig.bundle?.createUpdaterArtifacts === false) {
    failures.push(
      `[release] src-tauri/tauri.dist.conf.json must not disable updater artifacts, got ${JSON.stringify(
        tauriDistConfig.bundle?.createUpdaterArtifacts,
      )}`,
    );
  }

  const targets = tauriConfig.bundle?.targets;
  const hasWindowsInstallerTarget =
    targets === "all" || (Array.isArray(targets) && (targets.includes("nsis") || targets.includes("msi")));
  if (!hasWindowsInstallerTarget) {
    failures.push(`[release] Tauri bundle targets must include Windows installers, got ${JSON.stringify(targets)}`);
  }

  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
}

async function main() {
  await verifyCleanWorktree();

  const missingSuites = [];
  for (const suite of focusedVitestSuites) {
    if (!(await fileExists(suite))) missingSuites.push(suite);
  }

  if (missingSuites.length > 0) {
    console.error("[release] Missing focused test suites:");
    for (const suite of missingSuites) console.error(`  - ${suite}`);
    process.exit(1);
  }

  await verifyReleaseContract();

  for (const script of syntaxCheckedScripts) {
    await run(`Node syntax check: ${script}`, "node", ["--check", script]);
  }
  await run("Release Doctor", pnpm, ["verify:release:doctor"]);

  if (preflightOnly) {
    console.log("\n[release] Preflight passed.");
    console.log("[release] Run `pnpm.cmd verify:release` for the full TypeScript, Vitest, and artifact gate.");
    return;
  }

  await run("TypeScript", pnpm, ["exec", "tsc", "--noEmit"]);
  await run("Rust backend check", cargo, ["check", "--manifest-path", "src-tauri/Cargo.toml", "--lib"]);
  if (withIme) {
    await run("Native IME CDP verification", pnpm, ["verify:ime"]);
  } else {
    console.log("\n[release] Native IME CDP verification skipped.");
    console.log("[release] Run `pnpm.cmd verify:release:ime` with Tauri dev/CDP running before a human handoff build.");
  }

  await run("Mux live restore smoke", pnpm, ["verify:mux-live"]);
  await run("Mux performance smoke", pnpm, ["verify:mux-performance"]);
  await run("Scrollback capture/search smoke", pnpm, ["verify:scrollback-gates"]);
  await run("Focused workstation Vitest", pnpm, ["exec", "vitest", "run", ...focusedVitestSuites, "--reporter=dot"]);
  if (skipFullVitest) {
    console.log("\n[release] Full frontend Vitest explicitly skipped.");
  } else {
    await run("Full frontend Vitest", pnpm, ["test", "--", "--reporter=dot"]);
  }

  await run("Distribution artifacts", pnpm, ["verify:dist"]);

  console.log("\n[release] Release gate passed.");
}

main().catch((error) => {
  console.error(`\n[release] ${error.message}`);
  process.exit(1);
});
