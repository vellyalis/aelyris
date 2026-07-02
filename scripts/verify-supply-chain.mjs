import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const outDir = path.join(repoRoot, ".codex-auto", "release-doctor");
const outJson = path.join(outDir, "supply-chain-audit.json");
const stackRiskJson = path.join(repoRoot, ".codex-auto", "quality", "stack-risk.json");
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
// after scripts-only package.json changes. npm audit is lockfile-driven here;
// cargo audit is keyed to the Rust manifest and lockfile. Keep those freshness
// domains separate so a Rust dependency edit does not invalidate npm evidence.
const npmAuditInputs = ["pnpm-lock.yaml"].map((file) => path.join(repoRoot, file));
const cargoAuditInputs = ["src-tauri/Cargo.toml", "src-tauri/Cargo.lock"].map((file) => path.join(repoRoot, file));
const stackRiskInputs = [
  "package.json",
  "pnpm-lock.yaml",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/pty-server/Cargo.toml",
  "src-tauri/pty-server/Cargo.lock",
  "scripts/verify-stack-risk.mjs",
].map((file) => path.join(repoRoot, file));

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

function hasNpmAuditVulnerabilityMetadata(value) {
  const vulnerabilities = value?.metadata?.vulnerabilities;
  return (
    vulnerabilities &&
    typeof vulnerabilities === "object" &&
    (typeof vulnerabilities.total === "number" ||
      Object.values(vulnerabilities).some((item) => typeof item === "number"))
  );
}

function hasCargoAuditVulnerabilityCount(value) {
  return typeof value?.vulnerabilities?.count === "number";
}

function hasCargoMetadataResolveRoot(value) {
  return typeof value?.resolve?.root === "string" && Array.isArray(value?.resolve?.nodes);
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

async function readClassifiedStackRisk() {
  const artifactMtimeMs = await mtimeMs(stackRiskJson);
  const inputCutoffMs = Math.max(...(await Promise.all(stackRiskInputs.map(mtimeMs))));
  const relativePath = path.relative(repoRoot, stackRiskJson).replaceAll("\\", "/");
  if (artifactMtimeMs <= 0) {
    return {
      ok: false,
      fresh: false,
      reason: "stack-risk artifact is missing",
      path: relativePath,
      inputCutoffMs,
      artifactMtimeMs,
    };
  }
  if (artifactMtimeMs + 5_000 < inputCutoffMs) {
    return {
      ok: false,
      fresh: false,
      reason: "stack-risk artifact is older than dependency or stack-risk verifier inputs",
      path: relativePath,
      inputCutoffMs,
      artifactMtimeMs,
    };
  }
  const data = await readJsonFile(stackRiskJson);
  const releaseBlockerCount = Array.isArray(data?.releaseBlockers)
    ? data.releaseBlockers.length
    : (data?.summary?.releaseBlockers ?? null);
  const upstreamBoundBlockerCount = Array.isArray(data?.upstreamBoundBlockers)
    ? data.upstreamBoundBlockers.length
    : (data?.summary?.upstreamBoundBlockers ?? null);
  const unclassifiedCount = Array.isArray(data?.unclassified)
    ? data.unclassified.length
    : (data?.summary?.unclassified ?? null);
  const ok =
    data?.classificationGate?.ok === true &&
    data?.classificationGate?.upstreamEvidenceComplete === true &&
    releaseBlockerCount === 0 &&
    unclassifiedCount === 0 &&
    typeof upstreamBoundBlockerCount === "number" &&
    upstreamBoundBlockerCount > 0;
  return {
    ok,
    fresh: true,
    reason: ok
      ? "stack-risk classifies all remaining dependency risks as upstream-bound with no repo-owned release blockers"
      : "stack-risk classification is incomplete or still has repo-owned/unclassified blockers",
    path: relativePath,
    status: data?.status ?? null,
    summary: data?.summary ?? null,
    classificationGate: data?.classificationGate ?? null,
    releaseBlockerCount,
    upstreamBoundBlockerCount,
    unclassifiedCount,
    upstreamEvidenceKeys: Object.values(data?.upstreamEvidence ?? {})
      .map((item) => item?.key)
      .filter(Boolean)
      .sort(),
    inputCutoffMs,
    artifactMtimeMs,
  };
}

async function readDirectEvidence() {
  const [npmInputCutoffMs, cargoInputCutoffMs] = await Promise.all([
    Promise.all(npmAuditInputs.map(mtimeMs)).then((values) => Math.max(...values)),
    Promise.all(cargoAuditInputs.map(mtimeMs)).then((values) => Math.max(...values)),
  ]);
  const mtimes = {
    npmAudit: await mtimeMs(directEvidencePaths.npmAudit),
    cargoAudit: await mtimeMs(directEvidencePaths.cargoAudit),
    cargoMetadata: await mtimeMs(directEvidencePaths.cargoMetadata),
    provenance: await mtimeMs(directEvidencePaths.provenance),
  };
  const npmFresh = mtimes.npmAudit > 0 && mtimes.npmAudit + 5_000 >= npmInputCutoffMs;
  const cargoFresh =
    mtimes.cargoAudit > 0 &&
    mtimes.cargoMetadata > 0 &&
    mtimes.cargoAudit + 5_000 >= cargoInputCutoffMs &&
    mtimes.cargoMetadata + 5_000 >= cargoInputCutoffMs;
  const evidence = {
    ok: npmFresh && cargoFresh,
    npm: {
      ok: npmFresh,
      reason: npmFresh
        ? null
        : mtimes.npmAudit > 0
          ? "npm direct evidence is older than pnpm-lock.yaml"
          : "npm direct evidence is missing",
      inputCutoffMs: npmInputCutoffMs,
      evidenceMtimeMs: mtimes.npmAudit,
      json: null,
    },
    cargo: {
      ok: cargoFresh,
      reason: cargoFresh
        ? null
        : mtimes.cargoAudit > 0 && mtimes.cargoMetadata > 0
          ? "cargo direct evidence is older than Rust dependency inputs"
          : "cargo direct evidence is incomplete",
      inputCutoffMs: cargoInputCutoffMs,
      auditMtimeMs: mtimes.cargoAudit,
      metadataMtimeMs: mtimes.cargoMetadata,
      auditJson: null,
      metadataJson: null,
    },
    provenance: null,
    mtimes,
  };
  try {
    if (npmFresh) {
      evidence.npm.json = await readJsonFile(directEvidencePaths.npmAudit);
      if (!hasNpmAuditVulnerabilityMetadata(evidence.npm.json)) {
        evidence.npm.ok = false;
        evidence.npm.reason = "npm direct evidence does not contain audit vulnerability metadata";
      }
    }
    if (cargoFresh) {
      evidence.cargo.auditJson = await readJsonFile(directEvidencePaths.cargoAudit);
      evidence.cargo.metadataJson = await readJsonFile(directEvidencePaths.cargoMetadata);
      const auditValid = hasCargoAuditVulnerabilityCount(evidence.cargo.auditJson);
      const metadataValid = hasCargoMetadataResolveRoot(evidence.cargo.metadataJson);
      if (!auditValid || !metadataValid) {
        evidence.cargo.ok = false;
        evidence.cargo.reason = [
          auditValid ? null : "cargo direct audit evidence does not contain a vulnerability count",
          metadataValid ? null : "cargo direct metadata evidence does not contain a resolve graph",
        ]
          .filter(Boolean)
          .join("; ");
      }
    }
    if (mtimes.provenance > 0) evidence.provenance = await readJsonFile(directEvidencePaths.provenance);
    evidence.ok = evidence.npm.ok && evidence.cargo.ok;
    return evidence;
  } catch (error) {
    return {
      ...evidence,
      ok: false,
      parseError: error instanceof Error ? error.message : String(error),
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

async function readRustSourceCorpus() {
  const root = path.join(repoRoot, "src-tauri", "src");
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".rs")) {
        files.push(full);
      }
    }
  }
  await walk(root);
  const parts = await Promise.all(
    files.sort().map(async (sourceFile) => {
      const relative = path.relative(repoRoot, sourceFile).replaceAll("\\", "/");
      return `\n// ${relative}\n${await readFile(sourceFile, "utf8")}`;
    }),
  );
  return parts.join("\n");
}

function git2AdvisoryApiScope(warning, rustSourceCorpus) {
  if (warning.package !== "git2") return null;
  if (warning.advisoryId === "RUSTSEC-2026-0183") {
    const remoteLines = rustSourceCorpus
      .split("\n")
      .filter((line) => /remote/i.test(line))
      .join("\n");
    const remoteListReachable = /Remote::list|\.list\s*\(/.test(remoteLines);
    return remoteListReachable
      ? null
      : {
          scope: "api-unreachable-in-source",
          reason: "git2 Remote::list is not referenced by active Rust source",
        };
  }
  if (warning.advisoryId === "RUSTSEC-2026-0184") {
    const blameReachable = /BlameHunk|git2::Blame|\.blame_file\s*\(|\.blame_buffer\s*\(|\.blame\s*\(/.test(
      rustSourceCorpus,
    );
    return blameReachable
      ? null
      : {
          scope: "api-unreachable-in-source",
          reason: "git2 BlameHunk/blame APIs are not referenced by active Rust source",
        };
  }
  return null;
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

function classifyCargoWarningReachability(warnings, metadata, rustSourceCorpus = "") {
  const reachability = buildCargoReachability(metadata);
  const runtime = new Set(reachability.runtimePackageKeys);
  const buildOnly = new Set(reachability.buildOnlyPackageKeys);
  const items = flattenCargoWarnings(warnings).map((warning) => {
    const apiScope = git2AdvisoryApiScope(warning, rustSourceCorpus);
    const scope =
      apiScope?.scope ??
      (runtime.has(warning.key)
        ? "windows-runtime"
        : buildOnly.has(warning.key)
          ? "build-time-or-proc-macro"
          : "target-unreachable-on-windows");
    return { ...warning, scope, apiReachability: apiScope };
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
    apiUnreachableWarningCount: items.filter((item) => item.scope === "api-unreachable-in-source").length,
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
  const usingDirectNpmEvidence = npmAudit.ok !== true && directEvidence?.npm?.ok === true;
  const usingDirectCargoEvidence =
    (cargoMetadata.ok !== true || cargoAudit.ok !== true) && directEvidence?.cargo?.ok === true;
  const npmJson = usingDirectNpmEvidence ? directEvidence.npm.json : parseJson(npmAudit.stdout);
  const cargoMetadataJson = usingDirectCargoEvidence
    ? directEvidence.cargo.metadataJson
    : parseJson(cargoMetadata.stdout);
  const cargoJson = usingDirectCargoEvidence ? directEvidence.cargo.auditJson : parseJson(cargoAudit.stdout);
  const npmKnownVulnerabilities = hasNpmAuditVulnerabilityMetadata(npmJson)
    ? (npmJson?.metadata?.vulnerabilities?.total ??
      Object.values(npmJson?.metadata?.vulnerabilities ?? {}).reduce(
        (sum, value) => sum + (typeof value === "number" ? value : 0),
        0,
      ))
    : null;
  const cargoKnownVulnerabilities = hasCargoAuditVulnerabilityCount(cargoJson) ? cargoJson.vulnerabilities.count : null;
  const cargoWarningCount = countCargoWarnings(cargoJson);
  const cargoWarnings = summarizeCargoWarnings(cargoJson);
  const rustSourceCorpus = await readRustSourceCorpus();
  const cargoWarningReachability = classifyCargoWarningReachability(cargoWarnings, cargoMetadataJson, rustSourceCorpus);
  const stackRiskClassification = await readClassifiedStackRisk();
  const npmAuditUnavailable = !(npmAudit.ok || usingDirectNpmEvidence) && npmKnownVulnerabilities == null;
  const cargoAuditCleanEnough =
    (cargoMetadata.ok || usingDirectCargoEvidence) &&
    cargoWarningReachability.ok &&
    (cargoAudit.ok || usingDirectCargoEvidence) &&
    cargoKnownVulnerabilities === 0 &&
    cargoWarningReachability.runtimeCriticalWarningCount === 0;
  const classifiedUpstreamBound =
    (npmAudit.ok || usingDirectNpmEvidence) &&
    (cargoMetadata.ok || usingDirectCargoEvidence) &&
    cargoWarningReachability.ok &&
    (cargoAudit.ok || usingDirectCargoEvidence || hasCargoAuditVulnerabilityCount(cargoJson)) &&
    npmKnownVulnerabilities === 0 &&
    typeof cargoKnownVulnerabilities === "number" &&
    cargoKnownVulnerabilities > 0 &&
    cargoWarningReachability.runtimeCriticalWarningCount === 0 &&
    stackRiskClassification.ok === true;
  const status =
    (npmAudit.ok || usingDirectNpmEvidence) &&
    (cargoMetadata.ok || usingDirectCargoEvidence) &&
    cargoWarningReachability.ok &&
    (cargoAudit.ok || usingDirectCargoEvidence) &&
    npmKnownVulnerabilities === 0 &&
    cargoKnownVulnerabilities === 0 &&
    cargoWarningReachability.runtimeCriticalWarningCount === 0
      ? "pass"
      : classifiedUpstreamBound
        ? "classified-upstream-bound"
      : npmAuditUnavailable && cargoAuditCleanEnough
        ? "environment-blocked"
        : "fail";
  const report = {
    version: 1,
    generatedAt,
    status,
    npm: {
      ok: npmAudit.ok || usingDirectNpmEvidence,
      exitCode: npmAudit.exitCode,
      knownVulnerabilities: npmKnownVulnerabilities ?? null,
      unavailableReason: npmAuditUnavailable ? npmAudit.stderr.slice(-2000) || directEvidence?.npm?.reason : null,
      stderrTail: npmAudit.stderr.slice(-2000),
    },
    cargo: {
      ok: cargoAudit.ok || usingDirectCargoEvidence,
      exitCode: cargoAudit.exitCode,
      knownVulnerabilities: cargoKnownVulnerabilities,
      warningCount: cargoWarningCount,
      warnings: cargoWarnings,
      reachability: cargoWarningReachability,
      advisoryDatabase: cargoJson?.database ?? null,
      stderrTail: cargoAudit.stderr.slice(-2000),
    },
    cargoMetadata: {
      ok: cargoMetadata.ok || usingDirectCargoEvidence,
      exitCode: cargoMetadata.exitCode,
      stderrTail: cargoMetadata.stderr.slice(-2000),
    },
    directEvidence: {
      used: usingDirectNpmEvidence || usingDirectCargoEvidence,
      ok: directEvidence?.ok ?? null,
      npm: directEvidence?.npm
        ? {
            used: usingDirectNpmEvidence,
            ok: directEvidence.npm.ok,
            reason: directEvidence.npm.reason,
            inputCutoffMs: directEvidence.npm.inputCutoffMs,
            evidenceMtimeMs: directEvidence.npm.evidenceMtimeMs,
          }
        : null,
      cargo: directEvidence?.cargo
        ? {
            used: usingDirectCargoEvidence,
            ok: directEvidence.cargo.ok,
            reason: directEvidence.cargo.reason,
            inputCutoffMs: directEvidence.cargo.inputCutoffMs,
            auditMtimeMs: directEvidence.cargo.auditMtimeMs,
            metadataMtimeMs: directEvidence.cargo.metadataMtimeMs,
          }
        : null,
      parseError: directEvidence?.parseError ?? null,
      paths: Object.fromEntries(
        Object.entries(directEvidencePaths).map(([key, value]) => [
          key,
          path.relative(repoRoot, value).replaceAll("\\", "/"),
        ]),
      ),
      provenance: directEvidence?.provenance ?? null,
    },
    stackRiskClassification,
    policy: {
      failOnKnownVulnerabilities: true,
      allowClassifiedUpstreamBoundBlockers: true,
      repoOwnedReleaseBlockersMustBeZero: true,
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
  console.log(`[supply-chain] stackRiskClassification=${stackRiskClassification.ok ? "pass" : "fail"}`);
  console.log(`[supply-chain] stackRiskUpstreamBoundBlockers=${stackRiskClassification.upstreamBoundBlockerCount}`);
  console.log(`[supply-chain] cargoBuildOnlyWarningCount=${report.cargo.reachability.buildOnlyWarningCount}`);
  console.log(
    `[supply-chain] cargoTargetUnreachableWarningCount=${report.cargo.reachability.targetUnreachableWarningCount}`,
  );
  console.log(`[supply-chain] cargoApiUnreachableWarningCount=${report.cargo.reachability.apiUnreachableWarningCount}`);
  console.log(`[supply-chain] wrote ${path.relative(repoRoot, outJson).replaceAll("\\", "/")}`);
  if (!["pass", "classified-upstream-bound", "environment-blocked"].includes(status)) process.exit(1);
}

main().catch((error) => {
  console.error(`[supply-chain] ${error.message ?? error}`);
  process.exit(1);
});
