import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "mux-fallback-blocker-contract.json");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function check(id, ok, detail, evidence = {}) {
  return { id, ok: Boolean(ok), detail, evidence };
}

const design = read("docs/specs/AETHER_WORLD_CLASS_GAP_CLOSURE_IMPLEMENTATION_DESIGN_2026-06-25.md");
const packageJson = read("package.json");
const api = read("src-tauri/src/api/mod.rs");
const app = read("src/App.tsx");
const ipcMux = read("src-tauri/src/ipc/mux_commands.rs");
const antiDebt = read("scripts/verify-anti-debt-claim-contract.mjs");
const tmuxContract = read("scripts/verify-mux-tmux-grade-contract.mjs");

const checks = [
  check(
    "design-declares-fallbacks-claim-blocking",
    design.includes("Fallbacks are allowed only as explicit degraded modes") &&
      design.includes("A fallback must never satisfy") &&
      design.includes("In-process PTY fallback can keep the app usable, but blocks `tmux`") &&
      design.includes('"fallbackPath": "in-process-pty"') &&
      design.includes('"removalGate": "verify-mux-fallback-blocker"'),
    "The world-class design states that in-process PTY fallback is degraded and blocks the tmux claim.",
  ),
  check(
    "visible-runtime-classifies-native-as-degraded",
    app.includes('payload?.backend === "sidecar" || payload?.backend === "native"') &&
      app.includes('payload?.durability === "tmux-durable" || payload?.durability === "degraded"') &&
      app.includes('backend === "sidecar"') &&
      app.includes('? "tmux-durable"') &&
      app.includes(': "degraded"'),
    "Visible runtime metadata classifies sidecar sessions as tmux-durable and native/in-process sessions as degraded.",
  ),
  check(
    "daemon-contract-keeps-sidecar-durability-machine-readable",
    api.includes('transport: "loopback-http-websocket"') &&
      api.includes('client_detach_policy: "detach-keeps-live-pty-while-daemon-running"') &&
      api.includes("snapshot-restores-graph-as-restore-pending-with-durable-scrollback") &&
      api.includes('attach_policy: "reattach-respawns-only-missing-or-restore-pending-pty-bindings"') &&
      api.includes('"stream-attach-snapshot-replay"') &&
      api.includes('"terminal-fallback-telemetry"'),
    "Daemon contract exposes sidecar durability, restore, attach, replay, and fallback telemetry capabilities as machine-readable policy.",
  ),
  check(
    "ipc-fallback-persists-but-is-not-claim-unlocker",
    ipcMux.includes("fn persist_mux_workspace_snapshot") &&
      ipcMux.includes("api_state.mux_store.as_ref()") &&
      ipcMux.includes(".save_graph(&graph)") &&
      tmuxContract.includes("ipc-fallback-persistence-has-no-unit-test-yet") &&
      design.includes("Tauri IPC in-process mux fallback save snapshots") &&
      design.includes("In-process native fallback must block the tmux-equivalent claim"),
    "IPC fallback durability is preserved for user safety, while tmux-grade status remains blocked by explicit fallback policy.",
  ),
  check(
    "anti-debt-register-enforces-claim-block-shape",
    antiDebt.includes('schema: "aether.degradation-register/v1"') &&
      antiDebt.includes("claimBlocks") &&
      antiDebt.includes("removalGate") &&
      antiDebt.includes("noClaimPassesWhileBlocked") &&
      antiDebt.includes("claim ${") &&
      antiDebt.includes("is pass while degradation"),
    "The anti-debt claim register validates fallback records, removal gates, and claim-blocking violations.",
  ),
  check(
    "package-exposes-fallback-blocker-gate",
    packageJson.includes('"verify:mux-fallback-blocker": "node scripts/verify-mux-fallback-blocker.mjs"'),
    "package.json exposes the mux fallback blocker as a first-class verifier.",
  ),
];

const failed = checks.filter((item) => !item.ok);
const report = {
  schema: "aether.mux-fallback-blocker-contract/v1",
  version: 1,
  generatedAt: new Date().toISOString(),
  ok: failed.length === 0,
  status: failed.length === 0 ? "pass-fallback-blocker-contract" : "failed",
  total: checks.length,
  passed: checks.length - failed.length,
  failed: failed.map((item) => item.id),
  checks,
  knownGaps: [
    {
      id: "live-fallback-telemetry-not-exercised-here",
      severity: "review",
      detail:
        "This gate proves claim classification and source contracts; it does not intentionally force a sidecar outage to capture a live fallback telemetry event.",
    },
  ],
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

for (const item of checks) {
  console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.id}`);
  console.log(`      ${item.detail}`);
}
if (report.knownGaps.length > 0) {
  console.log("\nKnown review gaps:");
  for (const gap of report.knownGaps) console.log(`REVIEW ${gap.id}: ${gap.detail}`);
}
if (failed.length > 0) {
  console.error(`\n${failed.length}/${checks.length} mux fallback blocker assertion(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} mux fallback blocker assertions PASSED`);
