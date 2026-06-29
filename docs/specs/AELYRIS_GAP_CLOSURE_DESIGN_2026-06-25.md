# Aelyris Gap Closure Implementation Design

Date: 2026-06-25
Status: DESIGN READY FOR WORK-UNIT PLANNING
Related audit: `docs/specs/AELYRIS_COMPETITIVE_GAP_AUDIT_2026-06-25.md`

This document answers the re-audit question:

> Are the tmux / BridgeSpace / Ghostty gaps already designed deeply enough to implement?

Short answer: partially.

The repository already contains detailed design for visible agent runtime boundaries,
MCP orchestration, durable MCP merge intent, command-risk enforcement, and several
hardening P0s. The missing piece was an integrated implementation design that turns
the gap audit into a single execution path and claim gate for:

- tmux-grade durable mux behavior.
- BridgeSpace-plus visible AI team workspace behavior.
- Ghostty/WezTerm-class Windows terminal quality.
- Current release truth that cannot be contradicted by stale green artifacts.

This document is the bridge from the gap audit into implementation. It does not
replace `CODEX_HANDOFF.md`; it narrows the next P0 execution plan.

## 1. Re-Audit Verdict

| Area | Existing design | Re-audit verdict | Missing before this doc |
| --- | --- | --- | --- |
| Visible agent runtime | `VISIBLE_AGENT_PANE_RUNTIME_SPEC.md` | Strong. It clearly separates visible PTY agents from headless `-p` planner/MCP paths and defines center-pane mounting. | Current gate still fails for right-rail/orchestra dispatch proof and sidecar-owned loop durability. |
| MCP orchestrator surface | `MCP_TOOL_SURFACE_SPEC.md`, `CODEX_HANDOFF.md` | Strong. Tool surface, authority classes, and local orchestration loop are specified. | Needs end-to-end proof that UI, loop, MCP, merge, and restart replay all share one backend truth. |
| Durable merge intent | `P0-3_DURABLE_MERGE_INTENT_PLAN.md` | Strong for MCP merge intent. | Explicitly excludes autonomy-loop self-merge. Split merge paths remain. |
| Command-risk enforcement | `P0-4_BACKEND_COMMAND_RISK_PLAN.md` | Strong and security-focused. | Not the blocker for tmux/BridgeSpace/Ghostty positioning, but must stay in aggregate gates. |
| Release hardening P0s | `AELYRIS_WORLD_RELEASE_HARDENING_AUDIT_2026-06-23.md` | Broad and useful. | Lists P0s but does not sequence the tmux/BridgeSpace/Ghostty closure as one claim system. |
| tmux parity | `VISIBLE_AGENT_PANE_RUNTIME_SPEC.md`, mux source, sidecar source | Partial. Pane graph, layout, keymap, sidecar, durable scrollback exist. | No complete session/window/multi-client/attach/control-lock proof. Live restore proof currently red or blocked. |
| BridgeSpace-plus AI team OS | specs plus implemented MCP/task/event/ownership pieces | Partial. Strong substrate exists. | Shared brain, ownership, merge, visible panes, and replay are not yet one durable product proof. |
| Ghostty/WezTerm quality | terminal/native scripts and native Rust modules | Partial. Native direction exists. | Daily-driver proof, text shaping/fallback, IME/resume/resize/visual regression proof are not current enough. |
| Current truth | `score-release-quality.mjs`, quality artifacts | Partial. The current score is authoritative in practice. | Stale green artifacts can still confuse docs and claims. Need hierarchy and freshness gate. |
| Aggregate claim gate | none | Missing. | Need one gate that answers "can we claim world-class terminal AI OS?" |

## 2. Product Claim Policy

Do not claim any of the following until the matching gate is green:

- "tmux-equivalent" or "full tmux rewrite".
- "BridgeSpace-plus complete".
- "Ghostty-class" or "WezTerm-class daily-driver terminal".
- "world-class Windows terminal AI OS".
- "release-ready".

Allowed current positioning while these gates are red:

> Aelyris has a real Rust/Tauri terminal, mux, sidecar, visible-agent, MCP,
> worktree, ownership, review, and merge substrate, but the world-class claim is
> still blocked by durability, persistence, native-quality, and current-proof gates.

## 3. Architecture Principles

The gap closure must follow these principles:

1. One current readiness truth.
   `score-release-quality` and the new world-class gate override stale historical
   promotion artifacts.

2. One durable merge truth.
   `MergeIntentStore` becomes the single source of merge state for MCP, cockpit UI,
   and autonomy loop. Any in-memory queue is only a transient adapter.

3. One backend shared brain.
   Active task graph, agent activity, file claims, symbol claims, knowledge impacts,
   pane bindings, and merge intents must be observable through backend APIs after
   restart.

4. Visible agents are real panes.
   UI-visible agents use interactive PTY/TUI paths and mount into the central pane
   tree. Headless `-p` remains valid only for planner/reviewer/MCP/batch roles.

5. Sidecar-owned first for tmux claims.
   If a visible loop pane falls back to in-process native PTY, the UI may work, but
   the tmux-grade claim is blocked.

6. No green from old evidence.
   Every claim gate must check artifact freshness, command result status, and the
   concrete proof that matters for that claim.

## 3A. Anti-Debt And No-Fake-Green Rules

The implementation must not trade the world-class goal for a test-only green path.
These rules are mandatory for every workstream in this document.

### Fallback Rules

Fallbacks are allowed only as explicit degraded modes. A fallback must never satisfy
the claim it is bypassing.

Every fallback path must produce a typed degradation record:

```ts
interface DegradationRecord {
  id: string;
  component: "mux" | "terminal" | "orchestrator" | "merge" | "ownership" | "native";
  fallbackPath: string;
  reason: string;
  userVisible: boolean;
  claimBlocks: Array<"tmux" | "bridgespace" | "ghostty" | "release">;
  recoveryAction: string;
  removalGate: string;
  observedAt: string;
}
```

Rules:

- In-process PTY fallback can keep the app usable, but blocks `tmux`.
- Parser/file fallback in symbol ownership can keep scheduling safe by serializing,
  but blocks "function-level parallelism is fully unlocked" for that language/file.
- Font rasterization fallback can keep text visible, but blocks `ghostty` if shaping,
  fallback fonts, width calculation, or IME composition are incomplete.
- Shell, HTTP, or static artifact proof can explain an environment block, but cannot
  replace a live proof gate when the product claim requires live behavior.
- A fallback must have a removal gate. Permanent silent fallback is technical debt
  and fails the aggregate gate.

### Test Integrity Rules

Tests and verifiers must prove behavior, not implementation coincidence.

Required patterns:

- Prefer semantic checks over exact source-string checks.
- Every verifier that can be green without exercising the runtime must label itself
  `static_only` and cannot unlock a product claim by itself.
- Every claim gate needs at least one negative case proving the wrong path is blocked.
- Every restart/durability claim needs a crash/restart/reconnect replay artifact.
- Every performance claim needs a measured budget and must record the host, duration,
  payload shape, and artifact freshness.
- Every security or merge gate must bind to immutable IDs/OIDs or persisted rows, not
  caller-supplied mutable branch names alone.
- Every UI-visible claim must include either a browser/Tauri screenshot/artifact or
  an explicit environment-blocked record that keeps the claim red/review.

Forbidden patterns:

- Do not make a verifier pass by looking only for a function name or comment.
- Do not introduce a mock-only implementation and count it as live proof.
- Do not lower a gate threshold to match the current implementation.
- Do not use frontend local state as the source of truth for durable panes, merge,
  ownership, or shared brain state.
- Do not accept "spawn EPERM" or browser attach failure as proof of success. It is
  only a host-gate blocker.

### Debt Accounting Rules

If a work unit intentionally ships with a degraded path, it must add the degradation
to the current truth artifact and the aggregate world-class gate must remain red or
review for the affected claim.

The debt record must answer:

- What user-visible behavior is worse?
- Which claim is blocked?
- What implementation removes the debt?
- Which verifier proves it is gone?

If those four fields are missing, the work unit is not done.

## 3B. Technology Standard

The chosen technologies are directionally strong for a Windows-first terminal AI OS,
but each has a minimum usage standard. The standard below is part of the design.

| Layer | Adopted direction | Why it is acceptable | Hard requirement |
| --- | --- | --- | --- |
| Backend runtime | Rust + Tokio | Memory safety, predictable ownership, async IO, strong Windows bindings. | Durable orchestration, mux, merge, and ownership state live in Rust/backend, not frontend-only state. Blocking PTY reads stay off Tokio worker threads. |
| PTY | ConPTY through `portable-pty`, sidecar-owned when durable | Native Windows terminal substrate and practical shell compatibility. | Sidecar/daemon ownership is required for tmux claims. In-process PTY remains degraded only. |
| Terminal parser/state | `alacritty_terminal`-backed state engine | Mature terminal grid/parser basis. | Renderer and mux gates must exercise real terminal state, scrollback, alt-screen, OSC, resize, and reconnect behavior. |
| Persistence | SQLite via `rusqlite`, WAL, normalized repositories | Strong local durability without cloud dependency. | Merge, ownership, pane bindings, event/outbox, and shared-brain state must be transactional, indexed, and restart-replayable. |
| API/control plane | Axum + WebSocket + scoped local tokens | Good local daemon/control surface with streaming events. | Tokens must be scoped; MCP/control/sidecar authority cannot collapse into one broad bearer path. |
| Renderer | winit/wgpu on Windows DX12 path | High-performance native presentation path and future renderer independence. | Dirty-row/dirty-rect rendering, glyph atlas lifecycle, DPI resize, sleep/resume, and visual regression proof are required before Ghostty-class claims. |
| Text shaping | System-backed shaper required on Windows | Ghostty/WezTerm-class rendering needs shaping/fallback beyond simple glyph rasterization. | `fontdue` may remain a rasterizer/atlas helper, but is not sufficient as the final shaping/fallback answer. Add DirectWrite/DWriteCore or an equivalent shaping layer before claiming Ghostty-class quality. |
| Symbol intelligence | tree-sitter parser tier plus future LSP tier | Good low-latency local extraction with room for precise semantic ownership. | Parser/file fallback serializes conservatively. Function-level parallelism claims require verified symbol ranges and conflict proof. |
| Observability | `tracing`, JSON events, machine-readable artifacts | Needed for current proof and post-crash audit. | Every claim gate writes artifacts with freshness, host context, measured status, and blockers. |

### Performance Budgets

Initial budgets are intentionally conservative and must be replaced by measured
release budgets once live host gates are stable:

- Mux split/select/resize command path: p95 under 50 ms inside the app process.
- Sidecar attach/reconnect metadata path: p95 under 250 ms excluding shell startup.
- PTY output ingestion: no unbounded queue growth under sustained output; dropped or
  lagged events must be counted and surfaced.
- Terminal render: dirty rows/rectangles only for steady-state output; no full
  scrollback repaint on ordinary keystrokes or prompt output.
- Shared brain snapshot read: p95 under 100 ms for normal project scale, with caps
  and pagination for large fleets.
- SQLite writes for merge/ownership/outbox: transactional and indexed; no full-table
  scans on hot scheduling paths.

Any gate that cannot measure a budget yet must mark the budget `unmeasured` and keep
the relevant product claim in review/block.

## 3C. Modularity And Changeability Standard

The implementation must keep Aelyris easy to change while the product moves toward
tmux / BridgeSpace / Ghostty-class quality. The goal is not merely smaller files; it
is stable ownership boundaries, narrow contracts, and low-risk replacement of
terminal, mux, orchestration, persistence, and UI surfaces.

### Existing Baseline

`CODEX_HANDOFF.md` already defines two important modularity constraints:

- The backend capability layer belongs under `src-tauri/src/control/` with
  per-domain modules such as worktree, agent, pane, diff, merge, and approval.
  Tauri IPC and MCP must stay thin adapters over that layer.
- God-file decomposition remains required: `src-tauri/src/ipc/commands.rs` and
  `src/App.tsx` must not keep absorbing unrelated behavior.

This document strengthens those constraints for the world-class gap closure.

### Boundary Rules

Every work unit must identify one primary owner boundary before implementation:

| Boundary | Owns | Must not own |
| --- | --- | --- |
| `src-tauri/src/control/*` | domain behavior and orchestration decisions | Tauri serialization quirks or UI layout |
| `src-tauri/src/ipc/*` | Tauri command translation, validation, response mapping | domain state, scheduling policy, merge authority |
| `src-tauri/src/api/*` | HTTP/MCP adapter contracts and auth enforcement | duplicate merge, mux, ownership, or task logic |
| `src-tauri/src/persistence/*` | SQLite schema/repository operations | scheduler policy or UI view models |
| `src-tauri/src/mux/*` | durable session/window/pane/client model | frontend pane-tree local-only state |
| `src-tauri/src/term/*` | terminal parsing/input/render contracts | app shell layout or agent orchestration |
| `src/features/terminal/*` | terminal UI rendering and interaction | durable mux state or backend scheduling |
| `src/features/agent-inspector/*` | operator visibility and control surfaces | source-of-truth agent state |
| `src/shared/lib/*` | frontend adapters and pure helpers | backend truth, side effects hidden from tests |

If a change needs to touch more than three boundaries, split it into multiple WUs
unless the only cross-boundary change is adding a shared contract field and its
adapter plumbing.

### Work Unit Grain Rules

Each WU should be sized so that it can be reviewed and reverted without dismantling
the entire product path.

Mandatory WU shape:

- One behavioral objective.
- One primary owner boundary.
- Explicit contract additions or no contract change.
- Focused tests for the changed boundary.
- One integration verifier only when the WU crosses process/UI/backend boundaries.
- No opportunistic cleanup outside the target boundary.

Split a WU when:

- it changes persistence schema and UI presentation in the same patch.
- it introduces a new backend source of truth and a new frontend workflow.
- it touches both native renderer internals and orchestration logic.
- it changes command-risk/merge authority and unrelated UX.
- it requires more than one migration plus non-trivial UI behavior.

Do not split a WU when:

- a contract field must be threaded through adjacent adapters in one lockstep patch.
- a verifier and implementation must change together to avoid stale false failure.
- a migration and its repository read/write code are inseparable.

### Contract-First Rule

Cross-boundary behavior must be introduced as a contract before UI behavior depends
on it.

Preferred order:

1. Domain type and backend repository/service contract.
2. Tauri/MCP/API adapter.
3. Frontend type or fixture.
4. UI rendering/control.
5. Integration verifier.

For Rust/TypeScript shared concepts, keep using explicit fixtures/contract tests
until codegen is intentionally adopted. Do not add ad hoc duplicated enums without
a drift test.

### Adapter Rule

IPC, MCP, HTTP, and frontend adapters must stay thin:

- validate input.
- translate to domain commands.
- call one domain service.
- translate result or error.
- record audit evidence where appropriate.

They must not:

- make scheduling decisions.
- perform merge authority checks that differ from backend merge policy.
- maintain local-only durable state.
- duplicate terminal/mux/ownership logic.

### God-File Guard

New world-class work must reduce, not increase, the long-term blast radius of:

- `src/App.tsx`
- `src-tauri/src/ipc/commands.rs`
- `src-tauri/src/api/mcp.rs`
- `src-tauri/src/bin/aelyris_native.rs`

Allowed changes to those files:

- wire to a newly extracted module.
- remove duplicated logic.
- add a narrow adapter call.
- add a temporary compatibility wrapper with a removal gate.

Forbidden changes:

- adding new domain logic directly.
- adding new long switch/case or match branches without extracting a handler table
  or per-domain module when the surface is growing.
- adding new local state that competes with a backend source of truth.

### Replaceability Requirements

The following parts must remain replaceable without rewriting the app shell:

- terminal renderer implementation behind `NativeRenderFrame` / render contract.
- text shaping backend behind the shaping trait.
- mux persistence backend behind repository/service traits.
- MCP transport shape behind API adapter contracts.
- planner/model router behind orchestration router contracts.
- frontend pane tree rendering behind backend pane binding contracts.

Every new abstraction must have a real reason:

- it hides a volatile implementation boundary.
- it removes meaningful duplication.
- it lets the test or proof harness exercise a stable contract.
- it matches an existing local pattern.

No abstraction should be added only because "modular" sounds better.

### Modularity Gate

Add `scripts/verify-modularity-boundary-contract.mjs` before large G1-G5 work.

The verifier should fail or warn on:

- new domain keywords added to known adapter god files without a matching extracted
  module or explicit allowlist entry.
- frontend source-of-truth fields for durable mux, merge, ownership, or shared
  brain state.
- new duplicated enum/string unions across Rust and TypeScript without a fixture or
  contract test.
- new persistence tables without repository tests.
- WU docs missing owner boundary, contract changes, rollback plan, and gates.

This gate should be advisory at first, then blocking once the initial baseline is
recorded.

### Rollback And Changeability Rule

Each WU must define a rollback path:

- schema migrations need forward-only compatibility or an explicit recovery script.
- UI feature flags or degraded visibility must exist for risky surfaces.
- backend new sources of truth need boot reconcile and idempotent replay.
- native renderer changes need a runtime switch only as a visible degraded mode, not
  as a hidden substitute for passing Ghostty gates.

If a WU cannot be rolled back or replayed safely, it is too large or it touches the
wrong boundary.

## 4. Workstream G0 - Current Truth And Documentation Freshness

### Intent

Stop stale green artifacts from overriding current red evidence. Make it impossible
for docs to imply release readiness while `score-release-quality` or world-class
gates are blocked.

### Target Files

- `scripts/score-release-quality.mjs`
- `scripts/verify-goal-documentation-freshness.mjs`
- new `scripts/verify-current-readiness-source.mjs`
- new `scripts/verify-anti-debt-claim-contract.mjs`
- new `scripts/verify-modularity-boundary-contract.mjs`
- `.codex-auto/quality/release-quality-score.json`
- `.codex-auto/quality/current-readiness-source.json`
- `.codex-auto/quality/degradation-register.json`
- `.codex-auto/promotion-gate.json`
- `package.json`
- `docs/specs/README.md`
- `docs/specs/CODEX_HANDOFF.md`
- `docs/history/IMPLEMENTATION_PLAN_2026-06-23.md`

### Data Contract

Create `.codex-auto/quality/current-readiness-source.json`:

```json
{
  "schema": "aelyris.current-readiness-source/v1",
  "generatedAt": "ISO-8601",
  "authoritativeSources": [
    "release-quality-score",
    "world-class-terminal-ai-os"
  ],
  "historicalSources": [
    "promotion-gate"
  ],
  "releaseQuality": {
    "status": "pass | review | block",
    "score": 0,
    "grade": "A | B | C | D | F",
    "artifact": ".codex-auto/quality/release-quality-score.json"
  },
  "staleContradictions": [
    {
      "artifact": ".codex-auto/promotion-gate.json",
      "reason": "older than current quality score or contradicts current block"
    }
  ],
  "claimBlocks": [
    "tmux",
    "bridgespace",
    "ghostty",
    "release"
  ],
  "degradations": [
    {
      "id": "example",
      "component": "mux",
      "fallbackPath": "in-process-pty",
      "claimBlocks": ["tmux"],
      "removalGate": "verify-mux-fallback-blocker"
    }
  ]
}
```

### Implementation Notes

- `verify-current-readiness-source.mjs` reads all relevant quality artifacts and
  writes the source hierarchy.
- Historical artifacts may remain in the repo, but must be labeled historical if
  they are stale or contradicted.
- `score-release-quality.mjs` should include a "stale green contradiction" check.
- `verify-anti-debt-claim-contract.mjs` must fail if a product claim is green while
  any degradation record blocks that claim.
- `verify-modularity-boundary-contract.mjs` should start as advisory against the
  current baseline and become blocking before large G1-G5 implementation work.
- Docs freshness verification should fail if docs claim readiness while current
  authoritative artifacts block readiness.
- `docs/specs/README.md` should point readers to the latest audit/design once the
  user or owner approves updating the already-dirty README.

### Acceptance Gates

- `node scripts/verify-current-readiness-source.mjs`
- `node scripts/verify-anti-debt-claim-contract.mjs`
- `node scripts/verify-modularity-boundary-contract.mjs`
- `node scripts/score-release-quality.mjs`
- `node scripts/verify-goal-documentation-freshness.mjs`

### Done Definition

- There is a single machine-readable current truth file.
- Every fallback/degraded path is represented in `degradation-register.json`.
- A degraded fallback cannot satisfy or unlock the product claim it blocks.
- New WUs declare owner boundary, contract changes, rollback plan, and gates.
- Adapter god files do not grow new domain logic without extraction or an explicit
  debt record.
- Stale green promotion artifacts cannot mask a current block.
- Docs either reference the current block or are marked stale by a verifier.

## 5. Workstream G1 - Orchestra Center-Pane Visible Agent Proof

### Intent

Prove the BridgeSpace-style visible team workspace path:

one task lane -> one real interactive agent -> one central terminal pane -> one
worktree or branch context -> live metadata visible to the operator.

### Target Files

- `src/App.tsx`
- `src/shared/lib/orchestraDispatch.ts`
- `src/shared/lib/agentFleet.ts`
- `src/features/orchestrator/OrchestratorPanel.tsx`
- `src/features/agent-inspector/AgentInspector.tsx`
- `src/features/agent-inspector/ConductorView.tsx`
- `src/features/terminal/pane-tree/PaneTreeContainer.tsx`
- `src/features/terminal/pane-tree/PaneTreeRenderer.tsx`
- `src/features/terminal/pane-tree/usePaneTree.ts`
- `src/features/terminal/pane-tree/persistence.ts`
- `src/features/terminal/TerminalCanvas.tsx`
- `src/features/terminal/TerminalInfoBar.tsx`
- `src/shared/types/agent.ts`
- `src/shared/types/terminalPane.ts`
- `src-tauri/src/ipc/interactive_commands.rs`
- `src-tauri/src/ipc/orchestrator_commands.rs`
- `scripts/verify-agent-team-orchestration-readiness.mjs`
- `scripts/verify-dispatch-pane.mjs`
- new `scripts/verify-orchestra-center-pane-live.mjs`

### Runtime Contract

Each visible orchestra lane must produce a binding like:

```ts
interface VisibleAgentPaneBinding {
  taskId: string;
  roleId: string;
  sessionId: string;
  paneId: string;
  terminalId: string;
  cwd: string;
  branchName?: string;
  backend: "sidecar" | "native";
  durability: "tmux-durable" | "degraded";
  spawnedAt: string;
}
```

The binding belongs to the backend. The frontend may cache it, but cannot be the
source of truth for durability.

### G1.2 Implementation Ledger - 2026-06-25

Current frontend contract implemented:

- `VisibleAgentPaneBinding` now exists in `src/features/terminal/pane-tree/types.ts`
  with `backend: "sidecar" | "native"`, `durability: "tmux-durable" |
  "degraded"`, status, task, role, cwd, branch, and timestamps.
- `PaneTreeSnapshot` persists sanitized `agentBindings` and drops stale bindings
  whose pane id is no longer in the restored tree.
- `App.tsx` preserves `taskId` from the Rust `agent_spawned` event instead of
  reducing the event to `terminalId/model`.
- `PaneTreeContainer` builds the visible-agent binding when loop-dispatched PTYs
  are mounted into the central pane tree, updates status on `pty-exit-*`, and
  saves the binding with the pane snapshot.
- If a restored native/degraded agent PTY is not present after backend
  reconciliation, the pane is marked `exited` and the agent chip becomes
  `error`; the renderer must not spawn a fresh shell into that pane.
- Mux hydration preserves seed `agentBindings` only when the mux-restored pane ids
  still match. It does not invent bindings for unrelated panes.

Current reality and remaining debt:

- Rust currently emits `agent_spawned` with `taskId`, `terminalId`, and `model`.
  It does not emit backend, durability, cwd, branch, prompt, cost, session id, or
  sidecar/tmux ids.
- Loop-dispatched central-pane agents are still native/in-process PTYs via
  `PaneFleet -> PtyManager`, not sidecar/tmux-durable sessions.
- Therefore current loop panes default to `backend="native"` and
  `durability="degraded"`. This blocks tmux-equivalent durability claims until
  the backend owns restart-replayable agent pane sessions.
- The implemented contract is a truthful frontend/cache layer, not the final
  backend source of truth.

Current G1.2 proof:

- `pnpm test -- src/__tests__/paneTreePersistence.test.ts src/__tests__/PaneTreeContainerActiveTerminal.test.tsx`
- `.\node_modules\.bin\tsc.CMD --noEmit`
- `pnpm verify:visible-agent-pane-binding`
- Artifact:
  `.codex-auto/quality/visible-agent-pane-binding-contract.json`

### Implementation Notes

- Replace brittle exact-string checks in
  `verify-agent-team-orchestration-readiness.mjs` with semantic checks:
  - `handleStartAgent` or equivalent receives role and branch/worktree context.
  - successful spawn creates or reuses a pane leaf.
  - pane metadata includes task/role/session/backend.
- The UI dispatch path must not silently spawn headless `-p` agents for visible
  lanes.
- `orchestraDispatch.ts` should preserve router/model selection while also
  preserving branch/worktree and role metadata.
- `PaneTreeContainer` should expose an explicit action for attaching an agent
  terminal to a pane leaf instead of relying on implicit tab creation.
- If sidecar is unavailable and native fallback is used, set
  `durability="degraded"` and block the tmux-grade claim.
- Persist pane bindings through `pane-tree/persistence.ts` and reconcile them
  from backend/sidecar list on restart.

### Acceptance Gates

- `pnpm test -- src/__tests__/orchestraDispatch.test.ts src/__tests__/paneTreePersistence.test.ts src/__tests__/integration-pane-lifecycle.test.ts`
- `node scripts/verify-agent-team-orchestration-readiness.mjs`
- `node scripts/verify-dispatch-pane.mjs`
- `node scripts/verify-orchestra-center-pane-live.mjs`

### Done Definition

- Right-rail/orchestra dispatch creates visible agent panes in the central pane tree.
- Each pane has task, role, branch/worktree, backend, and durability metadata.
- Fallback mode is visible and claim-blocking.

## 6. Workstream G2 - Durable Merge Unification

### Intent

Close the split between MCP durable merge intents and autonomy-loop in-memory merge
queue. Merge state must survive process restart and must remain review-gated.

### Target Files

- `src-tauri/src/merge_intent/store.rs`
- `src-tauri/src/merge_intent/mod.rs`
- `src-tauri/src/persistence/merge_repo.rs`
- `src-tauri/src/control/merge.rs`
- `src-tauri/src/control/loop_ports.rs`
- `src-tauri/src/control/approval.rs`
- `src-tauri/src/ipc/review_commands.rs`
- `src-tauri/src/api/mcp.rs`
- `src-tauri/src/lib.rs`
- `scripts/verify-security-mcp-merge-intent-binding.mjs`
- `scripts/verify-merge-idempotency.mjs`
- new `scripts/verify-durable-merge-unification.mjs`

### Design

Use `MergeIntentStore` as the single merge source.

```rust
pub trait MergeIntentPort {
    fn request_merge(&self, input: MergeRequestInput) -> Result<MergeIntent, MergeError>;
    fn approve_intent(&self, intent_id: &str, reviewer_id: &str) -> Result<MergeIntent, MergeError>;
    fn execute_approved(&self, intent_id: &str) -> Result<MergeIntent, MergeError>;
    fn list_pending(&self, scope: MergeScope) -> Result<Vec<MergeIntent>, MergeError>;
}
```

`control::merge::MergeQueue` must become one of:

- a thin adapter that writes to `MergeIntentStore`; or
- a compatibility facade removed from authoritative state paths.

It must not remain a second source of truth.

### State Rules

- All merge requests create immutable intent rows first.
- Review verdict, gates, reviewer identity, source branch, target branch, commit
  heads, and diff summary are stored before execution.
- Autonomy loop cannot self-approve. It can enqueue and observe.
- Re-running the same approved merge is idempotent.
- Process restart cannot lose pending intents or executed intent history.

### Acceptance Gates

- `cargo test --manifest-path src-tauri/Cargo.toml merge_intent --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml control::merge --lib`
- `node scripts/verify-security-mcp-merge-intent-binding.mjs`
- `node scripts/verify-merge-idempotency.mjs`
- `node scripts/verify-durable-merge-unification.mjs`

### Done Definition

- MCP, cockpit UI, and autonomy loop all enqueue through durable merge intents.
- In-memory merge state cannot produce a merge that is missing from SQLite.
- Restart replay shows the same pending/executed merge queue.

### Implementation Status - 2026-06-25

Status: REVIEW, with the main G2 production path implemented and verifier-guarded.

Implemented:

- `LoopPortsAdapter` now defaults to durable-merge-required mode. If no
  `MergeIntentStore` is injected, autonomy-loop merge fails closed before the
  legacy RAM `MergeQueue` can enqueue.
- `run_step` and `run_step_visible` accept `Option<Arc<MergeIntentStore>>` and
  inject it into the concrete autonomy adapter.
- MCP `aelyris.orchestrator.step` passes `state.merge_store.clone()` into
  headless autonomy execution.
- Tauri IPC `orchestrator_step` receives the managed
  `Option<Arc<MergeIntentStore>>` and passes it into visible-pane autonomy
  execution.
- Tauri startup creates one durable merge store from the app DB, reconciles
  dangling `merging` rows on boot, manages the same store for local IPC, and
  passes the same handle into the API/MCP state.
- `control::merge` now exposes `request_durable_intent` and
  `approve_durable_intent` helpers. The loop commits the worker worktree first,
  creates an immutable OID-bound intent, captures gate evidence as
  `gatesDigest`, CAS-claims the intent, runs `perform_merge_bound`, and records
  terminal state.
- G2.1: direct MCP `aelyris.review.approve` now keeps only the MCP input boundary
  checks (store attached, exact allowlist, strict `verdict`/`gatesDigest` typing)
  and delegates execution to `control::merge::approve_durable_intent`. That
  helper owns durable claim, approval metadata, idempotent already-merged
  handling, OID-bound merge execution, and `needs_reconcile` marking. It returns
  typed errors so MCP maps missing intents to `NotFound`, operator/state errors
  to `BadRequest`, and persistence failures to `Internal`.
- Legacy `MergeQueue` remains only as a compatibility/test behavior surface:
  the only method that disables durable-merge-required mode is private and
  `#[cfg(test)]`.

New gate:

- `pnpm verify:durable-merge-unification`
- Artifact: `.codex-auto/quality/durable-merge-unification.json`

Current proof:

- PASS `cargo test --manifest-path src-tauri\Cargo.toml control::loop_ports::tests --lib`
  - 23 passed.
- PASS `cargo test --manifest-path src-tauri\Cargo.toml merge_intent --lib`
  - 6 passed.
- PASS `node scripts\verify-security-mcp-merge-intent-binding.mjs`
  - 10/10 passed.
- PASS `pnpm verify:durable-merge-unification`
  - 10/10 passed.
- PASS `.\\node_modules\\.bin\\biome.CMD check scripts\\verify-security-mcp-merge-intent-binding.mjs scripts\\verify-durable-merge-unification.mjs`
- PASS `cargo test --manifest-path src-tauri\Cargo.toml review_approve --lib`
  - 2 passed.
- PASS `cargo test --manifest-path src-tauri\Cargo.toml request_merge_is_idempotent --lib`
  - 1 passed.
- PASS `cargo test --manifest-path src-tauri\Cargo.toml control::merge --lib`
  - 5 passed.
- BLOCK `pnpm verify:merge-idempotency`
  - Requires a running API token: `AELYRIS_API_TOKEN is required (start pnpm tauri:dev and export it)`.

Remaining REVIEW items:

- Direct MCP approval still has a default operator actor path and optional
  `gatesDigest`; hard actor identity and hard gate evidence are not yet enforced
  for every approval surface.
- `verify:merge-idempotency` still needs a live Tauri/API session to prove the
  end-to-end idempotency contract outside Rust unit tests.

## 7. Workstream G3 - Durable Ownership And Shared Brain

### Intent

Make the BridgeSpace-plus "shared brain" real across restart. The operator and
agents must be able to see who owns which files/symbols, what each agent is doing,
and what merge/review state exists after app restart.

### Target Files

- `src-tauri/src/file_ownership/mod.rs`
- `src-tauri/src/symbol_ownership/mod.rs`
- `src-tauri/src/symbol_ownership/extract.rs`
- `src-tauri/src/symbol_ownership/agent_context.rs`
- `src-tauri/src/task/symbol_enrich.rs`
- `src-tauri/src/knowledge_graph/mod.rs`
- `src-tauri/src/knowledge_graph/manager.rs`
- `src-tauri/src/ipc/ownership_commands.rs`
- `src-tauri/src/ipc/symbol_ownership_commands.rs`
- `src-tauri/src/ipc/orchestrator_commands.rs`
- `src-tauri/src/api/mcp.rs`
- new `src-tauri/src/persistence/ownership_repo.rs`
- `src-tauri/src/shared_brain.rs`
- `src/shared/lib/agentFleet.ts`
- `src/features/agent-inspector/AgentInspector.tsx`
- `src/features/terminal/TerminalInfoBar.tsx`
- `scripts/verify-symbol-ownership-live.mjs`
- `scripts/verify-shared-brain-live.mjs`
- new `scripts/verify-shared-brain-restart-replay.mjs`

### Persistence Model

Add persistent backend records for active ownership state and reconstruct the
shared-brain snapshot from normalized runtime sources. Do not add a raw
`shared_brain_snapshots` table until there is a concrete replay or export use
case that cannot be served from the normalized stores.

```sql
CREATE TABLE file_ownership_claims (
  claim_id TEXT PRIMARY KEY,
  task_id TEXT,
  agent_id TEXT NOT NULL,
  pattern TEXT NOT NULL,
  lease_expires_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE symbol_ownership_claims (
  claim_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  task_id TEXT,
  path TEXT NOT NULL,
  symbol TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  mode TEXT NOT NULL,
  confidence TEXT NOT NULL,
  lease_expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Implemented contract:

- file and symbol ownership claims are durable active projections.
- Context Store, Event Bus, Knowledge Graph, and MergeIntentStore remain their
  existing normalized sources of truth.
- `SharedBrainSnapshot` is reconstructed from live agents, durable ownership,
  durable merge intents, events, and decisions.
- `shared_brain_snapshots` is intentionally not created in this slice to avoid a
  redundant second source of truth.

### Backend API Contract

Expose one read path for the shared brain:

```ts
interface SharedBrainSnapshot {
  workspaceId: string;
  generatedAt: string;
  taskGraphRevision?: string;
  agents: Array<{
    sessionId: string;
    taskId?: string;
    role?: string;
    currentAction?: string;
    cwd?: string;
    branchName?: string;
    paneId?: string;
  }>;
  ownership: Array<{
    claimId: string;
    kind: "file" | "symbol";
    path: string;
    symbol?: string;
    range?: { startLine: number; endLine: number };
    ownerSessionId?: string;
    confidence: "lsp" | "parser" | "diff-hunk" | "file-fallback";
    status: "active" | "released" | "expired" | "blocked";
  }>;
  mergeIntents: Array<{
    intentId: string;
    sourceBranch: string;
    targetBranch: string;
    state: string;
  }>;
  blockers: Array<{
    type: string;
    detail: string;
  }>;
}
```

Expose through:

- Tauri IPC: `shared_brain_snapshot`
- MCP: `aelyris.shared_brain.snapshot`
- Optional HTTP API if sidecar/control API already owns the route.

### Scheduling Rules

- The scheduler consults persistent ownership before dispatch.
- Same-file, disjoint verified symbols may run in parallel.
- Unknown or low-confidence symbol ranges fall back to file-level serialization.
- Expired leases become visible warnings before they are automatically reclaimed.
- Agent prompts receive a compact ownership header from one backend formatter only.

### Acceptance Gates

- `cargo test --manifest-path src-tauri/Cargo.toml symbol_ownership --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml ownership_repo --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml shared_brain --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml claim_from --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml control::loop_ports::tests --lib`
- `pnpm verify:shared-brain-ownership-persistence`
- `node scripts/verify-symbol-ownership-live.mjs`
- `node scripts/verify-shared-brain-live.mjs`
- `node scripts/verify-shared-brain-restart-replay.mjs --phase seed`
- restart Aelyris
- `node scripts/verify-shared-brain-restart-replay.mjs --phase verify --id <seed-id>`

### Done Definition

- File/symbol claims survive restart.
- Shared brain snapshot includes active agents, pane bindings, ownership, and merge
  intents.
- Dispatch decisions and MCP/IPC reads use the same backend state.

### Implementation Status - 2026-06-25

Completed in this slice:

- Added `src-tauri/src/shared_brain.rs` as the single backend formatter for
  agents, ownership, merge intents, blockers, and decisions.
- Exposed the formatter through Tauri IPC `shared_brain_snapshot` and MCP
  `aelyris.shared_brain.snapshot`.
- Added `file_ownership_claims` and `symbol_ownership_claims` migrations.
- Added `src-tauri/src/persistence/ownership_repo.rs` with load/upsert/delete,
  expiry pruning, and transactional symbol-claim reconcile.
- Added pure-core `hydrate`/`snapshot` helpers to `FileOwnership` and
  `SymbolOwnership`.
- Restored file/symbol ownership during Tauri setup.
- Made MCP and IPC ownership mutation paths write-through. MCP ownership tools
  fail closed when no durable DB is attached.
- Made autonomy-loop file lane claim/release write through `OwnershipRepo` and
  publish blocker events on durability failures.
- Added `scripts/verify-shared-brain-ownership-persistence-contract.mjs` and
  package script `verify:shared-brain-ownership-persistence`.
- Added two-phase live verifier
  `scripts/verify-shared-brain-restart-replay.mjs`.

Proof completed:

- PASS `cargo test --manifest-path src-tauri\Cargo.toml ownership_repo --lib`
  - 5 passed.
- PASS `cargo test --manifest-path src-tauri\Cargo.toml shared_brain --lib`
  - 1 passed.
- PASS `cargo test --manifest-path src-tauri\Cargo.toml claim_from --lib`
  - 5 passed.
- PASS `cargo test --manifest-path src-tauri\Cargo.toml control::loop_ports::tests --lib`
  - 23 passed.
- PASS `cargo test --manifest-path src-tauri\Cargo.toml symbol_ownership --lib`
  - 47 passed.
- PASS `cargo test --manifest-path src-tauri\Cargo.toml migrations_are_idempotent --lib`
  - 1 passed.
- PASS `pnpm verify:shared-brain-ownership-persistence`
  - 12/12 passed.
- PASS `.\\node_modules\\.bin\\biome.CMD check scripts\\verify-shared-brain-ownership-persistence-contract.mjs scripts\\verify-shared-brain-restart-replay.mjs`
- PASS `node --check scripts\verify-shared-brain-restart-replay.mjs`

Remaining REVIEW items:

- `verify-shared-brain-restart-replay.mjs` is two-phase and requires an
  operator-controlled app restart between seed and verify; it is not yet a fully
  automated restart harness.
- The autonomy loop now writes file lanes through the repo, but `StepReport` is
  not fallible; ownership DB write failures are surfaced through tracing and
  blocker events while live lane state is maintained.

## 8. Workstream G4 - tmux-Grade Mux Closure

### Intent

Turn the existing mux substrate into a defensible tmux-grade Windows product claim.

### Target Files

- `src-tauri/src/mux/graph.rs`
- `src-tauri/src/mux/layout.rs`
- `src-tauri/src/mux/manager.rs`
- `src-tauri/src/mux/store.rs`
- `src-tauri/src/mux/keymap.rs`
- `src-tauri/src/pty_sidecar.rs`
- `src-tauri/src/api/mod.rs`
- `src-tauri/src/api/mux.rs`
- `src-tauri/src/ipc/mux_commands.rs`
- `src-tauri/src/ipc/interactive_commands.rs`
- `src/features/terminal/pane-tree/*`
- `src/shared/types/pane.ts`
- `src/shared/types/terminalPane.ts`
- `scripts/verify-mux-live-restore.mjs`
- `scripts/verify-mux-performance.mjs`
- new `scripts/verify-mux-tmux-grade-contract.mjs`
- new `scripts/verify-mux-window-session-model.mjs`
- new `scripts/verify-mux-multiclient-attach.mjs`
- new `scripts/verify-mux-fallback-blocker.mjs`
- new `scripts/verify-mux-live-process-preservation.mjs`

### Model

Define the durable mux model explicitly:

```ts
interface MuxSession {
  sessionId: string;
  workspaceId: string;
  windows: MuxWindow[];
  clients: MuxClient[];
  createdAt: string;
  updatedAt: string;
}

interface MuxWindow {
  windowId: string;
  name: string;
  activePaneId: string;
  layoutRoot: MuxPaneNode;
}

interface MuxClient {
  clientId: string;
  attachedSessionId: string;
  attachedWindowId: string;
  mode: "read-write" | "read-only";
  lastSeenAt: string;
}
```

This model must live in the backend/sidecar layer. The frontend pane tree renders
and controls it; it does not own it.

### Required Behavior

- Create/list/rename/kill session.
- Create/list/rename/kill window.
- Split/select/resize/swap/move pane.
- Attach/detach/re-attach client.
- Read-only attach or spectator attach for future shared inspection.
- Prefix keymap maps to backend mux operations.
- Sidecar restart and UI restart have documented behavior:
  - UI restart must reattach without pane loss.
  - sidecar crash may respawn, but cannot be advertised as tmux-equivalent unless
    sessions are restored with explicit limitation labels.
- In-process native fallback must block the tmux-equivalent claim.

### Acceptance Gates

- `pnpm verify:mux-tmux-grade-contract`
- `cargo test --manifest-path src-tauri/Cargo.toml mux --lib`
- `node scripts/verify-mux-live-restore.mjs`
- `node scripts/verify-mux-performance.mjs`
- `node scripts/verify-mux-window-session-model.mjs`
- `node scripts/verify-mux-multiclient-attach.mjs`
- `node scripts/verify-mux-fallback-blocker.mjs`
- `node scripts/verify-mux-live-process-preservation.mjs`

### Done Definition

- Sessions, windows, panes, and clients are backend-visible and restart-replayable.
- Multi-client attach behavior is proved.
- Fallback mode is reported and blocks tmux claim.
- Prefix key operations exercise backend mux state, not local-only UI state.

### Implementation Status - 2026-06-25

Completed in this slice:

- Added `scripts/verify-mux-tmux-grade-contract.mjs` and package script
  `verify:mux-tmux-grade-contract`.
- Confirmed the backend mux graph already models workspace/window/tab/pane,
  lifecycle, PTY binding, project context, and agent context.
- Confirmed `FileMuxSnapshotStore` is versioned, atomic, and restores live PTY
  bindings as explicit `restore-pending` detached panes.
- Confirmed REST mux mutations persist snapshots and detach/attach has an
  explicit restore-pending respawn policy.
- Made Tauri IPC in-process mux fallback save snapshots after split, close, swap,
  break, join, synchronize, layout, and zoom mutations. This closes a fallback
  durability hole where IPC fallback operations could look successful but be lost
  on restart.
- Added typed stream attach modes to the HTTP/WebSocket API:
  `read-write` remains the default for backward compatibility, while
  `read-only` tickets can attach to the same PTY output stream without being able
  to forward bytes into the PTY writer.
- Bound the redeemed ticket's attach mode into the WebSocket request extensions,
  so a `read-only` ticket cannot be upgraded by appending a query string at
  connection time.
- Added explicit stream controller policy:
  `control=shared` stays the compatible default, while `control=exclusive`
  acquires a session controller lease for one `clientId`.
- Added REST owner checks for exclusive leases: `POST /sessions/{id}/input` and
  `POST /sessions/{id}/resize` remain compatible when no exclusive lease exists,
  but return `409` unless the request carries the lease owner's
  `x-aelyris-client-id` when an exclusive controller is active.
- Added opt-in atomic attach replay for WebSocket clients:
  `GET /sessions/{id}/stream?...&replayLines=N` uses
  `PtyManager::capture_and_subscribe` so the initial snapshot and future live
  bytes are split at one backend critical section instead of racing between
  separate capture and subscribe calls.
- Added `scripts/verify-mux-multiclient-attach.mjs` and package script
  `verify:mux-multiclient-attach` to make multi-client read-only attach a
  machine-checked contract instead of a narrative claim.
- Added `scripts/verify-mux-fallback-blocker.mjs` and package script
  `verify:mux-fallback-blocker` so in-process/native fallback durability cannot
  unlock the tmux-grade claim.
- Added backend-owned window/session lifecycle closure:
  `MuxGraph::create_window`, `MuxGraph::rename_window`,
  `MuxGraph::remove_window`, `MuxManager` wrappers, REST session delete, and
  REST window list/create/rename/kill routes.
- Added backend-owned mux client lifecycle closure:
  `MuxClientRecord`, `MuxClientMode`, graph/manager upsert-remove operations,
  pane-to-workspace/window attachment lookup, WebSocket attach/drop recording,
  persisted live client state while connected, and restart restore cleanup so
  stale WebSocket clients are not resurrected.
- Added `scripts/verify-mux-window-session-model.mjs` and package script
  `verify:mux-window-session-model` so G4.1 is a machine-checked
  session/window/client model/API contract instead of a narrative claim.
- Added `scripts/verify-mux-live-process-preservation.mjs` and package script
  `verify:mux-live-process-preservation` as a dedicated claim gate. It now
  proves `daemon-live-detach-reattach-preserves-existing-pty-process-id`: while
  the daemon remains alive, mux detach/attach preserves the same live PTY
  process identity instead of respawning. Restart restore remains
  restore-pending respawn and cannot satisfy this gate.
  same-process preservation is proven only while the daemon remains alive;
  restart restore remains restore-pending respawn.
- Updated GUI spawn/adoption and IPC mux fallback synchronization so mux graph
  PTY bindings receive live `processId` from `PtyRuntimeIdentity` or sidecar
  `TerminalInfo`, rather than relying on terminal ids alone.

Proof completed:

- PASS `pnpm verify:mux-tmux-grade-contract`
  - 16/16 passed after adding backend-owned mux client records and daemon-live
    process preservation separation.
- PASS `pnpm verify:mux-multiclient-attach`
  - 13/13 passed, including backend-visible mux client attach/drop records.
- PASS `pnpm verify:mux-fallback-blocker`
  - 6/6 passed.
- PASS `pnpm verify:mux-window-session-model`
  - 14/14 passed. Static backend model gate for
    workspace/window/tab/pane/client ownership, session delete, window
    list/create/rename/kill routes, stream-client attach/drop persistence,
    restart cleanup of live clients, snapshot persistence, and explicit
    separation from live process-restore claims.
- PASS `cargo test --manifest-path src-tauri\Cargo.toml mux --lib`
  - 37 passed.
- PASS `cargo test --manifest-path src-tauri\Cargo.toml --test test_api_3d1_v2b`
  - 16 passed, including default read-write ticket compatibility, read-only
    ticket response shape, exclusive controller client id response, ticket
    single-use, ticket session binding, controller lease conflict, and WS ticket
    auth rejection paths.
- PASS `cargo test --manifest-path src-tauri\Cargo.toml --test test_pty_broadcast`
  - 8 passed, including `capture_and_subscribe_replays_snapshot_then_future_bytes`.
- PASS `.\\node_modules\\.bin\\biome.CMD check scripts\verify-mux-tmux-grade-contract.mjs scripts\verify-mux-multiclient-attach.mjs scripts\verify-mux-fallback-blocker.mjs`
- PASS `pnpm verify:mux-live-process-preservation`
  - Writes `.codex-auto/quality/mux-live-process-preservation.json` with
    `status=passed` once `PtyRuntimeIdentity`, mux graph `processId` refresh,
    daemon contract policy, and API integration process-id equality checks are
    present. 8/8 passed. same-process preservation is proven only while the
    daemon remains alive; restart restore remains restore-pending respawn.

Current G4 verdict:

- `REVIEW` for mux graph/session/window/client model, restore-pending substrate,
  read-only multi-client attach/input isolation, explicit exclusive controller
  lease with REST owner checks, atomic attach replay, persisted live client
  records while connected, restart cleanup of stale clients, and fallback claim
  blocking.
- `BLOCK` for full tmux-grade claim until legacy shared writer semantics are
  product-classified and fresh live two-client sidecar/browser-level proof is in
  place.
- `PASS` for daemon-live same-process detach/reattach preservation. The G4.1
  window/session model gate and `verify:mux-live-process-preservation` now prove
  separate things: backend ownership/API lifecycle and process-id preservation
  while the daemon remains alive.

Remaining BLOCK/REVIEW items from subagent audit:

- Multi-client output fanout exists. New clients can opt into gap-safe initial
  replay with `replayLines`, and live WebSocket attach/drop is now mirrored into
  backend `MuxClientRecord`s. The remaining proof gap is a fresh live
  two-client sidecar/browser-level run that exercises this end to end.
- Input arbitration is partially closed: read-only attach mode cannot write to
  PTY streams, exclusive controller lease exists, and REST input/resize owner
  checks exist. Default read-write streams intentionally remain shared for
  existing clients and must be product-classified before a tmux-equivalent claim.
- `/mux/workspaces/{id}/attach` currently means restore/respawn missing PTYs, not
  second-client attach to an already-live session.
- Daemon-live client detach/reattach now preserves and proves the same PTY
  process id. Sidecar/daemon crash or process restart still restores graph as
  `restore-pending` and respawns PTYs on attach; this is honest durability but
  not restart-time live process preservation.
- Existing live restore artifact is now machine-classified as
  `environment-blocked` on this machine because Node `child_process` cannot
  launch the PTY sidecar (`spawn EPERM`). The live gate must be refreshed on a
  host where Node can spawn the sidecar and `cargo aelys` parity checks
  before upgrading this from REVIEW/BLOCK.

## 9. Workstream G5 - Ghostty/WezTerm-Class Native Terminal Closure

### Intent

Move from "native direction exists" to "Windows daily-driver terminal quality is
proved by current evidence."

### Target Files

- `src-tauri/src/term/native.rs`
- `src-tauri/src/term/native_input.rs`
- `src-tauri/src/term/text_shaping.rs`
- `src-tauri/src/bin/aelyris_native.rs`
- `src-tauri/src/ipc/commands.rs`
- `src/features/terminal/NativeTerminalArea.tsx`
- `src/features/terminal/TerminalCanvas.tsx`
- `src/features/terminal/hooks/useCanvasIME.ts`
- `src/features/terminal/terminalPaint.ts`
- `src/features/terminal/terminalMetrics.ts`
- `src/features/terminal/terminalCanvasGeometry.ts`
- `scripts/verify-native-boundary-contract.mjs`
- `scripts/verify-full-native-rust-gap-audit.mjs`
- `scripts/verify-native-terminal-input-host.mjs`
- `scripts/verify-terminal-font-render-contract.mjs`
- new `scripts/verify-native-daily-driver-terminal.mjs`
- new `scripts/verify-native-text-shaping-fallback.mjs`
- new `scripts/verify-native-visual-regression.mjs`

### Renderer Design

Add an internal shaping boundary even if the first implementation delegates to the
current renderer:

```rust
pub trait TextShaper {
    fn shape_run(&self, input: ShapeInput) -> Result<ShapedRun, ShapeError>;
    fn resolve_fallback(&self, codepoints: &[char], style: CellStyle) -> Vec<FontFaceRef>;
}
```

Windows target:

- Prefer a system-backed shaper that respects installed fonts and fallback.
- Preserve a fallback implementation for testability.
- Keep glyph cache, atlas invalidation, DPI changes, and font config under one
  terminal renderer owner.

### Daily-Driver Proof Matrix

The native terminal claim requires current proof for:

- ConPTY shell launch and process reconnect.
- Interactive input, paste, command-center submit, and raw PTY write gating.
- IME composition and commit.
- Font fallback for Japanese, emoji, powerline, Nerd Font glyphs, and box drawing.
- Ligature or explicit no-ligature policy.
- Resize, DPI change, scrollback, selection, copy, links, and alternate screen.
- OSC and chunked output behavior.
- Sleep/resume and app restart.
- At least one real Windows visual artifact set in `.codex-auto/production-smoke/`.

### Acceptance Gates

- `node scripts/verify-native-boundary-contract.mjs`
- `node scripts/verify-full-native-rust-gap-audit.mjs`
- `node scripts/verify-native-terminal-input-host.mjs`
- `node scripts/verify-terminal-font-render-contract.mjs`
- `node scripts/verify-native-daily-driver-terminal.mjs`
- `node scripts/verify-native-text-shaping-fallback.mjs`
- `node scripts/verify-native-visual-regression.mjs`

### G5 Implementation Status - 2026-06-27

Native text-shaping contract added in `src-tauri/src/term/text_shaping.rs`.
This is a deliberate anti-debt boundary, not a Ghostty/WezTerm parity claim.

Implemented now:

- `TextShaper` trait, `ShapeInput`, `ShapedRun`, `GlyphCluster`,
  `FontFaceRef`, and `TerminalTextShapingPolicy` are first-class Rust types.
- `PolicyTextShaper` classifies Japanese, emoji, Powerline, Nerd Font, and box
  drawing fallback requirements and remains the deterministic test fallback.
- `DirectWriteTextShaper` adds the Windows system-backed shaping boundary with
  `DWriteCreateFactory`, DirectWrite text layout cluster metrics, system font
  collection lookup, `HasCharacter`-checked installed-family fallback
  candidates, and real `IDWriteFontFallback::MapCharacters` mapping.
- `IDWriteFontFallback::MapCharacters` is now used through a minimal
  `IDWriteTextAnalysisSource` implementation so fallback clusters carry
  `directwrite-map-characters` mapped font metadata instead of only candidate
  family names.
- DirectWrite-mapped fallback fonts now carry local font file path and
  collection index metadata into the winit/wgpu atlas path; `fontdue` loads that
  DirectWrite-resolved font file for fallback glyph rasterization rather than
  guessing by family name or substituting `?`.
- `aelyris-native` readiness and winit/wgpu artifacts now expose
  `textShapingPolicy`, `systemTextShapingCapability`,
  `textShapingBackend` =
  `directwrite-shaped-run-consumed-fontdue-directwrite-fallback-atlas` when
  fallback atlas rasterization succeeds,
  `textShapingRendererIntegrationReady` from the live draw plan,
  `textShapingFallbackGlyphRasterizationReady` from atlas/fallback glyph
  evidence, and the remaining full-native blockers.
- `aelyris-native text-shaping-fixture-proof` now writes a real native grayscale
  PNG atlas fixture at
  `.codex-auto/production-smoke/native-text-shaping/fallback-glyph-atlas.png`
  plus `.codex-auto/quality/native-text-shaping-visual-fixture.json`; the fixture
  is generated from DirectWrite shaped runs, DirectWrite fallback mapping, and
  the native font atlas path without React or WebView.
- `verify:native-text-shaping-fallback` writes
  `.codex-auto/quality/native-text-shaping-fallback.json`; the current artifact
  has `systemTextShapingReady: true`, `rendererTextShapingIntegrated: true`,
  `realFontFallbackReady: true`,
  `rendererFallbackGlyphRasterizationReady: true`,
  `visualFallbackGlyphFixturesReady: true`,
  `readyForGhosttyClaim: true`, and `unsupportedSystemShaper: false`. This is a
  text-shaping subclaim only; it is not full Ghostty/WezTerm parity.
- `verify:native-daily-driver-terminal` writes
  `.codex-auto/quality/native-daily-driver-terminal.json` and remains blocked
  until native boundary, full primary-shell readiness, process reconnect,
  chunked OSC, and sleep/resume proof are all current and green. Current
  native-client, native-input/HWND-paste, and system text-shaping subclaims are
  green.
- `verify:native-visual-regression` writes
  `.codex-auto/quality/native-visual-regression.json` and remains blocked until
  real post-resume visual proof is current. Native visual QA and the fallback
  glyph PNG fixture are now current and tied to the native proof artifacts.
- `verify:full-native:audit` now reports `106/120` (88%). The remaining
  full-native gaps are daemon/mux boundary proof and real sleep/resume visual
  dogfood.

Ghostty/WezTerm parity remains BLOCKED until:

- Native visual regression artifacts prove the full native surface, including
  nonblank pixels, contrast, resize, focus, and post-resume behavior, from
  current native renderer sources.
- Native daily-driver proof covers the same path under sustained output,
  resize, IME, paste, reconnect, and sleep/resume conditions.

### Done Definition

- Native boundary contract is green with fresh artifacts.
- Text shaping/fallback proof is current and covers Japanese/emoji/powerline/box
  drawing.
- Visual regression and daily-driver proof pass on Windows.
- Ghostty/WezTerm comparison is based on measured behavior, not architecture intent.

## 10. Workstream G6 - Aggregate World-Class Gate

### Intent

Create one command that answers the user's strategic question:

> Can Aelyris honestly claim tmux + BridgeSpace + Ghostty quality on Windows?

### Target Files

- new `scripts/verify-world-class-terminal-ai-os.mjs`
- `package.json`
- `.codex-auto/quality/world-class-terminal-ai-os.json`
- `scripts/score-release-quality.mjs`

### Gate Inputs

The aggregate gate reads:

- `verify-current-readiness-source`
- `verify-anti-debt-claim-contract`
- `verify-modularity-boundary-contract`
- `score-release-quality`
- `verify-agent-team-orchestration-readiness`
- `verify-orchestra-center-pane-live`
- `verify-security-mcp-merge-intent-binding`
- `verify-durable-merge-unification`
- `verify-shared-brain-live`
- `verify-shared-brain-restart-replay`
- `verify-mux-live-restore`
- `verify-mux-window-session-model`
- `verify-mux-multiclient-attach`
- `verify-mux-fallback-blocker`
- `verify-native-boundary-contract`
- `verify-native-daily-driver-terminal`
- `verify-native-text-shaping-fallback`
- `verify-native-visual-regression`

### Output Contract

```json
{
  "schema": "aelyris.world-class-terminal-ai-os/v1",
  "status": "pass | review | block",
  "claims": {
    "tmux": "pass | review | block",
    "bridgespace": "pass | review | block",
    "ghostty": "pass | review | block",
    "release": "pass | review | block"
  },
  "blockingReasons": [],
  "artifacts": [],
  "generatedAt": "ISO-8601"
}
```

### G6 Implementation Status - 2026-06-26

Aggregate gate added as `verify:world-class-terminal-ai-os`.

Current output:

- Artifact: `.codex-auto/quality/world-class-terminal-ai-os.json`
- Status: `block`
- Claims: `tmux=block`, `bridgespace=block`, `ghostty=block`,
  `release=block`
- Release score integration: `score-release-quality.mjs` now includes
  `world-class-terminal-ai-os` as a 16-point release item.
- Current release score after integration: `66/351`, grade `D`,
  `releaseCandidateReady=false`.
- `verify:current-readiness-source` now lists
  `world-class-terminal-ai-os` as an authoritative source.
- `verify:requirements-spec-design-traceability` now guards the requirements,
  specification, design, verifier, and artifact chain. It can pass while product
  claims remain blocked; it fails only when the documentation stack becomes
  stale, disconnected, or overclaiming.
- Traceability source:
  `docs/specs/AELYRIS_REQUIREMENTS_SPEC_DESIGN_TRACEABILITY_2026-06-27.md`.

Current blocking reasons:

- `tmux`: live mux restore proof is `environment-blocked` or not green. The
  static mux contract passes but still has recorded review gaps.
- `bridgespace`: shared brain restart replay now writes an
  `environment-blocked` artifact when no authenticated live Aelyris API token is
  supplied, and agent-team orchestration readiness is still blocked by mux live
  restore plus upper-compat host proof gates.
- `ghostty`: native boundary is blocked. The native text-shaping subclaim is now
  ready with a DirectWrite fallback atlas PNG fixture, but daily-driver terminal
  proof and native visual regression are still blocked.
- `release`: current readiness source blocks world-class/release claims and the
  release-quality score is not release-candidate ready.

The aggregate gate intentionally exits non-zero while any claim is blocked. It
must not be softened to `review` just because individual static contracts pass.
The documentation traceability gate must also not be treated as product
readiness. It proves that the requirements/spec/design stack is current; it does
not unlock tmux, BridgeSpace, Ghostty, world-class, or release claims.

### Package Script

Add after the verifier exists:

```json
{
  "scripts": {
    "verify:world-class-terminal-ai-os": "node scripts/verify-world-class-terminal-ai-os.mjs"
  }
}
```

### Done Definition

- One command provides an honest pass/review/block verdict.
- The verdict is impossible to make green while P0 tmux, BridgeSpace, Ghostty, or
  release truth gates are red.
- `score-release-quality` consumes or references the aggregate verdict.

## 11. Execution Order

Implement in this order:

1. G0 Current truth hierarchy.
   This prevents any future work from being misreported.

2. G1 Orchestra center-pane proof.
   This gives the fastest visible product proof and resolves the current failing
   `verify-agent-team-orchestration-readiness` path.

3. G2 Durable merge unification.
   This closes the most dangerous backend split before autonomous loop claims.

4. G3 Durable ownership and shared brain.
   This makes BridgeSpace-plus coordination real across restart.

5. G4 tmux-grade mux closure.
   This should run after G1/G3 so agent panes and ownership can be included in
   restore/attach proof.

6. G5 Ghostty/WezTerm native closure.
   This is broader and should proceed in parallel only if there is a dedicated
   terminal-rendering owner.

7. G6 aggregate world-class gate.
   Add the gate once the component gates exist. Before then, keep the audit doc as
   the human-readable verdict.

## 12. Work Unit Sizing

Recommended work units:

| WU | Scope | Expected size | Notes |
| --- | --- | --- | --- |
| WU-G0.1 | `verify-current-readiness-source` and artifact hierarchy | S | Pure scripts/docs. No app behavior change. |
| WU-G0.2 | `verify-anti-debt-claim-contract` and degradation register | S | Prevents fallback or stale proof from unlocking claims. |
| WU-G0.3 | `verify-modularity-boundary-contract` and WU template fields | S | Keeps implementation grain, boundaries, and rollback plans explicit. |
| WU-G1.1 | Replace brittle orchestra dispatch gate with semantic proof | S | Keep lockstep with `CODEX_HANDOFF.md` WU-1.1 warning. |
| WU-G1.2 | Central pane binding contract and persistence | M | Touches App, pane tree, agent types, tests. |
| WU-G2.1 | MergeQueue adapter over `MergeIntentStore` | M | Security-sensitive. Must preserve gated merge. |
| WU-G3.1 | Persistent ownership repo | M | Implemented 2026-06-25 with migrations, repo tests, restore, and write-through paths. |
| WU-G3.2 | Shared brain snapshot IPC/MCP | M | Implemented 2026-06-25 backend formatter plus IPC/MCP; UI integration remains future work. |
| WU-G4.1 | Mux session/window/client model verifier | M | Implemented with backend graph/manager/API contracts, persisted WebSocket client records while connected, restore cleanup, and IPC fallback snapshot persistence. Daemon-live process preservation is now a separate PASS gate; sidecar restart restore remains restore-pending respawn. |
| WU-G4.2 | Multi-client attach and fallback blocker | L | Implemented for read-only attach, controller lease, input/resize arbitration, fallback blocking, and backend-visible live client records. Remaining blocker is fresh live two-client proof plus product classification of compatible shared writers. |
| WU-G5.1 | Native daily-driver proof harness | M | Verification first, renderer changes second. |
| WU-G5.2 | Text shaping/fallback closure | L | DirectWrite shaped runs, real DirectWrite fallback mapping, and DirectWrite-resolved fallback atlas rasterization are now implemented at source-contract level; Windows visual QA and daily-driver proof remain. |
| WU-G6.1 | Aggregate world-class gate | S | Only after component gates are meaningful. |

## 13. Non-Goals

- Do not rewrite the entire terminal engine before the claim gates show which
  native defects remain.
- Do not add cloud collaboration as a substitute for local multi-client attach.
- Do not make the frontend the owner of durable orchestration, merge, pane, or
  ownership state.
- Do not loosen merge approval to make autonomy look complete.
- Do not hide sidecar/native fallback from the operator.
- Do not update stale docs by changing wording only; every claim change needs a
  gate or artifact.
- Do not treat a degraded fallback as a product feature unless it is user-visible,
  claim-blocking, and has a removal gate.
- Do not keep `fontdue` as the final Ghostty-class shaping answer without a
  system-backed shaping/fallback layer.
- Do not count static verifier success as live terminal, mux, restart, or renderer
  proof.
- Do not add new domain logic to `App.tsx`, `commands.rs`, `api/mcp.rs`, or
  `aelyris_native.rs` when a narrower module can own it.
- Do not split work so finely that a contract cannot compile or a verifier cannot
  express the behavior; contract-threading patches may be lockstep.

## 14. Immediate Next Action

G0.1, G0.2, G0.3, G1.1, G1.2, G2.1, G3.1, G3.2, G4.1, the backend/static
portion of G4.2, and the daemon-live half of G4.3 now have focused
implementation and proof artifacts. The next implementation should refresh the
host-runnable `verify:mux-live` sidecar proof on a host where Node child-process
spawning is allowed, then add/refresh a live two-client WebSocket attach proof.

Reason:

- G2 closed the durable merge source-of-truth gap.
- G3 closed the durable ownership/shared-brain backend gap.
- The largest remaining "tmux full rewrite equivalence" risk is no longer the
  static multi-client model or daemon-live process preservation; it is fresh
  sidecar live proof under Windows process boundaries and product classification
  of shared-writer versus exclusive-controller semantics.
- G0.2 prevents fallback debt and test-only greens from unlocking strategic claims.
- G0.3 prevents the closure work from increasing god-file debt or mixing unrelated
  boundaries.
- G4 is the point where Aelyris's tmux-equivalence claim becomes evidence-backed
  instead of architecture-only.

## 15. Final Re-Audit Statement

Before this document, the design was strong in several individual specs but not
fully integrated:

- Visible runtime design: yes.
- MCP tool surface design: yes.
- Durable MCP merge intent design: yes.
- Backend command-risk design: yes.
- tmux parity design: partial.
- BridgeSpace-plus durable shared-brain design: partial.
- Ghostty-class native quality design: partial.
- Single world-class claim gate: missing.

As of the 2026-06-25 G2/G3 implementation slices, durable merge intent and durable
ownership/shared-brain backend paths have focused code and proof artifacts. The
remaining integrated gaps are now concentrated in G4 mux parity, G5 native
quality, and G6 aggregate world-class gating. Each remaining workstream still
needs normal code-level WU planning before implementation, using
`CODEX_HANDOFF.md` and the relevant spec sections.
