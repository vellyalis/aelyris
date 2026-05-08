import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tauriDir = join(root, "src-tauri");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function output(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
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

const extension = process.platform === "win32" ? ".exe" : "";
const built = join(tauriDir, "pty-server", "target", "release", `aether-pty-server${extension}`);
const bundled = join(tauriDir, "binaries", `aether-pty-server-${host}${extension}`);
const accidentalMainPackageBin = join(tauriDir, "target", "release", `aether-pty-server${extension}`);
mkdirSync(dirname(bundled), { recursive: true });
copyFileSync(built, bundled);
rmSync(accidentalMainPackageBin, { force: true });
console.log(`Prepared PTY sidecar: ${bundled}`);
