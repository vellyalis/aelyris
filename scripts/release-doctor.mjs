import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const strictSigning = args.has("--strict-signing") || process.env.AETHER_RELEASE_STRICT_SIGNING === "1";
const failOnWarning = args.has("--fail-on-warn") || process.env.AETHER_RELEASE_FAIL_ON_WARN === "1";
const outputDir = path.join(repoRoot, ".codex-auto", "release-doctor");
const outputJson = path.join(outputDir, "p2-08-release-doctor.json");
const outputMarkdown = path.join(outputDir, "p2-08-release-doctor.md");

const minArtifactBytes = {
  appExe: 10 * 1024 * 1024,
  nsis: 4 * 1024 * 1024,
  msi: 4 * 1024 * 1024,
};

function rel(filePath) {
  return path.relative(repoRoot, filePath) || filePath;
}

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function formatBytes(bytes) {
  if (bytes == null) return "missing";
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function section(id, title, status, summary, details = {}) {
  return { id, title, status, summary, details };
}

function statusRank(status) {
  if (status === "fail") return 2;
  if (status === "warn") return 1;
  return 0;
}

function summarizeStatus(checks) {
  const worst = checks.reduce((acc, item) => Math.max(acc, statusRank(item.status)), 0);
  if (worst === 2) return "fail";
  if (worst === 1) return "pass_with_warnings";
  return "pass";
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
}

async function maybeReadJson(relativePath) {
  try {
    return await readJson(relativePath);
  } catch {
    return null;
  }
}

async function readText(relativePath) {
  return await readFile(path.join(repoRoot, relativePath), "utf8");
}

async function fileInfo(filePath) {
  try {
    const info = await stat(filePath);
    const hash = createHash("sha256");
    hash.update(await readFile(filePath));
    return {
      exists: true,
      path: normalizePath(rel(filePath)),
      bytes: info.size,
      size: formatBytes(info.size),
      modifiedAt: info.mtime.toISOString(),
      sha256: hash.digest("hex"),
    };
  } catch {
    return {
      exists: false,
      path: normalizePath(rel(filePath)),
      bytes: null,
      size: "missing",
      modifiedAt: null,
      sha256: null,
    };
  }
}

function parseCargoVersion(cargoToml) {
  const packageBlock = cargoToml.match(/^\[package\][\s\S]*?(?=^\[|$)/m)?.[0] ?? "";
  return packageBlock.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null;
}

async function checkVersion(pkg, tauriConfig) {
  const cargoToml = await readText("src-tauri/Cargo.toml");
  const cargoVersion = parseCargoVersion(cargoToml);
  const versions = {
    packageJson: pkg.version,
    tauriConfig: tauriConfig.version,
    cargoToml: cargoVersion,
  };
  const uniqueVersions = new Set(Object.values(versions).filter(Boolean));
  const ok = uniqueVersions.size === 1 && uniqueVersions.has(pkg.version);
  return section(
    "version-match",
    "Version Match",
    ok ? "pass" : "fail",
    ok
      ? `package.json, tauri.conf.json, and Cargo.toml agree on ${pkg.version}.`
      : `Version mismatch: ${JSON.stringify(versions)}.`,
    { versions },
  );
}

async function checkIconIntegrity(tauriConfig) {
  const iconEntries = tauriConfig.bundle?.icon ?? [];
  const requiredExtraIcons = ["icons/64x64.png", "icons/icon.png", "icons/StoreLogo.png"];
  const iconPaths = [...new Set([...iconEntries, ...requiredExtraIcons])];
  const icons = [];
  for (const iconPath of iconPaths) {
    const info = await fileInfo(path.join(repoRoot, "src-tauri", iconPath));
    icons.push(info);
  }
  const missing = icons.filter((icon) => !icon.exists);
  const tiny = icons.filter((icon) => icon.exists && icon.bytes < 256);
  const status = missing.length > 0 || tiny.length > 0 ? "fail" : "pass";
  return section(
    "icon-integrity",
    "Icon Integrity",
    status,
    status === "pass"
      ? `${icons.length} configured Windows/Tauri icon files exist and have non-empty content.`
      : `Icon check failed: ${missing.length} missing, ${tiny.length} suspiciously tiny.`,
    { icons, missing: missing.map((icon) => icon.path), tiny: tiny.map((icon) => icon.path) },
  );
}

function artifactPaths(version) {
  return {
    appExe: path.join(repoRoot, "src-tauri", "target", "release", "aether-terminal.exe"),
    nsis: path.join(
      repoRoot,
      "src-tauri",
      "target",
      "release",
      "bundle",
      "nsis",
      `Aether Terminal_${version}_x64-setup.exe`,
    ),
    msi: path.join(
      repoRoot,
      "src-tauri",
      "target",
      "release",
      "bundle",
      "msi",
      `Aether Terminal_${version}_x64_en-US.msi`,
    ),
    latestJson: path.join(repoRoot, "src-tauri", "target", "release", "bundle", "latest.json"),
  };
}

async function checkDistArtifacts(version) {
  const paths = artifactPaths(version);
  const appExe = await fileInfo(paths.appExe);
  const nsis = await fileInfo(paths.nsis);
  const msi = await fileInfo(paths.msi);
  const artifacts = { appExe, nsis, msi };
  const failures = Object.entries(artifacts).filter(
    ([key, info]) => !info.exists || info.bytes < minArtifactBytes[key],
  );
  return section(
    "dist-artifacts",
    "Distribution Artifacts",
    failures.length === 0 ? "pass" : "fail",
    failures.length === 0
      ? `Current ${version} exe, NSIS setup, and MSI artifacts are present.`
      : `Missing or undersized current artifacts: ${failures.map(([, info]) => info.path).join(", ")}.`,
    { version, artifacts, minimumBytes: minArtifactBytes },
  );
}

function hasWindowsInstallerTarget(targets) {
  return targets === "all" || (Array.isArray(targets) && (targets.includes("nsis") || targets.includes("msi")));
}

async function checkTauriBuild(pkg, tauriConfig, tauriDistConfig) {
  const script = pkg.scripts?.["tauri:build:dist"];
  const buildReady =
    script === "node scripts/build-pty-sidecar.mjs && tauri build --config src-tauri/tauri.dist.conf.json --no-sign" &&
    tauriConfig.bundle?.active === true &&
    hasWindowsInstallerTarget(tauriConfig.bundle?.targets) &&
    Array.isArray(tauriDistConfig.bundle?.externalBin) &&
    tauriDistConfig.bundle.externalBin.includes("binaries/aether-pty-server") &&
    tauriDistConfig.bundle?.createUpdaterArtifacts === false;
  return section(
    "tauri-build",
    "Tauri Build Contract",
    buildReady ? "pass" : "fail",
    buildReady
      ? "Local distribution build contract is configured for unsigned Windows exe/MSI/NSIS verification."
      : "Tauri build contract is not ready for the local Windows distribution gate.",
    {
      script,
      bundleActive: tauriConfig.bundle?.active,
      targets: tauriConfig.bundle?.targets,
      externalBin: tauriDistConfig.bundle?.externalBin,
      distCreateUpdaterArtifacts: tauriDistConfig.bundle?.createUpdaterArtifacts,
    },
  );
}

async function checkSigning(version, tauriConfig) {
  const paths = artifactPaths(version);
  const sigs = {
    nsis: await fileInfo(`${paths.nsis}.sig`),
    msi: await fileInfo(`${paths.msi}.sig`),
  };
  const pubkey = tauriConfig.plugins?.updater?.pubkey ?? "";
  const hasPlaceholderPubkey = !pubkey || pubkey.includes("REPLACE_");
  const hasPrivateKey = Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY);
  const allSigsPresent = sigs.nsis.exists && sigs.msi.exists;
  const signedReady = allSigsPresent && !hasPlaceholderPubkey;
  const status = signedReady ? "pass" : strictSigning ? "fail" : "warn";
  return section(
    "signing-state",
    "Signing State",
    status,
    signedReady
      ? "Updater signatures and a non-placeholder updater pubkey are present."
      : "Current artifacts are suitable for local no-sign smoke only; signed updater release requires keys and .sig files.",
    {
      strictSigning,
      hasPrivateKey,
      hasPlaceholderPubkey,
      pubkeyState: hasPlaceholderPubkey ? "placeholder-or-missing" : "configured",
      signatures: sigs,
    },
  );
}

async function checkUpdater(version, tauriConfig) {
  const paths = artifactPaths(version);
  const latest = await fileInfo(paths.latestJson);
  const endpoints = tauriConfig.plugins?.updater?.endpoints ?? [];
  let latestJson = null;
  if (latest.exists) {
    try {
      latestJson = JSON.parse(await readFile(paths.latestJson, "utf8"));
    } catch {
      latestJson = null;
    }
  }
  const endpointConfigured = Array.isArray(endpoints) && endpoints.length > 0;
  const invalidEndpoints = endpoints.filter((endpoint) => {
    try {
      const url = new URL(endpoint.replace("{{target}}", "windows-x86_64").replace("{{current_version}}", version));
      return (
        url.protocol !== "https:" ||
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname.endsWith(".invalid") ||
        url.hostname.includes("example")
      );
    } catch {
      return true;
    }
  });
  const latestMatches = latestJson?.version === version;
  const status = !endpointConfigured || invalidEndpoints.length > 0 ? "fail" : latestMatches ? "pass" : "warn";
  return section(
    "updater-latest-release",
    "Updater And Latest Release",
    status,
    status === "pass"
      ? `Updater endpoint and latest.json are present for ${version}.`
      : status === "fail"
        ? "Updater endpoint is missing or points at a non-production host."
        : "Updater endpoint exists, but latest.json/signatures are not ready for a signed update channel.",
    { endpoints, invalidEndpoints, latest, latestJsonVersion: latestJson?.version ?? null },
  );
}

async function checkKnownRisks() {
  const riskRegister = await maybeReadJson(".codex-auto/risk-register.json");
  const risks = riskRegister?.risks ?? [];
  const closedStatuses = new Set(["closed", "mitigated", "resolved"]);
  const acceptedRisks = risks.filter((risk) => String(risk.status ?? "").toLowerCase() === "accepted");
  const openRisks = risks.filter((risk) => {
    const status = String(risk.status ?? "").toLowerCase();
    return !closedStatuses.has(status) && status !== "accepted";
  });
  const releaseKeywords = /release|dist|sign|installer|updater|crash|rollback|tauri|webview|ime/i;
  const releaseRisks = openRisks
    .filter((risk) => releaseKeywords.test(`${risk.key ?? ""} ${risk.title ?? ""} ${risk.mitigation ?? ""}`))
    .slice(-12);
  const acceptedReleaseRisks = acceptedRisks
    .filter((risk) =>
      releaseKeywords.test(`${risk.key ?? ""} ${risk.title ?? ""} ${risk.mitigation ?? ""} ${risk.closureReason ?? ""}`),
    )
    .slice(-12);
  const acceptedSevereRisks = acceptedRisks
    .filter((risk) => /critical|high|medium-high/i.test(String(risk.severity ?? "")))
    .slice(-12);
  const status = releaseRisks.length > 0 || acceptedSevereRisks.length > 0 ? "warn" : "pass";
  return section(
    "known-risks",
    "Known Risks",
    status,
    releaseRisks.length > 0
      ? `${releaseRisks.length} open release-adjacent risks remain visible for handoff.`
      : acceptedSevereRisks.length > 0
        ? `${acceptedSevereRisks.length} accepted severe risks remain and need explicit release-owner approval.`
        : acceptedReleaseRisks.length > 0
          ? `No open release-adjacent risks; ${acceptedReleaseRisks.length} accepted low-risk release controls are recorded.`
          : "No open release-adjacent risks were found in the risk register.",
    {
      openRiskCount: openRisks.length,
      acceptedRiskCount: acceptedRisks.length,
      releaseRisks: releaseRisks.map((risk) => ({
        id: risk.id,
        key: risk.key,
        severity: risk.severity,
        title: risk.title,
        parentRoadmapId: risk.parentRoadmapId,
        reason: risk.reason,
      })),
      acceptedReleaseRisks: acceptedReleaseRisks.map((risk) => ({
        id: risk.id,
        key: risk.key,
        severity: risk.severity,
        title: risk.title,
        closureReason: risk.closureReason,
      })),
      acceptedSevereRisks: acceptedSevereRisks.map((risk) => ({
        id: risk.id,
        key: risk.key,
        severity: risk.severity,
        title: risk.title,
        closureReason: risk.closureReason,
      })),
    },
  );
}

async function listFilesSafe(dir, extensions) {
  if (!dir || !existsSync(dir)) return [];
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (out.length < 80) out.push(...(await listFilesSafe(full, extensions)));
      continue;
    }
    if (extensions.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
      const info = await stat(full);
      out.push({
        path: normalizePath(rel(full)),
        bytes: info.size,
        modifiedAt: info.mtime.toISOString(),
      });
    }
  }
  return out;
}

async function checkCrashLogs() {
  const localAppData = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Aether Terminal") : null;
  const candidates = [
    path.join(repoRoot, ".codex-auto", "crash-reports"),
    path.join(repoRoot, ".codex-auto", "logs"),
    localAppData ? path.join(localAppData, "logs") : null,
  ].filter(Boolean);
  const crashFiles = [];
  const errLogs = [];
  for (const dir of candidates) {
    const crashes = await listFilesSafe(dir, [".dmp", ".crash"]);
    crashFiles.push(...crashes);
    const logs = await listFilesSafe(dir, [".err.log"]);
    errLogs.push(...logs.filter((log) => log.bytes > 0));
  }
  return section(
    "crash-log-status",
    "Crash Log Status",
    crashFiles.length > 0 ? "warn" : "pass",
    crashFiles.length > 0
      ? `${crashFiles.length} crash dump/report files are present and should be reviewed before release.`
      : "No crash dump/report files found in release doctor scan paths.",
    {
      scanPaths: candidates.map((candidate) => normalizePath(rel(candidate))),
      crashFiles: crashFiles.slice(-20),
      nonEmptyErrLogCount: errLogs.length,
      recentErrLogs: errLogs.slice(-12),
    },
  );
}

function parseVersionFromArtifact(name) {
  return name.match(/Aether Terminal_([^_]+)_x64/)?.[1] ?? null;
}

async function checkRollback(version) {
  const bundleRoot = path.join(repoRoot, "src-tauri", "target", "release", "bundle");
  const previousArtifacts = [];
  for (const subdir of ["nsis", "msi"]) {
    const dir = path.join(bundleRoot, subdir);
    if (!existsSync(dir)) continue;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const artifactVersion = parseVersionFromArtifact(entry.name);
      if (artifactVersion && artifactVersion !== version) {
        const info = await fileInfo(path.join(dir, entry.name));
        previousArtifacts.push({ ...info, version: artifactVersion, kind: subdir });
      }
    }
  }
  const playbook = existsSync(path.join(repoRoot, "docs", "release-build-playbook.md"))
    ? await readText("docs/release-build-playbook.md")
    : "";
  const hasRollbackInstructions = /rollback/i.test(playbook) && /previous/i.test(playbook);
  const status = previousArtifacts.length > 0 && hasRollbackInstructions ? "pass" : "warn";
  return section(
    "rollback-package",
    "Rollback Package",
    status,
    status === "pass"
      ? `${previousArtifacts.length} previous installer artifacts are available and rollback instructions are documented.`
      : "Rollback needs at least one previous installer artifact plus documented rollback instructions.",
    {
      currentVersion: version,
      previousArtifacts: previousArtifacts.slice(-12),
      hasRollbackInstructions,
    },
  );
}

async function checkSmokePath() {
  const playbookPath = path.join(repoRoot, "docs", "release-build-playbook.md");
  const exists = existsSync(playbookPath);
  const playbook = exists ? await readFile(playbookPath, "utf8") : "";
  const requirements = [
    ["install", /install smoke/i],
    ["uninstall", /uninstall smoke/i],
    ["firstLaunch", /first launch/i],
    ["ime", /\bIME\b/i],
    ["dashboard", /dashboard/i],
    ["terminal", /terminal/i],
    ["rollback", /rollback/i],
  ];
  const missing = requirements.filter(([, pattern]) => !pattern.test(playbook)).map(([name]) => name);
  return section(
    "windows-smoke-path",
    "Windows Installer Smoke Path",
    exists && missing.length === 0 ? "pass" : "fail",
    exists && missing.length === 0
      ? "Windows exe/MSI install, first-launch, IME, dashboard, terminal, uninstall, and rollback smoke path is documented."
      : `Release playbook is missing smoke coverage: ${missing.join(", ") || "playbook file"}.`,
    {
      playbook: normalizePath(rel(playbookPath)),
      missing,
    },
  );
}

async function checkLatestReleaseGate() {
  const ledger = await maybeReadJson(".codex-auto/validation-ledger.json");
  const entries = ledger?.entries ?? [];
  const releaseEntries = entries
    .filter((entry) => /release|dist/i.test(JSON.stringify(entry)))
    .slice(-5)
    .map((entry) => ({
      id: entry.id,
      at: entry.at,
      status: entry.status ?? entry.result ?? null,
      roadmapId: entry.roadmapId ?? entry.activeRoadmapId ?? null,
    }));
  return section(
    "latest-release-gate",
    "Latest Release Gate",
    releaseEntries.length > 0 ? "pass" : "warn",
    releaseEntries.length > 0
      ? `Found ${releaseEntries.length} recent release/dist validation ledger entries.`
      : "No previous release/dist validation ledger entry found; this doctor report should be recorded as P2-08 evidence.",
    { releaseEntries },
  );
}

async function main() {
  const pkg = await readJson("package.json");
  const tauriConfig = await readJson("src-tauri/tauri.conf.json");
  const tauriDistConfig = await readJson("src-tauri/tauri.dist.conf.json");
  const version = pkg.version;
  const generatedAt = new Date().toISOString();

  const checks = [
    await checkVersion(pkg, tauriConfig),
    await checkIconIntegrity(tauriConfig),
    await checkDistArtifacts(version),
    await checkTauriBuild(pkg, tauriConfig, tauriDistConfig),
    await checkSigning(version, tauriConfig),
    await checkUpdater(version, tauriConfig),
    await checkLatestReleaseGate(),
    await checkKnownRisks(),
    await checkCrashLogs(),
    await checkRollback(version),
    await checkSmokePath(),
  ];

  const overallStatus = summarizeStatus(checks);
  const report = {
    version: 1,
    roadmapId: "P2-08",
    parentRoadmapId: "P2-08",
    reason: "blocker-decomposition",
    taskId: "auto-1778005841170-4-release-doctor-and-distribution-",
    generatedAt,
    workspace: normalizePath(repoRoot),
    host: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
    },
    strictSigning,
    failOnWarning,
    overallStatus,
    releaseCandidateReady: overallStatus === "pass",
    localUnsignedSmokeReady: checks
      .filter((check) => ["version-match", "icon-integrity", "dist-artifacts", "tauri-build", "windows-smoke-path"].includes(check.id))
      .every((check) => check.status === "pass"),
    checks,
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const markdown = [
    "# P2-08 Release Doctor",
    "",
    `- Generated: ${generatedAt}`,
    `- Overall: ${overallStatus}`,
    `- Release candidate ready: ${report.releaseCandidateReady}`,
    `- Local unsigned smoke ready: ${report.localUnsignedSmokeReady}`,
    "",
    "| Check | Status | Summary |",
    "| --- | --- | --- |",
    ...checks.map((check) => `| ${check.title} | ${check.status} | ${check.summary.replaceAll("|", "\\|")} |`),
    "",
  ].join("\n");
  await writeFile(outputMarkdown, markdown, "utf8");

  for (const check of checks) {
    console.log(`[doctor] ${check.status.toUpperCase()} ${check.title}: ${check.summary}`);
  }
  console.log(`[doctor] wrote ${normalizePath(rel(outputJson))}`);
  console.log(`[doctor] wrote ${normalizePath(rel(outputMarkdown))}`);
  console.log(`[doctor] overall=${overallStatus}`);

  if (overallStatus === "fail" || (overallStatus === "pass_with_warnings" && failOnWarning)) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`[doctor] ${error.message ?? error}`);
  process.exit(1);
});
