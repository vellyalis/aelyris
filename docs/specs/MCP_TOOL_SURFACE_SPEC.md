# Quorum MCP Tool Surface Spec (`aether.mcp.v1`)

> ⚠️ **v2.0 merge-model update (2026-06-15) — read first.** The authoritative
> requirements ([AETHER_COCKPIT_REQUIREMENTS](./AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md),
> v2.0) now specify **full autonomy with no human gate in the critical path**: the
> **Reviewer agent merges to `main` automatically** once all quality gates are green,
> and the **watchdog auto-decides** tool-approval (auto-approve / auto-deny, keeping
> only an auto-deny floor for catastrophic/irreversible ops) instead of routing to a
> human Decision Inbox. The §3.5 / §4 "GATED / never returns done / human clicks
> grant / never auto-merges main" content describes the **superseded v1 gate model**
> — treat it as historical on the *merge* and *human-grant* axes; `request_merge` may
> resolve to `done` after the Reviewer's all-green verdict, and the grant path's
> human step is replaced by the watchdog auto-decision. These mechanics are rewritten
> during Batch E/G. Automated, non-blocking compensating controls remain.

Status: Draft / binding design alignment
Audience: backend (Rust) + orchestration engineering
Scope: the **AI-facing** projection of the Quorum Control API.

> **HARD SCOPE NOTE:** This document is analysis + design only. It maps a proposed
> `aether` MCP server onto real backend code. File:line references are to the
> current tree on branch `codex/release-hardening-quality-gates`. Nothing here is
> implemented yet beyond what the "maps to" column cites as existing.

---

## 1. Purpose & placement

### 1.1 The two-faces model

Quorum's north star is a single backend **Quorum Control API** (a capability /
intent layer). Two clients ("faces") project onto it:

| Face | Consumer | Transport | Status |
|------|----------|-----------|--------|
| Face 1 — Cockpit UI | Human operator | Tauri IPC (`invoke`) | Exists. `src-tauri/src/lib.rs:520-690` registers ~68 commands consumed by the React frontend. |
| **Face 2 — Orchestrator AI** | Opus 4.8 orchestrator (or operator's Claude Code / Codex session) | **`aether` MCP server** | **This spec.** Partial precedent exists at `src-tauri/src/api/mod.rs:964-966` (`/mcp/*` routes). |

The capability layer is built **once**; both faces consume it. A tool in this
catalog is not new business logic — it is a thin MCP adapter over an existing
IPC handler or backend `fn`. Where a row says **NEW**, the underlying capability
itself does not yet exist and must be built in the capability layer first (and
then it gets a Tauri IPC binding for Face 1 too).

### 1.2 Who connects

Two deployment shapes, same tool catalog:

1. **Operator-attached** — the operator's existing `claude` / `codex` CLI session
   (already a long-lived process; see `AgentCli` at
   `src-tauri/src/agent/interactive.rs:65`) adds `aether` as an MCP server in its
   own config. The operator drives Quorum from the same chat they already use.
2. **Embedded orchestrator** — an in-app Opus 4.8 orchestrator process that Quorum
   spawns and points at the `aether` MCP server. This is the "dispatch a fleet,
   poll, request a gated merge" loop (worked example in §6).

In both shapes the MCP server is a **face over the capability layer**, never a
second source of truth. The session truth source remains
`rust-pty-manager` / `rust-mux-manager` exactly as the daemon contract already
claims (`src-tauri/src/api/mod.rs:1858-1863`).

---

## 2. Transport

### 2.1 Recommendation: stdio for local single-operator

The default and recommended transport is **stdio**. Rationale:

- Quorum is a **local-only**, single-operator desktop app (Tauri). The MCP
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
| Bearer token | `QUORUM_API_TOKEN` env var; random UUID generated + logged once if unset | `src-tauri/src/api/mod.rs:676-689` |
| Constant-time compare | `subtle::ConstantTimeEq` via `ct_eq` | `src-tauri/src/api/mod.rs:710-739` |
| Loopback bind only | `SocketAddr::from(([127,0,0,1], port))` | `src-tauri/src/api/mod.rs:990-992` |
| Per-IP rate limit | `RateLimiter` token bucket, REST + WS buckets | `src-tauri/src/api/mod.rs:336-501` |
| Session cap | `MAX_PTY_SESSIONS = 32` | `src-tauri/src/api/mod.rs:98` |
| Sidecar token-file precedent | `aether-pty-server.token` file | `src-tauri/src/pty_sidecar.rs:17` |

The daemon **already exposes a non-webview MCP-shaped HTTP surface** today:
`/mcp/contract`, `/mcp/tools/list`, `/mcp/tools/call`
(`src-tauri/src/api/mod.rs:964-966`, handlers at `1842-1926`). That surface is
read-mostly (`terminal.list`, `terminal.capture`, `mux.workspaces.list`,
`mux.workspace.get`, `mux.workspace.safeInput` — `src-tauri/src/api/mod.rs:1734-1742`).
The `aether.mcp.v1` catalog in §3 **supersedes and extends** that prototype with the
full worktree/agent/diff/gate surface.

### 2.3 Loopback safety rules (HTTP transport only)

- Bind `127.0.0.1` only — never `0.0.0.0`. (Matches `serve` at `:990`.)
- Require `Authorization: Bearer <token>` on every call (`auth_middleware`,
  `src-tauri/src/api/mod.rs:741-804`).
- Reuse the existing typed error envelope (§5).
- The MCP tool surface is **single-token, single-tenant** — same assumption the
  ticket/rate-limit code already documents (`src-tauri/src/api/mod.rs:560-565`).

---

## 3. Tool catalog (`aether.mcp.v1`)

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
| `aether.list_worktrees` | **params** `{ repoPath: string }` → **return** `{ worktrees: WorktreeInfo[] }` where `WorktreeInfo = { name, path, branch, is_main, head_sha, status: "Clean"\|"Modified"\|"Conflicted" }` | `git::list_worktrees` `src-tauri/src/git/worktree.rs:29`; IPC `ipc::list_worktrees` `src-tauri/src/lib.rs:565` | FREE | Pure read. Includes the main worktree first (`worktree.rs:34-58`). |
| `aether.create_worktree` | **params** `{ repoPath: string, branch: string }` → **return** `WorktreeInfo` | `git::create_worktree` `src-tauri/src/git/worktree.rs:203`; IPC `ipc::create_worktree` `src-tauri/src/lib.rs:566` | FREE | Branch name MUST pass the **one shared validator** (`validate_branch_name` `worktree.rs:173`). Worktree path is deterministic via the **one shared worktree-path fn** (`predict_worktree_path` `worktree.rs:195`). Creating an isolated worktree is non-destructive to `main`. |
| `aether.remove_worktree` | **params** `{ repoPath: string, branch: string, deleteBranch?: boolean }` → **return** `{ ok: true }` | `git::remove_worktree` `src-tauri/src/git/worktree.rs:120`; IPC `ipc::remove_worktree` `src-tauri/src/lib.rs:567` | FREE | Force-removes via `git worktree remove --force` (`worktree.rs:127-131`) then prunes. Destroys only the *isolated* worktree, never `main`'s working tree, so it stays FREE. Branch deletion guarded by `show-ref` re-check (`worktree.rs:151-166`). |

### 3.2 Agent (fleet) domain

`AgentSession` is the unified backend session. On the interactive PTY path it is
`InteractiveSessionInfo` (`src-tauri/src/agent/interactive.rs:135`):
`{ id, pty_id, backend, cli, status, model, initial_prompt, cwd, worktree_branch, worktree_path, repo_path, cost, tokens_used, started_at }`.

| Tool | I/O (JSON) | Maps to | FREE/GATED | Notes |
|------|-----------|---------|------------|-------|
| `aether.spawn_agent` | **params** `{ role?: string, task: string, model?: string, repoPath: string, branch?: string, cols?: u16, rows?: u16 }` → **return** `SpawnResult = { session_id, pty_id, worktree_path: string\|null, backend }` | `spawn_interactive_agent` `src-tauri/src/ipc/interactive_commands.rs:52`; IPC `ipc::spawn_interactive_agent` `src-tauri/src/lib.rs:673` | FREE | `model` selects the CLI via `AgentCli::from_model` (`interactive.rs:98`); `task` → `initial_prompt` as an interactive prompt (positional/env delivery, **never `-p` / `--print` on the visible PTY path**). When `branch` is set, a worktree is auto-created (`interactive_commands.rs:83-95`) and mirrored as a ghost-diff layer (`interactive_commands.rs:196-222`). **`role` is a NEW field** — today role lives only in the frontend `AgentSession` (`src/shared/types/agent.ts:51`), so the capability layer must thread it into `InteractiveSessionInfo`. Spawning an agent in an isolated worktree is FREE; the agent itself is still subject to watchdog gating on *its* tool calls (§4.3). See `VISIBLE_AGENT_PANE_RUNTIME_SPEC.md` for the visible-vs-headless runtime boundary. |
| `aether.stop_agent` | **params** `{ sessionId: string, removeWorktree?: boolean }` → **return** `{ ok: true }` | `stop_interactive_agent` `src-tauri/src/ipc/interactive_commands.rs:292`; or `end_session_and_remove_worktree` `:331` when `removeWorktree=true`. IPC `:674-675` | FREE | Closes PTY, tears down native engine + ghost layer, unregisters session. `removeWorktree=true` additionally removes the worktree (`interactive_commands.rs:360-369`) — still FREE because it only deletes the *isolated* worktree. |
| `aether.fleet_status` | **params** `{}` → **return** `{ sessions: AgentSession[] }` (the `InteractiveSessionInfo[]` list) | `list_interactive_agents` `src-tauri/src/ipc/interactive_commands.rs:381`; IPC `ipc::list_interactive_agents` `src-tauri/src/lib.rs:676`. Live status maintained by `run_output_monitor` `interactive_commands.rs:424` | FREE | The fleet view. `status` is the run-status string set by the output monitor: `thinking`/`coding`/`idle`/`done`/`waiting`/`unknown` (`interactive_commands.rs:464-472`). See §3.6 for `AgentRunStatus` enum alignment. Frontend consumes the same data via the unified `useAgentFleet` hook (today `useAgentManager`, `src/shared/hooks/useAgentManager.ts`). |
| `aether.send_steer` | **params** `{ target: string, text: string }` → **return** `{ accepted: u32 }` | `send_keys_by_target` `src-tauri/src/ipc/commands.rs:5313`; IPC `ipc::send_keys_by_target` `src-tauri/src/lib.rs:639` | FREE | Mid-run guidance: writes keystrokes to a running agent's PTY. `target` resolves by exact PTY id, `@role`/`role:` prefix, or pane name (collision rejected) via `resolve_send_target` (`commands.rs:5325`). Payload validated by `validate_keys_payload` (`commands.rs:5318`). Every write is audited (`record_audit_event`, `commands.rs:5408`). FREE because steering an isolated agent does not bypass any human gate — the agent's downstream tool calls are still gated. |

### 3.3 Pane domain

| Tool | I/O (JSON) | Maps to | FREE/GATED | Notes |
|------|-----------|---------|------------|-------|
| `aether.split_pane` | **params** `{ workspaceId: string, targetPaneId: string, axis: "horizontal"\|"vertical", shell?: string, cwd?: string, title?: string, cols?: u16, rows?: u16 }` → **return** `{ paneId: string }` | `mux_split_pane` `src-tauri/src/ipc/commands.rs:2511`; IPC `ipc::mux_split_pane` `src-tauri/src/lib.rs:540`. HTTP precedent `POST /mux/workspaces/{id}/panes/split` `src-tauri/src/api/mod.rs:928` | FREE | Layout only. `axis` parsed by `parse_mux_axis` (`commands.rs:2525`); `cwd` validated by `validate_path` (`commands.rs:2531`). Routes through the sidecar when present (`commands.rs:2534-2550`). |

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
| `aether.agent_diff` | **params** `{ sessionId: string, against?: "base"\|"target", targetBranch?: string }` → **return** `{ source, content: { kind: "diff", base_revision, files: FileDelta[] } }` where `FileDelta = { path, ... hunks }` (`ghostdiff/layer.rs:86`) | `against:"base"` → existing worktree-layer diff (`ghostdiff/mod.rs:41`, layer keyed by `sessionId`). `against:"target"` → `LayerSource::BranchComparison` (`ghostdiff/layer.rs:40`). A read accessor over the `LayerRegistry` snapshot (`ghostdiff/registry.rs`, re-exported `ghostdiff/mod.rs:28`) is **NEW** as an MCP/IPC read tool. | FREE | Pure read of the diff overlay. `against` defaults to `"base"`. For `"target"`, `targetBranch` is required and goes through the same branch validator. No file content is mutated. This is how the orchestrator *observes* an agent's progress before deciding to request a merge (§4). |

### 3.5 Approval & merge domain (GATED — the safety boundary)

These tools NEVER complete the privileged action. They enqueue an **intent** that
the watchdog policy engine + human inbox resolve. See §4.

| Tool | I/O (JSON) | Maps to | FREE/GATED | Notes |
|------|-----------|---------|------------|-------|
| `aether.request_approval` | **params** `{ sessionId: string, tool: string, summary?: string, risk?: "low"\|"medium"\|"high"\|"critical" }` → **return** `{ intentId: string, status: "auto_approved"\|"auto_denied"\|"pending", rule?: string }` | Watchdog evaluation `WatchdogEngine::evaluate` `src-tauri/src/watchdog/engine.rs:30` → `WatchdogDecision::{AutoApprove,AutoDeny,AskUser}` (`engine.rs:7-14`). `AskUser` surfaces to the human inbox as a `permission_required` decision (`src/shared/lib/decisionInbox.ts:5-12`). The enqueue/observe IPC pair is **NEW**; the *decision engine* exists. | **GATED** | The orchestrator submits a request; the **engine** decides. Low-risk patterns auto-approve (`engine.rs:35-47`), unmatched → `AskUser` → routes to the human Decision Inbox (`src/features/decision-inbox/DecisionInboxPanel.tsx`). The tool returns the **decision status**, it does not *make* the decision. No `grant` parameter exists by construction. |
| `aether.list_pending_approvals` | **params** `{}` → **return** `{ pending: HumanDecisionItem[] }` (`src/shared/lib/decisionInbox.ts:25-43`) | Derived from the decision inbox model (`buildDecisionInbox`, `src/shared/lib/decisionInbox.ts`), fed by agent watchdog events (`watchdog-decision-{sessionId}`, `src-tauri/src/ipc/commands.rs:4269-4292`) and audit events. A read IPC/MCP accessor is **NEW**. | **GATED (observe-only)** | Read-only poll of the human queue. Returns `pending` items only; the orchestrator uses this to *wait* for a human/engine decision. It cannot resolve an item. |
| `aether.request_merge` | **params** `{ sessionId: string, sourceBranch: string, targetBranch: string }` → **return** `{ intentId: string, status: "queued", stagedCommitSha?: string }` | **NEW.** No merge-to-`main` command exists in the codebase today (confirmed: only `git_commit`/`git_push`/`git_stage` IPC, and `remove_worktree`). Must be built as a **staging** capability: commit the worktree, then enqueue a `merge_conflict_strategy`/`destructive_operation` decision (`src/shared/lib/decisionInbox.ts:5-12`). | **GATED** | NEVER fast-forwards or merges to `main`. It *stages* the agent's branch and enqueues a human/engine decision. Returns `status:"queued"`, never `"done"`. The actual merge is performed only after a human grant via the Cockpit UI (Face 1). The orchestrator polls `list_pending_approvals` for resolution. |

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

---

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

The orchestrator's only follow-up is to **poll** `aether.list_pending_approvals`
(or `aether.fleet_status` for the `waiting_approval` run status). It never resolves
its own request.

### 4.2 The grant path (who can actually say yes)

```
orchestrator (Face 2)                 watchdog engine                 human (Face 1)
  aether.request_approval ───────────▶ WatchdogEngine::evaluate
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

- The watchdog rules live at `~/.aether/watchdog.json`
  (`src-tauri/src/watchdog/mod.rs:13-30`); patterns are glob-matched
  (`engine.rs:64-107`). Only the operator edits these (via the Watchdog rule
  dialog, Face 1). The orchestrator cannot add an auto-approve rule for itself —
  rule mutation is not in the MCP catalog.
- `AskUser` → the item shows up in the human Decision Inbox as one of the
  `HumanDecisionType` values (`src/shared/lib/decisionInbox.ts:5-12`). Only a
  human action there resolves it.

### 4.3 Defense in depth: spawned agents are themselves gated

`aether.spawn_agent` is FREE, but the spawned agent's *own* tool calls flow
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
- MCP arg coercion → `json_arg_string` / `json_arg_usize` / `json_arg_bool`
  (`api/mod.rs:1744-1781`).

### 5.3 Versioned schema

- Schema id: **`aether.mcp.v1`**. The existing prototype uses
  `aether.mcp.server.v1` (`api/mod.rs:1844`, `:1869`); `aether.mcp.v1` is the
  forward-compatible umbrella for the full catalog.
- `tools/list` advertises per-tool `inputSchema` (JSON Schema, `additionalProperties:false`)
  exactly as the prototype already does (`api/mod.rs:1867-1921`).
- New tool *additions* are minor (v1.x). Removing/renaming a tool, changing a
  `FREE`↔`GATED` classification, or changing a return shape is a **major** bump
  (`aether.mcp.v2`), since reclassifying a gate is a safety-relevant change.
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
→ aether.spawn_agent { role:"impl", task:"build auth module",  model:"opus",   repoPath:"C:/proj", branch:"feat/auth" }
← { session_id:"s-a1", pty_id:"s-a1", worktree_path:"C:/proj-feat/auth", backend:"sidecar" }
→ aether.spawn_agent { role:"impl", task:"build cache layer",   model:"sonnet", repoPath:"C:/proj", branch:"feat/cache" }
← { session_id:"s-b2", ... }
→ aether.spawn_agent { role:"impl", task:"build api routes",    model:"sonnet", repoPath:"C:/proj", branch:"feat/api" }
← { session_id:"s-c3", ... }

# 2. Poll the fleet (FREE) until status settles.
→ aether.fleet_status {}
← { sessions:[
    { id:"s-a1", status:"done",    worktree_branch:"feat/auth",  cost:0.42, ... },
    { id:"s-b2", status:"coding",  worktree_branch:"feat/cache", ... },
    { id:"s-c3", status:"waiting_approval", worktree_branch:"feat/api", ... } ] }

# 3. Inspect the finished agent's diff (FREE, observe-only).
→ aether.agent_diff { sessionId:"s-a1", against:"target", targetBranch:"main" }
← { source:{ kind:"branchComparison", baseBranch:"main", headBranch:"feat/auth" },
    content:{ kind:"diff", base_revision:"main", files:[ { path:"src/auth.rs", ... } ] } }

# 4. Steer the still-coding agent (FREE).
→ aether.send_steer { target:"s-b2", text:"use the existing LRU in shared/lib, don't add a dep\r" }
← { accepted:1 }

# 5. s-c3 is waiting on a human gate — observe, do NOT grant.
→ aether.list_pending_approvals {}
← { pending:[ { id:"d-9", type:"permission_required", sessionId:"s-c3",
               risk:"high", status:"pending", title:"write outside workspace" } ] }
   # The orchestrator records this and moves on. It cannot resolve d-9.

# 6. Request a GATED merge of the ready branch. This STAGES — it never merges main.
→ aether.request_merge { sessionId:"s-a1", sourceBranch:"feat/auth", targetBranch:"main" }
← { intentId:"m-7", status:"queued", stagedCommitSha:"abc1234" }
   # status:"queued", NOT "done". A human grants in the Cockpit UI; the engine
   # never auto-merges to main.

# 7. Poll for the human decision (observe-only loop).
→ aether.list_pending_approvals {}
← { pending:[ { id:"m-7", type:"merge_conflict_strategy", status:"pending", risk:"high" } ] }
   # ... repeat until the human resolves it in Face 1; m-7 leaves `pending`.

# 8. Clean up the merged worktree (FREE).
→ aether.stop_agent { sessionId:"s-a1", removeWorktree:true }
← { ok:true }
```

Key takeaways the example demonstrates:
- Steps 1-4, 8 are FREE — the orchestrator runs the whole fan-out/observe/steer
  loop with zero human friction.
- Steps 5-7 are GATED — every privileged transition is `pending`/`queued`, and the
  only resolver is the watchdog engine or a human in Face 1. The orchestrator's
  role is strictly request + observe + poll.
