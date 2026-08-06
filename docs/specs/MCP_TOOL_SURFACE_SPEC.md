# Aelyris MCP Tool Surface Spec (`aelyris.mcp.v1`)

> ⚠️ **Control-authority update (2026-07-13) — read before using this catalog.**
> This file inventories current and historical MCP-facing tools. The target
> cross-face identity, capability, command-envelope, versioning, idempotency,
> cancellation, backpressure, error, and evidence contract is owned by
> `AELYRIS_CONTROL_API_MCP_ULTRA_DESIGN.md`. `FREE`/`GATED` below is not an authorization decision:
> no-human-click is not no-capability. Current HTTP/
> JSON-RPC source and focused verifiers own implemented transport truth; stdio or
> other proposed transport text is not an implemented claim.

> ⚠️ **Merge-model update (2026-08-04) — read first.** The authoritative
> requirements ([docs/requirements.md](../requirements.md)) describe a **bounded
> autonomy** model. `aelyris.orchestrator.step` is implementation-only and stops
> completed work at `Review`; it accepts no reviewer identity, gate commands, or
> raw verdict booleans. The legacy MCP names `aelyris.request_merge` and
> `aelyris.review.approve` remain cataloged only as fail-closed compatibility
> errors. Generic integration is owned by the cockpit's backend-only
> exact-candidate review-and-merge command, while typed Mission acceptance owns
> Mission review/settlement. Earlier request/approve examples below are historical
> unless this update explicitly rewrites them.
> Automated, non-blocking compensating controls and human post-hoc override remain.

Status: Draft / binding design alignment
Audience: backend (Rust) + orchestration engineering
Scope: the **AI-facing** projection of the Aelyris Control API.

> **HARD SCOPE NOTE:** This document is analysis + design only. It maps a proposed
> `aelyris` MCP server onto real backend code. File:line references are to the
> current tree on branch `feat/wu-rt-1-context-lifecycle`. Many catalog entries
> are implemented and locked by MCP catalog/schema drift tests; rows marked
> design-target remain future work and must not be claimed without a matching
> source/gate reference.

---

## 1. Purpose & placement

### 1.1 The two-faces model

Aelyris's north star is a single backend **Aelyris Control API** (a capability /
intent layer). Two clients ("faces") project onto it:

| Face | Consumer | Transport | Status |
|------|----------|-----------|--------|
| Face 1 — Cockpit UI | Human operator | Tauri IPC (`invoke`) | Exists. `src-tauri/src/lib.rs:520-690` registers ~68 commands consumed by the React frontend. |
| **Face 2 — Orchestrator AI** | Opus 4.8 orchestrator (or operator's Claude Code / Codex session) | **`aelyris` MCP server** | **This spec.** Partial precedent exists at `src-tauri/src/api/mod.rs:964-966` (`/mcp/*` routes). |

The capability layer is built **once**; both faces consume it. A tool in this
catalog is not new business logic — it is a thin MCP adapter over an existing
IPC handler or backend `fn`. Where a row says **NEW**, the underlying capability
itself does not yet exist and must be built in the capability layer first (and
then it gets a Tauri IPC binding for Face 1 too).

### 1.2 Who connects

Two deployment shapes, one static tool catalog with a principal-scoped discovery
projection:

1. **Operator-attached** — the operator's existing `claude` / `codex` CLI session
   (already a long-lived process; see `AgentCli` at
   `src-tauri/src/agent/interactive.rs:65`) adds `aelyris` as an MCP server in its
   own config. The operator drives Aelyris from the same chat they already use.
2. **Embedded orchestrator** — an in-app Opus 4.8 orchestrator process that Aelyris
   spawns and points at the `aelyris` MCP server. This is the "dispatch a fleet,
   poll, request a gated merge" loop (worked example in §6).

In both shapes the MCP server is a **face over the capability layer**, never a
second source of truth. The session truth source remains
`rust-pty-manager` / `rust-mux-manager` exactly as the daemon contract already
claims (`src-tauri/src/api/mod.rs:1858-1863`).

For authenticated HTTP clients, the current `Principal` and `Governance` owner
filter `/mcp/tools/list`, JSON-RPC `tools/list`, and `/mcp/contract` to the exact
tools that principal may invoke. The default local operator still sees the full
static catalog. A restricted principal receives no hidden tool names, denial
reasons, policy internals, or unfiltered count, and JSON-RPC initialization uses
name-free scoped instructions. Discovery is not authority: every `tools/call` is
authorized again for the same actor before schema validation and dispatch.

---

## 2. Transport

### 2.1 Recommendation: stdio for local single-operator

The default and recommended transport is **stdio**. Rationale:

- Aelyris is a **local-only**, single-operator desktop app (Tauri). The MCP
  client and server run on the same machine under the same user.
- stdio needs no port, no token, no loopback exposure — the OS process boundary
  is the trust boundary. This is strictly safer than opening another TCP port.
- It matches how `claude` / `codex` already attach MCP servers.

### 2.2 Option: Streamable HTTP (reuse the daemon auth/token pattern)

When the orchestrator is **out-of-process** (embedded Opus running as its own
process, or a remote-but-loopback driver), a **Streamable HTTP** MCP transport is
the fallback. It does **not** need new auth machinery — it reuses the daemon's
existing pattern verbatim:

| Concern | Existing mechanism | File:line |
|---------|--------------------|-----------|
| Bearer token | `AELYRIS_API_TOKEN` env var; random UUID generated + logged once if unset | `src-tauri/src/api/mod.rs:676-689` |
| Constant-time compare | `subtle::ConstantTimeEq` via `ct_eq` | `src-tauri/src/api/mod.rs:710-739` |
| Loopback bind only | `SocketAddr::from(([127,0,0,1], port))` | `src-tauri/src/api/mod.rs:990-992` |
| Per-IP rate limit | `RateLimiter` token bucket, REST + WS buckets | `src-tauri/src/api/mod.rs:336-501` |
| Session cap | `MAX_PTY_SESSIONS = 32` | `src-tauri/src/api/mod.rs:98` |
| Sidecar token-file precedent | `aelyris-pty-server.token` file | `src-tauri/src/pty_sidecar.rs:17` |

The daemon **already exposes a non-webview MCP-shaped HTTP surface** today:
`/mcp/contract`, `/mcp/tools/list`, `/mcp/tools/call`
(`src-tauri/src/api/mod.rs:964-966`, handlers at `1842-1926`). That surface is
read-mostly (`terminal.list`, `terminal.capture`, `mux.workspaces.list`,
`mux.workspace.get`, `mux.workspace.safeInput` — `src-tauri/src/api/mod.rs:1734-1742`).
The `aelyris.mcp.v1` catalog in §3 **supersedes and extends** that prototype with the
full worktree/agent/diff/gate surface.

`mux.workspace.safeInput` and REST `/mux/workspaces/{id}/input` both pass the
authenticated Principal into the one `TerminalInputAuthority` envelope. Neither
surface accepts an actor field; command-risk, approval, target-scope, quarantine,
and held-write semantics remain backend-owned, and the audit records hashes and
result metadata rather than payload text.

`aelyris.pane_send_input` uses the same authenticated Principal and payload-free
audit owner. When a writable WebSocket holds an exclusive controller lease, MCP pane
input must supply that lease's optional `clientId` and the authenticated Principal
must also match; `clientId` is controller scope, never caller identity. Lease failure
precedes command classification and PTY mutation, while the existing Atomic payload,
approval, quarantine, frame-bound, and typed-NACK contracts remain unchanged.

`aelyris.pane.rename` and `aelyris.pane.set_role` apply that same Principal/clientId
lease check after exact terminal-id resolution and before the existing Cockpit-owned
mutation cores. Their audit records only actor, terminal, operation, controller-id
presence, result, and rejection code; the requested pane name, role, bearer, and
controller-id value are never persisted as authority evidence.

`aelyris.spawn_agent`, `aelyris.agent.spawn_visible`, and `aelyris.stop_agent`
retain the authenticated Principal in durable lifecycle evidence while continuing to
use the existing headless/interactive managers and cost gates. Lifecycle audit is
value-minimized: it may identify operation, runtime kind, result, and resulting
session id, but never prompt text, cwd, model/tool payloads, resume/branch values,
environment values, bearer credentials, or provider output.

`aelyris.worktree.create` and `aelyris.worktree.remove` continue to use the existing
Git/control owner. Their audit binds the authenticated Principal to create/remove,
result, delete-branch intent, and a one-way target digest only. Raw repository paths,
branch/worktree names, Git output, credentials, bearer values, and environment values
are excluded. The MCP remove adapter treats `worktreeName` as the branch/name returned
by create/list and routes through the branch-aware removal owner so Git receives the
predicted worktree path.

`aelyris.task.create` and `aelyris.task.transition` keep the Task Manager as the sole
mutation owner and preserve TaskCreated/ReviewRequired/TaskCompleted Event Bus
publication. The authenticated Principal is the initiating actor; task `owner`, model,
priority, dependencies, outputs, branches, title, and description remain task-domain
metadata and never substitute for that identity. Durable authority evidence contains
only operation, result, resulting lifecycle status, publication outcome, and a stable
one-way task digest. If Event Bus publication fails after a durable Task Manager
mutation, the call remains an explicit failure and the audit records that partial
coordination state without replaying the mutation or copying the task/event payload.

`aelyris.ownership.assign` preserves persistence-before-memory ordering in the existing
`OwnershipRepo` and `FileOwnership` owners. The authenticated Principal is the
initiating actor while caller-supplied `agentId` and `pattern` remain assignment-domain
values. Durable authority evidence contains only the operation, result, conflict count,
persistence/memory application state, and a stable one-way assignment digest. Raw
assignee ids, patterns, paths, conflict payloads, bearer values, environment values, and
repository contents are excluded, and a persistence or lock failure is never recorded
as an accepted assignment or replayed for audit.

Manual `aelyris.symbol.claim`, `refresh`, `release`, and `release_task` calls preserve
the existing `SymbolOwnership` staging and `OwnershipRepo` owners. The authenticated
Principal is the initiating actor while claim id, assigned agent/task, path, symbol,
range, mode, confidence, and lease remain claim-domain values. Reserved derived-claim
prefixes, path normalization, exact-versus-inferred conflict semantics, and
persistence-before-memory behavior stay unchanged. Durable authority evidence contains
only operation, result/outcome class and count, persistence/memory application state,
and a stable one-way claim/task digest; raw targets and conflict payloads are excluded.
Derived diff/source ingestion remains a separately bounded adapter because it accepts
large source payloads and owns reconciliation semantics beyond the manual lifecycle.

`aelyris.symbol.claim_from_diff` and `claim_from_source` now retain that same
authenticated Principal while continuing to delegate parsing and transactional
reconciliation to the existing extractors, `SymbolOwnership`, and `OwnershipRepo`.
The 1 MiB bound, raw input preservation, path normalization, reserved prefixes,
diff-hunk warn semantics, parser exact-block semantics, source fallback, and per-origin
replacement behavior remain unchanged. Audit evidence is aggregate-only: operation,
origin/input digests, derived/recorded and outcome counts, fallback, result, and
persistence/memory application state. Raw diff/source, assignment values, targets,
language, claim ids, and conflict payloads are excluded.

`aelyris.context.set` and `aelyris.context.remove` keep `ContextStoreManager` as the
durable decision owner and publish DecisionChanged through the existing Event Bus only
for real changes. The authenticated Principal is the initiating actor while key, value,
and previous value remain decision-domain data. Authority evidence contains only
operation, change kind, one-way decision/input digests, mutation state, Event Bus
publication outcome, and result. A publication failure after a durable mutation stays
an explicit partial-coordination failure; it is not replayed or rolled back, and raw
decision or Event Bus payloads are excluded from audit.

`aelyris.intent.propose` and `aelyris.intent.resolve` keep `IntentBus` as the sole
deliberation owner. Authenticated MCP mutations use its checked path so persistence
completes before the in-memory proposal/status becomes visible; legacy internal callers
retain their prior compatibility path. Caller-supplied proposer, proposal, targets,
intent id, and resolution status remain intent-domain data. Authority evidence contains
only operation, resulting state/outcome, mutation/Event Bus state, and one-way
intent/input digests. IntentDeclared publication failure after a durable proposal stays
an explicit partial-coordination failure without replay or rollback, and raw intent or
Event Bus payloads are excluded.

`aelyris.knowledge.add_node`, `add_edge`, `remove_node`, and `remove_edge` keep
`KnowledgeGraphManager` as the only graph mutation owner. Its authenticated MCP adapter
uses changed-returning manager methods for node/edge additions while preserving default
node kind, endpoint auto-creation, self-edge no-op, duplicate idempotency, node-removal
edge cascading, exact edge removal, and existing persistence behavior. Authority
evidence contains only actor, operation, changed/removed outcome, and one-way
target/input digests. Node ids, files, edge endpoints, and graph snapshots are excluded.

`aelyris.agent.report_activity`, `report_blocker`, and `steer_avoid` retain
`AgentManager`, the shared symbol-ownership context formatter, and Event Bus as their
only coordination owners. Activity and blocker updates use one AgentManager lock for
the live-process check and mutation; retained terminal, exited, and unknown sessions
cannot produce fleet facts. Avoid steering remains ownership-derived typed data rather
than raw pane input. Event publication failure after an activity/blocker mutation is an
explicit partial-coordination failure and never replays or rolls back the manager state.
Authority evidence stores only actor, operation, one-way session/input digests,
count/result metadata, and mutation/publication outcome. Session, task, file, symbol,
activity, blocker, directive, avoidance, and Event Bus payload values are excluded.

`aelyris.event.ack` retains `EventBus::ack` and `EventRepo` as the only durable cursor
owner. The authenticated Principal is the initiating actor while consumer id, event id,
and sequence remain at-least-once delivery inputs. Exact event-id/sequence binding,
cumulative monotonic advancement, idempotent retry, regression/gap/corruption errors,
and the existing structured tool-error envelope remain unchanged. Durable authority
evidence contains only operation, acknowledged sequence/outcome, cursor-advanced state,
and one-way consumer/event/input digests. Raw consumer ids, event ids, and Event Bus
payloads are excluded. Audit failure is best-effort after the cursor result and never
replays or fabricates a second acknowledgement.

`aelyris.orchestrator.step` keeps `control::loop_ports::run_step` as the sole bounded
multi-owner execution path. Startup admission, Task/Cost/Agent managers, file and
symbol ownership, Event Bus, Context Store, review/merge authority, durable give-up,
and exact existing error behavior remain unchanged. The authenticated Principal is the
initiating actor while repository path and active-agent usage remain orchestration
inputs. Authority evidence contains only operation, one-way repository/input digests,
loop state, aggregate result counts, and whether a report was produced. Repository
paths, task/session/agent ids, task packets, prompts, commands, worktree/branch names,
and Event Bus payloads are excluded. Audit failure occurs after the one `run_step`
result and never replays or fabricates another autonomy step.

`aelyris.review.reject` keeps the durable `MergeIntentStore` and SQLite conditional
transition as the sole reviewer-rejection authority. The authenticated Principal is
the initiating reviewer while intent id and optional reason remain review inputs.
Missing intents, merging intents, and already-resolved intents retain their exact
typed failures; no raw approval shortcut or merge action is introduced. Authority
evidence contains only operation, one-way intent/input digests, initial/resulting state,
and transition outcome. Intent ids, reasons, repository/worktree/branch paths, commit
OIDs, and review evidence are excluded. Audit failure occurs after the one durable
store result and never replays or fabricates another rejection.

### 2.3 Loopback safety rules (HTTP transport only)

- Bind `127.0.0.1` only — never `0.0.0.0`. (Matches `serve` at `:990`.)
- Require `Authorization: Bearer <token>` on every call (`auth_middleware`,
  `src-tauri/src/api/mod.rs:741-804`).
- Reuse the existing typed error envelope (§5).
- The default product remains single-operator and single-tenant, while the existing
  `PrincipalResolver`, `TenantResolver`, and `Governance` seams determine the exact
  actor/tenant and principal-scoped catalog when a deployment supplies a restricted
  policy. This adds no second identity or policy store.

---

## 3. Tool catalog (`aelyris.mcp.v1`)

Conventions for the **I/O** column: parameters are the MCP `inputSchema`
properties; the return is the JSON shape the tool resolves to. Types mirror the
Rust structs that already serialize across IPC, so the wire shape is not new.

Conventions for **FREE / GATED** (the safety boundary, see §4):
- **FREE** — the orchestrator may call it directly; it mutates only isolated /
  observable state (a worktree, an agent PTY, a pane, a read-only diff).
- **GATED** — the orchestrator may only *enqueue an intent* and *observe*; the
  grant authority is the watchdog policy engine + human inbox, never the tool.

### 3.1 Worktree domain

| Tool | I/O (JSON) | Maps to | FREE/GATED | Notes |
|------|-----------|---------|------------|-------|
| `aelyris.list_worktrees` | **params** `{ repoPath: string }` → **return** `{ worktrees: WorktreeInfo[] }` where `WorktreeInfo = { name, path, branch, is_main, head_sha, status: "Clean"\|"Modified"\|"Conflicted" }` | `git::list_worktrees` `src-tauri/src/git/worktree.rs:29`; IPC `ipc::list_worktrees` `src-tauri/src/lib.rs:565` | FREE | Pure read. Includes the main worktree first (`worktree.rs:34-58`). |
| `aelyris.create_worktree` | **params** `{ repoPath: string, branch: string }` → **return** `WorktreeInfo` | `git::create_worktree` `src-tauri/src/git/worktree.rs:203`; IPC `ipc::create_worktree` `src-tauri/src/lib.rs:566` | FREE | Branch name MUST pass the **one shared validator** (`validate_branch_name` `worktree.rs:173`). Worktree path is deterministic via the **one shared worktree-path fn** (`predict_worktree_path` `worktree.rs:195`). Creating an isolated worktree is non-destructive to `main`. |
| `aelyris.remove_worktree` | **params** `{ repoPath: string, branch: string, deleteBranch?: boolean }` → **return** `{ ok: true }` | `git::remove_worktree` `src-tauri/src/git/worktree.rs:120`; IPC `ipc::remove_worktree` `src-tauri/src/lib.rs:567` | FREE | Force-removes via `git worktree remove --force` (`worktree.rs:127-131`) then prunes. Destroys only the *isolated* worktree, never `main`'s working tree, so it stays FREE. Branch deletion guarded by `show-ref` re-check (`worktree.rs:151-166`). |

### 3.2 Agent (fleet) domain

`AgentSession` is the unified backend session. On the interactive PTY path it is
`InteractiveSessionInfo` (`src-tauri/src/agent/interactive.rs:135`):
`{ id, pty_id, backend, cli, status, model, initial_prompt, cwd, worktree_branch, worktree_path, repo_path, cost, tokens_used, started_at }`.

| Tool | I/O (JSON) | Maps to | FREE/GATED | Notes |
|------|-----------|---------|------------|-------|
| `aelyris.spawn_agent` | **params** `{ role?: string, task: string, model?: string, repoPath: string, branch?: string, cols?: u16, rows?: u16 }` → **return** `SpawnResult = { session_id, pty_id, worktree_path: string\|null, backend }` | `spawn_interactive_agent` `src-tauri/src/ipc/interactive_commands.rs:52`; IPC `ipc::spawn_interactive_agent` `src-tauri/src/lib.rs:673` | FREE | `model` selects the CLI via `AgentCli::from_model` (`interactive.rs:98`); `task` → `initial_prompt` as an interactive prompt (positional/env delivery, **never `-p` / `--print` on the visible PTY path**). When `branch` is set, a worktree is auto-created (`interactive_commands.rs:83-95`) and mirrored as a ghost-diff layer (`interactive_commands.rs:196-222`). **`role` is a NEW field** — today role lives only in the frontend `AgentSession` (`src/shared/types/agent.ts:51`), so the capability layer must thread it into `InteractiveSessionInfo`. Spawning an agent in an isolated worktree is FREE; the agent itself is still subject to watchdog gating on *its* tool calls (§4.3). See `VISIBLE_AGENT_PANE_RUNTIME_SPEC.md` for the visible-vs-headless runtime boundary. |
| `aelyris.stop_agent` | **params** `{ sessionId: string, removeWorktree?: boolean }` → **return** `{ ok: true }` | `stop_interactive_agent` `src-tauri/src/ipc/interactive_commands.rs:292`; or `end_session_and_remove_worktree` `:331` when `removeWorktree=true`. IPC `:674-675` | FREE | Closes PTY, tears down native engine + ghost layer, unregisters session. `removeWorktree=true` additionally removes the worktree (`interactive_commands.rs:360-369`) — still FREE because it only deletes the *isolated* worktree. |
| `aelyris.fleet_status` | **params** `{}` → **return** `{ sessions: AgentSession[] }` (the `InteractiveSessionInfo[]` list) | `list_interactive_agents` `src-tauri/src/ipc/interactive_commands.rs:381`; IPC `ipc::list_interactive_agents` `src-tauri/src/lib.rs:676`. Live status maintained by `run_output_monitor` `interactive_commands.rs:424` | FREE | The fleet view. `status` is the run-status string set by the output monitor: `thinking`/`coding`/`idle`/`done`/`waiting`/`unknown` (`interactive_commands.rs:464-472`). See §3.6 for `AgentRunStatus` enum alignment. Frontend consumes the same data via the unified `useAgentFleet` hook (today `useAgentManager`, `src/shared/hooks/useAgentManager.ts`). |
| `aelyris.send_steer` | **params** `{ target: string, text: string }` → **return** `{ accepted: u32 }` | `send_keys_by_target` `src-tauri/src/ipc/commands.rs:5313`; IPC `ipc::send_keys_by_target` `src-tauri/src/lib.rs:639` | FREE | Mid-run guidance: writes keystrokes to a running agent's PTY. `target` resolves by exact PTY id, `@role`/`role:` prefix, or pane name (collision rejected) via `resolve_send_target` (`commands.rs:5325`). Payload validated by `validate_keys_payload` (`commands.rs:5318`). Every write is audited (`record_audit_event`, `commands.rs:5408`). FREE because steering an isolated agent does not bypass any human gate — the agent's downstream tool calls are still gated. |

### 3.2.1 Session lifecycle domain (GATED)

These rows mirror the shipped `/mcp/tools/list` catalog entries added in H2 and
are locked in code by `catalog_and_schemas_list_exactly_the_same_verbs`. Every
tool delegates to the same `src-tauri/src/ipc/interactive_commands.rs`
function as the IPC face and returns the existing serialized result struct.

| Tool | I/O (JSON) | Maps to | FREE/GATED | Notes |
|------|-----------|---------|------------|-------|
| `aelyris.session.summarize` | **params** `{ session_id: string, reason?: string, timeout_ms?: integer }` → **return** `SessionSummarizeResult` | `ipc::session_summarize` | **GATED** | Injects the self-summary prompt into a live visible agent PTY; unknown/non-idle sessions and summary validation failures return the IPC error message through the MCP tool error. |
| `aelyris.session.checkpoint` | **params** `{ session_id: string, summary_json?: object, summary_seq?: integer, inflight_ref?: string, predecessor_session_id?: string }` → **return** `SessionCheckpointResult` | `ipc::session_checkpoint` | **GATED** | Persists the same checkpoint record as IPC; caller-provided paths are not accepted, so SEC-1 containment remains backend-owned. |
| `aelyris.session.handoff` | **params** `{ session_id: string, reason?: string, timeout_ms?: integer, cols?: integer, rows?: integer }` → **return** `SessionHandoffResult` | `ipc::session_handoff` | **GATED** | Runs the no-loss transaction: durable intent, summary, checkpoint, successor spawn, ack, audit, predecessor retire. |
| `aelyris.session.resume` | **params** `{ logical_session_id?: string, timeout_ms?: integer }` → **return** `SessionResumeResult` | `ipc::session_resume` | **GATED** | Reconciles durable handoff rows and preserves the IPC fail-closed identity mismatch behavior. |
| `aelyris.session.reset_context` | **params** `{ session_id: string, timeout_ms?: integer, cols?: integer, rows?: integer }` → **return** `SessionResetContextResult` | `ipc::session_reset_context` | **GATED** | Recycles the session through handoff-to-self; it does not remove the worktree. |

### 3.3 Pane domain

| Tool | I/O (JSON) | Maps to | FREE/GATED | Notes |
|------|-----------|---------|------------|-------|
| `aelyris.split_pane` | **params** `{ workspaceId: string, targetPaneId: string, axis: "horizontal"\|"vertical", shell?: string, cwd?: string, title?: string, cols?: u16, rows?: u16 }` → **return** `{ paneId: string }` | `mux_split_pane` `src-tauri/src/ipc/commands.rs:2511`; IPC `ipc::mux_split_pane` `src-tauri/src/lib.rs:540`. HTTP precedent `POST /mux/workspaces/{id}/panes/split` `src-tauri/src/api/mod.rs:928` | FREE | Layout only. `axis` parsed by `parse_mux_axis` (`commands.rs:2525`); `cwd` validated by `validate_path` (`commands.rs:2531`). Routes through the sidecar when present (`commands.rs:2534-2550`). |

### 3.4 Diff domain

The agent's work is mirrored as a ghost-diff **layer** keyed by `session_id`
(`src-tauri/src/ipc/interactive_commands.rs:196-222`,
`ghostdiff::register_worktree_and_watch` `src-tauri/src/ghostdiff/mod.rs:41`).
Two diff baselines exist in the layer model:

- **vs base** — the worktree's own HEAD/base SHA. `LayerContent::Diff { base_revision, files }`
  computed by `diff_engine::compute_diff(worktree_path, base_sha)`
  (`ghostdiff/mod.rs:72`, `:91`); base captured by `capture_head_sha` (`mod.rs:50`).
- **vs target** — an arbitrary branch comparison. `LayerSource::BranchComparison { repo_path, base_branch, head_branch }`
  (`src-tauri/src/ghostdiff/layer.rs:40-47`) runs `git diff base..head`.

| Tool | I/O (JSON) | Maps to | FREE/GATED | Notes |
|------|-----------|---------|------------|-------|
| `aelyris.agent_diff` | **params** `{ sessionId: string, against?: "base"\|"target", targetBranch?: string }` → **return** `{ source, content: { kind: "diff", base_revision, files: FileDelta[] } }` where `FileDelta = { path, ... hunks }` (`ghostdiff/layer.rs:86`) | `against:"base"` → existing worktree-layer diff (`ghostdiff/mod.rs:41`, layer keyed by `sessionId`). `against:"target"` → `LayerSource::BranchComparison` (`ghostdiff/layer.rs:40`). A read accessor over the `LayerRegistry` snapshot (`ghostdiff/registry.rs`, re-exported `ghostdiff/mod.rs:28`) is **NEW** as an MCP/IPC read tool. | FREE | Pure read of the diff overlay. `against` defaults to `"base"`. For `"target"`, `targetBranch` is required and goes through the same branch validator. No file content is mutated. This is how the orchestrator *observes* an agent's progress before deciding to request a merge (§4). |

### 3.5 Approval & merge domain (GATED — the safety boundary)

These tools NEVER complete the privileged action. They enqueue an **intent** that
the watchdog policy engine + human inbox resolve. See §4.

| Tool | I/O (JSON) | Maps to | FREE/GATED | Notes |
|------|-----------|---------|------------|-------|
| `aelyris.request_approval` | **params** `{ sessionId: string, tool: string, summary?: string, risk?: "low"\|"medium"\|"high"\|"critical" }` → **return** `{ intentId: string, status: "auto_approved"\|"auto_denied"\|"pending", rule?: string }` | Watchdog evaluation `WatchdogEngine::evaluate` `src-tauri/src/watchdog/engine.rs:30` → `WatchdogDecision::{AutoApprove,AutoDeny,AskUser}` (`engine.rs:7-14`). `AskUser` surfaces to the human inbox as a `permission_required` decision (`src/shared/lib/decisionInbox.ts:5-12`). The enqueue/observe IPC pair is **NEW**; the *decision engine* exists. | **GATED** | The orchestrator submits a request; the **engine** decides. Low-risk patterns auto-approve (`engine.rs:35-47`), unmatched → `AskUser` → routes to the human Decision Inbox (`src/features/decision-inbox/DecisionInboxPanel.tsx`). The tool returns the **decision status**, it does not *make* the decision. No `grant` parameter exists by construction. |
| `aelyris.list_pending_approvals` | **params** `{}` → **return** `{ pending: HumanDecisionItem[] }` (`src/shared/lib/decisionInbox.ts:25-43`) | Derived from the decision inbox model (`buildDecisionInbox`, `src/shared/lib/decisionInbox.ts`), fed by agent watchdog events (`watchdog-decision-{sessionId}`, `src-tauri/src/ipc/commands.rs:4269-4292`) and audit events. A read IPC/MCP accessor is **NEW**. | **GATED (observe-only)** | Read-only poll of the human queue. Returns `pending` items only; the orchestrator uses this to *wait* for a human/engine decision. It cannot resolve an item. |
| `aelyris.request_merge` | Legacy params retained for schema compatibility | Retired dispatcher stub in `src-tauri/src/api/mcp/dispatch.rs` | **GATED / retired** | Always returns a validation error before repository or persistence effects. Generic merge intents are minted only inside backend-owned exact-candidate review. |
| `aelyris.review.approve` | Legacy `{ intentId }` shape retained for schema compatibility | Retired dispatcher stub in `src-tauri/src/api/mcp/dispatch.rs` | **GATED / retired** | Always returns a validation error and never claims or merges an intent. This closes raw caller-authored approval; `review.reject` and pending-list remain recovery/observation controls for existing durable rows. |

### 3.6 `AgentRunStatus` alignment (shared name)

The binding design mandates one `AgentRunStatus` enum
`{ spawning, thinking, coding, running_tests, waiting_approval, blocked, idle, done, error }`,
with the TS union derived. The current backend strings are a **subset / near-match**
and MUST be reconciled when the capability layer is built:

| `AgentRunStatus` (target) | Current backend string | Source |
|---------------------------|------------------------|--------|
| `spawning` | (implicit at spawn) | `interactive_commands.rs:174` initial status |
| `thinking` | `"thinking"` | `interactive_commands.rs:466` |
| `coding` | `"coding"` | `interactive_commands.rs:467` |
| `running_tests` | (NEW — not yet detected) | — |
| `waiting_approval` | `"waiting"` | `interactive_commands.rs:470` (`WaitingPermission`) |
| `blocked` | (NEW) | — |
| `idle` | `"idle"` | `interactive_commands.rs:468` |
| `done` | `"done"` | `interactive_commands.rs:469`, `:526` |
| `error` | `"error"` | frontend `AgentStatus` `src/shared/types/agent.ts:1` |

The MCP tools serialize whatever the capability layer emits; this table is the
contract the capability layer must converge on so both faces see one enum.

### 3.7 Intent Bus domain (durable pre-fact deliberation)

H3 persistence rule: `aelyris.intent.*` reads and writes go through the single
`IntentBus` manager, which hydrates from the SQLite `intents` table before the
MCP HTTP server binds and writes through on real changes. The in-memory manager
remains the hot owner; SQLite is the restart source of truth.

| Tool | I/O (JSON) | Maps to | FREE/GATED | Notes |
|------|-----------|---------|------------|-------|
| `aelyris.intent.propose` | **params** `{ agentId: string, proposal: string, targets?: string[] }` -> **return** `{ intent: Intent }` | `intent::IntentBus::propose_checked` via `src-tauri/src/api/mcp.rs` | FREE | Authenticated MCP proposals persist before entering the hot manager; an IntentDeclared publication failure is explicit and does not replay or roll back the durable proposal. Legacy internal callers keep their best-effort compatibility path. |
| `aelyris.intent.list` | **params** `{}` -> **return** `{ intents: Intent[] }` | `intent::IntentBus::open` | FREE | Returns open deliberations from the hydrated manager. |
| `aelyris.intent.all` | **params** `{}` -> **return** `{ intents: Intent[] }` | `intent::IntentBus::all` | FREE | Returns every hydrated intent in proposal order, including accepted/rejected/superseded rows. |
| `aelyris.intent.resolve` | **params** `{ id: string, status: "accepted"\|"rejected"\|"superseded" }` -> **return** `{ intent: Intent\|null }` | `intent::IntentBus::resolve_checked` | FREE | Authenticated MCP resolution persists before memory mutation; unknown ids remain null and repeating the same status remains a no-op. |

---

### 3.7.1 Event Bus domain (A4.8 durable delivery)

The Rust/TypeScript wire authority is
`src-tauri/src/event_bus/mod.rs` / `src/shared/types/eventBus.ts`. `eventId` is
the stable idempotency identity. The durable consumer contract is
**at-least-once plus an idempotent effect**, never exactly-once.

| Tool | I/O (JSON) | Semantics |
|------|-----------|-----------|
| `aelyris.event.recent` | **params** `{}` → `{ events: AgentEvent[] }` | Bounded hot projection for cockpit visibility. Every returned row was committed first, but this cache is not a replay/ACK source. |
| `aelyris.event.by_channel` | **params** `{ channel: EventChannel }` → `{ channel, events: AgentEvent[] }` | Bounded hot projection restricted to one channel. Like `event.recent`, it is not a replay/ACK source. |
| `aelyris.event.since` | **params** `{ afterSeq?: integer, limit?: 1..1000 }` → `{ events: SeqEvent[], nextSeq, streamStatus: "complete", deliveryContract: "diagnostic" }` | Durable diagnostic read. It does not ACK. High-water, trailing row, gap, corruption, and cursor-range validation runs before an empty/complete result is allowed. |
| `aelyris.event.poll` | **params** `{ consumerId: string, limit?: 1..1000 }` → `{ consumerId, events: SeqEvent[], streamStatus: "complete", deliveryContract: "at_least_once", idempotencyField: "eventId" }` | Reads after the consumer's durable cumulative ACK without advancing it. Crash-before-ACK redelivers the same `eventId`. |
| `aelyris.event.ack` | **params** `{ consumerId: string, seq: integer >= 1, eventId: string }` → `{ ack: AckReceipt }` | Advances only to the exact delivered `seq/eventId` pair after the caller's idempotent effect. Cursor regression, future cursor, skipped/corrupt rows, and identity mismatch fail closed. The authenticated Principal is retained separately through identity-free acknowledgement evidence. |

The durable `aelyris.event.since`, `aelyris.event.poll`, and
`aelyris.event.ack` operations use the same tool-level non-success shape on
bespoke HTTP and native MCP:

```json
{
  "schema": "aelyris.mcp.server.v1",
  "tool": "aelyris.event.since",
  "ok": false,
  "error": {
    "schema": "aelyris.event-bus.error/v1",
    "domain": "event_bus",
    "retryable": false,
    "deliveryContract": "at_least_once",
    "eventBusError": { "code": "gap", "expected_seq": 2, "observed_seq": 3 }
  }
}
```

Native `tools/call` returns this `error` object unchanged in
`structuredContent`, serializes the same object into text `content`, and sets
`isError: true`; it does not collapse EventBus errors into generic internal
text. Stable error codes are defined by the tagged `EventBusError` union in the
TS mirror.

---

### 3.8 Proofbook domain (PB-3/PB-4 runtime slices)

PB-3 connects Proofbooks to the existing MCP face after the local PB-2 runner.
PB-4 adds a governed settlement verb for already-running `agentSession` steps.
Rows in this section describe scoped runtime slices when catalog rows, focused
tests, and verifier artifacts are green. They are not a shipped end-user
Proofbook product claim: canvas/UI, create/update/distill, HTTP/fan-out/
subProofbook, Evidence Store behavior, and native completion UI remain future
phases.

The implementation rule is strict: Proofbook MCP verbs and `mcpTool` steps are
thin adapters over the single `src-tauri/src/proofbook` contract spine and the
existing `tools/call` schema/governance/dispatch path. They do not create a
second dispatcher, a second catalog, or a Proofbook-only schema validator.

| Tool | I/O (JSON) | Maps to | FREE/GATED | Notes |
|------|-----------|---------|------------|-------|
| `aelyris.proofbook.list` | **params** `{ projectPath: string }` -> **return** `{ proofbooks: ProofbookSummary[] }` | `proofbook::list_proofbook_files` via `src-tauri/src/api/mcp.rs` | FREE | Lists contained `.aelyris/proofbooks/*.proofbook.yaml` and `.proofbook.yml` files. No runner state is touched. |
| `aelyris.proofbook.get` | **params** `{ projectPath: string, proofbookPath: string }` -> **return** `{ definition, definitionHash, validation }` | `proofbook::parse_proofbook` + `proofbook::validate_definition` | FREE | Reads one contained definition and returns validation status. Secret values are never resolved; definitions may contain only secret references. |
| `aelyris.proofbook.validate` | **params** `{ projectPath: string, proofbookPath: string }` -> **return** `ProofbookValidationReport` | same validator as IPC `validate_proofbook` | FREE | Schema/DAG/preflight validation only. It cannot start a run. |
| `aelyris.proofbook.run` | **params** `{ projectPath: string, proofbookPath: string, inputs?: object }` -> **return** `{ runId, status, ledgerPath, ledger }` | managed `ProofbookRunner::start_run_with_executors_as_actor` | **GATED** | Starts local PB-2/PB-3 execution through the managed runner and records the authenticated Principal in durable `run_created` evidence and the audit journal. No actor input exists, and actor identity does not affect definition hash, input hash, or deterministic run id. Sidecar/test modes without an attached runtime fail closed instead of creating another runner. |
| `aelyris.proofbook.status` | **params** `{ projectPath: string, runId: string }` -> **return** `{ ledger }` | `ProofbookRunner::status` | FREE | Reads the run ledger, waiting gates, decisions, artifacts, and residual blockers. |
| `aelyris.proofbook.settle_agent_session` | **params** `{ projectPath: string, runId: string, stepId: string, proof: { status: string, proofKind?: string, doneSignal?: string, finalReportPath?: string, artifactPaths?: string[], reviewerBatchId?: string, blockerCode?: string, blockerMessage?: string, summary?: string } }` -> **return** `{ ledger }` | `ProofbookRunner::settle_agent_session` | **GATED** | PB-4 only. Settles an already-running `agentSession` through explicit done signal, final report, required artifact settlement, reviewer-batch proof, or typed failure/blocker/timeout proof. First-file-exists alone is rejected. |
| `aelyris.proofbook.agent_session_candidate` | **params** `{ projectPath: string, runId: string, stepId: string, expectedRevision: integer >= 0 }` -> **return** current runtime-owned session identity, terminal status, expected-artifact presence, blockers, resulting status, and backend-selected proof kind | shared `control::proofbook::agent_session_settlement_candidate` over `ProofbookRunner` plus the attached runtime-session managers | FREE | AIO-2 read path. It accepts no proof, status, done signal, artifact path, reviewer id, blocker, or summary. Runtime and ledger identity are read from current backend owners. |
| `aelyris.proofbook.settle_current_agent_session` | **params** `{ projectPath: string, runId: string, stepId: string, expectedRevision: integer >= 0, expectedSessionId: string }` -> **return** the updated ledger | shared `control::proofbook::settle_current_agent_session` plus `ProofbookRunner::settle_agent_session_if_current` | **GATED** | AIO-2 effect path. Re-reads current ledger revision, session/PTY/backend/worktree identity, terminal status, and expected artifacts before generating the completion proof internally. It accepts no generic proof JSON and does not terminate a process, approve review, or merge work. |
| `aelyris.proofbook.cancel` | **params** `{ projectPath: string, runId: string }` -> **return** `{ ledger }` | `ProofbookRunner::cancel_run` | **GATED** | Appends cancellation evidence and prevents new steps. It never deletes ledger files or artifacts. |
| `aelyris.proofbook.cancel_current` | **params** `{ projectPath: string, runId: string, expectedRevision: integer >= 0 }` -> **return** the updated ledger | `ProofbookRunner::cancel_run_if_current_as_actor` | **GATED** | AIO-4 exact path. Cancels only the observed nonterminal revision, records the authenticated Principal in the durable Proofbook cancellation event and audit journal, and rejects stale or terminal requests. It does not claim external agent/PTY termination. |
| `aelyris.proofbook.approve_gate` | **params** `{ projectPath: string, runId: string, gateId: string, gateHash: string, actor?: string, comment?: string }` -> **return** `{ ledger }` | Proofbook runner gate resolver | **GATED** | Resolves a Proofbook gate only when the expected hash matches. The durable actor is always the authenticated Principal; the optional compatibility `actor` must match it exactly or the call fails before runner mutation. Stale hashes fail closed. |
| `aelyris.proofbook.reject_gate` | **params** `{ projectPath: string, runId: string, gateId: string, gateHash: string, actor?: string, comment?: string }` -> **return** `{ ledger }` | Proofbook runner gate resolver | **GATED** | Records a rejection with append-only evidence whose actor is the authenticated Principal. A caller-supplied compatibility `actor` cannot impersonate another principal, and comments carry no authority. |

PB-3/PB-4 deliberately exclude `aelyris.proofbook.create`,
`aelyris.proofbook.update`, and `aelyris.proofbook.distill`. Those mutation and
rewrite verbs are PB-6 work and remain absent from `tool_names()` and
`tools_list()` until their own design gate is green.

`mcpTool` step semantics:

- A Proofbook `mcpTool` step names a catalog `toolName` and an `arguments`
  object. The target tool must be present in `tool_names()` and `tools_list()`.
- The step validates the arguments with the same inputSchema validator that
  guards external `tools/call`. The machine-correctable `schema_violation`
  payload is preserved in the ledger when validation fails.
- The step authorizes through the same governance choke point as external MCP
  callers. A denied policy is durably audited and recorded as
  `mcp_governance_denied`; the runner must not retry through IPC or a less
  governed helper.
- FREE target tools may run immediately through the shared dispatch seam and the
  step passes only when the MCP result is not an error result.
- GATED target tools transition the Proofbook run to `waiting_gate` before the
  privileged action. The ledger records `kind:"mcpTool"`, `toolName`, `safety`,
  `gateId`, `gateHash`, `argumentsHash`, and any `pendingDecisionId`; success is
  impossible until `aelyris.proofbook.approve_gate` resolves the expected hash.
- `GATED_OBSERVE_ONLY` tools may run only when the row explicitly says the verb
  is read-only and cannot resolve or mutate a decision. Otherwise any non-FREE
  safety classification becomes a waiting gate.
- PB-3 `mcpTool` cannot call `aelyris.proofbook.*`; recursive Proofbook runs and
  gate mutation from inside a Proofbook stay out of scope until subProofbook
  lineage exists.

PB-3/PB-4 drift tests must prove all Proofbook rows have `additionalProperties:false`,
the expected FREE/GATED safety classification, and a handler entry. They must
also prove the PB-6 mutation verbs are still absent.
## 4. Gate enforcement

This is the **critical safety boundary**. The gate model:

> worktree / agent / pane / diff = **FREE** tools an AI may call.
> approval + merge-to-main = **GATED**: the AI may request / observe / route them
> but MUST NOT grant them. The **grant authority is the watchdog policy engine**
> (`src-tauri/src/watchdog/`): low-risk auto-approve, high-risk routes to the
> human approval inbox.

### 4.1 What a GATED tool does (and does not) do

| GATED tool returns | GATED tool NEVER returns |
|--------------------|--------------------------|
| `{ status: "pending" }` (engine said `AskUser`) | `{ status: "done" }` for a human-gated action |
| `{ status: "queued" }` (intent staged, awaiting decision) | a tool parameter named `grant`, `approve`, or `force` |
| `{ status: "auto_approved", rule }` (engine matched a low-risk auto rule) | the ability to mutate `main` |
| `{ status: "auto_denied", rule }` (engine matched a deny rule) | — |

The orchestrator's only follow-up is to **poll** `aelyris.list_pending_approvals`
(or `aelyris.fleet_status` for the `waiting_approval` run status). It never resolves
its own request.

### 4.2 The grant path (who can actually say yes)

```
orchestrator (Face 2)                 watchdog engine                 human (Face 1)
  aelyris.request_approval ───────────▶ WatchdogEngine::evaluate
                                       (engine.rs:30)
                                         │
              AutoApprove {rule} ◀───────┤  low-risk pattern match (engine.rs:35-47)
              AutoDeny   {rule} ◀───────┤  deny pattern match
                                         │
              status:"pending" ◀─────────┘  AskUser ──▶ Decision Inbox
                                                        (DecisionInboxPanel.tsx)
                                                          │
                                                          ▼  human clicks grant
                                                        privileged action executes
                                                        (Cockpit UI / Face 1 only)
```

- The watchdog rules live at `~/.aelyris/watchdog.json`
  (`src-tauri/src/watchdog/mod.rs:13-30`); patterns are glob-matched
  (`engine.rs:64-107`). Only the operator edits these (via the Watchdog rule
  dialog, Face 1). The orchestrator cannot add an auto-approve rule for itself —
  rule mutation is not in the MCP catalog.
- `AskUser` → the item shows up in the human Decision Inbox as one of the
  `HumanDecisionType` values (`src/shared/lib/decisionInbox.ts:5-12`). Only a
  human-authorized action resolves it, either directly in Face 1 or through the
  independently authorized routing adapter below.
- `aelyris.approval.resolve` is a routing adapter for that same human action, not
  a bearer-authorized AI grant. It requires the independently configured human
  approval capability in addition to the authenticated Principal and the exact
  current prompt fingerprint. The MCP adapter calls the existing single-use
  interactive approval core and records only Principal, result class, and
  one-way terminal/prompt/input digests. It never stores or hashes capability
  material, decision values, prompt text/keys, terminal ids, or terminal content.

### 4.3 Defense in depth: spawned agents are themselves gated

`aelyris.spawn_agent` is FREE, but the spawned agent's *own* tool calls flow
through the same watchdog evaluation: the agent output monitor parses each tool
use and runs `watchdog.evaluate(tool_name)` (`src-tauri/src/ipc/commands.rs:4304-4352`),
emitting `approved` / `denied` / `manual`. So even a fleet dispatched freely by
the orchestrator cannot escalate past the human gate — every privileged tool the
*sub-agents* attempt is independently evaluated.

### 4.4 Invariant (must hold in tests)

> There exists no MCP call authenticated only by the public bearer by which the
> orchestrator can transition a `permission_required` /
> `merge_conflict_strategy` / `destructive_operation` decision from `pending` to
> `decided`. The only writers are (a) watchdog auto rules and (b) the existing
> Face 1 human action, optionally routed through `aelyris.approval.resolve` with
> the separate human approval capability and exact live prompt fingerprint.

---

## 5. Auth, safety & error model

### 5.1 Typed errors (mirror the daemon)

The MCP surface reuses the daemon's typed error envelope so both faces fail
identically. `ApiError` (`src-tauri/src/api/mod.rs:839-885`) serializes as
`{ "error": string, "code": string }` with a stable `code`:

| MCP error code | HTTP status (HTTP transport) | `ApiError` variant | When |
|----------------|------------------------------|--------------------|------|
| `not_found` | 404 | `NotFound` | unknown `sessionId` / `workspaceId` / worktree |
| `bad_request` | 400 | `BadRequest` | invalid branch name, bad axis, missing arg, oversized payload |
| `conflict` | 409 | `Conflict` | worktree/branch already exists |
| `unauthorized` | 401 | `Unauthorized` | missing/bad bearer token (HTTP transport) |
| `rate_limited` | 429 | `RateLimited` | token-bucket exhausted (HTTP transport) |
| `internal` | 500 | `Internal` | lock poisoned, git failure, sidecar error |

PTY-layer errors are mapped without string-matching via `map_pty_err`
(`src-tauri/src/api/mod.rs:889-895`).

### 5.2 Input validation at the boundary

All validation reuses existing, single-source validators (no re-implementation):

- Branch names → `validate_branch_name` (`src-tauri/src/git/worktree.rs:173`) — the
  **one shared branch-name validator** the binding design mandates. (Note: the
  spawn path has a near-duplicate inline check at `interactive_commands.rs:67-80`
  that should be collapsed onto the shared validator when the capability layer
  lands.)
- Worktree paths → `predict_worktree_path` (`worktree.rs:195`) — the **one shared
  worktree-path fn**.
- `cwd` → `validate_api_cwd` / `normalize_api_cwd` (`api/mod.rs:1339-1458`): rejects
  `..`, UNC, NUL, and system dirs (`is_dangerous_api_cwd`, `:1430`).
- Steering payload → `validate_keys_payload` (`commands.rs:5318`).
- MCP tool dispatch validates the advertised `inputSchema` before handler
  dispatch; per-verb `arg_string` / `arg_usize` / `arg_bool` coercion remains as
  defense in depth.

### 5.2.1 Runtime inputSchema enforcement

`tools/call` must enforce the same `inputSchema` that `tools/list` advertises
before any verb dispatch. The built-in validator intentionally supports only the
schema subset the catalog uses: object roots, `properties`, `required`,
`additionalProperties:false` or schema objects, primitive `type`s, arrays with
`items`, `enum`, `minimum`/`maximum`, `maxLength`, and `description` metadata.
The Rust drift test `every_catalog_schema_is_in_the_enforced_subset` fails if a
future catalog entry adds unsupported JSON Schema features.

On violation, native MCP returns a normal tool result with `isError:true` and
`structuredContent` carrying:

```json
{
  "schema_violation": {
    "verb": "aelyris.task.transition",
    "missing": ["to"],
    "wrong_type": [{ "field": "id", "expected": "string", "got": "integer" }],
    "unknown": ["extra"]
  }
}
```

The HTTP `/mcp/tools/call` shape mirrors this as `ok:false` with the same
`error.schema_violation` payload. This is deliberately machine-correctable:
an orchestrator can fix missing, mistyped, or unknown arguments in one retry
without reading logs.

### 5.2.2 Bounded MCP pending queue

`mcp_pending` is a live in-memory queue for non-durable approval requests. It is
bounded by `MAX_MCP_PENDING = 500`; durable merge intents remain in
`MergeIntentStore` and are not part of this cap. When a new pending item would
exceed the cap, the runtime drops the oldest item, logs `tracing::warn!`, and
publishes a system-channel `EscalationRaised` EventBus event with
`source:"mcp_pending"`, `reason:"queue_overflow"`, `droppedId`, `newId`, and
`cap`. Overflow is therefore observable instead of silently consuming RAM.

### 5.3 Versioned schema

- Schema id: **`aelyris.mcp.v1`**. The existing prototype uses
  `aelyris.mcp.server.v1` (`api/mod.rs:1844`, `:1869`); `aelyris.mcp.v1` is the
  forward-compatible umbrella for the full catalog.
- `tools/list` advertises per-tool `inputSchema` (JSON Schema, `additionalProperties:false`)
  exactly as the prototype already does (`api/mod.rs:1867-1921`).
- New tool *additions* are minor (v1.x). Removing/renaming a tool, changing a
  `FREE`↔`GATED` classification, or changing a return shape is a **major** bump
  (`aelyris.mcp.v2`), since reclassifying a gate is a safety-relevant change.
- A `contract` endpoint/handshake mirrors `mcp_contract` (`api/mod.rs:1842`) and
  reports `schema`, `tools`, and the `claims` block asserting
  `webviewRequiredForToolCalls:false` (`api/mod.rs:1858-1863`) — i.e. the MCP face
  works headless, without the React webview.

---

## 6. Worked example: Opus orchestrator dispatching 3 agents

Goal: implement three independent modules in parallel and observe them through
Review. All FREE calls run without human friction; generic MCP orchestration
intentionally stops before merge authority.

```
# 1. Dispatch a fleet — three FREE spawns, each in its own worktree.
→ aelyris.spawn_agent { role:"impl", task:"build auth module",  model:"opus",   repoPath:"C:/proj", branch:"feat/auth" }
← { session_id:"s-a1", pty_id:"s-a1", worktree_path:"C:/proj-feat/auth", backend:"sidecar" }
→ aelyris.spawn_agent { role:"impl", task:"build cache layer",   model:"sonnet", repoPath:"C:/proj", branch:"feat/cache" }
← { session_id:"s-b2", ... }
→ aelyris.spawn_agent { role:"impl", task:"build api routes",    model:"sonnet", repoPath:"C:/proj", branch:"feat/api" }
← { session_id:"s-c3", ... }

# 2. Poll the fleet (FREE) until status settles.
→ aelyris.fleet_status {}
← { sessions:[
    { id:"s-a1", status:"done",    worktree_branch:"feat/auth",  cost:0.42, ... },
    { id:"s-b2", status:"coding",  worktree_branch:"feat/cache", ... },
    { id:"s-c3", status:"waiting_approval", worktree_branch:"feat/api", ... } ] }

# 3. Inspect the finished agent's diff (FREE, observe-only).
→ aelyris.agent_diff { sessionId:"s-a1", against:"target", targetBranch:"main" }
← { source:{ kind:"branchComparison", baseBranch:"main", headBranch:"feat/auth" },
    content:{ kind:"diff", base_revision:"main", files:[ { path:"src/auth.rs", ... } ] } }

# 4. Steer the still-coding agent (FREE).
→ aelyris.send_steer { target:"s-b2", text:"use the existing LRU in shared/lib, don't add a dep\r" }
← { accepted:1 }

# 5. s-c3 is waiting on a human gate — observe, do NOT grant.
→ aelyris.list_pending_approvals {}
← { pending:[ { id:"d-9", type:"permission_required", sessionId:"s-c3",
               risk:"high", status:"pending", title:"write outside workspace" } ] }
   # The orchestrator records this and moves on. It cannot resolve d-9.

# 6. Advance implementation until the task reaches Review.
→ aelyris.orchestrator.step { repoPath:"C:/proj", activeAgents:0 }
← { dispatched:[], merged:[], state:"active" }
   # No reviewerId/gates/gateCommands exist on this tool. The raw MCP
   # request_merge/review.approve names are retired and return errors.
   # Open the Cockpit's Review & merge action, or use typed Mission acceptance,
   # so candidate freeze, clean-checkout gates, semantic review, and OID-bound
   # merge remain one backend-owned authority path.

# 7. Clean up an abandoned or non-merged worktree explicitly when appropriate (FREE).
→ aelyris.stop_agent { sessionId:"s-a1", removeWorktree:true }
← { ok:true }
```

Key takeaways the example demonstrates:
- Steps 1-4, 7 are FREE — the orchestrator runs the whole fan-out/observe/steer
  loop with zero human friction.
- Step 5 remains the tool-approval gate. Step 6 demonstrates the separate merge
  boundary: MCP observes Review but cannot manufacture or approve merge authority.
