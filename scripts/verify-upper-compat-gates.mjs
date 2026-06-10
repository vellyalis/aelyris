import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "upper-compat-gates.json");
const DB_PATH = join(ROOT, ".codex-auto", "production-smoke", "upper-compat", "verify-aether.db");

function read(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

function parseLastJson(stdout) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(stdout.slice(start, end + 1));
  }
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Keep scanning; cargo may print build output before the proof JSON.
    }
  }
  throw new Error("upper-compat-proof did not print JSON");
}

function gateComplete(proof, name) {
  return proof?.gates?.[name]?.complete === true;
}

const apiSource = read("src-tauri/src/api/mod.rs");
const dbSource = read("src-tauri/src/db/queries.rs");
const migrationSource = read("src-tauri/src/db/migrations.rs");
const nativeSource = read("src-tauri/src/bin/aether_native.rs");

const run = spawnSync(
  "cargo",
  ["run", "--quiet", "--manifest-path", "src-tauri/Cargo.toml", "--bin", "aether-native", "--", "upper-compat-proof"],
  {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      AETHER_UPPER_COMPAT_DB_PATH: DB_PATH,
    },
    timeout: 240_000,
  },
);

const checks = [];
let proof = null;
if (run.status === 0) {
  proof = parseLastJson(run.stdout);
}

function addCheck(id, passed, detail, evidence = {}) {
  checks.push({
    id,
    status: passed ? "passed" : "failed",
    detail,
    evidence,
  });
}

addCheck(
  "aether.mcp.server.v1",
  run.status === 0 &&
    proof?.schema === "aether.upper-compat-proof.v1" &&
    gateComplete(proof, "aether.mcp.server.v1") &&
    apiSource.includes("/mcp/contract") &&
    apiSource.includes("/mcp/tools/list") &&
    apiSource.includes("/mcp/tools/call") &&
    apiSource.includes("terminal.capture") &&
    apiSource.includes("mux.workspace.safeInput"),
  "Local MCP contract and tool-call routes are Rust-backed and route through PTY/mux state.",
  { routes: proof?.gates?.["aether.mcp.server.v1"]?.routes ?? [] },
);

addCheck(
  "aether.workspace.data.v1",
  gateComplete(proof, "aether.workspace.data.v1") &&
    migrationSource.includes("CREATE TABLE IF NOT EXISTS workspace_items") &&
    dbSource.includes("upsert_workspace_item") &&
    dbSource.includes("list_workspace_items"),
  "Workspace tasks, reviews, handoffs, and context packs persist in SQLite through Rust APIs.",
  proof?.gates?.["aether.workspace.data.v1"] ?? {},
);

addCheck(
  "aether.mode-preservation.v1",
  gateComplete(proof, "aether.mode-preservation.v1") &&
    migrationSource.includes("CREATE TABLE IF NOT EXISTS mode_preservation_snapshots") &&
    dbSource.includes("save_mode_preservation_snapshot"),
  "Mode/rail/pane restoration snapshots are durable and not tied to React state.",
  proof?.gates?.["aether.mode-preservation.v1"] ?? {},
);

addCheck(
  "aether.history.search.v1",
  gateComplete(proof, "aether.history.search.v1") &&
    migrationSource.includes("CREATE TABLE IF NOT EXISTS history_search_entries") &&
    dbSource.includes("search_workspace_history"),
  "Cross-mode history search persists command, review, and handoff evidence in Rust-owned storage.",
  proof?.gates?.["aether.history.search.v1"] ?? {},
);

addCheck(
  "aether.agent-identity.v1",
  gateComplete(proof, "aether.agent-identity.v1") &&
    migrationSource.includes("CREATE TABLE IF NOT EXISTS agent_identity_records") &&
    dbSource.includes("upsert_agent_identity"),
  "Agent provider/auth/install/worktree/context identity is durable and visible without WebView-only state.",
  proof?.gates?.["aether.agent-identity.v1"] ?? {},
);

addCheck(
  "native-proof-command",
  nativeSource.includes('"upper-compat-proof"') &&
    proof?.claims?.webviewUsed === false &&
    proof?.claims?.reactUsed === false &&
    proof?.claims?.notAPrototypeFallback === true,
  "The five gates are proven by a native Rust command, not by a frontend-only fixture.",
  proof?.claims ?? {},
);

const passed = checks.filter((check) => check.status === "passed").length;
const total = checks.length;
const report = {
  schema: "aether.upper-compat-gates.verification.v1",
  status: passed === total ? "pass" : "fail",
  score: Math.round((passed / total) * 100),
  passed,
  total,
  proof,
  cargo: {
    status: run.status,
    signal: run.signal,
    stderrTail: run.stderr.split(/\r?\n/).slice(-40),
  },
  checks,
};

writeJsonAtomic(OUT, report);

if (report.status !== "pass") {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(report, null, 2));
