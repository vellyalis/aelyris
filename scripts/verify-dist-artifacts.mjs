import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const tauriConfig = JSON.parse(await readFile(path.join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8"));
const tauriDistConfig = JSON.parse(await readFile(path.join(repoRoot, "src-tauri", "tauri.dist.conf.json"), "utf8"));
const version = pkg.version;

const artifacts = [
  {
    label: "App exe",
    path: path.join(repoRoot, "src-tauri", "target", "release", "aether-terminal.exe"),
    minBytes: 10 * 1024 * 1024,
  },
  {
    label: "NSIS setup exe",
    path: path.join(
      repoRoot,
      "src-tauri",
      "target",
      "release",
      "bundle",
      "nsis",
      `Aether Terminal_${version}_x64-setup.exe`,
    ),
    minBytes: 4 * 1024 * 1024,
  },
  {
    label: "MSI",
    path: path.join(
      repoRoot,
      "src-tauri",
      "target",
      "release",
      "bundle",
      "msi",
      `Aether Terminal_${version}_x64_en-US.msi`,
    ),
    minBytes: 4 * 1024 * 1024,
  },
];

const failures = [];

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function relativeArtifactPath(artifactPath) {
  return path.relative(repoRoot, artifactPath) || artifactPath;
}

function recordFailure(message) {
  failures.push(message);
  console.error(message);
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    recordFailure(`[dist] ${label} mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertBundleTargets() {
  const targets = tauriConfig.bundle?.targets;
  const hasWindowsInstallerTarget =
    targets === "all" || (Array.isArray(targets) && (targets.includes("nsis") || targets.includes("msi")));

  if (!hasWindowsInstallerTarget) {
    recordFailure(`[dist] Tauri bundle targets must include Windows installers, got ${JSON.stringify(targets)}`);
  }
}

assertEqual("package.json and tauri.conf.json version", tauriConfig.version, version);
assertEqual("Tauri productName", tauriConfig.productName, "Aether Terminal");
assertEqual("Tauri bundle.active", tauriConfig.bundle?.active, true);
assertEqual("Dist updater artifacts", tauriDistConfig.bundle?.createUpdaterArtifacts, false);
assertBundleTargets();

for (const artifact of artifacts) {
  try {
    await access(artifact.path);
    const info = await stat(artifact.path);
    if (info.size < artifact.minBytes) {
      recordFailure(
        `[dist] ${artifact.label} is suspiciously small: ${formatMiB(info.size)} ` +
          `(expected at least ${formatMiB(artifact.minBytes)}): ${relativeArtifactPath(artifact.path)}`,
      );
      continue;
    }
    console.log(`[dist] ${artifact.label}: ${formatMiB(info.size)} (${relativeArtifactPath(artifact.path)})`);
  } catch {
    recordFailure(`[dist] Missing ${artifact.label}: ${relativeArtifactPath(artifact.path)}`);
  }
}

if (failures.length > 0) {
  console.error("");
  console.error(`[dist] Artifact verification failed for version ${version}.`);
  console.error("[dist] Expected artifacts:");
  for (const artifact of artifacts) {
    console.error(
      `  - ${artifact.label}: ${relativeArtifactPath(artifact.path)} (min ${formatMiB(artifact.minBytes)})`,
    );
  }
  console.error("[dist] Run `pnpm.cmd tauri:build:dist`, then re-run `pnpm.cmd verify:dist`.");
  process.exit(1);
}

console.log("[dist] Artifacts look ready for local distribution.");
