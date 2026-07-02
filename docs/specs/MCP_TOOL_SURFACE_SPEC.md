# Aelyris MCP Tool Surface Spec (`aelyris.mcp.v1`)

> ⚠️ **Merge-model update (2026-06-15) — read first.** The authoritative
> requirements ([docs/requirements.md](../requirements.md)) describe a **bounded
> autonomy** model: agents can dispatch, review, and merge through **gated controls**,
> and autonomy is bounded by verifier gates (this is alpha). A Reviewer agent
> (reviewer ≠ implementer) can advance `request_merge` to `done` only after all
> quality gates are green, and tool-approval can be auto-decided within a policy
> envelope that keeps an auto-deny floor for catastrophic/irreversible ops.
>
> **2026-07-02: §3 and §4 regenerated from the implementation.** An audit found
> the previous §3 catalog (~13 designed tools) and the previous §4.4 invariant
> ("no MCP tool can decide a merge") no longer matched the shipped code. §3 is
> now generated from `src-tauri/src/api/mcp.rs`; §4 now describes the shipped
> bounded-autonomy merge model (durable OID-bound merge intents +
> reviewer-authority verbs). The earlier "never returns done / human clicks
> grant / never merges main" mechanics are historical for the *merge* axis.

Status: Aligned to implementation (regenerated 2026-07-02)
Audience: backend (Rust) + orchestration engineering
Scope: the **AI-facing** projection of the Aelyris Control API.

> **SCOPE NOTE:** §3 and §4 of this document describe the tool surface that is
> **implemented** in `src-tauri/src/api/mcp.rs` and served over the daemon's
> `/mcp/*` routes. File references are to the current tree; line numbers are
> intentionally omitted because they drift — use the cited symbol names. The
> runtime source of truth for the catalog is `GET /mcp/tools/list`.

---

## 1. Purpose & placement

### 1.1 The two-faces model

Aelyris's north star is a single backend **Aelyris Control API** (a capability /
intent layer). Two clients ("faces") project onto it:

| Face | Consumer | Transport | Status |
|------|----------|-----------|--------|
| Face 1 — Cockpit UI | Human operator | Tauri IPC (`invoke`) | Exists. The `tauri::generate_handler![...]` block in `src-tauri/src/lib.rs` registers 212 IPC handlers as of 2026-07-02 (count drifts; the block is the source of truth). |
| **Face 2 — Orchestrator AI** | An orchestrator model (or the operator's AI CLI session) | **`aelyris` MCP surface** | Implemented. `src-tauri/src/api/mcp.rs` defines the catalog (`tool_names`), the schemas (`tools_list`), and the dispatcher (`tools_call`); `src-tauri/src/api/mod.rs` wires the `/mcp/contract`, `/mcp/tools/list`, `/mcp/tools/call`, and `/mcp` (JSON-RPC) routes. |

The capability layer is built **once**; both faces consume it. A tool in this
catalog is not new business logic — it is a thin MCP adapter over a shared
backend `fn` (mostly under `src-tauri/src/control/`), and most capabilities
also have a Tauri IPC binding for Face 1 (e.g. the merge verbs are mirrored by
the four commands in `src-tauri/src/ipc/merge_commands.rs`).

### 1.2 Who connects

Two deployment shapes, same tool catalog:

1. **Operator-attached** — the operator's existing AI CLI session (already a
   long-lived process; see `AgentCli` at `src-tauri/src/agent/interactive.rs`)
   adds `aelyris` as an MCP server in its own config. The operator drives
   Aelyris from the same chat they already use.
2. **Embedded orchestrator** — an in-app orchestrator process that Aelyris
   points at the `aelyris` MCP surface. This is the "dispatch a fleet, poll,
   request a gated merge" loop (worked example in §6).

In both shapes the MCP surface is a **face over the capability layer**, never a
second source of truth. The session truth source remains
`rust-pty-manager` / `rust-mux-manager` exactly as the daemon contract claims
(the `claims` block in `contract()`, `src-tauri/src/api/mcp.rs`).

---

## 2. Transport

### 2.1 Implemented transport: loopback HTTP (+ JSON-RPC endpoint)

The transport implemented today is **loopback HTTP JSON**: the contract
endpoint reports `"transport": "local-http-json"` (`contract()` in
`src-tauri/src/api/mcp.rs`). Two shapes are served:

- Plain HTTP: `GET /mcp/contract`, `GET /mcp/tools/list`, `POST /mcp/tools/call`.
- Native MCP JSON-RPC: `POST /mcp` handles `initialize` / `tools/list` /
  `tools/call` / `ping` (`mcp_rpc()`, protocol version `2024-11-05`).

stdio remains a reasonable future option for local single-operator use (no
port, no token, OS process boundary as trust boundary) but is **not
implemented**; do not claim it.

### 2.2 Auth: the daemon token pattern

The HTTP transport needs no new auth machinery — it reuses the daemon's
existing pattern (all in `src-tauri/src/api/mod.rs`):

| Concern | Existing mechanism |
|---------|--------------------|
| Bearer token | `AELYRIS_API_TOKEN` env var; random token generated + logged once if unset |
| Constant-time compare | `subtle::ConstantTimeEq` |
| Loopback bind only | server binds `127.0.0.1` only |
| Per-IP rate limit | `RateLimiter` token bucket, REST + WS buckets |
| Session cap | `MAX_PTY_SESSIONS = 32` |
| Sidecar token-file precedent | `aelyris-pty-server.token` file (`src-tauri/src/pty_sidecar.rs`) |

### 2.3 Loopback safety rules

- Bind `127.0.0.1` only — never `0.0.0.0`.
- Require `Authorization: Bearer <token>` on every call (`auth_middleware`,
  `src-tauri/src/api/mod.rs`).
- Reuse the existing typed error envelope (§5).
- The MCP tool surface is **single-token, single-tenant** — same assumption the
  rate-limit code documents.

---

## 3. Tool catalog (`aelyris.mcp.v1`)

> **Generated from `src-tauri/src/api/mcp.rs` on 2026-07-02.** The catalog
> (`tool_names()`), the advertised schemas (`tools_list()`), and the dispatch
> handlers (`tools_call()`) are locked together by the drift test
> `catalog_and_schemas_list_exactly_the_same_verbs` in the same file. The
> runtime source of truth is `GET /mcp/tools/list`; if this table and the
> running daemon disagree, the daemon wins.

**63 verbs** as of 2026-07-02: 5 unprefixed terminal/mux verbs plus 58
`aelyris.*` verbs.

**Face notes column** reflects the `safety` annotation each schema carries in
`tools_list()`:

- **FREE** — the orchestrator may call it directly; it mutates only isolated /
  observable coordination state (a worktree, a claim, a graph row, a stream).
- **GATED** — the call is bounded by a policy engine, a durable intent store,
  or a live cost cap; it cannot directly perform the privileged end action.
- **GATED (observe-only)** — read-only view of pending decisions
  (`GATED_OBSERVE_ONLY` in code).
- **REVIEWER AUTHORITY** — the verb **is** a decision: it resolves a durable
  merge intent (approve → real gated git merge, reject → resolved without
  merging). See §4 for the exact boundaries.
- The five terminal/mux verbs carry no `safety` field in code; their notes
  describe their behavior directly.

Additionally, **every** verb dispatched through `tools_call()` first passes the
P5 governance choke point (`state.governance.authorize(actor, verb)`); a policy
denial is durably audited and returned as a generic 403 (`ApiError::Forbidden`).

### 3.1 Terminal (2)

| Verb | Purpose | Key params | Face notes |
|------|---------|-----------|------------|
| `terminal.list` | List live native PTY sessions. | — | Read-only. |
| `terminal.capture` | Capture bounded scrollback from a live PTY session. | `sessionId`; opt `lines` (1–10000), `clean` | Read-only, byte/line-capped. |

### 3.2 Mux (3)

| Verb | Purpose | Key params | Face notes |
|------|---------|-----------|------------|
| `mux.workspaces.list` | List Rust mux workspaces and pane counts. | — | Read-only. |
| `mux.workspace.get` | Return the Rust-owned mux graph for one workspace. | `workspaceId` | Read-only. |
| `mux.workspace.safeInput` | Send bounded input to all live panes in a workspace. | `workspaceId`, `text` (≤1 MiB); opt `approvalId` | Mutating, command-risk gated (P0-4): a `review`-classified command is refused without an `approvalId` minted for that exact command + target set; `deny` (destructive) is always refused. |

### 3.3 Worktree (5)

| Verb | Purpose | Key params | Face notes |
|------|---------|-----------|------------|
| `aelyris.worktree.validate` | Validate an orchestrator worktree branch name. | `branchName` | FREE, read-only. |
| `aelyris.worktree.predictPath` | Predict the isolated worktree path for a branch. | `repoPath`, `branchName` | FREE, read-only. |
| `aelyris.worktree.list` | List git worktrees for a repository. | `repoPath` | FREE, read-only. |
| `aelyris.worktree.create` | Create an isolated agent worktree. | `repoPath`, `branchName` | FREE, mutating (isolated worktree only, never `main`'s working tree). |
| `aelyris.worktree.remove` | Remove an isolated agent worktree. | `repoPath`, `worktreeName`; opt `deleteBranch` | FREE, mutating (isolated worktree only). |

### 3.4 Fleet & agent runtime (6)

| Verb | Purpose | Key params | Face notes |
|------|---------|-----------|------------|
| `aelyris.fleet_status` | Read the unified native-owned agent fleet snapshot. | — | FREE, read-only. |
| `aelyris.route_agent` | Route a prompt to the recommended coding model profile. | `prompt`; opt `budgetRemaining` | FREE, read-only. |
| `aelyris.spawn_agent` | Spawn a **headless** implementer agent (`control::agent::start_headless`, `src-tauri/src/control/agent.rs`). | `prompt`, `cwd`; opt `model`, `allowedTools`, `resumeId` | GATED: enforces the live cost cap (BR7, `cost.guard_spawn`) and refuses at the agent cap. **Headless only** — visible interactive panes are a different path (Tauri IPC `spawn_interactive_agent`, `src-tauri/src/ipc/interactive_commands.rs`); see `VISIBLE_AGENT_PANE_RUNTIME_SPEC.md` for that runtime boundary. |
| `aelyris.stop_agent` | Stop a running headless agent session by id. | `sessionId` | GATED (headless sessions only). |
| `aelyris.pane_send_input` | Send bounded input to a live pane/terminal id. | `terminalId`, `text` (≤1 MiB); opt `approvalId` | FREE annotation in code, but command-risk gated (P0-4) exactly like `mux.workspace.safeInput` — this is the agent-injection path the gate exists to catch. |
| `aelyris.agent_diff` | Read an agent-owned GhostDiff layer without mutating files. | `sessionId`; opt `path`, `against` (`base`\|`target`), `targetBranch` | FREE, read-only. |

### 3.5 Agent coordination (4)

| Verb | Purpose | Key params | Face notes |
|------|---------|-----------|------------|
| `aelyris.agent.report_activity` | Report what an agent is touching right now (file/symbol/action); publishes `agent_activity` (BR5). | `sessionId`, `action`; opt `file`, `symbol` | FREE, mutating coordination state. |
| `aelyris.agent.report_blocker` | Report an agent is stuck; marks it blocked and publishes `blocker_raised` (BR5). | `sessionId`, `summary`; opt `needs` | FREE, mutating coordination state. |
| `aelyris.agent.steer_avoid` | Typed steer: tell a live agent to avoid symbols other agents currently own, derived from the live symbol-ownership map (not raw pane text). | `sessionId`; opt `files` | FREE. Errors if the target is not a live agent; publishes `steer_avoid`. |
| `aelyris.agent.activity` | Read the whole fleet's live activity snapshot. | — | FREE, read-only. |

### 3.6 Task graph, orchestrator & supervisor (6)

| Verb | Purpose | Key params | Face notes |
|------|---------|-----------|------------|
| `aelyris.task.create` | Create a Task Graph node (BR4); `owner` is the implementer identity used by the reviewer≠implementer merge gate; binds source/target branches. | `id`, `title`; opt `description`, `owner`, `model`, `priority`, `dependencies`, `outputs`, `sourceBranch`, `targetBranch` | FREE, mutating task state. |
| `aelyris.task.list` | List every Task Graph node with lifecycle status, owner, dependencies, branch bindings. | — | FREE, read-only. |
| `aelyris.task.transition` | Transition a task to a new lifecycle state (lifecycle-validated). | `id`, `to` (pending/ready/running/blocked/review/done/failed) | FREE, mutating task state. |
| `aelyris.orchestrator.plan` | Read the next scheduling decision (dispatch set + loop state). | opt `activeAgents` | FREE, read-only. |
| `aelyris.orchestrator.step` | Drive one autonomy step (BR9): reassign crashed tasks, dispatch ready tasks as headless agents, and **merge** review-passing tasks into their target branch when gates are green and reviewer ≠ owner; `gateCommands` decide the objective gates mechanically in each worktree. | `repoPath`, `reviewerId`; opt `activeAgents`, `gates`, `gateCommands` | REVIEWER AUTHORITY — this verb can perform real merges via the review path (`review::review`, `src-tauri/src/review/mod.rs`, which blocks a self-review). |
| `aelyris.supervisor.health` | Read the Architect-level health verdict of the autonomy loop with machine-readable directives. | opt `activeAgents` | FREE, read-only. |

### 3.7 Events (3)

| Verb | Purpose | Key params | Face notes |
|------|---------|-----------|------------|
| `aelyris.event.recent` | Recent fleet coordination events across all channels (bounded ring). | — | FREE, read-only. |
| `aelyris.event.by_channel` | Recent events on one channel. | `channel` (planning/backend/frontend/database/review/system) | FREE, read-only. |
| `aelyris.event.since` | No-loss cursor subscribe (BR5/P3): every event with `seq > afterSeq`; survives restart. | opt `afterSeq`, `limit` (≤1000) | FREE, read-only. Preferred for reliable orchestration. |

### 3.8 Context / ADR (4)

| Verb | Purpose | Key params | Face notes |
|------|---------|-----------|------------|
| `aelyris.context.set` | Set a project decision in the shared Context Store / ADR (BR6); publishes `decision_changed`; injected into every dispatched agent's prompt. | `key`, `value` | FREE, mutating shared state. |
| `aelyris.context.get` | Read one project decision. | `key` | FREE, read-only. |
| `aelyris.context.all` | The full shared ADR snapshot. | — | FREE, read-only. |
| `aelyris.context.remove` | Remove a project decision; publishes `decision_changed`. | `key` | FREE, mutating shared state. |

### 3.9 Knowledge graph (8)

| Verb | Purpose | Key params | Face notes |
|------|---------|-----------|------------|
| `aelyris.knowledge.add_node` | Add a node (symbol/module) to the code Knowledge Graph. | `id`; opt `kind`, `file` | FREE, mutating graph state. |
| `aelyris.knowledge.add_edge` | Record a dependency edge (`dependent` → `dependency`); unknown endpoints auto-created. | `dependent`, `dependency` | FREE, mutating graph state. |
| `aelyris.knowledge.remove_node` | Remove a node and every edge touching it. | `id` | FREE, mutating graph state. |
| `aelyris.knowledge.remove_edge` | Remove a single dependency edge. | `dependent`, `dependency` | FREE, mutating graph state. |
| `aelyris.knowledge.dependencies` | Direct dependencies of a node. | `id` | FREE, read-only. |
| `aelyris.knowledge.dependents` | Direct dependents of a node. | `id` | FREE, read-only. |
| `aelyris.knowledge.impact` | Blast radius: the transitive dependents of a node. | `id` | FREE, read-only. |
| `aelyris.knowledge.graph` | The whole graph: every node + edge. | — | FREE, read-only. |

### 3.10 Intent bus (4)

| Verb | Purpose | Key params | Face notes |
|------|---------|-----------|------------|
| `aelyris.intent.propose` | Declare an intent **before** acting (pre-fact half of the Event Bus); publishes `intent_declared`. | `agentId`, `proposal`; opt `targets` | FREE, mutating coordination state. |
| `aelyris.intent.list` | Open (still-deliberating) intents. | — | FREE, read-only. |
| `aelyris.intent.all` | Every intent with its status. | — | FREE, read-only. |
| `aelyris.intent.resolve` | Resolve an intent to a terminal status (accepted/rejected/superseded). | `id`, `status` | FREE, mutating coordination state. |

### 3.11 File ownership (4)

| Verb | Purpose | Key params | Face notes |
|------|---------|-----------|------------|
| `aelyris.ownership.assign` | Claim a path pattern for an agent (BR8): exact, `dir/*`, or `dir/**`. | `agentId`, `pattern` | FREE, mutating ownership state; returns resulting conflicts. |
| `aelyris.ownership.owner_of` | The agent that owns a path, if any. | `path` | FREE, read-only. |
| `aelyris.ownership.claims` | All current file-ownership claims. | — | FREE, read-only. |
| `aelyris.ownership.conflicts` | All current cross-agent ownership conflicts. | — | FREE, read-only. |

### 3.12 Symbol ownership (8)

| Verb | Purpose | Key params | Face notes |
|------|---------|-----------|------------|
| `aelyris.symbol.claim` | Claim a symbol range inside a file (finer than file ownership); overlap semantics depend on `confidence` (lsp/parser block, diff-hunk warns). | `claimId`, `agentId`, `path`, `symbol`, `startLine`, `endLine`, `mode`, `confidence`; opt `taskId`, `leaseSecs` | FREE, lease-based mutating state. |
| `aelyris.symbol.refresh` | Extend a live claim's lease (heartbeat). | `claimId`; opt `leaseSecs` | FREE. |
| `aelyris.symbol.release` | Release one claim by id. | `claimId` | FREE. |
| `aelyris.symbol.release_task` | Release all claims a task held (call on merge/fail). | `taskId` | FREE. |
| `aelyris.symbol.claims` | All live symbol claims (expired leases swept). | — | FREE, read-only. |
| `aelyris.symbol.conflicts` | All live cross-agent symbol overlaps (block + warn). | — | FREE, read-only. |
| `aelyris.symbol.claim_from_diff` | Derive claims from a `git diff` (confidence diff-hunk; idempotent per span). | `agentId`, `diff` (≤1 MiB); opt `taskId`, `mode`, `leaseSecs` | FREE. |
| `aelyris.symbol.claim_from_source` | Derive claims by parsing file source (tree-sitter: Rust/TS/TSX) into exact ranges (confidence parser); unparseable input yields no claims (`fallback:true` → file-level exclusivity). | `agentId`, `path`, `source` (≤1 MiB); opt `taskId`, `mode`, `leaseSecs` | FREE. |

### 3.13 Shared brain (1)

| Verb | Purpose | Key params | Face notes |
|------|---------|-----------|------------|
| `aelyris.shared_brain.snapshot` | Unified snapshot: live agents, pane/event activity, file+symbol ownership, unresolved durable merge intents, blockers, project decisions — one backend formatter. | opt `workspaceId` | FREE, read-only. |

### 3.14 Approval (2)

| Verb | Purpose | Key params | Face notes |
|------|---------|-----------|------------|
| `aelyris.request_approval` | Request policy/human approval for a held agent tool call. **This never grants approval**: the watchdog engine decides auto_approved / auto_denied, or the item goes `pending` to the human queue. | `sessionId`, `tool`; opt `summary`, `risk` | GATED. Handler: `control::approval::evaluate` over `WatchdogEngine` (`src-tauri/src/api/mcp.rs`). No `grant` parameter exists. |
| `aelyris.list_pending_approvals` | Observe pending approval items **and** unresolved durable merge intents. Returns `{ pending, mergeIntents, grantToolExposed:false }`. | — | GATED (observe-only). Merge intents are synthesized from the durable store (`state.merge_store.list_unresolved`), not a RAM queue; a read can never cause a merge. |

### 3.15 Review / merge (3)

| Verb | Purpose | Key params | Face notes |
|------|---------|-----------|------------|
| `aelyris.request_merge` | Queue a **durable** merge intent — never merges by itself. Canonicalizes `repoPath` and resolves the source/target branch-tip OIDs at request time; the immutable intent row is bound to those exact commits. Idempotent per (`taskId`, source OID, target OID). | `taskId`, `repoPath`, `sourceBranch`, `targetBranch`; opt `sessionId` | GATED, fail-closed: errors if the durable store (`merge_intent::store::MergeIntentStore`) is not attached — no RAM fallback a restart would lose (P0-3). |
| `aelyris.review.approve` | Reviewer authority: approve a durable merge intent **by id** and perform the real gated git merge (fast-forward/3-way) into its bound target (`control::merge::approve_durable_intent` → `git::perform_merge_bound`). | `intentId`; opt `verdict` (must equal `"approve"`), `gatesDigest` | REVIEWER AUTHORITY. Accepts **only** `intentId`/`verdict`/`gatesDigest` — any other field (including repo/source/target) is rejected explicitly, so a caller can never re-point the merge. Bound tips are re-validated: already-merged target → idempotent `AlreadyMerged`; moved tips → `needs_reconcile`, no merge. Reviewer identity + gates digest are recorded on the row. |
| `aelyris.review.reject` | Reviewer authority: reject a durable merge intent by id, resolving it without merging. | `intentId`; opt `reason` | REVIEWER AUTHORITY. Cannot reject an in-flight (`merging`) or already-resolved intent (conditional durable UPDATE is the arbiter). Rejects unknown fields. |

### 3.16 `AgentRunStatus` (shared name)

The binding design's one shared `AgentRunStatus` enum is implemented in Rust at
`src-tauri/src/agent/status.rs`:
`{ Spawning, Thinking, Coding, RunningTests, WaitingApproval, Blocked, Idle, Done, Error }`.
The agent output monitor (`src-tauri/src/agent/output_monitor.rs`,
`DetectedStatus`) maps detected PTY output states onto it. The MCP tools
serialize whatever the capability layer emits; the TS union on Face 1 must stay
derived from this enum.

---

## 4. Gate enforcement (bounded autonomy)

This is the **critical safety boundary**. The shipped model is **bounded
autonomy**, not "no AI can ever decide":

> Coordination verbs (worktree / fleet / task / events / ownership / context /
> knowledge / intent) are **FREE**.
> Tool approvals stay gated behind the watchdog policy engine + human inbox —
> no MCP verb can grant them.
> Merges flow through **durable, OID-bound merge intents**: an AI Reviewer
> **can** execute a real git merge, but only by approving a stored intent by
> id, only into the commits captured at request time, only with recorded
> reviewer identity and gate evidence, and (on the autonomy-loop path) only
> when reviewer ≠ implementer and the mechanical gates are green.

### 4.1 The three decision authorities

| Authority | What it decides | Where |
|-----------|-----------------|-------|
| Watchdog policy engine | Tool-approval requests: auto-approve / auto-deny / ask-user by rule match | `src-tauri/src/watchdog/engine.rs`, driven from `aelyris.request_approval` and from the per-agent output monitor |
| Human (Face 1) | `pending` tool approvals in the Decision Inbox; merge intents via the mirrored IPC commands (`src-tauri/src/ipc/merge_commands.rs`: `merge_intents_pending`, `request_merge_intent`, `approve_merge_intent`, `merge_diff`) | Cockpit UI |
| Reviewer authority (AI or human) | Durable merge intents: `aelyris.review.approve` / `aelyris.review.reject`, and the loop merge inside `aelyris.orchestrator.step` | `src-tauri/src/control/merge.rs`, `src-tauri/src/review/mod.rs` |

### 4.2 The durable merge-intent lifecycle

```
request_merge                       review.approve                    git
  │  canonicalize repoPath            │  intentId only —                │
  │  resolve source/target OIDs       │  unknown fields rejected        │
  ▼                                   ▼                                 │
[queued] ──(CAS claim_for_merge)──▶ [merging] ── perform_merge_bound ──▶ merged
  │                                   │            (tips re-checked)     │
  │ review.reject                     │ tips moved / repo unreadable     ▼
  ▼                                   ▼                              [conflict]
[rejected]                       [needs_reconcile]
```

- **Immutable binding:** the intent row stores `repo_path` (canonicalized at
  request time), `source_branch`/`target_branch`, and `source_oid`/
  `target_oid`/`merge_base_oid` resolved at request time
  (`aelyris.request_merge` handler; `control::merge::request_durable_intent`).
  Approval reads repo/source/target **from the stored row, never the caller**.
- **OID CAS:** `approve_durable_intent` re-validates the bound tips before
  merging. A target that already contains the source OID resolves idempotently
  (`AlreadyMerged`); moved tips return `StaleTips` and the intent becomes
  `needs_reconcile` — no merge happens on drifted branches
  (`src-tauri/src/control/merge.rs`, `git::perform_merge_bound`).
- **Single in-flight claim:** `store.claim_for_merge` is a conditional durable
  UPDATE — a second concurrent approve of the same intent is refused. The
  in-process `MergeQueue` additionally serializes at most one in-flight merge
  per target branch (`control/merge.rs` tests).
- **Durability, fail-closed:** both `request_merge` and the review verbs error
  when the SQLite-backed `MergeIntentStore` is not attached; there is no RAM
  fallback (P0-3).
- **Recorded evidence:** approval writes `reviewer_id` and the optional
  `gatesDigest` onto the row (`store.record_approval`) before any git work.

### 4.3 Defense in depth

- **Reviewer ≠ implementer:** the autonomy-loop merge path
  (`aelyris.orchestrator.step` → `review::review`,
  `src-tauri/src/review/mod.rs`) refuses a self-review: a task whose reviewer
  equals its implementer (`owner` from `aelyris.task.create`) is Blocked, never
  merged. Mechanical `gateCommands` results are authoritative over a reviewer's
  claimed verdict, so a red branch cannot merge on that path.
- **Spawned agents are themselves gated:** an agent's own tool calls flow
  through the same watchdog evaluation (`watchdog.evaluate(tool_name)` in
  `src-tauri/src/ipc/commands.rs`), emitting approved/denied/manual — a fleet
  dispatched freely cannot escalate past the tool-approval gate.
- **Command-risk gate on injected input:** `aelyris.pane_send_input` and
  `mux.workspace.safeInput` refuse `review`-classified commands without a
  matching `approvalId` and always refuse `deny`-classified (destructive)
  commands (P0-4, `command_risk::gate`).
- **Governance choke point:** every MCP verb passes
  `state.governance.authorize` before dispatch; denials are durably audited and
  returned as a generic 403 (P5, `tools_call` in `src-tauri/src/api/mcp.rs`).
- **Rule mutation is not in the catalog:** watchdog rules live in the
  operator-edited config (`src-tauri/src/watchdog/`); no MCP verb adds or edits
  an auto-approve rule.

### 4.4 Invariants (must hold in tests)

The safety invariant is **not** "no MCP tool can decide a merge" — that was the
earlier v1 gate model and it does not describe the shipped code
(`aelyris.review.approve` → `control::merge::approve_durable_intent` →
`git::perform_merge_bound` performs a real merge). The invariants that must
hold, and that the test suites in `src-tauri/src/api/mcp.rs` and
`src-tauri/src/control/merge.rs` pin, are:

1. **No merge without a stored intent.** The only MCP path to a merge is
   approving an existing durable intent by `intentId`. `aelyris.request_merge`
   never merges (it only creates/returns the queued row), and
   `aelyris.review.approve` rejects every field other than
   `intentId`/`verdict`/`gatesDigest`, so a caller can never supply or re-point
   repo/source/target.
2. **Merges are commit-bound.** Approval merges exactly the OIDs captured at
   request time or does not merge at all: moved tips → `needs_reconcile`;
   already-contained source → idempotent `AlreadyMerged`; repo unreadable →
   `needs_reconcile`.
3. **Approval is attributed.** A successful approve records a non-empty
   `reviewer_id` (and `gatesDigest` when supplied) on the durable row before
   the merge executes; on the autonomy-loop path reviewer ≠ implementer is
   enforced (`review::review` blocks self-review).
4. **At most one in-flight decision per intent, and per target branch on the
   queue.** The CAS `claim_for_merge` refuses a second approve; `MergeQueue`
   refuses a second in-flight merge into the same target.
5. **Tool approvals still have no grant verb.** There is no MCP tool, and no
   tool parameter, by which the orchestrator can transition a
   `permission_required` decision from `pending` to decided. The only writers
   of that transition remain the watchdog engine's auto rules and a human
   action in Face 1 (`aelyris.list_pending_approvals` reports
   `grantToolExposed: false`).

---

## 5. Auth, safety & error model

### 5.1 Typed errors (mirror the daemon)

The MCP surface reuses the daemon's typed error envelope so both faces fail
identically. `ApiError` (`src-tauri/src/api/mod.rs`) serializes as
`{ "error": string, "code": string }` with a stable `code`:

| MCP error code | HTTP status (HTTP transport) | `ApiError` variant | When |
|----------------|------------------------------|--------------------|------|
| `not_found` | 404 | `NotFound` | unknown `sessionId` / `workspaceId` / intent / worktree |
| `bad_request` | 400 | `BadRequest` | invalid branch name, missing arg, unknown approve field, oversized payload |
| `conflict` | 409 | `Conflict` | worktree/branch already exists |
| `unauthorized` | 401 | `Unauthorized` | missing/bad bearer token (HTTP transport) |
| `forbidden` | 403 | `Forbidden` | governance policy denial (P5) or command-risk refusal |
| `rate_limited` | 429 | `RateLimited` | token-bucket exhausted (HTTP transport) |
| `internal` | 500 | `Internal` | lock poisoned, git failure, persistence not attached |

PTY-layer errors are mapped without string-matching via `map_pty_err`
(`src-tauri/src/api/mod.rs`).

### 5.2 Input validation at the boundary

All validation reuses existing, single-source validators (no re-implementation):

- Branch names → `validate_branch_name` (`src-tauri/src/git/worktree.rs`) — the
  one shared branch-name validator.
- Worktree paths → `predict_worktree_path` (`src-tauri/src/git/worktree.rs`) —
  the one shared worktree-path fn.
- Repo paths on the merge path → canonicalized (`std::fs::canonicalize`) and
  directory-checked at request time, then stored immutably on the intent.
- MCP arg coercion → `arg_string` / `arg_string_raw` / `arg_usize` /
  `arg_bool` / `arg_optional_*` (`src-tauri/src/api/mcp.rs`); payload-bearing
  args (`diff`, `source`, pane `text`) are byte-capped at 1 MiB, locked to the
  WS frame bound by the test `input_schema_maxlength_matches_ws_frame_bound`.
- Reviewer verbs additionally hard-reject unknown fields in the handler because
  the dispatcher does not enforce the advertised schema (see §3.15 notes).

### 5.3 Versioned schema

- The implemented contract/schema id is **`aelyris.mcp.server.v1`**
  (`contract()` and `tools_list()` in `src-tauri/src/api/mcp.rs`);
  `aelyris.mcp.v1` remains the forward-compatible umbrella name this document
  uses for the catalog.
- `tools/list` advertises per-tool `inputSchema` (JSON Schema,
  `additionalProperties: false`) plus the `safety` annotation.
- New tool *additions* are minor (v1.x). Removing/renaming a tool, changing a
  safety classification, or changing a return shape is a **major** bump, since
  reclassifying a gate is a safety-relevant change. (This already happened
  once: the merge axis moved from "GATED, never decides" to
  "REVIEWER_AUTHORITY, durable-intent bound" — the change this document's
  2026-07-02 banner records.)
- The `contract` endpoint reports `schema`, `tools`, and the `claims` block
  asserting `webviewRequiredForToolCalls: false` — the MCP face works headless,
  without the React webview.

---

## 6. Worked example: orchestrator dispatching and merging a task

Goal: run one task through the bounded-autonomy loop with the verbs as
implemented. Coordination calls run without human friction; the merge is
durable-intent bound.

```
# 1. Record the world-model decision agents must align to (FREE).
→ aelyris.context.set { key:"auth_method", value:"jwt" }

# 2. Create a task with an implementer identity and branch bindings (FREE).
→ aelyris.task.create { id:"t-auth", title:"build auth module", owner:"agent-impl-1",
                        sourceBranch:"feat/auth", targetBranch:"main",
                        outputs:["src/auth.rs"] }

# 3. Create the isolated worktree and spawn a HEADLESS implementer (GATED by cost cap).
→ aelyris.worktree.create { repoPath:"C:/proj", branchName:"feat/auth" }
→ aelyris.spawn_agent { prompt:"implement the auth module per the ADR",
                        cwd:"C:/proj-worktrees/feat-auth", model:"sonnet" }
← { sessionId:"h-a1", spawned:true }

# 4. Observe without screen-scraping (FREE): fleet, no-loss events, diff overlay.
→ aelyris.fleet_status {}
→ aelyris.event.since { afterSeq: 0 }
→ aelyris.agent_diff { sessionId:"h-a1", against:"target", targetBranch:"main" }

# 5. Coordinate parallel lanes (FREE): claims + typed steer.
→ aelyris.symbol.claim_from_source { agentId:"agent-impl-1", path:"src/auth.rs", source:"..." }
→ aelyris.agent.steer_avoid { sessionId:"h-a1", files:["src/auth.rs"] }

# 6. Request a DURABLE merge intent (GATED — never merges by itself).
→ aelyris.request_merge { taskId:"t-auth", repoPath:"C:/proj",
                          sourceBranch:"feat/auth", targetBranch:"main" }
← { intentId:"merge:t-auth:…", status:"queued",
    intent:{ sourceOid:"abc1234", targetOid:"def5678", ... } }
   # The intent row is immutable and bound to these exact commits.

# 7. Observe pending decisions (GATED, observe-only).
→ aelyris.list_pending_approvals {}
← { pending:[...], mergeIntents:[{ intentId:"merge:t-auth:…", state:"queued" }],
    grantToolExposed:false }

# 8. Reviewer authority resolves the intent (REVIEWER AUTHORITY).
#    Either the loop merges it mechanically when gates are green and
#    reviewer != owner:
→ aelyris.orchestrator.step { repoPath:"C:/proj", reviewerId:"agent-reviewer-1",
                              gateCommands:{ test:["pnpm","test"] } }
#    ... or a reviewer approves the stored intent BY ID (no repo/source/target
#    accepted — they come from the immutable row; moved tips => needs_reconcile):
→ aelyris.review.approve { intentId:"merge:t-auth:…", gatesDigest:"sha256:…" }
← { intentId:"merge:t-auth:…", status:"merged", outcome:{ ... } }

# 9. Clean up (FREE).
→ aelyris.symbol.release_task { taskId:"t-auth" }
→ aelyris.worktree.remove { repoPath:"C:/proj", worktreeName:"feat-auth" }
```

Key takeaways the example demonstrates:
- Steps 1-5, 9 are FREE coordination — the orchestrator runs the whole
  fan-out/observe/steer loop with zero human friction.
- Steps 6-8 are the bounded merge path: the request creates a durable,
  commit-bound intent; only reviewer-authority verbs resolve it; approval is
  attributed (reviewer id + gates digest) and re-validates the bound tips
  before any git mutation. Tool approvals (`aelyris.request_approval`) remain
  decidable only by the watchdog engine or a human — no grant verb exists.
