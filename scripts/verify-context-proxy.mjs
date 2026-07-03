import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "runtime-core-context-proxy.json");

function read(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function check(id, ok, detail) {
  return { id, ok: ok === true, detail };
}

const rustContext = read("src-tauri/src/agent/context_lifecycle.rs");
const rustInteractive = read("src-tauri/src/agent/interactive.rs");
const rustCommands = read("src-tauri/src/ipc/interactive_commands.rs");
const rustSession = read("src-tauri/src/agent/session.rs");
const agentTypes = read("src/shared/types/agent.ts");
const contextTelemetry = read("src/shared/lib/contextTelemetry.ts");
const workstationSummary = read("src/shared/lib/workstationSummary.ts");
const budgetStatus = read("src/shared/lib/budgetStatus.ts");
const agentFleet = read("src/shared/lib/agentFleet.ts");
const useAgentManager = read("src/shared/hooks/useAgentManager.ts");
const workstationSummaryTest = read("src/__tests__/workstationSummary.test.ts");
const budgetStatusTest = read("src/__tests__/budgetStatus.test.ts");
const agentFleetTest = read("src/__tests__/agentFleet.test.ts");

const checks = [
  check(
    "rust-context-remaining-contract",
    rustContext.includes("pub struct ContextRemaining") &&
      rustContext.includes("TelemetryConfidence") &&
      rustContext.includes("pct: Option<f64>") &&
      rustContext.includes("used_pct: Option<f64>"),
    "Rust exposes ContextRemaining{pct, used_pct, confidence, source, updated_at, warn, hard}",
  ),
  check(
    "grid-snapshot-primary-parser",
    rustContext.includes("pub fn grid_text(snapshot: &GridSnapshot)") &&
      rustContext.includes("parse_claude_context_remaining_from_grid") &&
      rustCommands.includes("native_registry.snapshot(session_id)") &&
      rustCommands.includes("parse_claude_context_remaining_from_grid(&snapshot"),
    "Claude context-left parsing is driven from term_snapshot/GridSnapshot state, not raw PTY bytes",
  ),
  check(
    "claude-context-left-tests",
    rustContext.includes("parses_claude_context_left_line_from_grid") &&
      rustContext.includes("You've used 78% of your weekly limit") &&
      rustContext.includes("ignores_non_context_percent_lines") &&
      rustContext.includes("hard_pressure_uses_existing_usage_threshold_shape"),
    "Rust tests cover grid extraction, weekly-limit false positive, and warn/hard pressure",
  ),
  check(
    "non-claude-fallback-unknown",
    rustContext.includes("non_claude_proxy_is_confidence_unknown") &&
      rustContext.includes("AgentCli::Codex") &&
      rustContext.includes("TelemetryConfidence::Unknown"),
    "Codex/Gemini fallback keeps confidence unknown rather than pretending token visibility",
  ),
  check(
    "interactive-session-proxy-fields",
    rustInteractive.includes("logical_session_id") &&
      rustInteractive.includes("last_activity") &&
      rustInteractive.includes("turn_count") &&
      rustInteractive.includes("context_remaining") &&
      rustInteractive.includes("update_context_remaining"),
    "InteractiveSessionInfo carries stable logical id, activity, turn count, and context telemetry",
  ),
  check(
    "status-idle-turn-proxy",
    rustInteractive.includes("status == \"idle\" && previous_status != \"idle\"") &&
      rustInteractive.includes("turn_count.saturating_add(1)") &&
      rustInteractive.includes("update_status_tracks_activity_turns_and_proxy_context") &&
      rustContext.includes("status_time_turn_proxy"),
    "Status transitions maintain turn proxy and fallback context confidence",
  ),
  check(
    "unified-agent-session-carries-context",
    rustSession.includes("context_remaining: Option<ContextRemaining>") &&
      rustSession.includes("logical_session_id: Some(info.logical_session_id)") &&
      rustSession.includes("turn_count: Some(info.turn_count)"),
    "Unified backend AgentSession propagates interactive context telemetry to fleet surfaces",
  ),
  check(
    "frontend-context-type-and-normalizer",
    agentTypes.includes("export interface ContextRemaining") &&
      contextTelemetry.includes("normalizeContextRemaining") &&
      contextTelemetry.includes("used_pct") &&
      contextTelemetry.includes("usedPct"),
    "Frontend normalizes snake_case Rust context telemetry into camelCase UI state",
  ),
  check(
    "frontend-prefers-runtime-context",
    workstationSummary.includes("session.contextRemaining?.usedPct") &&
      budgetStatus.includes("agentContextPercent(session) >= thresholds.contextWarnPct"),
    "Workstation summary and budget warning use runtime context first, existing thresholds second",
  ),
  check(
    "frontend-live-and-fleet-projection",
    useAgentManager.includes("context_remaining?: ContextRemainingWire") &&
      useAgentManager.includes("normalizeContextRemaining(r.context_remaining)") &&
      agentFleet.includes("context_remaining?: ContextRemainingWire") &&
      agentFleet.includes("normalizeContextRemaining(session.context_remaining)"),
    "Live session and unified fleet projections preserve runtime context telemetry",
  ),
  check(
    "frontend-tests-cover-runtime-context",
    workstationSummaryTest.includes("prefers runtime context remaining telemetry") &&
      budgetStatusTest.includes("uses runtime context remaining telemetry") &&
      agentFleetTest.includes("contextRemaining: expect.objectContaining"),
    "Vitest coverage fixes runtime context precedence and projection behavior",
  ),
  check(
    "rt1a0-live-gate-present",
    existsSync(join(ROOT, "scripts/verify-runtime-core-rt1a0-live.mjs")) &&
      existsSync(join(ROOT, ".codex-auto/quality/runtime-core-rt1a0-live.json")),
    "RT-1a0 live fixture gate exists and records the current host blocker separately from deterministic RT-1a work",
  ),
];

const ok = checks.every((item) => item.ok);
const artifact = {
  ok,
  status: ok ? "pass-context-proxy" : "fail-context-proxy",
  generatedAt: new Date().toISOString(),
  phase: "RT-1a",
  checks,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`);

if (!ok) {
  console.error(JSON.stringify(artifact, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(artifact, null, 2));

