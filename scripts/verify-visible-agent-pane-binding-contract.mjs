import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "visible-agent-pane-binding-contract.json");

const files = {
  app: "src/App.tsx",
  container: "src/features/terminal/pane-tree/PaneTreeContainer.tsx",
  persistence: "src/features/terminal/pane-tree/persistence.ts",
  renderer: "src/features/terminal/pane-tree/PaneTreeRenderer.tsx",
  types: "src/features/terminal/pane-tree/types.ts",
  tests: "src/__tests__/paneTreePersistence.test.ts",
  containerTests: "src/__tests__/PaneTreeContainerActiveTerminal.test.tsx",
};

function read(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function hasAll(source, needles) {
  return needles.every((needle) => source.includes(needle));
}

function check(id, ok, detail) {
  return { id, ok: Boolean(ok), detail };
}

const source = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, read(path)]));

const checks = [
  check(
    "visible-agent-binding-type-contract",
    hasAll(source.types, [
      'VISIBLE_AGENT_PANE_BACKENDS = ["sidecar", "native"]',
      'VISIBLE_AGENT_PANE_DURABILITY_STATES = ["tmux-durable", "degraded"]',
      "export interface VisibleAgentPaneBinding",
      "taskId?: string",
      "roleId?: string",
      "spawnedAt: string",
    ]),
    files.types,
  ),
  check(
    "snapshot-persists-agent-bindings",
    hasAll(source.persistence, [
      "agentBindings?: Record<string, VisibleAgentPaneBinding>",
      "const agentBindings = sanitizeAgentBindings(record.agentBindings, leafIds)",
      "function sanitizeAgentBindings",
      "VISIBLE_AGENT_PANE_BACKENDS",
      "VISIBLE_AGENT_PANE_DURABILITY_STATES",
      "VISIBLE_AGENT_PANE_STATUSES",
    ]),
    files.persistence,
  ),
  check(
    "container-restores-agent-bindings",
    hasAll(source.container, [
      "initialSnapshot?.agentBindings",
      "setAgentBindings(restoredAgentBindings)",
      "setAgentMeta(agentBindingsToMeta(restoredAgentBindings))",
      "agentBindingsToMeta",
      "preserveSeedAgentBindings",
    ]),
    files.container,
  ),
  check(
    "container-saves-current-agent-bindings",
    hasAll(source.container, [
      "persistedAgentBindings",
      "agentBindings: Object.keys(persistedAgentBindings).length > 0 ? persistedAgentBindings : undefined",
      "setAgentBindings((prev) => new Map(prev).set(terminalId, binding))",
    ]),
    files.container,
  ),
  check(
    "loop-agent-panes-default-to-native-degraded",
    hasAll(source.container, [
      'const backend = agent.backend ?? "native"',
      'const durability = agent.durability ?? (backend === "sidecar" ? "tmux-durable" : "degraded")',
    ]) &&
      hasAll(source.app, [
        'payload?.backend === "sidecar" || payload?.backend === "native" ? payload.backend : "native"',
        'payload?.durability === "tmux-durable" || payload?.durability === "degraded"',
      ]),
    "Current loop-dispatched agent panes are native/in-process and must not be claimed tmux-durable by default.",
  ),
  check(
    "missing-restored-native-agents-do-not-spawn-fresh-shells",
    hasAll(source.container, [
      "missingRestoredAgents",
      'current.status !== "running"',
      'status: "error"',
      'next.set(binding.paneId, "exited")',
    ]) && source.renderer.includes("endedLifecycle && (!agent || !terminalId)"),
    "Restored native/degraded agent panes without a live terminal must become exited/error placeholders.",
  ),
  check(
    "app-retains-agent-spawn-task-id",
    hasAll(source.app, [
      "PaneAgentSpawnRequest",
      "const taskId = typeof payload?.taskId ===",
      "...(taskId ? { taskId } : {})",
    ]),
    files.app,
  ),
  check(
    "persistence-test-covers-visible-agent-bindings",
    hasAll(source.tests, [
      "round-trips visible agent pane bindings while dropping stale bindings",
      '"agent-pty-1"',
      'backend: "native"',
      'durability: "degraded"',
      '"pane-stale"',
    ]),
    files.tests,
  ),
  check(
    "container-test-covers-missing-restored-agent-pty",
    hasAll(source.containerTests, [
      "marks restored degraded agent panes exited instead of spawning a fresh shell when the PTY is gone",
      'backend: "native"',
      'durability: "degraded"',
      'expect(c.terminalIds.has("agent-pty-1")).toBe(false)',
      'expect(c.paneLifecycleStates?.get("agent-pty-1")).toBe("exited")',
      'expect(c.agentMeta?.get("agent-pty-1")).toEqual({ model: "sonnet", status: "error" })',
    ]),
    files.containerTests,
  ),
];

const ok = checks.every((item) => item.ok);
const artifact = {
  schema: "aelyris.visible-agent-pane-binding-contract/v1",
  version: 1,
  generatedAt: new Date().toISOString(),
  ok,
  status: ok ? "pass" : "fail",
  currentReality: {
    loopDispatchedAgentPanes: "native-in-process-pty",
    defaultBackend: "native",
    defaultDurability: "degraded",
    sidecarDurabilityClaim: "not-proven",
  },
  checks,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ artifact: OUT, ...artifact }, null, 2));
if (!ok) process.exitCode = 1;
