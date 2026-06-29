# Aelyris Agent Message Bus Superset Requirements / Specification / Design

Date: 2026-06-28 JST
Status: design ready for work-unit planning; implementation not complete
Related plan: `../../PLAN.md`
Related public copy: `../GITHUB_INTRODUCTION.md`

Naming note: **Aelyris** is the product name, pronounced **Aelys** / **エイリス**. The CLI and short name is `aelys`. Product surfaces use **Aelyris Core**, **Aelyris Grid**, and **Aelyris Pane**. **Qralis** is the coordination engine name for messaging, roles, directives, and multi-agent coordination. This document turns the `agmsg` comparative audit into Aelyris/Qralis requirements,
specification, and implementation design. The goal is not to copy `agmsg` as a
standalone CLI. The goal is to make Aelyris a strict superset of that class of
local agent messaging, then exceed it by binding messages to visible panes,
TaskGraph, worktrees, review, merge, and evidence.

Audited reference:

- `https://github.com/fujibee/agmsg`
- `https://github.com/fujibee/agmsg/blob/main/ARCHITECTURE.md`

## 1. Audit Verdict

Current verdict: **BLOCK for strict agmsg superset claims**.

Aelyris already has a stronger product substrate than `agmsg`: Tauri/Rust
workspace UI, real terminal panes, TaskGraph, EventBus, MCP/control APIs,
worktree isolation, file/symbol ownership, review/merge gates, and release
evidence. However, it does not yet implement the concrete local agent-message
contract that makes `agmsg` sharp.

Missing or weaker than `agmsg` today:

- Addressed inbox/history/read-state API.
- Delivery policy equivalent to `monitor`, `turn`, `both`, and `off`.
- Persistent `actas`-style role exclusivity locks.
- Peer agent spawn/ready/despawn lifecycle tied to messaging.
- Storage/agent/delivery driver contracts.
- Machine-readable host directives similar to `AGMSG-DIRECTIVE`.
- Append-only message log with stable message ids such as UUIDv7.
- Explicit plugin/driver trust model.
- Watch-once / no-empty-worker safety gates.
- No-loss and backpressure semantics for message publication.

Aelyris can still claim a broader AI development workspace direction, but it must
not claim strict `agmsg` superset behavior until the gates in this document are
green.

## 2. Product Requirement

Aelyris must provide a local-first coordination layer where AI agents and human
operators can exchange durable, addressed messages that are visible, replayable,
permissioned, and connected to the actual project work.

The message layer must become part of the shared backend truth, not a frontend
chat widget and not a loose log file. It must feed and be fed by TaskGraph,
visible panes, worktrees, review gates, ownership, merge intent, and evidence.

## 3. Requirement Set

| ID | Requirement | Current status |
| --- | --- | --- |
| AMB-R1 | Local message bus backed by SQLite/WAL and repo-local project identity. | BLOCK |
| AMB-R2 | Addressed messages with inbox, history, read/ack state, sender, recipient, role, task, pane, and evidence refs. | BLOCK |
| AMB-R3 | Delivery modes: `monitor`, `turn`, `both`, `off`, plus Aelyris policy hooks for review-gated and task-scoped delivery. | BLOCK |
| AMB-R4 | Team and agent identity: whoami/team list, role membership, active/inactive state, driver identity, and session linkage. | REVIEW |
| AMB-R5 | Persistent role leases equivalent to `actas`: acquire, renew, release, steal-with-reason, expiry, and audit events. | BLOCK |
| AMB-R6 | Peer lifecycle: spawn, ready sentinel, health, graceful despawn, force despawn, and message-route cleanup. | REVIEW |
| AMB-R7 | Directive protocol for host actions: parse, validate, gate, execute, record, and fail closed. | BLOCK |
| AMB-R8 | Driver model: storage, agent runtime, delivery, and trust/capability drivers are explicit contracts with tests. | BLOCK |
| AMB-R9 | Append-only message/event log with UUIDv7 message ids, sequence cursors, projections, idempotency, and replay. | BLOCK |
| AMB-R10 | Plugin/driver trust model with path-pinned allowlist, manifest capabilities, and scoped access. | BLOCK |
| AMB-R11 | Watch-once and no-empty-worker guardrails: do not launch heavy agents just to discover an empty inbox. | BLOCK |
| AMB-R12 | UI cockpit integration: inbox, role leases, directives, message thread, pane/task/review evidence are visible and actionable. | BLOCK |
| AMB-R13 | Verifier gates prove the above and block public claims until current artifacts are green. | BLOCK |

## 4. Public Claim Boundary

Allowed before implementation:

> Aelyris is designing a local-first agent coordination layer that will connect
> messages, tasks, panes, reviews, and evidence in one workspace.

Forbidden until gates pass:

- strict `agmsg` superset,
- completed agent message bus,
- fully autonomous swarm intelligence,
- completed autonomous multi-agent platform,
- release-ready multi-agent coordination.

## 5. API Specification

Qralis API names are the target public/internal contract for the coordination layer. Any legacy implementation aliases must be treated as compatibility shims, not public names.

### Message API

| API | Authority | Purpose |
| --- | --- | --- |
| `qralis.message.send` | FREE or scoped WRITE | Send an addressed message to an agent, role, task, or team. |
| `qralis.message.inbox` | FREE | Read the caller's inbox projection. |
| `qralis.message.history` | FREE | Read immutable message history for a thread, task, agent, or role. |
| `qralis.message.ack` | FREE | Mark delivery/read state for a message. |
| `qralis.message.watch` | FREE streaming | Stream eligible messages according to delivery policy. |
| `qralis.message.thread` | FREE | Return a conversation thread with evidence and task refs. |

### Identity And Role Lease API

| API | Authority | Purpose |
| --- | --- | --- |
| `qralis.team.whoami` | FREE | Resolve current team, agent identity, driver, and session. |
| `qralis.team.list_agents` | FREE | List known agents and their roles/status. |
| `qralis.role.acquire` | GATED when stealing | Acquire an exclusive role lease. |
| `qralis.role.renew` | FREE for holder | Extend an existing lease. |
| `qralis.role.release` | FREE for holder | Release a lease. |
| `qralis.role.status` | FREE | Inspect role holders and lease expiry. |

### Directive API

| API | Authority | Purpose |
| --- | --- | --- |
| `qralis.directive.submit` | FREE parse, GATED execute | Submit a host-action directive from an agent output. |
| `qralis.directive.preview` | FREE | Show intended action, authority, and risk. |
| `qralis.directive.apply` | GATED | Execute after policy approval. |
| `qralis.directive.status` | FREE | Read durable outcome and audit refs. |

Directive schema baseline:

```json
{
  "schema": "qralis.directive.v1",
  "id": "uuidv7-or-equivalent",
  "issuedBy": "agent-id",
  "taskId": "task-id-or-null",
  "action": "install_dependency | spawn_agent | open_file | run_verifier | request_approval",
  "args": {},
  "reason": "human-readable reason",
  "idempotencyKey": "stable-key",
  "requiresApproval": true
}
```

Unknown actions, malformed JSON, missing ids, missing authority, or untrusted
plugin origins must fail closed and write an audit event.

## 6. Data Model Specification

Minimum tables or equivalent repositories:

| Store | Required fields |
| --- | --- |
| `agent_identities` | `id`, `team_id`, `driver`, `session_id`, `role`, `status`, `created_at`, `last_seen_at` |
| `agent_messages` | `id` UUIDv7, `thread_id`, `sender_id`, `recipient_kind`, `recipient_id`, `task_id`, `pane_id`, `body`, `idempotency_key`, `created_at` |
| `agent_message_events` | `seq`, `id` UUIDv7, `message_id`, `kind`, `payload_json`, `idempotency_key`, `created_at` |
| `agent_inbox_cursors` | `agent_id`, `message_id`, `delivered_at`, `read_at`, `ack_state` |
| `agent_delivery_policies` | `scope_kind`, `scope_id`, `mode`, `updated_at` |
| `agent_role_leases` | `role`, `holder_agent_id`, `lease_id`, `expires_at`, `steal_reason`, `created_at` |
| `agent_directives` | `id`, `status`, `issuer_agent_id`, `action`, `args_json`, `risk`, `audit_event_id`, `created_at` |
| `agent_driver_manifests` | `driver_id`, `kind`, `manifest_json`, `trusted`, `capabilities_json`, `source_path` |

Hard requirements:

- SQLite WAL enabled where this state lives.
- Migrations must include schema versioning, foreign keys, and indexes for inbox, history, role lease, and directive hot paths.
- Append-only message events are the source of message lifecycle truth.
- Projections such as inbox/read state can be rebuilt from events.
- Sequence cursors remain available alongside UUIDv7 ids.
- Publishers must not silently drop messages when persistence is unavailable.
  They must fail, backpressure, or write a durable degraded record.

## 7. Delivery Modes

| Mode | Behavior | Gate expectation |
| --- | --- | --- |
| `monitor` | Eligible messages stream immediately to the visible operator/agent monitor. | Proof that live stream receives the message without waiting for turn boundary. |
| `turn` | Messages are held for the next safe turn/checkpoint. | Proof that messages do not interrupt active tool execution. |
| `both` | Stream now and keep turn-boundary delivery. | Proof that duplicate handling is idempotent through `message_id` plus `idempotency_key`. |
| `off` | No automatic delivery; manual inbox/history only. | Proof that no process is spawned and no stream event is delivered. |

Aelyris-specific extension:

- `review_gate`: deliver when a task reaches review or conflict state.
- `task_scope`: deliver only to agents bound to a task/lane/worktree.
- `human_only`: visible to the operator but not injected into agent context.

## 8. Implementation Design

New backend module boundary:

```text
src-tauri/src/agent_message/
  mod.rs
  model.rs
  repo.rs
  service.rs
  delivery.rs
  role_lease.rs
  directive.rs
  driver.rs
  verifier_fixtures.rs
```

Adapter boundaries:

- `src-tauri/src/persistence/*`: migrations and repositories only.
- `src-tauri/src/api/mcp.rs`: MCP verbs; no domain logic.
- `src-tauri/src/ipc/*`: Tauri commands; no domain logic.
- `src-tauri/src/orchestrator/*`: consumes message/lease service through a port.
- `src/features/*`: UI projections only; backend remains source of truth.

Frontend surfaces:

```text
src/features/agent-inbox/
src/features/agent-message-thread/
src/features/role-leases/
src/features/directive-review/
```

Integration points:

- TaskGraph tasks can reference message thread ids.
- Visible agent panes show current role lease and recent addressed messages.
- Review surface can convert reviewer findings into addressed messages.
- Merge intent can include message/evidence thread ids.
- Release evidence can include message-bus verifier artifacts.

## 9. Work Units

| WU | Scope | Output | Gate |
| --- | --- | --- | --- |
| AMB-0 | Add docs/spec/plan and claim blockers. | This document plus traceability updates. | Docs review. |
| AMB-1 | SQLite schema and repositories. | Migrations, repo tests, WAL proof. | `pnpm verify:agent-message:schema` |
| AMB-2 | Message service and MCP/Tauri APIs. | Send/inbox/history/ack/watch. | `pnpm verify:agent-message:contract` |
| AMB-3 | Delivery policies. | monitor/turn/both/off. | `pnpm verify:agent-message:delivery` |
| AMB-4 | Role leases. | acquire/renew/release/steal. | `pnpm verify:agent-role-lease` |
| AMB-5 | Directive protocol. | parser, preview, gated apply, audit. | `pnpm verify:agent-directive-gate` |
| AMB-6 | UI cockpit surfaces. | inbox/thread/lease/directive review. | `pnpm verify:agent-message:ui-smoke`, `.codex-auto/quality/agent-message-ui-smoke.json` |
| AMB-7 | Orchestrator integration. | TaskGraph, worktree, pane, review, merge refs. | `pnpm verify:goal:orchestration` extension |
| AMB-8 | Driver and trust model. | manifest, allowlist, capability gates. | `pnpm verify:agent-driver-trust` |
| AMB-9 | Reliability and replay. | no-loss/backpressure/rebuild tests. | `pnpm verify:agent-message:replay`, `.codex-auto/quality/agent-message-replay.json` |
| AMB-10 | Superset claim gate. | aggregate verifier. | `pnpm verify:agmsg-superset` |

## 10. Verification Contract

New verifier artifacts should live under `.codex-auto/quality/`:

- `agent-message-schema.json`
- `agent-message-contract.json`
- `agent-message-delivery.json`
- `agent-role-lease.json`
- `agent-directive-gate.json`
- `agent-driver-trust.json`
- `agmsg-superset.json`

The aggregate `agmsg-superset` gate must require current passing artifacts for
message contract, delivery policy, role leases, directives, driver trust,
watch-once guardrails, and replay/no-loss behavior.

Until that gate is green, `score-release-quality` and public docs must treat
strict agmsg superset claims as blocked.

## 11. Security And Trust Rules

- Untrusted drivers cannot read arbitrary message history.
- Untrusted plugins cannot register executable directives.
- Directives cannot run shell or filesystem mutations without existing command
  risk approval and audit binding.
- Agent identity cannot be self-asserted without session/driver binding.
- Role stealing requires reason, previous holder, new holder, and audit event.
- Message body redaction must apply before public logs or release artifacts.

## 12. Open Decisions

- When to run a full brand/API rename. AMB-1 through AMB-10 use `qralis.*` APIs and `qralis.*.v1` schema literals for the coordination engine contract.
- Whether third-party `agmsg` import/export should be supported in v1 or deferred. Core Aelyris message ids use UUIDv7 plus sequence cursors.
- Whether compatibility with `agmsg` CLI file/database layout is required, or
  whether Aelyris only needs behavioral superset semantics.
- Whether third-party `agmsg` import/export should be supported.
- Which message bodies can be included in context packs by default.


