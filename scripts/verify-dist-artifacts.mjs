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
  "scripts/build-dist-windows.ps1",
  "scripts/build-pty-sidecar.ps1",
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
  "scripts/build-dist-windows.ps1",
  "scripts/build-pty-sidecar.ps1",
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
      "scripts/build-dist-windows.ps1",
      "scripts/build-pty-sidecar.ps1",
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
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", `& { param($exePath) ${ps} }`, exePath],
      {
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
    );
    return JSON.parse(stdout.trim());
  } catch (error) {
    if (process.platform === "win32" && error?.code === "EPERM") {
      console.warn(
        `[dist] powershell.exe spawn was blocked while reading VersionInfo; falling back to PE resource parsing.`,
      );
      return readWindowsVersionInfoFromPe(exePath);
    }
    throw error;
  }
}

function align4(offset) {
  return (offset + 3) & ~3;
}

function readUtf16Z(buffer, offset, maxOffset) {
  let end = offset;
  while (end + 1 < maxOffset && buffer.readUInt16LE(end) !== 0) {
    end += 2;
  }
  return {
    value: buffer.toString("utf16le", offset, end),
    nextOffset: Math.min(end + 2, maxOffset),
  };
}

function rvaToOffset(sections, rva) {
  for (const section of sections) {
    const size = Math.max(section.virtualSize, section.rawSize);
    if (rva >= section.virtualAddress && rva < section.virtualAddress + size) {
      return section.rawPointer + (rva - section.virtualAddress);
    }
  }
  return null;
}

function parsePeHeaders(buffer) {
  if (buffer.length < 0x40 || buffer.toString("ascii", 0, 2) !== "MZ") {
    throw new Error("not a PE executable");
  }
  const peOffset = buffer.readUInt32LE(0x3c);
  if (buffer.toString("ascii", peOffset, peOffset + 4) !== "PE\u0000\u0000") {
    throw new Error("missing PE signature");
  }

  const fileHeaderOffset = peOffset + 4;
  const sectionCount = buffer.readUInt16LE(fileHeaderOffset + 2);
  const optionalHeaderSize = buffer.readUInt16LE(fileHeaderOffset + 16);
  const optionalHeaderOffset = fileHeaderOffset + 20;
  const magic = buffer.readUInt16LE(optionalHeaderOffset);
  const dataDirectoryOffset = optionalHeaderOffset + (magic === 0x20b ? 112 : 96);
  const resourceDirectoryRva = buffer.readUInt32LE(dataDirectoryOffset + 2 * 8);
  const sectionOffset = optionalHeaderOffset + optionalHeaderSize;
  const sections = [];

  for (let i = 0; i < sectionCount; i += 1) {
    const offset = sectionOffset + i * 40;
    sections.push({
      virtualSize: buffer.readUInt32LE(offset + 8),
      virtualAddress: buffer.readUInt32LE(offset + 12),
      rawSize: buffer.readUInt32LE(offset + 16),
      rawPointer: buffer.readUInt32LE(offset + 20),
    });
  }

  return { resourceDirectoryRva, sections };
}

function readResourceDirectoryEntries(buffer, baseOffset, directoryOffset) {
  const absoluteOffset = baseOffset + directoryOffset;
  const namedCount = buffer.readUInt16LE(absoluteOffset + 12);
  const idCount = buffer.readUInt16LE(absoluteOffset + 14);
  const entries = [];
  const count = namedCount + idCount;
  for (let i = 0; i < count; i += 1) {
    const entryOffset = absoluteOffset + 16 + i * 8;
    const nameOrId = buffer.readUInt32LE(entryOffset);
    const dataOrDirectory = buffer.readUInt32LE(entryOffset + 4);
    entries.push({
      id: nameOrId & 0x80000000 ? null : nameOrId,
      isDirectory: Boolean(dataOrDirectory & 0x80000000),
      offset: dataOrDirectory & 0x7fffffff,
    });
  }
  return entries;
}

function findVersionResource(buffer, resourceOffset, resourceRva, sections) {
  const typeEntry = readResourceDirectoryEntries(buffer, resourceOffset, 0).find((entry) => entry.id === 16);
  if (!typeEntry?.isDirectory) return null;
  const nameEntry = readResourceDirectoryEntries(buffer, resourceOffset, typeEntry.offset)[0];
  if (!nameEntry?.isDirectory) return null;
  const languageEntry = readResourceDirectoryEntries(buffer, resourceOffset, nameEntry.offset)[0];
  if (!languageEntry || languageEntry.isDirectory) return null;

  const dataEntryOffset = resourceOffset + languageEntry.offset;
  const dataRva = buffer.readUInt32LE(dataEntryOffset);
  const size = buffer.readUInt32LE(dataEntryOffset + 4);
  const dataOffset = rvaToOffset(sections, dataRva);
  if (dataOffset == null) return null;
  return buffer.subarray(dataOffset, dataOffset + size);
}

function parseVersionBlock(buffer, startOffset, endOffset) {
  const length = buffer.readUInt16LE(startOffset);
  const valueLength = buffer.readUInt16LE(startOffset + 2);
  const type = buffer.readUInt16LE(startOffset + 4);
  const blockEnd = Math.min(startOffset + length, endOffset);
  const key = readUtf16Z(buffer, startOffset + 6, blockEnd);
  let valueOffset = align4(key.nextOffset);
  let value = null;
  if (valueLength > 0) {
    if (type === 1) {
      const valueBytes = Math.max(0, (valueLength - 1) * 2);
      value = buffer.toString("utf16le", valueOffset, Math.min(valueOffset + valueBytes, blockEnd));
    }
    valueOffset = align4(valueOffset + (type === 1 ? valueLength * 2 : valueLength));
  }

  const children = [];
  let childOffset = valueOffset;
  while (childOffset + 6 <= blockEnd) {
    const childLength = buffer.readUInt16LE(childOffset);
    if (childLength <= 0 || childOffset + childLength > blockEnd) break;
    children.push(parseVersionBlock(buffer, childOffset, blockEnd));
    childOffset = align4(childOffset + childLength);
  }

  return { key: key.value, value, children };
}

function flattenVersionStrings(block, output = {}) {
  if (typeof block.value === "string" && block.children.length === 0) {
    output[block.key] = block.value;
  }
  for (const child of block.children) {
    flattenVersionStrings(child, output);
  }
  return output;
}

async function readWindowsVersionInfoFromPe(exePath) {
  const buffer = await readFile(exePath);
  const { resourceDirectoryRva, sections } = parsePeHeaders(buffer);
  const resourceOffset = rvaToOffset(sections, resourceDirectoryRva);
  if (resourceOffset == null) {
    throw new Error("missing PE resource directory");
  }
  const versionResource = findVersionResource(buffer, resourceOffset, resourceDirectoryRva, sections);
  if (!versionResource) {
    throw new Error("missing PE VersionInfo resource");
  }
  const info = flattenVersionStrings(parseVersionBlock(versionResource, 0, versionResource.length));
  return {
    ProductName: info.ProductName ?? "",
    FileDescription: info.FileDescription ?? "",
    CompanyName: info.CompanyName ?? "",
    FileVersion: info.FileVersion ?? "",
    ProductVersion: info.ProductVersion ?? "",
  };
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
if (tauriDistConfig.bundle?.createUpdaterArtifacts === false) {
  recordFailure("[dist] Dist config must not disable updater artifacts; release builds need signed update payloads");
}
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
