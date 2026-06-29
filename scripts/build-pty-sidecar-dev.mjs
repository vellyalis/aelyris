import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tauriDir = join(root, "src-tauri");
const DEV_SIDECAR_REPLACE_RETRIES = Number.parseInt(process.env.AELYRIS_DEV_SIDECAR_REPLACE_RETRIES ?? "5", 10);
const DEV_SIDECAR_REPLACE_RETRY_DELAY_MS = Number.parseInt(
  process.env.AELYRIS_DEV_SIDECAR_REPLACE_RETRY_DELAY_MS ?? "250",
  10,
);

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

function run(command, args) {
  const result = spawnWithWindowsShellFallback(command, args, {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${failureDetail(result)}`);
  }
}

run("cargo", ["build", "--manifest-path", "src-tauri/pty-server/Cargo.toml"]);

const extension = process.platform === "win32" ? ".exe" : "";
const built = join(tauriDir, "pty-server", "target", "debug", `aelyris-pty-server${extension}`);
const sibling = join(tauriDir, "target", "debug", `aelyris-pty-server${extension}`);

function sleepSync(ms) {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

function isLockedExecutableError(error) {
  return ["EBUSY", "EPERM", "EACCES"].includes(error?.code);
}

function quotePowerShellString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function stopProcessesUsingPath(exePath) {
  if (process.platform !== "win32") return [];
  const command = [
    "$ErrorActionPreference = 'SilentlyContinue';",
    `$target = [System.IO.Path]::GetFullPath(${quotePowerShellString(exePath)});`,
    "$items = Get-CimInstance Win32_Process |",
    "Where-Object { $_.ExecutablePath -and ([System.IO.Path]::GetFullPath($_.ExecutablePath) -ieq $target) } |",
    "Select-Object ProcessId,Name,ExecutablePath;",
    "foreach ($item in $items) { Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue }",
    "if ($items) { $items | ConvertTo-Json -Compress }",
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    const reason = (result.stderr || result.stdout || `exit ${result.status}`).trim();
    console.warn(`Could not inspect locked dev PTY sidecar: ${reason}`);
    return [];
  }
  const raw = result.stdout.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [{ raw }];
  }
}

function replaceDevSidecarExecutable(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  for (let attempt = 0; attempt <= DEV_SIDECAR_REPLACE_RETRIES; attempt += 1) {
    try {
      rmSync(destination, { force: true });
      copyFileSync(source, destination);
      return;
    } catch (error) {
      if (!isLockedExecutableError(error) || attempt >= DEV_SIDECAR_REPLACE_RETRIES) {
        throw error;
      }
      const stopped = stopProcessesUsingPath(destination);
      const stoppedIds = stopped.map((item) => item.ProcessId ?? item.Id ?? item.raw ?? "unknown").join(", ");
      const detail = stopped.length > 0 ? ` stopped stale pid(s): ${stoppedIds}` : " no matching stale process found";
      console.warn(
        `Dev PTY sidecar was locked while replacing ${destination}; retry ${attempt + 1}/${DEV_SIDECAR_REPLACE_RETRIES}.${detail}`,
      );
      sleepSync(DEV_SIDECAR_REPLACE_RETRY_DELAY_MS * (attempt + 1));
    }
  }
}

mkdirSync(dirname(sibling), { recursive: true });
replaceDevSidecarExecutable(built, sibling);
console.log(`Prepared dev PTY sidecar: ${sibling}`);
