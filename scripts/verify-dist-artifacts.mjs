import { execFile } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);
const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const tauriConfig = JSON.parse(await readFile(path.join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8"));
const tauriDistConfig = JSON.parse(await readFile(path.join(repoRoot, "src-tauri", "tauri.dist.conf.json"), "utf8"));
const version = pkg.version;
const mainBinaryName = tauriConfig.mainBinaryName ?? pkg.name;

const failures = [];
const releaseProvenanceInputs = [
  "package.json",
  "pnpm-lock.yaml",
  "index.html",
  "vite.config.ts",
  "tsconfig.json",
  "scripts/build-pty-sidecar.mjs",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/tauri.conf.json",
  "src-tauri/tauri.dist.conf.json",
  {
    path: "src-tauri/src",
    exclude: [],
  },
  {
    path: "src",
    exclude: [
      /(^|[\\/])__tests__([\\/]|$)/,
      /\.test\.[cm]?[jt]sx?$/i,
      /\.spec\.[cm]?[jt]sx?$/i,
    ],
  },
  "public",
  "src-tauri/pty-server/Cargo.toml",
  "src-tauri/pty-server/src/main.rs",
];
const sidecarProvenanceInputs = [
  "scripts/build-pty-sidecar.mjs",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  {
    path: "src-tauri/src",
    exclude: [
      /(^|[\\/])main\.rs$/i,
      /(^|[\\/])bin([\\/]|$)/,
    ],
  },
  "src-tauri/pty-server/Cargo.toml",
  "src-tauri/pty-server/Cargo.lock",
  "src-tauri/pty-server/src/main.rs",
];

const artifacts = [
  {
    label: "App exe",
    path: path.join(repoRoot, "src-tauri", "target", "release", `${mainBinaryName}.exe`),
    minBytes: 10 * 1024 * 1024,
    provenanceInputs: releaseProvenanceInputs,
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
    provenanceInputs: releaseProvenanceInputs,
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
    provenanceInputs: releaseProvenanceInputs,
  },
];

const sidecarName = process.platform === "win32" ? "aether-pty-server-x86_64-pc-windows-msvc.exe" : null;
if (sidecarName) {
  artifacts.push({
    label: "PTY sidecar",
    path: path.join(repoRoot, "src-tauri", "binaries", sidecarName),
    minBytes: 1024 * 1024,
    provenanceInputs: sidecarProvenanceInputs,
  });
}
const aetherctlReleaseName = process.platform === "win32" ? "aetherctl.exe" : "aetherctl";
if (process.platform === "win32") {
  artifacts.push({
    label: "aetherctl",
    path: path.join(repoRoot, "src-tauri", "target", "release", aetherctlReleaseName),
    minBytes: 1024 * 1024,
    provenanceInputs: [
      "scripts/build-pty-sidecar.mjs",
      "src-tauri/Cargo.toml",
      "src-tauri/Cargo.lock",
      "src-tauri/src/bin/aetherctl.rs",
    ],
  });
}

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

async function readWindowsVersionInfo(exePath) {
  const ps = [
    "$ErrorActionPreference = 'Stop';",
    "$item = Get-Item -LiteralPath $exePath;",
    "$vi = $item.VersionInfo;",
    "[pscustomobject]@{",
    "  ProductName = $vi.ProductName;",
    "  FileDescription = $vi.FileDescription;",
    "  CompanyName = $vi.CompanyName;",
    "  FileVersion = $vi.FileVersion;",
    "  ProductVersion = $vi.ProductVersion",
    "} | ConvertTo-Json -Compress",
  ].join(" ");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-Command", `& { param($exePath) ${ps} }`, exePath],
    {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );
  return JSON.parse(stdout.trim());
}

async function assertWindowsAppIdentity(artifact) {
  if (process.platform !== "win32" || artifact.label !== "App exe") return;

  const basename = path.basename(artifact.path);
  if (basename !== "Aether.exe") {
    recordFailure(`[dist] App exe must be named Aether.exe for Task Manager discoverability, got ${basename}`);
  }

  try {
    const versionInfo = await readWindowsVersionInfo(artifact.path);
    const expected = {
      ProductName: "Aether Terminal",
      FileDescription: "Aether Terminal",
      CompanyName: "Aether",
    };
    for (const [key, value] of Object.entries(expected)) {
      if (versionInfo[key] !== value) {
        recordFailure(`[dist] App exe VersionInfo ${key} mismatch: expected ${value}, got ${versionInfo[key]}`);
      }
    }
    if (Object.entries(expected).every(([key, value]) => versionInfo[key] === value)) {
      console.log(
        `[dist] Windows app identity: ${basename}, ProductName=${versionInfo.ProductName}, Company=${versionInfo.CompanyName}`,
      );
    }
  } catch (error) {
    recordFailure(`[dist] Unable to read Windows VersionInfo for ${relativeArtifactPath(artifact.path)}: ${error}`);
  }
}

async function latestMtimeForInput(input) {
  const relativePath = typeof input === "string" ? input : input.path;
  const absolutePath = path.join(repoRoot, relativePath);
  let info;
  try {
    info = await stat(absolutePath);
  } catch {
    recordFailure(`[dist] Missing provenance input: ${relativePath}`);
    return 0;
  }
  if (!info.isDirectory()) return info.mtimeMs;

  const exclude = typeof input === "string" ? [] : (input.exclude ?? []);
  let latest = info.mtimeMs;
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(absolutePath, { withFileTypes: true });
  for (const entry of entries) {
    const childRelativePath = path.join(relativePath, entry.name);
    if (exclude.some((pattern) => pattern.test(childRelativePath))) continue;
    latest = Math.max(latest, await latestMtimeForInput({ path: childRelativePath, exclude }));
  }
  return latest;
}

async function latestMtimeMs(relativePaths) {
  let latest = 0;
  for (const input of relativePaths) {
    latest = Math.max(latest, await latestMtimeForInput(input));
  }
  return latest;
}

async function assertSidecarBundleWiring() {
  const externalBin = tauriDistConfig.bundle?.externalBin ?? [];
  if (!Array.isArray(externalBin) || !externalBin.includes("binaries/aether-pty-server")) {
    recordFailure(`[dist] PTY sidecar externalBin missing from tauri.dist.conf.json`);
  }
  if (process.platform !== "win32") return;
  const wxsPath = path.join(repoRoot, "src-tauri", "target", "release", "wix", "x64", "main.wxs");
  try {
    const wxs = await readFile(wxsPath, "utf8");
    const sidecarMatches = wxs.match(/aether-pty-server\.exe/g) ?? [];
    if (sidecarMatches.length !== 1) {
      recordFailure(`[dist] MSI manifest should include exactly one PTY sidecar exe, found ${sidecarMatches.length}`);
    }
    const ctlMatches = wxs.match(/aetherctl\.exe/g) ?? [];
    if (ctlMatches.length !== 1) {
      recordFailure(`[dist] MSI manifest should include exactly one aetherctl exe, found ${ctlMatches.length}`);
    }
  } catch {
    recordFailure(`[dist] Missing WiX manifest for sidecar verification: ${relativeArtifactPath(wxsPath)}`);
  }
}

assertEqual("package.json and tauri.conf.json version", tauriConfig.version, version);
assertEqual("Tauri productName", tauriConfig.productName, "Aether Terminal");
assertEqual("Tauri mainBinaryName", tauriConfig.mainBinaryName, "Aether");
assertEqual("Tauri bundle.active", tauriConfig.bundle?.active, true);
assertEqual("Dist updater artifacts", tauriDistConfig.bundle?.createUpdaterArtifacts, false);
assertBundleTargets();
await assertSidecarBundleWiring();

for (const artifact of artifacts) {
  try {
    await access(artifact.path);
    const info = await stat(artifact.path);
    const newestInputMtimeMs = await latestMtimeMs(artifact.provenanceInputs ?? releaseProvenanceInputs);
    if (info.size < artifact.minBytes) {
      recordFailure(
        `[dist] ${artifact.label} is suspiciously small: ${formatMiB(info.size)} ` +
          `(expected at least ${formatMiB(artifact.minBytes)}): ${relativeArtifactPath(artifact.path)}`,
      );
      continue;
    }
    if (newestInputMtimeMs > 0 && info.mtimeMs + 1000 < newestInputMtimeMs) {
      recordFailure(
        `[dist] ${artifact.label} is older than release inputs; rebuild required: ${relativeArtifactPath(artifact.path)}`,
      );
      continue;
    }
    await assertWindowsAppIdentity(artifact);
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
