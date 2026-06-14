import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();
const artifactPath = join(root, ".codex-auto", "quality", "cockpit-batch-b-readiness.json");

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function check(id, ok, detail) {
  return { id, ok: Boolean(ok), detail };
}

const files = {
  session: "src-tauri/src/agent/session.rs",
  status: "src-tauri/src/agent/status.rs",
  claude: "src-tauri/src/agent/claude.rs",
  commands: "src-tauri/src/ipc/commands.rs",
  interactiveCommands: "src-tauri/src/ipc/interactive_commands.rs",
  useAgentFleet: "src/shared/hooks/useAgentFleet.ts",
  agentFleet: "src/shared/lib/agentFleet.ts",
  agentFleetTest: "src/__tests__/agentFleet.test.ts",
  controlVerifier: "scripts/verify-control-layer-scaffold.mjs",
  packageJson: "package.json",
};

const text = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, read(path)]));

const checks = [
  check(
    "unified-agent-session-rust-dto",
    text.session.includes("pub struct AgentSession") &&
      text.session.includes("pub run_mode: AgentRunMode") &&
      text.session.includes("pub status: AgentRunStatus") &&
      text.session.includes("pub prompt: Option<String>") &&
      text.session.includes("impl From<AgentSessionInfo> for AgentSession") &&
      text.session.includes("impl From<InteractiveSessionInfo> for AgentSession"),
    files.session,
  ),
  check(
    "headless-session-has-started-at",
    text.claude.includes("pub started_at: u64") &&
      text.claude.includes("SystemTime::now()") &&
      text.claude.includes("UNIX_EPOCH"),
    files.claude,
  ),
  check(
    "fleet-ipc-and-push-event",
    text.commands.includes("pub fn list_agent_fleet") &&
      text.commands.includes("pub(crate) fn agent_fleet_snapshot") &&
      text.commands.includes('app.emit("agent-fleet-updated", &sessions)') &&
      text.interactiveCommands.includes("super::emit_agent_fleet(app)"),
    "src-tauri/src/ipc",
  ),
  check(
    "frontend-use-agent-fleet-hook",
    text.useAgentFleet.includes('listen<BackendAgentFleetSession[]>("agent-fleet-updated"') &&
      text.useAgentFleet.includes('invoke<BackendAgentFleetSession[]>("list_agent_fleet"') &&
      text.useAgentFleet.includes("mergeAgentFleetSessions(headless.sessions, interactive.sessions)") &&
      text.useAgentFleet.includes("selectFleetSession"),
    files.useAgentFleet,
  ),
  check(
    "frontend-fleet-projection-covers-both-runtimes",
    text.agentFleet.includes('runtime: "headless"') &&
      text.agentFleet.includes('runtime: "interactive"') &&
      text.agentFleet.includes("mapBackendAgentFleetSessions") &&
      text.agentFleet.includes("agentRunStatusToLegacyStatus"),
    files.agentFleet,
  ),
  check(
    "focused-tests-cover-fleet-contract",
    text.agentFleetTest.includes("merges headless and interactive sessions") &&
      text.agentFleetTest.includes("maps backend unified DTOs") &&
      text.agentFleetTest.includes("waiting_approval"),
    files.agentFleetTest,
  ),
  check(
    "control-layer-scaffold-is-gated",
    text.controlVerifier.includes("approval-has-no-grant-surface") &&
      text.controlVerifier.includes("legacy-ipc-names-still-registered") &&
      text.packageJson.includes('"verify:control-layer": "node scripts/verify-control-layer-scaffold.mjs"'),
    "scripts/package",
  ),
];

const ok = checks.every((item) => item.ok);
const artifact = {
  version: 1,
  generatedAt: new Date().toISOString(),
  localDate: new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()),
  ok,
  status: ok ? "pass-current-cockpit-batch-b-readiness" : "fail-current-cockpit-batch-b-readiness",
  checks,
  failedChecks: checks.filter((item) => !item.ok).map((item) => item.id),
};

mkdirSync(dirname(artifactPath), { recursive: true });
writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

if (!ok) {
  console.error(JSON.stringify(artifact, null, 2));
  process.exit(1);
}

console.log(`cockpit-batch-b-readiness: PASS ${artifactPath}`);
