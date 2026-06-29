import { copyFileSync, mkdirSync, rmSync, utimesSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tauriDir = join(root, "src-tauri");

function spawnWithWindowsShellFallback(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: root,
    shell: false,
    windowsHide: true,
    ...options,
  });
  if (process.platform !== "win32" || result.status !== null || result.error?.code !== "EPERM") {
    return result;
  }
  return spawnSync(command, args, {
    cwd: root,
    shell: true,
    windowsHide: true,
    ...options,
  });
}

function failureDetail(result) {
  if (result.error) return `${result.error.code ?? "error"}: ${result.error.message}`;
  if (result.signal) return `signal ${result.signal}`;
  return `exit code ${result.status}`;
}

function run(command, args, options = {}) {
  const result = spawnWithWindowsShellFallback(command, args, {
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${failureDetail(result)}`);
  }
}

function output(command, args, options = {}) {
  const result = spawnWithWindowsShellFallback(command, args, {
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${failureDetail(result)}`);
  }
  return result.stdout;
}

const rustcVerbose = output("rustc", ["-Vv"]);
const host = rustcVerbose
  .split(/\r?\n/)
  .find((line) => line.startsWith("host:"))
  ?.split(":")[1]
  ?.trim();

if (!host) {
  throw new Error("Unable to determine Rust target triple from rustc -Vv");
}

run("cargo", ["build", "--manifest-path", "src-tauri/pty-server/Cargo.toml", "--release"]);
run("cargo", ["build", "--manifest-path", "src-tauri/Cargo.toml", "--release", "--bin", "aelys"]);

const extension = process.platform === "win32" ? ".exe" : "";
const built = join(tauriDir, "pty-server", "target", "release", `aelyris-pty-server${extension}`);
const bundled = join(tauriDir, "binaries", `aelyris-pty-server-${host}${extension}`);
const builtCtl = join(tauriDir, "target", "release", `aelys${extension}`);
const accidentalMainPackageBin = join(tauriDir, "target", "release", `aelyris-pty-server${extension}`);
mkdirSync(dirname(bundled), { recursive: true });
copyFileSync(built, bundled);
const now = new Date();
utimesSync(bundled, now, now);
utimesSync(builtCtl, now, now);
rmSync(accidentalMainPackageBin, { force: true });
console.log(`Prepared PTY sidecar: ${bundled}`);
console.log(`Prepared aelys: ${builtCtl}`);
