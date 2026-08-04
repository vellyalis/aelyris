import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);

function runGit(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (!allowFailure && result.status !== 0) {
    process.stderr.write(result.stderr || `git ${args.join(" ")} failed\n`);
    process.exit(result.status ?? 1);
  }
  return result.status === 0 ? result.stdout.trim() : "";
}

function parseArgs(argv) {
  let base = null;
  let full = false;
  let readingFiles = false;
  const explicitFiles = [];
  const passthrough = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--files") {
      readingFiles = true;
    } else if (arg === "--") {
      // pnpm forwards its argument separator; it is not a Vitest filter.
    } else if (readingFiles) {
      explicitFiles.push(arg.replaceAll("\\", "/"));
    } else if (arg === "--base") {
      base = argv[index + 1] ?? null;
      index += 1;
    } else if (arg.startsWith("--base=")) {
      base = arg.slice("--base=".length);
    } else if (arg === "--full") {
      full = true;
    } else {
      passthrough.push(arg);
    }
  }
  return { base, explicitFiles, full, passthrough };
}

function parseNameStatus(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, ...pathParts] = line.split(/\s+/);
      return { status, file: pathParts.at(-1)?.replaceAll("\\", "/") ?? "" };
    })
    .filter((entry) => entry.file);
}

function collectChanges(base) {
  const diffArgs = base
    ? ["diff", "--name-status", "--diff-filter=ACMRD", base, "HEAD"]
    : ["diff", "--name-status", "--diff-filter=ACMRD", "HEAD"];
  const changes = parseNameStatus(runGit(diffArgs));
  if (!base) {
    const untracked = runGit(["ls-files", "--others", "--exclude-standard"], { allowFailure: true });
    changes.push(
      ...untracked
        .split(/\r?\n/)
        .map((file) => file.trim().replaceAll("\\", "/"))
        .filter(Boolean)
        .map((file) => ({ status: "?", file })),
    );
  }
  return [...new Map(changes.map((entry) => [entry.file, entry])).values()];
}

function isFrontendModule(file) {
  return /^src\/.+\.(?:[cm]?[jt]sx?)$/.test(file);
}

function requiresFullSuite(file) {
  return (
    /^(?:vite|vitest|playwright)\.config\.[cm]?[jt]s$/.test(file) ||
    /^tsconfig(?:\.[^.]+)?\.json$/.test(file) ||
    /^src\/(?:test|test-utils)\//.test(file) ||
    file === "pnpm-lock.yaml"
  );
}

function dependencyManifestChanged(changes, base) {
  if (!changes.some((entry) => entry.file === "package.json")) return false;
  const baseline = runGit(["show", `${base ?? "HEAD"}:package.json`], { allowFailure: true });
  if (!baseline) return true;
  try {
    const before = JSON.parse(baseline);
    const after = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    const dependencyContract = (manifest) => ({
      dependencies: manifest.dependencies ?? {},
      devDependencies: manifest.devDependencies ?? {},
      optionalDependencies: manifest.optionalDependencies ?? {},
      peerDependencies: manifest.peerDependencies ?? {},
      overrides: manifest.pnpm?.overrides ?? {},
    });
    return JSON.stringify(dependencyContract(before)) !== JSON.stringify(dependencyContract(after));
  } catch {
    return true;
  }
}

function vitestCliPath() {
  const packagePath = require.resolve("vitest/package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  const relativeBin = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.vitest;
  if (!relativeBin) throw new Error("vitest package does not expose a CLI binary");
  return path.resolve(path.dirname(packagePath), relativeBin);
}

const { base, explicitFiles, full: forcedFull, passthrough } = parseArgs(process.argv.slice(2));
const changes = explicitFiles.length > 0
  ? explicitFiles.map((file) => ({ status: "M", file }))
  : collectChanges(base);
const frontendChanges = changes.filter((entry) => isFrontendModule(entry.file));
const fullReason =
  forcedFull ||
  changes.some((entry) => entry.status.startsWith("D") && isFrontendModule(entry.file)) ||
  changes.some((entry) => requiresFullSuite(entry.file)) ||
  dependencyManifestChanged(changes, base);

if (!fullReason && frontendChanges.length === 0) {
  console.log("[frontend-tests] no changed frontend modules; skipping Vitest");
  process.exit(0);
}

const mode = fullReason ? "full" : "related";
const files = fullReason ? [] : frontendChanges.map((entry) => entry.file);
console.log(
  `[frontend-tests] mode=${mode} changedModules=${frontendChanges.length} base=${
    explicitFiles.length > 0 ? "explicit" : base ?? "worktree"
  }`,
);
for (const file of files) console.log(`[frontend-tests] owner=${file}`);

const cliArgs = fullReason
  ? [vitestCliPath(), "run", "--configLoader", "native", ...passthrough]
  : [
      vitestCliPath(),
      "related",
      "--run",
      "--passWithNoTests",
      "--configLoader",
      "native",
      ...files,
      ...passthrough,
    ];

const existingNodeOptions = process.env.NODE_OPTIONS?.trim();
const shimOption = "--require ./scripts/vite-windows-net-use-shim.cjs";
const result = spawnSync(process.execPath, cliArgs, {
  cwd: repoRoot,
  stdio: "inherit",
  windowsHide: true,
  env: {
    ...process.env,
    AELYRIS_VITE_NO_ESBUILD_SPAWN: "1",
    NODE_OPTIONS: existingNodeOptions ? `${existingNodeOptions} ${shimOption}` : shimOption,
  },
});

process.exit(result.status ?? 1);
