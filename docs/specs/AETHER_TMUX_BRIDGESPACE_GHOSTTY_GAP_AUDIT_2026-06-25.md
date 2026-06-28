# Aether Terminal tmux / BridgeSpace / Ghostty Gap Audit

Date: 2026-06-25 JST
Status: REVIEW / BLOCK for world-class positioning
Scope: current local checkout, current source, current `.codex-auto` evidence, and four read-only subagent audits.

## Executive Verdict

Aether is not "just chat tabs" anymore. The repo contains a substantial Rust/Tauri
terminal and AI-team control plane:

- Rust-owned terminal engine, mux graph, pane layouts, sidecar PTY daemon, durable scrollback, and mux APIs.
- Visible PTY agent runtime, sidecar-first interactive AI CLI spawning, and loop-dispatched visible panes.
- A broad local MCP surface for worktrees, tasks, events, ownership, context, intents, knowledge graph, review, and merge.
- Durable merge-intent security checks and OID-bound reviewer approval paths.
- Native-first proof path through `aether-native`, native input/IME/paste guard, and winit/wgpu proof harnesses.

But the current evidence does not support an unqualified claim of:

- "full tmux rewrite / tmux-equivalent"
- "BridgeSpace-plus AI team OS is complete"
- "Ghostty/WezTerm-class Windows terminal quality"
- "release candidate ready"

Current hard truth from `node scripts/score-release-quality.mjs`:

- Score: `32`
- Total/max: `114/351`
- Grade: `D`
- `releaseCandidateReady=false`
- The blocker list is implementation/evidence-heavy, not only operator gates.

Defensible public/internal claim today:

> Aether has a local daemon-backed Windows mux and an implemented AI-team control-plane prototype with visible PTY agent panes, MCP orchestration APIs, and native-first terminal proof paths.

Not yet defensible:

> Aether is tmux-equivalent, BridgeSpace-plus complete, or Ghostty-class as a daily driver on Windows.

## Subagent Coverage

Four read-only subagents were used:

- tmux parity / terminal mux audit
- BridgeSpace-plus / AI team OS / MCP audit
- Ghostty/WezTerm-class terminal quality audit
- release evidence / docs consistency audit

They did not edit files. Their findings are consolidated below.

## Verification Run During This Audit

Commands run:

| Command | Result | Notes |
|---|---:|---|
| `node scripts/verify-mcp-orchestrator-surface.mjs` | PASS | MCP tool surface passed. |
| `node scripts/verify-security-mcp-merge-intent-binding.mjs` | PASS | 10/10 merge-intent security checks passed. |
| `node scripts/verify-control-layer-scaffold.mjs` | PASS | Control layer scaffold passed. |
| `node scripts/verify-agent-team-orchestration-readiness.mjs` | FAIL | Failed `app-dispatches-agents-in-parallel` and `native-workspace-agent-identity-boundary`. |
| `node scripts/verify-upper-compat-gates.mjs` | BLOCK | `spawnSync cargo EPERM`; artifact records `environment-blocked` with phase/command/code metadata; cannot prove upper-compat gates here. |
| `node scripts/verify-native-boundary-contract.mjs` | BLOCK | 10/14 native boundary checks pass; remaining blockers are live mux restore, sidecar command-session artifact, command recovery, and AI CLI launch-planner preflight. |
| `node scripts/verify-full-native-rust-gap-audit.mjs` | IN PROGRESS | `106/120`, 88%; full native still needs daemon/mux boundary and real sleep/resume visual dogfood. |
| `node scripts/score-release-quality.mjs` | BLOCK | Score `32`, grade `D`, not release ready. |
| `node scripts/verify-mux-performance.mjs` | BLOCK | `spawn EPERM`; fresh perf proof not produced. |
| `node scripts/verify-mux-live-restore.mjs` | BLOCK | Node `child_process` launch fails with `spawn EPERM`; artifact now records an `environment-blocked` proof gate with phase/command/code metadata instead of a product pass. |

Important interpretation:

- `spawn EPERM` is an environment/sandbox proof blocker, not direct proof that the product feature is absent.
- The release score still treats unrefreshed or blocked proof as not current. That is correct for strict positioning.

## Current Implemented Substrate

### Local Mux Core

Implemented:

- Rust mux graph with workspaces/windows/tabs/panes and lifecycle states: `src-tauri/src/mux/graph.rs`.
- Pane/layout ops: split, close, swap, move, even/equalize/tiled, rotate, zoom, sync, break, join.
- File snapshot store and restore-pending semantics: `src-tauri/src/mux/store.rs`.
- Tauri IPC and sidecar HTTP routes: `src-tauri/src/ipc/mux_commands.rs`, `src-tauri/src/api/mux.rs`, `src-tauri/src/pty_sidecar.rs`.
- Sidecar not tied to app kill-on-close, allowing app restart adoption: `src-tauri/src/pty_sidecar.rs`.
- Durable scrollback file store: `src-tauri/src/pty/scrollback.rs`.
- Prefix keymap coverage: `src-tauri/src/mux/keymap.rs`.

Meaning:

- Aether has a serious local daemon-backed Windows mux core.
- It is not merely a React pane layout.

### Visible Agent Runtime

Implemented:

- `spawn_interactive_agent` uses sidecar command sessions first and native PTY fallback only when sidecar is unavailable: `src-tauri/src/ipc/interactive_commands.rs`.
- `agent_command_spec` and `agent_shell_command_spec` explicitly avoid `-p` / `--print` for visible interactive paths: `src-tauri/src/agent/interactive.rs`.
- `PaneFleet` dispatches loop workers into visible PTY panes rather than hidden stdout drains: `src-tauri/src/control/pane_fleet.rs`.
- `orchestrator_step` emits `agent_spawned` and frontend bridges to pane mounting: `src-tauri/src/ipc/orchestrator_commands.rs`, `src/App.tsx`, `src/features/terminal/pane-tree/PaneTreeContainer.tsx`.

Meaning:

- The product direction is correct: visible AI agents should be real PTY/TUI panes, not fake copied text.
- Manual/right-rail Orchestra dispatch still needs stronger center-pane-first proof and less split presentation state.

### MCP / AI Team OS Control Plane

Implemented:

- Broad MCP catalog: `src-tauri/src/api/mcp.rs`.
- Worktree validation/create/remove and routing.
- Task Graph, Event Bus, Context Store, Intent Bus, Knowledge Graph.
- File ownership and symbol ownership APIs.
- `aether.request_merge` creates durable merge intents.
- `aether.review.approve` approves by intent id, rejects unknown branch overrides, and performs OID-bound merge.
- Merge-intent security gate passes: `.codex-auto/quality/security-merge-intent-binding.json`.

Meaning:

- Aether is already above "N terminals running N AI CLIs" at the control-plane level.
- However, durable AI-team OS semantics are incomplete where state is split or in-memory.

### Native / Ghostty-Class Direction

Implemented:

- Rust terminal engine and renderer-neutral frame contracts: `src-tauri/src/term/engine.rs`, `src-tauri/src/term/render_frame.rs`.
- Canvas2D production renderer without xterm dependency: `src/features/terminal/TerminalCanvas.tsx`.
- Native input/IME/paste guard: `src-tauri/src/term/native_input.rs`.
- `aether-native` proof binary with Win32/GDI, winit/wgpu, and font-atlas proof paths: `src-tauri/src/bin/aether_native.rs`.
- Clipboard image intake and terminal image protocol ingestion exist.

Meaning:

- The native-first direction is real.
- It is still not proven as a sustained daily-driver terminal renderer.

## P0 Gaps

### P0-1: Current Release Truth Is BLOCK / D

Evidence:

- `.codex-auto/quality/release-quality-score.json` generated during this audit reports score `32`, total `114/351`, grade `D`, `releaseCandidateReady=false`.
- `.codex-auto/promotion-gate.json` still says `status=pass`, `score=100`, `readyForPromotion=true`, but it is from 2026-05-06 and no longer authoritative for current command-center/native/MCP state.

Problem:

- Old promotion evidence contradicts current quality score.
- Docs and operator-facing summaries can accidentally cite stale success.

Required fix:

- Add a freshness hierarchy: current `release-quality-score.json` must override stale `promotion-gate.json`.
- Either regenerate promotion gate from the new model or mark it historical.
- Add a verifier that fails when old "readyForPromotion" artifacts are newer-claimable than current score.

Acceptance:

- `node scripts/score-release-quality.mjs` is the current release readiness source.
- Any doc claiming GO must include its generation timestamp and current score.

### P0-2: tmux-Equivalent Claim Is Not Yet Defensible

Implemented foundation:

- Pane graph, layout ops, sidecar-backed app restart adoption, durable scrollback, sync/broadcast, prefix keymap.

Missing:

- Current live restore proof is red: `.codex-auto/performance/mux-live-restore-smoke.json` now records `environment-blocked` Node child-process launch (`spawn EPERM`).
- Full daemon-owned session/window/client model has since been implemented as a
  static/backend contract, but fresh live proof is still blocked.
- `Ctrl+B c` still creates an app workspace tab, not a fully daemon-owned tmux window.
- Multi-client read-only attach, control locking, backend-visible client records,
  and fallback blocking are now contract-covered. Remote/cross-machine attach is
  still not a product surface.
- Client detach/reattach while the daemon remains alive now preserves the same
  PTY process id. Daemon crash recovery is still snapshot-and-respawn /
  restore-pending, not restart-time live process preservation.

Required gates:

- `pnpm verify:mux-live` must be hard blocker for tmux-grade positioning.
- Add `verify-mux-window-session-model`.
- Add `verify-mux-multiclient-attach`.
- Add `verify-mux-fallback-blocker`.
- Add `verify-mux-live-process-preservation`.
- Add `verify-mux-daemon-upgrade-policy`.

Acceptance:

- Existing PTYs survive app restart and are adopted.
- Daemon restart behavior is explicit: either live preservation or honest restore-pending respawn.
- Client detach/reattach while daemon-live proves the same process id.
- Session/window create/list/select/rename/close are daemon-owned.
- A second client can attach without stealing or killing the first client.
- Read-only attach cannot write.
- Fallback/local-only layouts cannot count as durable mux success.

### P0-3: Merge Paths Are Split

Evidence:

- MCP merge path uses durable merge intents: `src-tauri/src/api/mcp.rs`, `src-tauri/src/merge_intent`.
- Autonomy loop still has an in-memory `MergeQueue`: `src-tauri/src/control/merge.rs`, `src-tauri/src/control/loop_ports.rs`.

Problem:

- Two merge truths exist.
- MCP/reviewer safety is stronger than the older in-memory loop path.
- Crash/restart can lose queued merge state outside the durable intent store.

Required fix:

- Make durable `MergeIntentStore` the single merge truth for MCP, cockpit UI, and autonomy loop.
- Remove or demote in-memory `MergeQueue` to a transient adapter over durable intents.

Acceptance:

- One store backs request, inspect, approval, rejection, conflict, stale-tip, cleanup, and restart reconciliation.
- Crash during queued/merging/needs-reconcile states recovers deterministically.
- Reviewer != implementer and all-green gate evidence are bound into the durable intent.

### P0-4: Ownership / Shared Brain Is Not Restart-Safe Enough

Evidence:

- Symbol ownership core is in-memory.
- Task graph persistence does not fully persist task symbol intent state.
- Frontend `workstationGraph.ts` builds a derived graph from panes/files/sessions rather than one backend authoritative brain snapshot.

Problem:

- The headline "shared brain avoids function-level conflicts" depends on state that can be lost or split across frontend and backend.
- File/symbol claims need durable lease state and replay/compaction.

Required fix:

- Persist active file and symbol claims with leases.
- Persist task symbol intents and recovery records.
- Add a backend `shared_brain.snapshot` API covering tasks, agents, panes, files, symbols, decisions, blockers, validations, evidence refs, and freshness.

Acceptance:

- Start two agents with overlapping/disjoint claims, restart app, and prove the conflict map is recovered.
- New agent prompt context includes current active claims after restart.
- Frontend graph reads backend shared brain rather than rebuilding partial truth.

### P0-5: Native Boundary Is Blocked

Current `node scripts/verify-native-boundary-contract.mjs` result:

- `status=blocked`
- 8/14 checks passed
- Failed checks include native input artifact freshness, daemon contract policy, native-client spike freshness, sidecar command-session artifact freshness, no-silent-fallback contract, and planner sidecar preflight.

Problem:

- Native-first implementation exists, but current proof is stale or blocked.
- Strict Ghostty-class positioning requires current daily-driver proof, not old proof harness artifacts.

Required fix:

- Refresh native input, native client, native boundary, command recovery, sidecar AI CLI boundary, and AI CLI launch planner evidence on a host where process spawning is allowed.

Acceptance:

- `pnpm verify:terminal:native-boundary` passes.
- `pnpm verify:full-native:audit` reports ready or gives only external/operator blockers.

### P0-6: Right-Rail Orchestra Dispatch Gate Is Failing

Current failure:

- `node scripts/verify-agent-team-orchestration-readiness.mjs` fails `app-dispatches-agents-in-parallel`.

Important nuance:

- Part of this is a brittle stale static string check: `App.tsx` now computes `const changedFiles = rightRailAllChangedFiles.map(...)`, while the verifier still expects inline `changedFiles: rightRailAllChangedFiles.map(...)`.
- The product gap still exists separately: right-rail Orchestra dispatch launches interactive sessions and routes focus to sessions; it is not yet fully proven as "N roles mount immediately into central pane tree, 1 agent = 1 pane."

Required fix:

- Update the verifier to check behavior/source semantics instead of exact stale formatting.
- Add the missing live/DOM proof for central pane mounting.

Acceptance:

- Dispatching implementer/tester/reviewer creates three central terminal panes.
- Each pane is a real PTY/TUI, no `-p` / `--print`.
- Pane labels show role/model/worktree.
- Agent card selection focuses the pane.
- Pane-mounted sessions do not duplicate as full separate tabs, or are clearly marked mounted.

## P1 Gaps

### P1-1: Ghostty/WezTerm-Class Renderer Is Not Proven

Implemented:

- Rust terminal grid.
- Canvas2D renderer.
- Renderer-neutral native frame.
- winit/wgpu proof path.

Missing:

- Sustained native primary terminal window under real workload.
- Long output flood, resize storm, scrollback, input echo, IME, paste, selection/copy, and visual QA in one daily-driver run.
- Native renderer integration now consumes DirectWrite shaped runs, uses real
  DirectWrite fallback mapping, and has a DirectWrite-resolved fallback atlas
  rasterization path with a current native PNG fixture. Full-surface native
  visual regression and daily-driver proof comparable to Ghostty/WezTerm remain
  missing.

Required gates:

- `verify:native-daily-driver-terminal`.
- `verify:native-text-shaping-fallback`.
- `verify:native-visual-regression`.

Acceptance:

- Native terminal runs >60 seconds with continuous output and input.
- CJK, emoji, combining marks, box drawing, ligature toggle, and fallback fonts render with correct width.
- Visual proof covers resize, DPI changes, focus, nonblank state, and real post-sleep/resume.

### P1-2: Symbol Ownership Is Parser-Limited

Implemented:

- Symbol claim/conflict core.
- Parser extraction for Rust / TypeScript / TSX.
- Diff-hunk fallback.

Missing:

- LSP `documentSymbol` extraction tier.
- Broader language coverage.
- Strong unsupported-language fallback policy in live scheduler.

Required fix:

- Add LSP-backed extraction.
- Persist confidence and source of claims.
- Gate unsupported languages to file-level exclusivity unless exact symbol proof exists.

Acceptance:

- Disjoint functions in the same file co-dispatch only with exact parser/LSP confidence.
- Diff-hunk overlap warns/serializes according to policy.
- Shared config/schema/migration files stay file-exclusive unless exact range proof exists.

### P1-3: Shared Brain Is Substrates, Not One Product Surface

Implemented:

- Context Store.
- Event Bus.
- Intent Bus.
- Knowledge Graph.
- Activity/blocker reporting.

Missing:

- One canonical "current brain" object.
- Compaction snapshots with evidence refs.
- UI and agent prompt injection from the same backend object.

Required fix:

- Add `BrainSnapshot` persistence and MCP/API read paths.
- Add rolling state per agent/task/symbol/file.
- Add compaction and stale markers.

Acceptance:

- New worker receives only relevant decisions, active claims, blockers, validations, and evidence refs.
- Raw logs remain replay evidence, not prompt flood.
- If compaction fails, brain marks stale but raw evidence remains.

### P1-4: AI CLI Real Provider Proof Is Missing/Stale

Implemented:

- Deterministic CLI shim boundary exists.
- Sidecar command-session path exists.

Missing:

- Fresh real Codex/Claude/Gemini authenticated prompt proof.
- Explicit token-spend consent packet is required.
- Provider preflight matrix is stale/failing according to release score.

Required gates:

- `verify:terminal:authenticated-ai-cli-consent-packet`
- `verify:terminal:authenticated-ai-cli-preflight-matrix`
- token-consented `verify:terminal:authenticated-ai-cli-prompt`

Acceptance:

- No token-spending smoke runs without explicit consent.
- Provider readiness is separated from real spend.
- Real provider prompt framing, input, cleanup, and telemetry are proven.

### P1-5: Command Evidence / Recovery Is Not Current

Current score blockers include:

- live command block evidence
- multi-pane command evidence
- recovered command evidence
- process reconnect command evidence
- command recovery contract

Problem:

- These are exactly the proof paths needed for tmux/Ghostty confidence.

Required fix:

- Refresh live command evidence and process reconnect gates on a host where sidecar/app process spawning works.

Acceptance:

- Command blocks include prompt marks, scrollback anchors, exit code, command text, pane id, and persisted recovery.
- Pre-restart and post-restart commands are both navigable and tied to pane/workspace/session.

## P2 Gaps

### P2-1: Docs Are Internally Inconsistent

Examples:

- `docs/specs/README.md` still says specs are draft/docs-only and implementation is not started.
- `docs/specs/CODEX_HANDOFF.md` says substantial source has landed and is no longer design-only.
- Some merge language still preserves the older human-gated/no-self-merge model while v2 says reviewer agent can merge after gates.
- Older progress docs claim higher scores and operator-only blockers that no longer match current `release-quality-score.json`.

Required fix:

- Reconcile docs around one current model:
  - implemented substrate exists
  - release state is currently BLOCK / D / 32
  - merge model is durable intent + reviewer approval / orchestrator gate, not caller-directed merge
  - human remains override/rollback and tool-approval backstop, not necessarily critical-path merge click

Acceptance:

- `docs/specs/README.md`, `CODEX_HANDOFF.md`, and command-center progress docs do not contradict current score artifacts.
- Stale evidence is clearly labeled historical.

### P2-2: Missing Aggregate World-Class Gate

Problem:

- There are many component gates, but no single "can we claim tmux + BridgeSpace + Ghostty quality" gate.

Required fix:

- Add `verify:world-class-terminal-ai-os` or equivalent aggregate.

Suggested subgates:

- release score current and above threshold
- mux live restore current and passed
- native boundary current and passed
- full-native audit current and ready or honestly blocked only by external/operator gates
- agent-team orchestration readiness passed
- upper-compat gates passed
- MCP orchestrator surface passed
- security merge-intent binding passed
- live shared-brain scenario passed
- real or consented AI CLI prompt smoke handled
- docs freshness passed

Acceptance:

- One command answers whether strong positioning is allowed.
- It outputs PASS / REVIEW / BLOCK with implementation-fixable vs environment/operator blockers.

## Required Claim Gates

### To Claim "tmux-Equivalent"

Required:

- Current `verify:mux-live` pass.
- Daemon-owned session/window model.
- Multi-client attach and read-only attach.
- Control locking.
- Durable scrollback and command-block replay after app restart.
- Honest daemon crash policy.
- Fallback mode blocks tmux-equivalent claim.

### To Claim "BridgeSpace-Plus AI Team OS"

Required:

- One scripted end-to-end: plan -> worktree isolation -> visible panes -> file/symbol ownership -> review -> durable merge -> restart replay.
- Durable shared brain snapshot.
- Durable merge-intent path unified across MCP, cockpit, and autonomy loop.
- Agent cards and pane focus use one source of truth.
- Symbol/function conflict map survives restart.

Current restart replay evidence:

- `pnpm verify:shared-brain-restart-replay` now writes an
  `environment-blocked` artifact when no authenticated live Aether API token is
  available. This keeps the BridgeSpace claim red without pretending the replay
  path passed.
- To turn it green, run the seed phase against a live authenticated Aether API,
  restart Aether Terminal, then run the verify phase with the printed id.

### To Claim "Ghostty/WezTerm-Class Windows Terminal"

Required:

- Native or Canvas production renderer proof under sustained workload.
- Native winit/wgpu daily-driver proof if claiming native terminal quality.
- Text shaping/fallback gate.
- IME candidate selection dogfood.
- Clipboard text/image/paste guard proof.
- Visual regression across DPI, resize, sleep/resume.
- Latency/perf budgets for input echo, scrollback, resize, and output flood.

### To Claim "Release Candidate Ready"

Required:

- `node scripts/score-release-quality.mjs` no longer grade D.
- Current release score source reconciles stale promotion/risk artifacts.
- No stale May artifacts can override current June blockers.
- All implementation-fixable blockers are closed or explicitly accepted with a current risk record.

## Prioritized Backlog

### P0 Sequence

1. Fix evidence truth hierarchy: current score beats stale promotion gate.
2. Fix `verify-agent-team-orchestration-readiness` stale string check and add central-pane live proof.
3. Unify autonomy/cockpit merge on durable `MergeIntentStore`.
4. Persist file/symbol ownership and task symbol intent state.
5. Add backend `shared_brain.snapshot` API.
6. Refresh native boundary and mux live gates on a host without `spawn EPERM`.
7. Add mux fallback blocker gate.
8. Reconcile docs around current BLOCK / D / 32 truth.

### P1 Sequence

1. Add native daily-driver terminal gate.
2. Add text shaping/fallback gate.
3. Add AI-team OS end-to-end restart scenario.
4. Add LSP symbol extraction tier.
5. Refresh command evidence and process reconnect gates.
6. Refresh live two-client sidecar/browser proof for multi-client/read-only attach.

### P2 Sequence

1. Add aggregate world-class positioning gate.
2. Add remote/cross-machine attach only after local multi-client attach is stable.
3. Add native settings/right-rail daily-driver parity.
4. Add complete choose-tree/window/session UI.

## Final Assessment

Aether has the right architecture to become the Windows AI terminal/workspace leader:

- local daemon mux
- AI-team control plane
- visible PTY agents
- MCP orchestration
- durable review/merge intent
- native terminal proof path

The missing work is no longer "invent the idea." It is:

- make the state durable in the right places
- collapse split merge/brain truths
- pass current live proof
- harden native renderer/input quality into daily-driver proof
- stop stale artifacts and docs from overstating readiness

Until those gates are green, position Aether as an implemented prototype/platform with strong foundations, not as completed tmux/Ghostty/BridgeSpace replacement.
