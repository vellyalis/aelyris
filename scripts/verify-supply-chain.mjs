import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const outDir = path.join(repoRoot, ".codex-auto", "release-doctor");
const outJson = path.join(outDir, "supply-chain-audit.json");
const directEvidenceDir = path.join(outDir, "supply-chain-inputs");
const directEvidencePaths = {
  npmAudit: path.join(directEvidenceDir, "npm-audit.json"),
  cargoAudit: path.join(directEvidenceDir, "cargo-audit.json"),
  cargoMetadata: path.join(directEvidenceDir, "cargo-metadata.json"),
  provenance: path.join(directEvidenceDir, "provenance.json"),
};
// Vulnerability evidence is keyed to dependency graph inputs, not package
// scripts. In this Windows sandbox Node child_process can be blocked by
// `spawn EPERM`, so direct evidence collected out-of-band must remain usable
// after scripts-only package.json changes. pnpm audit is lockfile-driven here;
// dependency edits still need pnpm-lock.yaml changes to be release-valid.
const supplyChainInputs = ["pnpm-lock.yaml", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"].map(
  (file) => path.join(repoRoot, file),
);

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

async function mtimeMs(file) {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return 0;
  }
}

async function readJsonFile(file) {
  return parseJson(await readFile(file, "utf8"));
}

async function readDirectEvidence() {
  const inputCutoffMs = Math.max(...(await Promise.all(supplyChainInputs.map(mtimeMs))));
  const files = Object.values(directEvidencePaths);
  const mtimes = await Promise.all(files.map(mtimeMs));
  const complete = mtimes.every((value) => value > 0);
  const freshForDependencyInputs = complete && mtimes.every((value) => value + 5_000 >= inputCutoffMs);
  if (!freshForDependencyInputs) {
    return {
      ok: false,
      reason: complete ? "direct evidence is older than dependency inputs" : "direct evidence is incomplete",
      inputCutoffMs,
      mtimes,
    };
  }
  try {
    return {
      ok: true,
      inputCutoffMs,
      mtimes,
      npmJson: await readJsonFile(directEvidencePaths.npmAudit),
      cargoJson: await readJsonFile(directEvidencePaths.cargoAudit),
      cargoMetadataJson: await readJsonFile(directEvidencePaths.cargoMetadata),
      provenance: await readJsonFile(directEvidencePaths.provenance),
    };
  } catch (error) {
    return {
      ok: false,
      reason: `direct evidence could not be parsed: ${error.message ?? error}`,
      inputCutoffMs,
      mtimes,
    };
  }
}

function spawnBlocked(...results) {
  return results.some((result) => /spawn EPERM/i.test(`${result?.stderr ?? ""}\n${result?.stdout ?? ""}`));
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

function flattenCargoWarnings(warnings) {
  return Object.entries(warnings ?? {}).flatMap(([kind, items]) =>
    Array.isArray(items)
      ? items.map((item) => ({
          ...item,
          kind,
          key: `${item.package}@${item.version}`,
        }))
      : [],
  );
}

function isProcMacroPackage(pkg) {
  return Array.isArray(pkg?.targets) && pkg.targets.some((target) => target?.kind?.includes("proc-macro"));
}

function hasDepKind(dep, kind) {
  return (dep?.dep_kinds ?? []).some((entry) => (entry?.kind ?? "normal") === kind);
}

function hasNormalDepKind(dep) {
  return (dep?.dep_kinds ?? []).some((entry) => entry?.kind == null || entry?.kind === "normal");
}

function buildCargoReachability(metadata) {
  const root = metadata?.resolve?.root;
  if (!root) {
    return {
      ok: false,
      target: "x86_64-pc-windows-msvc",
      runtimePackageKeys: [],
      buildOnlyPackageKeys: [],
    };
  }

  const nodes = new Map((metadata.resolve.nodes ?? []).map((node) => [node.id, node]));
  const packages = new Map((metadata.packages ?? []).map((pkg) => [pkg.id, pkg]));
  const runtimeIds = new Set();
  const buildOnlyIds = new Set();

  function visitBuildOnly(id) {
    if (!id || buildOnlyIds.has(id)) return;
    buildOnlyIds.add(id);
    const node = nodes.get(id);
    for (const dep of node?.deps ?? []) visitBuildOnly(dep.pkg);
  }

  function visitRuntime(id) {
    if (!id || runtimeIds.has(id)) return;
    const pkg = packages.get(id);
    if (isProcMacroPackage(pkg)) {
      visitBuildOnly(id);
      return;
    }
    runtimeIds.add(id);
    const node = nodes.get(id);
    for (const dep of node?.deps ?? []) {
      if (hasNormalDepKind(dep)) visitRuntime(dep.pkg);
      if (hasDepKind(dep, "build") || hasDepKind(dep, "dev")) visitBuildOnly(dep.pkg);
    }
  }

  const rootNode = nodes.get(root);
  for (const dep of rootNode?.deps ?? []) {
    if (hasNormalDepKind(dep)) visitRuntime(dep.pkg);
    if (hasDepKind(dep, "build") || hasDepKind(dep, "dev")) visitBuildOnly(dep.pkg);
  }

  function keyForId(id) {
    const pkg = packages.get(id);
    return pkg ? `${pkg.name}@${pkg.version}` : null;
  }

  return {
    ok: true,
    target: "x86_64-pc-windows-msvc",
    runtimePackageKeys: Array.from(runtimeIds).map(keyForId).filter(Boolean).sort(),
    buildOnlyPackageKeys: Array.from(buildOnlyIds)
      .filter((id) => !runtimeIds.has(id))
      .map(keyForId)
      .filter(Boolean)
      .sort(),
  };
}

function classifyCargoWarningReachability(warnings, metadata) {
  const reachability = buildCargoReachability(metadata);
  const runtime = new Set(reachability.runtimePackageKeys);
  const buildOnly = new Set(reachability.buildOnlyPackageKeys);
  const items = flattenCargoWarnings(warnings).map((warning) => {
    const scope = runtime.has(warning.key)
      ? "windows-runtime"
      : buildOnly.has(warning.key)
        ? "build-time-or-proc-macro"
        : "target-unreachable-on-windows";
    return { ...warning, scope };
  });
  return {
    ok: reachability.ok,
    target: reachability.target,
    runtimeWarningCount: items.filter((item) => item.scope === "windows-runtime").length,
    runtimeCriticalWarningCount: items.filter(
      (item) => item.scope === "windows-runtime" && item.kind !== "unmaintained",
    ).length,
    runtimeMaintenanceWarningCount: items.filter(
      (item) => item.scope === "windows-runtime" && item.kind === "unmaintained",
    ).length,
    buildOnlyWarningCount: items.filter((item) => item.scope === "build-time-or-proc-macro").length,
    targetUnreachableWarningCount: items.filter((item) => item.scope === "target-unreachable-on-windows").length,
    warnings: items,
  };
}

async function main() {
  const generatedAt = new Date().toISOString();
  const npmAudit = await run(pnpm, ["audit", "--audit-level", "moderate", "--json"]);
  const cargoMetadata = await run(cargo, [
    "metadata",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--format-version",
    "1",
    "--filter-platform",
    "x86_64-pc-windows-msvc",
  ]);
  const cargoAudit = await run(cargo, [
    "audit",
    "-f",
    "src-tauri/Cargo.lock",
    "--target-os",
    "windows",
    "--format",
    "json",
  ]);
  const directEvidence = spawnBlocked(npmAudit, cargoMetadata, cargoAudit) ? await readDirectEvidence() : null;
  const usingDirectEvidence = directEvidence?.ok === true;
  const npmJson = usingDirectEvidence ? directEvidence.npmJson : parseJson(npmAudit.stdout);
  const cargoMetadataJson = usingDirectEvidence ? directEvidence.cargoMetadataJson : parseJson(cargoMetadata.stdout);
  const cargoJson = usingDirectEvidence ? directEvidence.cargoJson : parseJson(cargoAudit.stdout);
  const npmKnownVulnerabilities =
    npmJson?.metadata?.vulnerabilities?.total ??
    Object.values(npmJson?.metadata?.vulnerabilities ?? {}).reduce(
      (sum, value) => sum + (typeof value === "number" ? value : 0),
      0,
    );
  const cargoKnownVulnerabilities = cargoJson?.vulnerabilities?.count ?? null;
  const cargoWarningCount = countCargoWarnings(cargoJson);
  const cargoWarnings = summarizeCargoWarnings(cargoJson);
  const cargoWarningReachability = classifyCargoWarningReachability(cargoWarnings, cargoMetadataJson);
  const status =
    (npmAudit.ok || usingDirectEvidence) &&
    (cargoMetadata.ok || usingDirectEvidence) &&
    cargoWarningReachability.ok &&
    (cargoAudit.ok || usingDirectEvidence) &&
    (npmKnownVulnerabilities ?? 0) === 0 &&
    (cargoKnownVulnerabilities ?? 0) === 0 &&
    cargoWarningReachability.runtimeCriticalWarningCount === 0
      ? "pass"
      : "fail";
  const report = {
    version: 1,
    generatedAt,
    status,
    npm: {
      ok: npmAudit.ok || usingDirectEvidence,
      exitCode: npmAudit.exitCode,
      knownVulnerabilities: npmKnownVulnerabilities ?? null,
      stderrTail: npmAudit.stderr.slice(-2000),
    },
    cargo: {
      ok: cargoAudit.ok || usingDirectEvidence,
      exitCode: cargoAudit.exitCode,
      knownVulnerabilities: cargoKnownVulnerabilities,
      warningCount: cargoWarningCount,
      warnings: cargoWarnings,
      reachability: cargoWarningReachability,
      advisoryDatabase: cargoJson?.database ?? null,
      stderrTail: cargoAudit.stderr.slice(-2000),
    },
    cargoMetadata: {
      ok: cargoMetadata.ok || usingDirectEvidence,
      exitCode: cargoMetadata.exitCode,
      stderrTail: cargoMetadata.stderr.slice(-2000),
    },
    directEvidence: {
      used: usingDirectEvidence,
      ok: directEvidence?.ok ?? null,
      reason: directEvidence?.ok === false ? directEvidence.reason : null,
      paths: Object.fromEntries(
        Object.entries(directEvidencePaths).map(([key, value]) => [
          key,
          path.relative(repoRoot, value).replaceAll("\\", "/"),
        ]),
      ),
      provenance: usingDirectEvidence ? directEvidence.provenance : null,
    },
    policy: {
      failOnKnownVulnerabilities: true,
      failOnWindowsRuntimeCriticalRustWarnings: true,
      trackWindowsRuntimeMaintenanceWarnings: true,
      informationalRustWarnings:
        "Runtime unsound/yanked/critical warnings fail this gate. Runtime unmaintained warnings from current upstream framework crates are tracked as release debt, not hidden.",
    },
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(outJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[supply-chain] status=${status}`);
  console.log(`[supply-chain] npmKnownVulnerabilities=${report.npm.knownVulnerabilities}`);
  console.log(`[supply-chain] cargoKnownVulnerabilities=${report.cargo.knownVulnerabilities}`);
  console.log(`[supply-chain] cargoWarningCount=${report.cargo.warningCount}`);
  console.log(`[supply-chain] cargoRuntimeWarningCount=${report.cargo.reachability.runtimeWarningCount}`);
  console.log(
    `[supply-chain] cargoRuntimeCriticalWarningCount=${report.cargo.reachability.runtimeCriticalWarningCount}`,
  );
  console.log(
    `[supply-chain] cargoRuntimeMaintenanceWarningCount=${report.cargo.reachability.runtimeMaintenanceWarningCount}`,
  );
  console.log(`[supply-chain] cargoBuildOnlyWarningCount=${report.cargo.reachability.buildOnlyWarningCount}`);
  console.log(
    `[supply-chain] cargoTargetUnreachableWarningCount=${report.cargo.reachability.targetUnreachableWarningCount}`,
  );
  console.log(`[supply-chain] wrote ${path.relative(repoRoot, outJson).replaceAll("\\", "/")}`);
  if (status !== "pass") process.exit(1);
}

main().catch((error) => {
  console.error(`[supply-chain] ${error.message ?? error}`);
  process.exit(1);
});
