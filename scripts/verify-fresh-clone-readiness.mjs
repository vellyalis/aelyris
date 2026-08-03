import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "fresh-clone-readiness.json");
const requireRemoteSync = process.argv.includes("--require-remote-sync");

function run(command, args) {
  try {
    return { ok: true, value: execFileSync(command, args, { cwd: ROOT, encoding: "utf8" }).trim() };
  } catch (error) {
    return {
      ok: false,
      value: "",
      error: String(error?.stderr || error?.message || error).trim(),
    };
  }
}

function check(id, passed, detail, evidence = {}) {
  return { id, status: passed ? "passed" : "failed", detail, evidence };
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(join(ROOT, path), "utf8"));
  } catch {
    return null;
  }
}

function major(version) {
  return Number.parseInt(String(version).match(/\d+/)?.[0] ?? "", 10);
}

function canonicalStatus(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, "; ")
    .replace(/\s*;\s*/g, "; ")
    .trim();
}

const checks = [];
const requiredTrackedPaths = [
  ".gitignore",
  ".node-version",
  "package.json",
  "pnpm-lock.yaml",
  "scripts/bootstrap-development.ps1",
  "scripts/bootstrap-fresh-clone-continuation.mjs",
  "scripts/verify-fresh-clone-readiness.mjs",
  "scripts/verify-audit-remediation-continuation.mjs",
  ".github/workflows/ci.yml",
  "AGENTS.md",
  "README.md",
  "README.ja.md",
  "CONTRIBUTING.md",
  "audit-remediation-instructions.md",
  "docs/WORK_RECORD_AND_CONTINUATION_PROTOCOL.md",
];
const tracked = run("git", ["ls-files", "--", ...requiredTrackedPaths]);
const trackedSet = new Set(
  tracked.value
    .split(/\r?\n/)
    .filter(Boolean)
    .map((path) => path.replace(/\\/g, "/")),
);
const missingTracked = requiredTrackedPaths.filter((path) => !trackedSet.has(path));
checks.push(
  check("portable-files-tracked", tracked.ok && missingTracked.length === 0, "fresh-clone entrypoints are tracked", {
    missingTracked,
  }),
);

const packageJson = readJson("package.json");
checks.push(
  check(
    "toolchain-contract",
    packageJson?.packageManager === "pnpm@10.33.0" &&
      packageJson?.engines?.node === ">=24 <25" &&
      packageJson?.engines?.pnpm === ">=10 <11" &&
      readFileSync(join(ROOT, ".node-version"), "utf8").trim() === "24.11.1",
    "Node and pnpm requirements are explicit and machine-readable",
  ),
);
checks.push(
  check(
    "package-entrypoints",
    packageJson?.scripts?.["bootstrap:continuation"] === "node scripts/bootstrap-fresh-clone-continuation.mjs" &&
      packageJson?.scripts?.["verify:fresh-clone"] === "node scripts/verify-fresh-clone-readiness.mjs" &&
      packageJson?.scripts?.["verify:cross-pc-continuation"] ===
        "node scripts/verify-fresh-clone-readiness.mjs --require-remote-sync",
    "package scripts expose bootstrap and fail-closed cross-PC verification",
  ),
);

const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
const protocol = readFileSync(join(ROOT, "docs", "WORK_RECORD_AND_CONTINUATION_PROTOCOL.md"), "utf8");
const readme = readFileSync(join(ROOT, "README.md"), "utf8");
const contributing = readFileSync(join(ROOT, "CONTRIBUTING.md"), "utf8");
const workflow = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
const pnpmSetupCount = workflow.match(/uses:\s*pnpm\/action-setup@/g)?.length ?? 0;
const explicitPnpmSetupVersionCount =
  workflow.match(/pnpm\/action-setup@[^\r\n]+\r?\n\s+with:\r?\n\s+version:/g)?.length ?? 0;
checks.push(
  check(
    "cross-pc-policy",
    agents.includes("Cross-PC Git Continuity Invariant") &&
      agents.includes("pnpm verify:cross-pc-continuation") &&
      protocol.includes("Fresh Clone And Cross-PC Continuation") &&
      protocol.includes("remote advertised ref") &&
      readme.includes("scripts/bootstrap-development.ps1") &&
      contributing.includes("An unpushed commit is a cross-PC continuation BLOCK"),
    "stable policy and contributor docs require fail-closed Git-based cross-PC continuity",
  ),
);
checks.push(
  check(
    "hosted-fresh-checkout-proof",
    workflow.includes("Fresh-clone continuation bootstrap") &&
      workflow.includes("scripts/bootstrap-development.ps1 -SkipInstall") &&
      pnpmSetupCount > 0 &&
      explicitPnpmSetupVersionCount === 0,
    "Windows CI executes the tracked bootstrap and takes pnpm version only from packageManager",
    { pnpmSetupCount, explicitPnpmSetupVersionCount },
  ),
);

const nodeVersion = run("node", ["--version"]);
const pnpmVersion =
  process.platform === "win32"
    ? run(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "pnpm --version"])
    : run("pnpm", ["--version"]);
const rustVersion = run("rustc", ["--version"]);
const rustDetails = run("rustc", ["-vV"]);
const cargoVersion = run("cargo", ["--version"]);
checks.push(check("node-runtime", nodeVersion.ok && major(nodeVersion.value) === 24, "Node 24 is active", nodeVersion));
checks.push(check("pnpm-runtime", pnpmVersion.ok && major(pnpmVersion.value) === 10, "pnpm 10 is active", pnpmVersion));
checks.push(
  check(
    "rust-runtime",
    rustVersion.ok && rustDetails.ok && /^host:\s+.+-pc-windows-msvc$/m.test(rustDetails.value),
    "the Rust MSVC host toolchain is available",
    { version: rustVersion.value, details: rustDetails.value, error: rustVersion.error || rustDetails.error || null },
  ),
);
checks.push(check("cargo-runtime", cargoVersion.ok, "cargo is available", cargoVersion));
checks.push(
  check("dependencies-installed", existsSync(join(ROOT, "node_modules")), "node_modules exists after frozen install"),
);

const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "";
const vswhere = programFilesX86 ? join(programFilesX86, "Microsoft Visual Studio", "Installer", "vswhere.exe") : "";
const msvc = vswhere
  ? run(vswhere, [
      "-latest",
      "-products",
      "*",
      "-requires",
      "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "-property",
      "installationPath",
    ])
  : { ok: false, value: "", error: "ProgramFiles(x86) is unavailable" };
const webViewRoots = [
  programFilesX86 ? join(programFilesX86, "Microsoft", "EdgeWebView", "Application") : "",
  process.env.ProgramFiles ? join(process.env.ProgramFiles, "Microsoft", "EdgeWebView", "Application") : "",
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Microsoft", "EdgeWebView", "Application") : "",
].filter(Boolean);
const webViewRuntime = webViewRoots.find(
  (path) => existsSync(path) && readdirSync(path, { withFileTypes: true }).some((entry) => entry.isDirectory()),
);
checks.push(
  check(
    "windows-native-prerequisites",
    process.platform === "win32" && msvc.ok && Boolean(msvc.value) && Boolean(webViewRuntime),
    "Visual C++ Build Tools and WebView2 Runtime are available on Windows",
    {
      platform: process.platform,
      msvcInstallation: msvc.value || null,
      webViewRuntime: webViewRuntime ?? null,
      error: msvc.error || null,
    },
  ),
);

const ignoreHandoff = run("git", ["check-ignore", "-q", ".claude/agent-memory-local/probe.md"]);
const ignoreEvidence = run("git", ["check-ignore", "-q", ".codex-auto/quality/probe.json"]);
checks.push(
  check(
    "machine-local-state-ignored",
    ignoreHandoff.ok && ignoreEvidence.ok,
    "handoff, worklogs, and generated evidence stay outside Git",
  ),
);

const head = run("git", ["rev-parse", "HEAD"]);
const branch = run("git", ["branch", "--show-current"]);
const gitStatus = run("git", ["status", "--short", "--branch", "--untracked-files=all"]);
const continuation = readJson(".codex-auto/quality/audit-remediation-continuation.json");
const bootstrap = readJson(".codex-auto/quality/fresh-clone-bootstrap.json");
checks.push(
  check(
    "continuation-reconstructed",
    continuation?.ok === true &&
      continuation?.status === "pass-current-audit-remediation-continuation" &&
      bootstrap?.ok === true &&
      bootstrap?.status === "pass-fresh-clone-continuation-bootstrap" &&
      continuation?.head === head.value.slice(0, 7) &&
      bootstrap?.head === head.value.slice(0, 7) &&
      continuation?.branch === branch.value &&
      canonicalStatus(continuation?.gitStatus) === canonicalStatus(gitStatus.value) &&
      canonicalStatus(bootstrap?.gitStatus) === canonicalStatus(gitStatus.value),
    "current-machine handoff and worklog were reconstructed from this checkout",
    {
      continuationStatus: continuation?.status ?? null,
      bootstrapStatus: bootstrap?.status ?? null,
      continuationHead: continuation?.head ?? null,
      bootstrapHead: bootstrap?.head ?? null,
      head: head.value,
      branch: branch.value,
      gitStatus: gitStatus.value,
    },
  ),
);

const upstreamName = run("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
const upstreamHead = run("git", ["rev-parse", "@{upstream}"]);
const upstreamParts = upstreamName.value.split("/");
const remoteName = upstreamParts.shift() ?? "";
const remoteBranch = upstreamParts.join("/");
const remoteHead =
  remoteName && remoteBranch
    ? run("git", ["ls-remote", remoteName, `refs/heads/${remoteBranch}`])
    : { ok: false, value: "", error: "missing upstream" };
const advertisedHead = remoteHead.value.split(/\s+/)[0] ?? "";
const remoteSync =
  upstreamName.ok &&
  upstreamHead.ok &&
  remoteHead.ok &&
  head.ok &&
  upstreamHead.value === head.value &&
  advertisedHead === head.value;
checks.push(
  check(
    "remote-head-current",
    !requireRemoteSync || remoteSync,
    requireRemoteSync
      ? "HEAD is available from the configured upstream for cross-PC continuation"
      : "remote synchronization is reported but not required by the local fresh-clone gate",
    {
      required: requireRemoteSync,
      upstream: upstreamName.value || null,
      localHead: head.value || null,
      trackingHead: upstreamHead.value || null,
      advertisedHead: advertisedHead || null,
      synchronized: remoteSync,
      error: upstreamName.error || upstreamHead.error || remoteHead.error || null,
    },
  ),
);

const failed = checks.filter((entry) => entry.status === "failed");
const localFailed = failed.filter((entry) => entry.id !== "remote-head-current");
const freshCloneReady = localFailed.length === 0;
const crossPcReady = freshCloneReady && remoteSync;
const gateOk = freshCloneReady && (!requireRemoteSync || remoteSync);
const result = {
  version: 1,
  generatedAt: new Date().toISOString(),
  status: gateOk
    ? crossPcReady
      ? "pass-cross-pc-development-continuation"
      : "pass-fresh-clone-local-awaiting-remote-sync"
    : "failed",
  ok: gateOk,
  freshCloneReady,
  crossPcReady,
  requireRemoteSync,
  branch: branch.value || null,
  head: head.value || null,
  checkCount: checks.length,
  failedCount: failed.length,
  checks,
  nextAction: crossPcReady
    ? "Clone the configured upstream on another Windows PC and run scripts/bootstrap-development.ps1."
    : requireRemoteSync
      ? "Publish the verified HEAD to its configured upstream, then rerun this gate."
      : "Run pnpm verify:cross-pc-continuation after the verified HEAD is published.",
};

writeJsonAtomic(OUT, result);
console.log(JSON.stringify({ artifact: OUT, ...result }, null, 2));
if (!result.ok) process.exitCode = 1;
