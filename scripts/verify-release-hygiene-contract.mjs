import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "release-hygiene-contract.json");
const SELF = "scripts/verify-release-hygiene-contract.mjs";

const MANUAL_DIAGNOSTIC_SCRIPT_PATTERN = /^scripts\/(?:diag-|tmp-|temporary-).*\.(?:mjs|js|ts|ps1|sh)$/i;
const ACTIVE_SOURCE_EXTENSIONS = new Set([".css", ".js", ".jsx", ".mjs", ".rs", ".ts", ".tsx"]);
const FALLBACK_SCAN_ROOTS = [
  "package.json",
  "src-tauri/Cargo.toml",
  "src",
  "src-tauri/src",
  "scripts",
];
const FALLBACK_SKIP_DIRS = new Set([
  ".codex-auto",
  ".git",
  "dist",
  "node_modules",
  "src-tauri/target",
  "target",
]);
const DISALLOWED_MARKERS = [
  {
    id: "temporary-engine-instrumentation",
    pattern: /temporary\s+.{0,60}instrumentation/i,
    reason: "Temporary engine instrumentation must be promoted to a verifier or removed before release.",
  },
  {
    id: "manual-osc-buffer-log-marker",
    pattern: /\[aelyris-engine\]\s+OSC buffer/i,
    reason: "Manual OSC buffer log probes are not release proof; use deterministic verifier artifacts.",
  },
  {
    id: "ad-hoc-tauri-dev-log-path",
    pattern: /\/tmp\/tauri-dev\d*\.log/i,
    reason: "Hard-coded ad-hoc dev log paths make release evidence non-reproducible.",
  },
];

function gitFiles(args) {
  const result = spawnSync("git", ["ls-files", ...args], { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    return {
      ok: false,
      files: [],
      error: `git ls-files ${args.join(" ")} failed: ${result.stderr || result.stdout || result.status}`,
    };
  }
  return {
    ok: true,
    files: result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim().replaceAll("\\", "/"))
      .filter(Boolean),
    error: null,
  };
}

function shouldSkipFallbackDir(path) {
  const normalized = path.replaceAll("\\", "/");
  if (FALLBACK_SKIP_DIRS.has(normalized)) return true;
  return [...FALLBACK_SKIP_DIRS].some((prefix) => normalized.startsWith(`${prefix}/`));
}

function walkFallback(path, out = []) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return out;
  const normalized = path.replaceAll("\\", "/");
  if (shouldSkipFallbackDir(normalized)) return out;
  const stat = statSync(full);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(full)) {
      walkFallback(join(path, entry), out);
    }
    return out;
  }
  out.push(normalized);
  return out;
}

function fallbackSourceFiles() {
  return [
    ...new Set(
      FALLBACK_SCAN_ROOTS.flatMap((path) => walkFallback(path)).filter((path) => existsSync(join(ROOT, path))),
    ),
  ];
}

function isActiveSourcePath(path) {
  if (path === SELF) return false;
  if (path.startsWith("docs/") || path.startsWith("CHANGELOG")) return false;
  if (path.startsWith("src/__tests__/") || path.startsWith("src-tauri/tests/")) return false;
  if (path.startsWith("src-tauri/vendor/")) return false;
  if (path === "package.json" || path === "src-tauri/Cargo.toml") return true;
  if (path.startsWith("src/") || path.startsWith("src-tauri/src/") || path.startsWith("scripts/")) {
    return ACTIVE_SOURCE_EXTENSIONS.has(extname(path));
  }
  return false;
}

function lineMatches(path, marker) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return [];
  return readFileSync(full, "utf8")
    .split(/\r?\n/)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => marker.pattern.test(line))
    .map(({ line, lineNumber }) => ({
      marker: marker.id,
      path,
      lineNumber,
      reason: marker.reason,
      sample: line.trim().slice(0, 240),
    }));
}

function writeArtifact(report) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
}

const trackedFileResult = gitFiles([]);
const untrackedFileResult = gitFiles(["--others", "--exclude-standard"]);
const gitEnumerationAvailable = trackedFileResult.ok && untrackedFileResult.ok;
const fallbackFiles = gitEnumerationAvailable ? [] : fallbackSourceFiles();
const trackedFiles = trackedFileResult.files;
const untrackedFiles = gitEnumerationAvailable ? untrackedFileResult.files : fallbackFiles;
const files = [...new Set([...trackedFiles, ...untrackedFiles, ...fallbackFiles])].filter((path) =>
  existsSync(join(ROOT, path)),
);
const manualDiagnosticScripts = files.filter((path) => MANUAL_DIAGNOSTIC_SCRIPT_PATTERN.test(path));
const scannedFiles = files.filter(isActiveSourcePath);
const markerHits = scannedFiles.flatMap((path) => DISALLOWED_MARKERS.flatMap((marker) => lineMatches(path, marker)));

const checks = {
  trackedFilesAvailable: trackedFiles.length > 0 || fallbackFiles.length > 0,
  untrackedFilesEnumerated: gitEnumerationAvailable || fallbackFiles.length > 0,
  activeSourcesIncludeUntracked: untrackedFiles.filter(isActiveSourcePath).every((path) => scannedFiles.includes(path)),
  noManualDiagnosticScripts: manualDiagnosticScripts.length === 0,
  noTemporaryInstrumentationMarkers: markerHits.length === 0,
};

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  ok: Object.values(checks).every(Boolean),
  status: Object.values(checks).every(Boolean) ? "pass-current-release-hygiene-contract" : "failed",
  checks,
  enumeration: {
    mode: gitEnumerationAvailable ? "git-ls-files" : "filesystem-active-source-scan",
    gitEnumerationAvailable,
    gitErrors: [trackedFileResult.error, untrackedFileResult.error].filter(Boolean),
    fallbackRootCount: FALLBACK_SCAN_ROOTS.length,
    fallbackFileCount: fallbackFiles.length,
    note:
      gitEnumerationAvailable
        ? "Release hygiene scanned tracked and untracked files from git ls-files."
        : "Node child_process git execution was unavailable, so release hygiene scanned active source roots directly and recorded this verifier-only environment boundary.",
  },
  trackedFileCount: trackedFiles.length,
  untrackedFileCount: untrackedFiles.length,
  scannedUntrackedFileCount: untrackedFiles.filter(isActiveSourcePath).length,
  scannedFileCount: scannedFiles.length,
  manualDiagnosticScripts,
  markerHits,
  policy: {
    manualDiagnosticScriptPattern: String(MANUAL_DIAGNOSTIC_SCRIPT_PATTERN),
    activeSourceRoots: ["src", "src-tauri/src", "scripts", "package.json", "src-tauri/Cargo.toml"],
    expectation:
      "Release evidence must be deterministic: ad-hoc diagnostic scripts and temporary instrumentation markers are not allowed in active production/verifier sources.",
  },
};

writeArtifact(report);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));
if (!report.ok) process.exitCode = 1;
