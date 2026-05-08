import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const outDir = path.join(repoRoot, ".codex-auto", "release-doctor");
const outJson = path.join(outDir, "supply-chain-audit.json");

async function run(command, args) {
  const spawnCommand = process.platform === "win32" && command.endsWith(".cmd") ? "cmd.exe" : command;
  const spawnArgs =
    process.platform === "win32" && command.endsWith(".cmd") ? ["/d", "/s", "/c", command, ...args] : args;
  try {
    const result = await execFileAsync(spawnCommand, spawnArgs, {
      cwd: repoRoot,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 64,
    });
    return { ok: true, exitCode: 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } catch (error) {
    return {
      ok: false,
      exitCode: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message ?? String(error),
    };
  }
}

function parseJson(text) {
  try {
    return text.trim() ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function countCargoWarnings(cargoAudit) {
  return Object.values(cargoAudit?.warnings ?? {}).reduce(
    (sum, items) => sum + (Array.isArray(items) ? items.length : 0),
    0,
  );
}

function summarizeCargoWarnings(cargoAudit) {
  return Object.fromEntries(
    Object.entries(cargoAudit?.warnings ?? {}).map(([kind, items]) => [
      kind,
      Array.isArray(items)
        ? items.map((item) => ({
            advisoryId: item.advisory?.id ?? null,
            package: item.package?.name ?? null,
            version: item.package?.version ?? null,
            title: item.advisory?.title ?? null,
          }))
        : [],
    ]),
  );
}

async function main() {
  const generatedAt = new Date().toISOString();
  const npmAudit = await run(pnpm, ["audit", "--audit-level", "moderate", "--json"]);
  const cargoAudit = await run(cargo, [
    "audit",
    "-f",
    "src-tauri/Cargo.lock",
    "--target-os",
    "windows",
    "--format",
    "json",
  ]);
  const npmJson = parseJson(npmAudit.stdout);
  const cargoJson = parseJson(cargoAudit.stdout);
  const npmKnownVulnerabilities =
    npmJson?.metadata?.vulnerabilities?.total ??
    Object.values(npmJson?.metadata?.vulnerabilities ?? {}).reduce(
      (sum, value) => sum + (typeof value === "number" ? value : 0),
      0,
    );
  const cargoKnownVulnerabilities = cargoJson?.vulnerabilities?.count ?? null;
  const cargoWarningCount = countCargoWarnings(cargoJson);
  const status =
    npmAudit.ok &&
    cargoAudit.ok &&
    (npmKnownVulnerabilities ?? 0) === 0 &&
    (cargoKnownVulnerabilities ?? 0) === 0
      ? "pass"
      : "fail";
  const report = {
    version: 1,
    generatedAt,
    status,
    npm: {
      ok: npmAudit.ok,
      exitCode: npmAudit.exitCode,
      knownVulnerabilities: npmKnownVulnerabilities ?? null,
      stderrTail: npmAudit.stderr.slice(-2000),
    },
    cargo: {
      ok: cargoAudit.ok,
      exitCode: cargoAudit.exitCode,
      knownVulnerabilities: cargoKnownVulnerabilities,
      warningCount: cargoWarningCount,
      warnings: summarizeCargoWarnings(cargoJson),
      advisoryDatabase: cargoJson?.database ?? null,
      stderrTail: cargoAudit.stderr.slice(-2000),
    },
    policy: {
      failOnKnownVulnerabilities: true,
      informationalRustWarnings:
        "Tracked as supply-chain debt because they are transitive and advisory-class informational; public release should reassess after Tauri/GTK/rand upstream updates.",
    },
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(outJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[supply-chain] status=${status}`);
  console.log(`[supply-chain] npmKnownVulnerabilities=${report.npm.knownVulnerabilities}`);
  console.log(`[supply-chain] cargoKnownVulnerabilities=${report.cargo.knownVulnerabilities}`);
  console.log(`[supply-chain] cargoWarningCount=${report.cargo.warningCount}`);
  console.log(`[supply-chain] wrote ${path.relative(repoRoot, outJson).replaceAll("\\", "/")}`);
  if (status !== "pass") process.exit(1);
}

main().catch((error) => {
  console.error(`[supply-chain] ${error.message ?? error}`);
  process.exit(1);
});
