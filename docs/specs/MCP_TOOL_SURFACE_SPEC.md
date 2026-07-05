# Aelyris MCP Tool Surface Spec (`aelyris.mcp.v1`)

> ⚠️ **Merge-model update (2026-06-15) — read first.** The authoritative
> requirements ([docs/requirements.md](../requirements.md)) describe a **bounded
> autonomy** model: agents can dispatch, review, and merge through **gated controls**,
> and autonomy is bounded by verifier gates (this is alpha). A Reviewer agent
> (reviewer ≠ implementer) can advance `request_merge` to `done` only after all
> quality gates are green, and tool-approval can be auto-decided within a policy
> envelope that keeps an auto-deny floor for catastrophic/irreversible ops. The
> §3.5 / §4 "GATED / never returns done / human clicks grant / never auto-merges
> main" content describes the **earlier v1 gate model** — treat it as historical on
> the *merge* and *human-grant* axes; these mechanics are rewritten during Batch E/G.
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

Two deployment shapes, same tool catalog:

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

### 2.3 Loopback safety rules (HTTP transport only)

- Bind `127.0.0.1` only — never `0.0.0.0`. (Matches `serve` at `:990`.)
- Require `Authorization: Bearer <token>` on every call (`auth_middleware`,
  `src-tauri/src/api/mod.rs:741-804`).
- Reuse the existing typed error envelope (§5).
- The MCP tool surface is **single-token, single-tenant** — same assumption the
  ticket/rate-limit code already documents (`src-tauri/src/api/mod.rs:560-565`).

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
| `aelyris.request_merge` | **params** `{ taskId?: string, sessionId?: string, repoPath: string, sourceBranch: string, targetBranch: string }` → **return** `{ intentId, status, intent }` | Implemented in `src-tauri/src/api/mcp.rs` through the durable `MergeIntentStore` and `src-tauri/src/control/merge.rs`. It captures repo/source/target branch tips and OIDs at request time and is idempotent per reviewed branch state. | **GATED** | Queues a durable, OID-bound merge intent. It does not by itself merge or re-point branches. The real merge path is `aelyris.review.approve`, which approves a stored intent by id, rejects override fields, re-validates bound tips, and uses `perform_merge_bound`; moved tips become `needs_reconcile` rather than silently merging unreviewed code. |

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
| `aelyris.intent.propose` | **params** `{ agentId: string, proposal: string, targets?: string[] }` -> **return** `{ intent: Intent }` | `intent::IntentBus::propose` via `src-tauri/src/api/mcp.rs` | FREE | Declares a proposal before acting and persists it best-effort through `persistence::IntentRepo`; write errors are logged but do not roll back the live in-memory proposal. |
| `aelyris.intent.list` | **params** `{}` -> **return** `{ intents: Intent[] }` | `intent::IntentBus::open` | FREE | Returns open deliberations from the hydrated manager. |
| `aelyris.intent.all` | **params** `{}` -> **return** `{ intents: Intent[] }` | `intent::IntentBus::all` | FREE | Returns every hydrated intent in proposal order, including accepted/rejected/superseded rows. |
| `aelyris.intent.resolve` | **params** `{ id: string, status: "accepted"\|"rejected"\|"superseded" }` -> **return** `{ intent: Intent\|null }` | `intent::IntentBus::resolve` | FREE | Updates a deliberation status through the same manager; the status transition is persisted on real change and restored across restart. |

---

### 3.8 Proofbook domain (PB-3 runtime slice)

PB-3 connects Proofbooks to the existing MCP face after the local PB-2 runner.
Rows in this section describe the scoped PB-3 runtime slice when catalog rows,
focused tests, and verifier artifacts are green. They are not a shipped
end-user Proofbook product claim: canvas/UI, create/update/distill,
agent/HTTP/fan-out/subProofbook, and Evidence Store behavior remain future
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
| `aelyris.proofbook.run` | **params** `{ projectPath: string, proofbookPath: string, inputs?: object }` -> **return** `{ runId, status, ledgerPath, ledger }` | managed `ProofbookRunner::start_run` | **GATED** | Starts local PB-2/PB-3 execution through the Tauri-managed runner. Sidecar/test modes without an attached runtime fail closed instead of creating another runner. |
| `aelyris.proofbook.status` | **params** `{ projectPath: string, runId: string }` -> **return** `{ ledger }` | `ProofbookRunner::status` | FREE | Reads the run ledger, waiting gates, decisions, artifacts, and residual blockers. |
| `aelyris.proofbook.cancel` | **params** `{ projectPath: string, runId: string }` -> **return** `{ ledger }` | `ProofbookRunner::cancel_run` | **GATED** | Appends cancellation evidence and prevents new steps. It never deletes ledger files or artifacts. |
| `aelyris.proofbook.approve_gate` | **params** `{ projectPath: string, runId: string, gateId: string, gateHash: string, actor?: string, comment?: string }` -> **return** `{ ledger }` | Proofbook runner gate resolver | **GATED** | Resolves a Proofbook gate only when the expected hash matches. Stale hashes fail closed. |
| `aelyris.proofbook.reject_gate` | **params** `{ projectPath: string, runId: string, gateId: string, gateHash: string, actor?: string, comment?: string }` -> **return** `{ ledger }` | Proofbook runner gate resolver | **GATED** | Records a rejection with actor/comment metadata and leaves append-only evidence. |

PB-3 deliberately excludes `aelyris.proofbook.create`,
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

PB-3 drift tests must prove all Proofbook rows have `additionalProperties:false`,
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
  human action there resolves it.

### 4.3 Defense in depth: spawned agents are themselves gated

`aelyris.spawn_agent` is FREE, but the spawned agent's *own* tool calls flow
through the same watchdog evaluation: the agent output monitor parses each tool
use and runs `watchdog.evaluate(tool_name)` (`src-tauri/src/ipc/commands.rs:4304-4352`),
emitting `approved` / `denied` / `manual`. So even a fleet dispatched freely by
the orchestrator cannot escalate past the human gate — every privileged tool the
*sub-agents* attempt is independently evaluated.

### 4.4 Invariant (must hold in tests)

> There exists no MCP tool, and no tool parameter, by which the orchestrator can
> transition a `permission_required` / `merge_conflict_strategy` /
> `destructive_operation` decision from `pending` to `decided`. The only writers
> of that transition are (a) the watchdog engine's auto rules and (b) a human
> action in Face 1.

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

Goal: implement three independent modules in parallel, observe, then request a
gated merge of the one that's ready. All FREE calls run without human friction;
the merge is GATED.

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

# 6. Request a GATED merge of the ready branch. This STAGES — it never merges main.
→ aelyris.request_merge { sessionId:"s-a1", sourceBranch:"feat/auth", targetBranch:"main" }
← { intentId:"m-7", status:"queued", stagedCommitSha:"abc1234" }
   # status:"queued", NOT "done". A human grants in the Cockpit UI; the engine
   # never auto-merges to main.

# 7. Poll for the human decision (observe-only loop).
→ aelyris.list_pending_approvals {}
← { pending:[ { id:"m-7", type:"merge_conflict_strategy", status:"pending", risk:"high" } ] }
   # ... repeat until the human resolves it in Face 1; m-7 leaves `pending`.

# 8. Clean up the merged worktree (FREE).
→ aelyris.stop_agent { sessionId:"s-a1", removeWorktree:true }
← { ok:true }
```

Key takeaways the example demonstrates:
- Steps 1-4, 8 are FREE — the orchestrator runs the whole fan-out/observe/steer
  loop with zero human friction.
- Steps 5-7 are GATED — every privileged transition is `pending`/`queued`, and the
  only resolver is the watchdog engine or a human in Face 1. The orchestrator's
  role is strictly request + observe + poll.
