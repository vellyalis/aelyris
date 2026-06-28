# Quorum Release-Hardening Audit

Date: 2026-06-23
Status: BLOCK for release. REVIEW for product hardening.

This is a strict multi-agent audit for turning Quorum from a strong
autonomous-agent cockpit into a release-grade, robust, fault-tolerant product.

The goal is not "make the foundation work". The goal is a system that can be
trusted under long runs, crashes, token failures, malicious local clients,
stale artifacts, interrupted merges, and non-engineer supervision.

## Executive Verdict

Aether is no longer just a scaffold. It has real Task Graph, Event Bus, Context
Store, Cost Manager, visible PTY dispatch, worktree/merge plumbing, MCP tools,
and a newly advanced symbol ownership layer.

It is still not world-release ready.

Current blockers are not one feature. They are release-grade system properties:

- Durable orchestration transaction/outbox.
- Persistent, leased file and symbol ownership cleanup.
- Durable merge queue and immutable merge intent binding.
- Sidecar-owned, restart-safe visible pane runtime for loop agents.
- Backend-authoritative lifecycle state and heartbeat recovery.
- Rust-side command-risk enforcement across REST, MCP, IPC, and PTY input.
- Scoped tokens/governance instead of one broad local bearer authority.
- UI that exposes exact backend state instead of inferred readiness.
- Fresh live evidence, soak tests, and fault-injection gates.
- Supply-chain/security gates green, not stale or waived.

## Audit Method

Four read-only sub-agents audited independent surfaces:

- Backend orchestration robustness.
- Release evidence, verifier quality, soak/fault-injection.
- Frontend/operator UX and non-engineer clarity.
- Security, MCP/local API, sandboxing, supply chain.

The main Codex thread additionally refreshed focused evidence:

- `cargo test --manifest-path src-tauri/Cargo.toml symbol_ownership --lib`
  - Result: `47 passed; 0 failed`.
- `pnpm test -- src/__tests__/agentFleet.test.ts src/__tests__/orchestraDispatch.test.ts`
  - Result: `2 files passed; 8 tests passed`.
- `node scripts/verify-mcp-orchestrator-surface.mjs`
  - Result: PASS.
- `node scripts/verify-agent-team-orchestration-readiness.mjs`
  - Result: FAIL only on `native-workspace-agent-identity-boundary`.
  - Mux performance/live-restore freshness is now green.
- `node scripts/verify-upper-compat-gates.mjs`
  - Result: BLOCKED artifact: `cargo-spawn-failed`, `spawnSync cargo EPERM`.
- `node scripts/score-release-quality.mjs`
  - Result: `score=35`, `total=118`, `max=335`, `grade=D`,
    `releaseCandidateReady=false`.

## Strong Areas Already Present

Do not rewrite these. Harden around them.

- Task lifecycle has a canonical Rust enum and transition guard:
  `src-tauri/src/task/status.rs`.
- Task planning/replanning has DAG validation, branch validation, file/symbol
  lane checks, and rework splicing:
  `src-tauri/src/task/planner.rs`, `src-tauri/src/task/replan.rs`.
- Task graph persistence exists:
  `src-tauri/src/task/manager.rs`,
  `src-tauri/src/persistence/task_repo.rs`.
- Event Bus has typed events, durable append, retry buffer, and replay:
  `src-tauri/src/event_bus/*`.
- Visible agent launches avoid `-p` / `--print` and use PTY shell commands:
  `src-tauri/src/agent/interactive.rs`,
  `src-tauri/src/control/pane_fleet.rs`.
- Worktree and merge plumbing exist:
  `src-tauri/src/git/worktree.rs`, `src-tauri/src/git/merge.rs`.
- Symbol ownership is now a real subsystem:
  `src-tauri/src/symbol_ownership/mod.rs`.
  It has ranges, leases, confidence tiers, shared-file rules, parser/diff-hunk
  extraction, and conservative dispatch collision checks.
- Mux evidence is currently strong:
  `.codex-auto/performance/mux-performance-smoke.json` and
  `.codex-auto/performance/mux-live-restore-smoke.json` are current and passed.

## P0 World-Release Blockers

### P0-1 Durable orchestration transaction/outbox

Problem:

`run_step` / `run_step_visible` mutate task graph, file lanes, symbol lanes,
events, pane spawn state, and merge status as separate effects. A crash between
effects can leave the system in a false state: task running with no pane, merge
committed but task not done, lock held after failure, or event shown live but not
durable.

Required design:

- Add an orchestration transaction/outbox layer around:
  `src-tauri/src/control/loop_ports.rs`.
- Commit these together where possible:
  task transition, ownership mutation, event enqueue, pane binding, merge
  intent/status, cost ledger update.
- Where external side effects cannot be inside the transaction, record
  `pending_external_effect` first, execute, then mark `applied` or
  `needs_reconcile`.

Acceptance:

- Crash after task persist but before pane spawn recovers to
  `needs_reconcile`, not stale `running`.
- Crash after merge commit but before task done recovers idempotently.
- Event replay after restart matches durable task/lock/merge state.
- New verifier: `scripts/verify-orchestrator-crash-recovery.mjs`.

### P0-2 Task-aware leased file ownership

Problem:

Symbol ownership is now strong, but file ownership can still leak or duplicate.
`FileOwnership::assign` pushes unconditionally, `release` removes a single
matching claim, and current loop release is tied mainly to merged tasks. Failed,
reworked, crashed, or escalated tasks can leave stale file locks.

Required design:

- Replace simple file ownership claims with task-aware leased claims.
- Add persistence for file claims.
- Add dedupe by `{task_id, agent_id, pattern}`.
- Add `release_for_task`, `release_for_agent`, lease expiry, and failure-path
  cleanup.
- Keep file-level ownership as the conservative fallback under symbol ownership.

Acceptance:

- Duplicate dispatch cannot duplicate file locks.
- Failed/escalated/rejected/reworked tasks release or reconcile file claims.
- Restart reloads file claims and expires stale leases.
- Rust tests cover duplicate assign, retry, merge release, failure release.

### P0-3 Durable merge queue and immutable merge intent

Problem:

The merge queue is in-memory, and `aether.review.approve` currently accepts
repo/source/target at approval time. That is not strong enough for a world-facing
autonomous merge claim.

Risks:

- Restart loses queued/in-flight merge intent.
- Multiple controllers can have separate merge queues.
- A local MCP caller with access could approve an existing intent id with
  altered repo/source/target parameters.

Required design:

- Add persistent merge intents:
  `src-tauri/src/persistence/merge_repo.rs` plus migration.
- Store immutable fields at request time:
  `intent_id`, `repo_path`, `source_branch`, `target_branch`, source/target OIDs,
  author/reviewer ids, gates digest, task id, created_at.
- Change review approval shape:
  `review.approve(intentId, verdict/gates)` only.
  It must not accept repo/source/target overrides.
- Add idempotency key:
  `{task_id, source_oid, target_oid}`.
- States:
  `queued`, `reviewing`, `ready_to_merge`, `merging`, `merged`, `conflict`,
  `rejected`, `cleanup_failed`, `needs_reconcile`.

Acceptance:

- Approval with altered repo/source/target fails.
- Restart preserves pending merge intents.
- Already-merged target is detected idempotently.
- New verifier:
  `scripts/verify-merge-idempotency.mjs`.
- New security verifier:
  `scripts/verify-security-mcp-merge-intent-binding.mjs`.

### P0-4 Backend command-risk enforcement

Problem:

Risk classification lives largely in frontend shell-safety UI. Backend routes can
still write raw terminal input through REST, MCP, Tauri IPC, and PTY pathways.
Frontend "Run anyway" is not a hard safety boundary.

Required design:

- Move destructive-command policy into Rust.
- Apply the same policy to:
  REST session input, MCP `safeInput` / pane input, Tauri terminal input,
  native terminal input commit, AI-steer terminal injection.
- Frontend confirmation should mint a short-lived approval id.
- Backend consumes approval id once and writes audit evidence.
- Catastrophic operations remain auto-denied unless explicitly within an owned
  worktree and approved by policy.

Acceptance:

- Destructive command via MCP/REST/Tauri is denied without approval id.
- Approval id cannot be replayed.
- Policy result is durable and visible in evidence.
- New verifier:
  `scripts/verify-security-backend-command-risk.mjs`.

### P0-5 Scoped local authority, not one broad bearer token

Problem:

The local API has useful protections: loopback binding, bearer auth,
constant-time comparison, CORS allowlist, rate limits, one-shot WS tickets, and
sidecar token ACL hardening. But a compromised bearer token still grants broad
control over PTY, MCP mutation, git/worktree, agent spawn, scrollback, shutdown,
and merge surfaces.

Required design:

- Default-deny governance with scoped principals:
  `read_only`, `pty_input`, `mcp_mutate`, `agent_spawn`, `merge`, `shutdown`,
  `sidecar_admin`.
- Separate sidecar token from MCP/control token.
- Rotate tokens on restart or explicit operator reset.
- Do not log full generated tokens.
- Prefer DPAPI/Credential Manager or named pipe ACLs for local secrets.
- Add explicit startup ACL verification.

Acceptance:

- Read-only token cannot mutate.
- Shutdown denied unless token has shutdown scope.
- Sidecar token cannot call merge/MCP mutating tools.
- New verifier:
  `scripts/verify-security-api-authz.mjs`.
- New verifier:
  `scripts/verify-security-token-acl.mjs`.

### P0-6 Sidecar-owned visible loop panes

Problem:

Visible loop agents can render in panes, but PaneFleet still has in-process PTY
paths. That is not tmux-grade durability. If UI/app crashes while the sidecar
survives, task recovery can incorrectly collapse running/review tasks and spawn
duplicates.

Required design:

- Introduce `VisiblePtyRuntime`:
  `spawn`, `subscribe_output`, `resize`, `close`, `list`, `attach`, `heartbeat`.
- Use sidecar-backed implementation first.
- Keep in-process fallback but mark it `durability_degraded`.
- Persist pane bindings:
  `task_id`, `agent_id`, `terminal_id`, `backend`, `status`, `last_heartbeat`,
  `presentation`, `worktree`, `completion_mode`.
- On restart, reconcile sidecar terminal list before re-dispatching tasks.

Acceptance:

- Loop-dispatched agent pane appears in sidecar `list`.
- App/WebView restart reattaches without duplicate agent spawn.
- Killed child moves pane/task to `lost` or `needs_reconcile`.
- New verifier:
  `scripts/verify-loop-pane-sidecar-recovery.mjs`.

## P1 Hardening Work

### P1-1 Complete symbol ownership beyond current core

Current:

- Range-based symbol ownership exists.
- Parser and diff-hunk tiers exist.
- Shared-file confidence rules exist.
- Focused Rust tests pass: `47 passed`.

Remaining:

- Backend LSP `documentSymbol` tier is deferred.
- File watcher / tool-event auto-refresh is deferred.
- Live MCP proof for `claim_from_diff` / `claim_from_source` still needs current
  token/app evidence.
- Frontend conflict UX is not consuming `symbol_claims` / `symbol_conflicts`.
- Persisting task symbols and active claim snapshots is still incomplete.

Required:

- Add backend LSP request/response correlation and headless `didOpen` /
  `didChange`.
- Add watcher/tool-event refresh.
- Persist symbol intents/claims needed for restart and audit.
- Show symbol, range, confidence, owner, expiry, and conflict severity in UI.
- Inject active symbol claims into new agent prompts and steering.

Acceptance:

- Same-file disjoint symbols show `parallel_safe`.
- Overlapping exact symbols block.
- Diff-hunk uncertainty warns at runtime and serializes at dispatch.
- Shared config/schema files require LSP to unlock symbol parallelism.
- Visual proof shows badges and click-to-editor range.

### P1-2 Backend-authoritative agent and pane lifecycle

Problem:

The UI still down-maps canonical states such as `waiting_approval`, `blocked`,
`running_tests`, and `spawning` into older labels. Interactive session managers
also use raw strings and have no durable heartbeat.

Required:

- Use `AgentRunStatus` end-to-end.
- Persist agent sessions:
  `agent_id`, `task_id`, `runtime`, `status`, `pane_id`, `worktree`,
  `last_heartbeat`, `started_at`, `ended_at`, `blocking_reason`.
- Add pane lifecycle:
  `spawning`, `attached`, `ready`, `running`, `exited`, `spawn_failed`, `lost`,
  `recovered`, `needs_reconcile`.
- UI should render exact state, next actor, recovery action, and evidence ids.

Acceptance:

- Missing heartbeat moves from `running` to `lost`/`blocked`.
- UI never shows stale `running` after killed process.
- Stop/select/focus route to the correct runtime path.

### P1-3 Server-derived cost and active-agent authority

Problem:

Some orchestration paths accept caller-supplied `activeAgents`. For a robust
system, the backend must derive active fleet size from persisted sessions and
pane bindings.

Required:

- Cost Manager reads active sessions/panes from backend state.
- MCP cannot lie about active agent count.
- Cost ledger is durable.
- Spawn decisions produce typed blocker reasons.

Acceptance:

- `verify-cost-cap-authority.mjs` proves MCP cannot bypass the cap.
- Restart preserves active count or reconciles unknowns before spawning.

### P1-4 Context Store and Event Bus consistency

Current:

- Event Bus has durable append and replay.
- Context Store writes shared decisions and broadcasts changes.

Gaps:

- Context Store mutates memory before persistence succeeds.
- Some events are durable-only, while UI live delivery uses different paths.
- Event replay is not yet the shared brain proof for restart.

Required:

- Persist-before-memory or transactional memory update for Context Store.
- One durable live broadcaster for all events.
- IPC `event_since` and `event_by_channel_since`.
- Shared brain snapshots contain active claims, decisions, blockers, validations,
  and evidence refs, not raw logs.

Acceptance:

- DB write failure cannot leave memory and disk divergent without a blocker.
- UI receives FileLocked/FileReleased/EscalationRaised live and via replay.
- `verify-shared-brain-live.mjs` proves restart replay.

### P1-5 Frontend cockpit truth and non-engineer clarity

Current:

- Agent Inspector, Decision Inbox, Review Queue, Context Panel, SCM, metrics,
  and panes exist.

Gaps:

- Orchestrator panel is mostly observation, not operator command.
- Review readiness is inferred locally from session/file heuristics.
- Decision Inbox language conflicts with v2 auto-decision model.
- Critical labels are often terse, tiny, uppercase, or chip-only.
- Non-engineers cannot reliably answer:
  "What is blocked, who owns it, can it merge, and what happens next?"

Required:

- Backend-backed readiness:
  review branch result, gate list, merge intent, merge outcome, conflict reason,
  rollback availability.
- Rename or split Decision Inbox:
  `Exceptions` / `Overrides` for v2 auto-decision mode.
- Plain-language status banner:
  "1 agent blocked by login; 2 files need review; merge is not ready because
  tests have not passed."
- Symbol conflict UI:
  file, symbol, range, confidence, severity, owner, expiry.
- Responsive visual proof at 320px, 480px, desktop.

Acceptance:

- Browser/Tauri screenshots for running, blocked, review-ready, conflict,
  backend-unavailable.
- No clipped critical text.
- Stop/focus/select actions call correct runtime path.

## P1 Security and Trust Work

### Security S1 Merge approval binding

Covered in P0-3. Treat as security critical.

### Security S2 Agent sandbox and environment control

Required:

- Agents may run only in registered worktrees unless explicitly in a trusted
  manual session.
- Deny repo-root autonomous cwd.
- Strip environment by allowlist.
- Provider-specific tool/sandbox policies for Claude, Codex, Gemini.
- Codex autonomous `--ask-for-approval never` requires a matching backend
  sandbox and policy proof.

Verifier:

- `scripts/verify-security-agent-sandbox.mjs`.

### Security S3 Auto-repair containment

Risk:

Output-triggered auto-repair can be shaped by terminal text and can create
branches/commits. The prompt says not to commit while implementation commits.

Required:

- Keep disabled by default.
- Trusted pane only.
- Explicit enable.
- No auto-commit unless review gates and tests pass.
- Terminal text alone cannot trigger production repair.

Verifier:

- `scripts/verify-security-auto-repair.mjs`.

### Security S4 Tauri surface narrowing

Required:

- Remove broad localhost wildcard CSP for production.
- Replace `$HOME/**` asset scope with selected project roots.
- Assert minimal capabilities.

Verifier:

- `scripts/verify-security-tauri-surface.mjs`.

### Security S5 Supply chain green

Current audit noted supply-chain artifact as failing/stale, with npm
vulnerabilities and Rust advisory concerns. Treat this as release-blocking until
freshly verified.

Required:

- Frozen `pnpm-lock.yaml`.
- Locked Cargo audit.
- `cargo-deny` or equivalent policy.
- SBOM.
- Sidecar binary hash and integrity.
- Documented reachability/waiver only for explicitly accepted non-runtime risks.

Verifier:

- `scripts/verify-supply-chain.mjs`.
- `scripts/verify-supply-chain-locked.mjs`.

## P2 Release Evidence System

### Current release truth

Current artifact:

- `.codex-auto/quality/release-quality-score.json`
- `score=35`, `total=118`, `max=335`, `grade=D`
- `releaseCandidateReady=false`

This does not mean the product idea is weak. It means the world-release proof
chain is not coherent and current.

### Evidence issues

- `.codex-auto/promotion-gate.json` is stale and contradicts the current score.
- `.codex-auto/risk-register.json` has contradictory top-level vs nested
  closure state.
- `.codex-auto/quality/final-goal-audit.json` is stale/blocked.
- Runtime hygiene is failing/stale.
- Live command/multipane/recovered/process-reconnect evidence is failing/stale.
- Real OS sleep/resume remains external/host blocked.
- Authenticated AI CLI prompt smoke still requires explicit token-spend consent.

### Required world-release gate

Add a single orchestrator:

```powershell
pnpm verify:world-release
```

It must write:

```text
.codex-auto/quality/world-release-gate.json
```

It must reconcile:

- Current git cleanliness.
- Fresh build/test/lint.
- Fresh security/supply-chain.
- Fresh release doctor.
- Fresh mux/live pane/reconnect evidence.
- Fresh shared brain/autonomy loop proof.
- Fresh symbol ownership live proof.
- Fresh UI/browser proof.
- Explicit external/operator gates.
- Stale artifact rejection.

Minimum additional scripts:

- `scripts/verify-world-release.mjs`
- `scripts/verify-world-live-panes.mjs --agents 3`
- `scripts/verify-world-soak.mjs --cycles 25 --agents 4`
- `scripts/verify-world-faults.mjs`
- `scripts/verify-world-evidence-reconcile.mjs`
- `scripts/verify-security-api-authz.mjs`
- `scripts/verify-security-mcp-merge-intent-binding.mjs`
- `scripts/verify-security-backend-command-risk.mjs`
- `scripts/verify-security-agent-sandbox.mjs`
- `scripts/verify-security-token-acl.mjs`
- `scripts/verify-security-tauri-surface.mjs`

## Soak and Fault-Injection Matrix

World release requires deterministic failure proof, not only happy-path tests.

### Soak

Run at least:

- 25 autonomous cycles.
- 4 concurrent agents.
- Planner -> workers -> reviewer -> merge.
- Mixed success/failure/rework tasks.
- No stale locks.
- No orphan panes.
- No runaway cost.
- No event/task/claim drift after restart.

Artifact:

```text
.codex-auto/quality/world-soak.json
```

### Fault injection cases

Mandatory cases:

- CLI spawn failure.
- PTY detach.
- Sidecar restart.
- Killed child process.
- Missing/expired API token.
- Blocked port.
- DB busy/write failure.
- Disk-full simulation or write-denied path.
- App restart after task running.
- App restart during review.
- Crash after merge commit before task done.
- Stale branch.
- Merge conflict.
- Failing tests.
- Agent edits undeclared files/symbols.
- Event append failure after live UI event.

Expected behavior:

- No silent PASS.
- No stale `running`.
- No duplicate merge.
- No duplicate agent spawn.
- No unreleased file/symbol lock.
- Typed blocker or `needs_reconcile` with recovery action.

## Recommended Implementation Order

1. Freeze truth and gates.
   - Add `world-release-gate.json` and stale artifact reconciliation.
   - Do not claim production readiness from old promotion/risk artifacts.
2. Security hardening first.
   - Merge intent binding.
   - Rust-side command-risk policy.
   - Scoped local authority.
   - Tauri CSP/asset scope.
3. Durable orchestration core.
   - Transaction/outbox.
   - Durable merge queue.
   - Persistent file/symbol claims.
   - Server-derived cost/active-agent authority.
4. Pane/runtime durability.
   - Sidecar-backed `VisiblePtyRuntime`.
   - Persist pane bindings and heartbeat.
   - Restart reconcile before re-dispatch.
5. Symbol ownership finish.
   - LSP tier.
   - Watcher/tool-event refresh.
   - Persistent active claim snapshots.
   - UI conflict badges and parallel-safe display.
6. UX truth and clarity.
   - Backend-backed review/merge readiness.
   - Exact lifecycle statuses.
   - Non-engineer summaries.
   - Visual/browser proof.
7. Soak/fault-injection.
   - 25-cycle fleet soak.
   - Fault matrix.
   - Evidence reconciliation.
8. Fusion Coordinator only after the above is stable.
   - Advisory-only first.
   - No merge bypass.
   - No visible pane fan-out for pure reasoning advisors.

## Claude / Implementer Handoff Prompt

```text
You are working in <repo>.

Read:
- docs/specs/AETHER_WORLD_RELEASE_HARDENING_AUDIT_2026-06-23.md
- docs/specs/IMPLEMENTATION_PLAN_2026-06-23.md
- docs/specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md
- docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md

Do not treat Aether as a scaffold. It already has real orchestration,
visible-pane, merge, event, context, cost, and symbol-ownership subsystems.
Your task is world-release hardening.

Prioritize in this order:
1. Security hardening: immutable merge intent, Rust-side command-risk policy,
   scoped local authority, Tauri CSP/asset scope, supply-chain green.
2. Durable orchestration: transaction/outbox, persistent file/symbol claims,
   durable merge queue, server-derived cost authority.
3. Pane durability: sidecar-backed VisiblePtyRuntime and persisted pane bindings.
4. Symbol finish: LSP tier, watcher/tool refresh, UI symbol conflict badges.
5. UX truth: backend-backed review/merge readiness and exact lifecycle states.
6. World-release gate: soak, fault injection, live panes, evidence reconcile.

Do not claim production readiness until `pnpm verify:world-release` writes a
fresh passing `.codex-auto/quality/world-release-gate.json`.

Keep changes sliced. Each slice must include tests or machine-readable proof.
Do not push or open PRs unless explicitly asked.
```

## Final Product Claim Boundary

Safe claim today:

> Aether has a real AI-team cockpit substrate with visible PTY agents, task
> graph orchestration, event/context sharing, worktree/review/merge plumbing,
> and an advancing file/symbol ownership model.

Unsafe claim today:

> Aether is ready for world release as a fully durable, secure, autonomous
> multi-agent engineering OS.

Target claim after this hardening:

> Aether can run multiple AI agents as a durable local engineering team, keep
> task/context/event/ownership state coherent across crashes and restarts,
> prevent unsafe local control paths, prove function-level conflict behavior,
> survive long-run/fault-injection tests, and produce auditable review/merge
> outcomes suitable for a public release.
