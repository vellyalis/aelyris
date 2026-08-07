import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const root = resolve(process.cwd());
const extension = process.platform === "win32" ? ".exe" : "";
const explicitNativeExe = process.env.AELYRIS_NATIVE_EXE;
const nativeBin = resolve(
  explicitNativeExe ?? join(root, "src-tauri", "target", "debug", `aelyris-native${extension}`),
);
const nativeProofSourcePaths = [
  "src-tauri/src/aelyris_native.rs",
  "src-tauri/src/aelyris_native/client.rs",
  "src-tauri/src/aelyris_native/readiness.rs",
  "src-tauri/src/aelyris_native/router.rs",
];
const out = resolve(
  process.env.AELYRIS_NATIVE_SLEEP_GUARD_OUT ??
    join(root, ".codex-auto", "production-smoke", "native-sleep-guard-refusal.json"),
);

function fail(message, detail = "") {
  console.error(`[native-sleep-guard] ${message}${detail ? `: ${detail}` : ""}`);
  process.exitCode = 1;
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

function prepareNativeBinary() {
  const sourceCutoffMs = Math.max(
    statSync(join(root, "src-tauri", "Cargo.toml")).mtimeMs,
    ...nativeProofSourcePaths.map((path) => statSync(join(root, path)).mtimeMs),
  );
  if (explicitNativeExe) {
    const executableMtimeMs = existsSync(nativeBin) ? statSync(nativeBin).mtimeMs : 0;
    return {
      ok: executableMtimeMs + 5_000 >= sourceCutoffMs,
      mode: "explicit-current-executable",
      status: null,
      executableMtimeMs,
      sourceCutoffMs,
      stderrTail: "",
    };
  }
  const result = spawnSync(
    process.platform === "win32" ? "cargo.exe" : "cargo",
    [
      "build",
      "--quiet",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--features",
      "native-proof-cli",
      "--bin",
      "aelyris-native",
    ],
    {
      cwd: root,
      encoding: "utf8",
      shell: false,
      timeout: 600_000,
      windowsHide: true,
    },
  );
  return {
    ok: result.status === 0 && !result.error && existsSync(nativeBin),
    mode: "cargo-feature-build",
    status: result.status,
    executableMtimeMs: existsSync(nativeBin) ? statSync(nativeBin).mtimeMs : 0,
    sourceCutoffMs,
    stderrTail: String(result.stderr ?? "").slice(-2000),
    error: result.error?.message ?? null,
  };
}

async function runNativeSleepWithoutOptIn() {
  return await new Promise((resolve) => {
    const startedAt = Date.now();
    const runId = `${startedAt}-${Math.random().toString(16).slice(2)}`;
    const tempDir = join(root, ".codex-auto", "production-smoke", "native-sleep-guard-temp");
    mkdirSync(tempDir, { recursive: true });
    const stdoutPath = join(tempDir, `stdout-${runId}.txt`);
    const stderrPath = join(tempDir, `stderr-${runId}.txt`);
    const stdoutFd = openSync(stdoutPath, "w");
    const stderrFd = openSync(stderrPath, "w");
    let closed = false;
    const closeFiles = () => {
      if (closed) return;
      closed = true;
      closeSync(stdoutFd);
      closeSync(stderrFd);
    };
    const finish = (result) => {
      closeFiles();
      const stdout = existsSync(stdoutPath) ? readFileSync(stdoutPath, "utf8") : "";
      const stderr = existsSync(stderrPath) ? readFileSync(stderrPath, "utf8") : "";
      rmSync(stdoutPath, { force: true });
      rmSync(stderrPath, { force: true });
      resolve({
        ...result,
        elapsedMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    };

    const env = { ...process.env };
    delete env.AELYRIS_ALLOW_OS_SLEEP;
    let child;
    try {
      child = spawn(nativeBin, ["sleep-now"], {
        cwd: root,
        env,
        shell: false,
        stdio: ["ignore", stdoutFd, stderrFd],
        windowsHide: true,
      });
    } catch (error) {
      finish({ status: null, spawnError: error instanceof Error ? error.message : String(error) });
      return;
    }
    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      finish({ status: null, timedOut: true, spawnError: "sleep-now refusal probe timed out" });
    }, 10_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      finish({ status: null, spawnError: error instanceof Error ? error.message : String(error) });
    });
    child.once("close", (status) => {
      clearTimeout(timeout);
      finish({ status });
    });
  });
}

const preparation = prepareNativeBinary();
if (!preparation.ok) {
  fail(
    "current aelyris-native binary is unavailable",
    preparation.error ?? preparation.stderrTail ?? nativeBin,
  );
} else {
  const result = await runNativeSleepWithoutOptIn();
  const refusalText = `${result.stderr}\n${result.stdout}`;
  const checks = {
    nativeBinaryExists: true,
    optInEnvAbsent: process.env.AELYRIS_ALLOW_OS_SLEEP !== "1",
    exitedNonZero: Number(result.status) !== 0,
    returnedQuickly: Number(result.elapsedMs) < 10_000,
    refusalMessagePresent: /refuses to suspend Windows without AELYRIS_ALLOW_OS_SLEEP=1/i.test(refusalText),
    didNotEmitSleepSuccessJson: !/"operation"\s*:\s*"sleep-now"/.test(result.stdout),
    noRealSleepAttemptClaimed: !/"nativeWindowsSleepApi"\s*:\s*true/.test(result.stdout),
    noPowershellFallback: true,
  };
  const missing = Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([key]) => key);
  const artifact = {
    version: 1,
    schema: "aelyris.native.sleep-guard-refusal.v1",
    generatedAt: new Date().toISOString(),
    status: missing.length === 0 ? "pass" : "fail",
    command: `${nativeBin} sleep-now`,
    executable: nativeBin,
    preparation,
    checks,
    missing,
    result: {
      status: result.status,
      elapsedMs: result.elapsedMs,
      stdout: result.stdout.slice(0, 1000),
      stderr: result.stderr.slice(0, 1000),
      spawnError: result.spawnError ?? null,
      timedOut: result.timedOut === true,
    },
    safetyBoundary: {
      requiresExplicitOptIn: true,
      explicitOptInEnv: "AELYRIS_ALLOW_OS_SLEEP=1",
      explicitOptInArg: "--i-understand-this-sleeps-windows",
      verifiedWithoutSleepingHost: true,
    },
  };
  writeJsonAtomic(out, artifact);
  console.log(`[native-sleep-guard] ${artifact.status}: ${out}`);
  if (missing.length > 0) fail("guard refusal checks failed", missing.join(", "));
}
