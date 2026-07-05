# WU-FA-1 — Fleet API & Hardening Wave 1: Requirements / Spec / Design (2026-07-03)

> **STATUS: APPROVED WORK-UNIT SPEC — implementation target, not a shipped
> claim.** Execution order lives in `fleet-api-instructions.md` (repo root).
> Parent decision record: `PRODUCT_DIRECTION_PROPOSALS_2026-07-03.md`
> (items C1, C2, C3, A1, A2, A3b, A4.1-A4.4). Claim policy applies: each
> capability is claimable only when its gate in §5 is green.

## 0. Goal in one sentence

Close the two known correctness/safety bugs in the fleet write/completion
paths, then make the control plane self-sufficient: an orchestrator or an
in-pane agent must be able to resolve approvals, spawn visible agents,
address panes by short id, and label its own pane — through the SAME
governed internals the cockpit uses, never through new parallel paths.

## 1. Requirements

### Functional
- **FR-1 (C1)** No keystroke write path may deliver input to a pane whose
  interactive session is `waiting_approval`, except the approval-resolution
  path carrying a matching prompt fingerprint. Broadcast/fan-out writes must
  SKIP such panes and report the skip; they must not error the whole batch.
- **FR-2 (C2)** Task completion markers must be collision-free: two distinct
  tasks can never resolve to the same marker file, even when they share a
  worktree or their ids differ only in sanitized-away characters.
- **FR-3 (A1)** MCP exposes `aelyris.approval.resolve` with the same
  fail-closed fingerprint contract as the IPC command (stale approval ⇒
  typed `stale_approval` error; missing fingerprint ⇒ fail closed).
- **FR-4 (A2)** MCP exposes `aelyris.agent.spawn_visible` that spawns the
  SAME visible interactive TUI agent as the cockpit (cost gate BR7 included),
  returning the same `SpawnResult`.
- **FR-5 (A3b)** Every terminal gets a session-scoped short id `%N`
  (monotonic, unique within an app run, never reused within a run). All
  terminal-addressed verbs (IPC send/capture, MCP verbs added here, `aelys`)
  accept either a UUID or `%N`. `%N` appears in the pane header and in fleet
  snapshots.
- **FR-6 (A4.1)** `aelys mcp <verb> [json]` invokes any catalog verb through
  `POST /mcp/tools/call` with the existing token auth; non-`ok` results exit
  non-zero with the error on stderr.
- **FR-7 (A4.2)** Inside a pane, `aelys` defaults its target terminal to
  `$AELYRIS_TERMINAL_ID` when the argument is omitted (send / capture /
  report). Outside a pane with no target ⇒ explicit error, never guessing.
- **FR-8 (A4.3)** An agent can label its own pane: MCP verbs
  `aelyris.pane.rename` and `aelyris.pane.set_role`, plus CLI sugar
  `aelys report --title "<text>"` (rename of `$AELYRIS_TERMINAL_ID`).
- **FR-9 (A4.4, stretch)** `aelys notify-on-exit -- <cmd…>` runs a command,
  and on exit publishes an EventBus event + Windows toast carrying exit code
  and the pane's short id.

### Non-functional
- **NFR-1** No new parallel implementations: every new verb/subcommand
  delegates to the existing internal function that the cockpit path uses.
- **NFR-2** Every new MCP verb goes through the existing `tools_call`
  pipeline: governance authorize → schema validation → dispatch. All new
  verbs are GATED (risk-classified); none is FREE.
- **NFR-3 (C3)** `tools_call` dispatch must not rebuild the verb catalog per
  request (memoized catalog + O(1) schema lookup).
- **NFR-4** No verifier is weakened. New behavior gets new checks (§5).
- **NFR-5** `%N` ids are display/addressing sugar only — persistence,
  audit events, and cross-restart identity keep using UUIDs. `%N` is
  resolved to a UUID at the API boundary and never stored.

## 2. Interface specification

### 2.1 MCP verbs (all GATED, `additionalProperties: false`)

| Verb | Params | Returns | Errors |
|---|---|---|---|
| `aelyris.approval.resolve` | `{ terminalId: string, decision: "approve"\|"deny", expectedPromptKey: string }` (all required) | `{ ok: true }` | `stale_approval: …` (typed, from the shared core fn); unknown terminal; schema violation |
| `aelyris.agent.spawn_visible` | `{ cwd: string, model?: string, initialPrompt?: string, branchName?: string, cols?: integer, rows?: integer }` (`cols`/`rows` default 120/30, min 20/10, max 500/200) | `SpawnResult` (`session_id`, `pty_id`, `worktree_path`, `backend`) | cost-cap denial (BR7 message passthrough); invalid branch name; CLI validation error |
| `aelyris.pane.rename` | `{ terminalId: string, name: string (1..120 chars) }` | `{ ok: true }` | unknown terminal |
| `aelyris.pane.set_role` | `{ terminalId: string, role: string (1..40 chars) }` | `{ ok: true }` | unknown terminal |

`terminalId` in the three terminal-addressed verbs (`approval.resolve`,
`pane.rename`, `pane.set_role`) accepts `"%<N>"` or a UUID (see §3.3);
`agent.spawn_visible` creates a new pane and takes no `terminalId`.
The catalog drift test (`catalog_and_schemas_list_exactly_the_same_verbs`)
automatically covers the new entries; schemas must be added to BOTH the
catalog and the schema list or that test fails — that is intended.

### 2.2 `aelys` CLI additions

```
aelys mcp <verb> [json-arguments]        # passthrough to POST /mcp/tools/call
aelys report --title "<text>"           # = aelyris.pane.rename on $AELYRIS_TERMINAL_ID
aelys send [<target>] <text> [--enter]  # target now optional in-pane; accepts %N
aelys capture [<target>] [--lines N]    # same
aelys notify-on-exit -- <cmd…>          # stretch (FR-9)
```

- `json-arguments` omitted ⇒ `{}`. Invalid JSON ⇒ usage error before any HTTP.
- Exit codes: 0 = HTTP 200 with `ok != false`; 2 = tool error (`ok:false` /
  `schema_violation`); 1 = transport/auth errors. Result JSON to stdout,
  errors to stderr.

### 2.3 Short id (`%N`) semantics

- Assigned at terminal registration from an `AtomicU32` counter starting
  at 1, per app-process lifetime. Sidecar-adopted terminals get ids on
  adoption (order of adoption). Not persisted; a restart renumbers.
- Rendered as `%3` in: pane header (TerminalInfoBar), `list_panes_info`,
  fleet snapshot (`AgentSession.short_id: Option<u32>`), `aelys sessions`.
- Resolution: one shared helper (`resolve_terminal_ref`, §3.3). `%N` that
  matches nothing ⇒ typed "unknown terminal reference" error (fail closed,
  no fuzzy match).

## 3. Design

### 3.1 Delegation map (NFR-1) — the whole design in one table

| New surface | Delegates to (existing) | File anchor |
|---|---|---|
| `aelyris.approval.resolve` | `resolve_interactive_approval_core` — extracted from the body of `resolve_interactive_approval` (`#[tauri::command]` wrapper keeps IPC face byte-compatible) | `src-tauri/src/ipc/send_keys_commands.rs:158` |
| `aelyris.agent.spawn_visible` | `spawn_interactive_agent_internal(...)` with `SpawnInteractiveAgentOptions::default()` | `src-tauri/src/ipc/interactive_commands.rs:85` |
| `aelyris.pane.rename` / `set_role` | `rename_pane` / `set_pane_role` internals (extract cores the same way as approval) | `src-tauri/src/ipc/send_keys_commands.rs:360,384` |
| `aelys mcp` | HTTP `POST /mcp/tools/call` (route exists, `src-tauri/src/api/mod.rs`) | `src-tauri/src/bin/aelys.rs` (client) |
| broadcast guard | `InteractiveSessionManager::list()` lookup inside `write_to_terminals` under the already-held `terminal_write_order_lock` | `send_keys_commands.rs:551-625` |
| marker path | `done_marker_path` gains the pane's `terminal_id` component | `src-tauri/src/control/pane_fleet.rs:67-75` |

Extraction rule for "core" functions: move the body into
`pub(crate) async fn <name>_core(app: &AppHandle, …)`, keep the
`#[tauri::command]` wrapper as a one-line delegate. No behavior change; the
existing Rust tests for the command must keep passing unmodified (that is
the no-drift proof for the refactor step).

### 3.2 C1 — uniform stale-approval guard (design)

In `write_to_terminals` (shared by broadcast/by_name/by_role/by_target) and
in single `send_keys`, after acquiring the per-terminal write lock and
BEFORE `gate_ipc_input`:

1. Look up the interactive session owning this pty (`find by pty_id`; the
   helper exists at `send_keys_commands.rs:104`).
2. If a session exists AND `status == "waiting_approval"`:
   - fan-out paths: **skip** this terminal; append
     `{ terminalId, reason: "waiting_approval" }` to a new `skipped` array in
     the result struct (additive field — FE ignores unknown fields).
   - single-target `send_keys`: return a typed error
     `blocked_waiting_approval: terminal <id> is at an approval gate; use the
     Decision Inbox or aelyris.approval.resolve` (do NOT silently drop a
     targeted write).
3. No session (plain shell pane) ⇒ unchanged behavior.

The approval-resolution path is exempt by construction (it does not go
through `write_to_terminals`). Audit: emit one `agent`-category audit event
per skipped pane (throttle: one per pane per approval episode is fine —
keying on the prompt fingerprint already stored on the session).

### 3.3 A3b — short ids (design)

- Storage: the pane metadata registry (`src-tauri/src/pty/registry.rs`)
  gains `short_id: u32`, assigned in `PtyManager` at spawn/adopt time from a
  process-global `AtomicU32` (`fetch_add(1) + 1`).
- Resolution helper in ONE place (`pty/registry.rs`):
  `pub fn resolve_terminal_ref(&self, r: &str) -> Result<String, String>` —
  `"%N"` → registry lookup; anything else → returned as-is (UUID path
  validated downstream exactly as today). Every new MCP verb and the `aelys`
  target parsing call this helper; existing IPC commands MAY adopt it in a
  later WU (out of scope here — do not touch their signatures).
- FE: `list_panes_info` and the fleet snapshot carry `short_id`;
  `TerminalInfoBar` prefixes the title with `%N ·`. (Keep it to those two
  surfaces; the UI-density WU will consolidate the header strip.)

### 3.4 C2 — marker collision (design)

`done_marker_relative_path(task_id, terminal_id)` =
`.aelyris/done/<sanitize(task_id)>-<terminal_id>.done`.
`terminal_id` is a UUID (filesystem-safe as-is). The prompt-injected
contract (`completion_marker_section`, `src-tauri/src/control/loop_ports.rs:493-500`
area) must emit the SAME path — single source: move path construction into
one function used by both the poller and the prompt builder, so they cannot
drift (the existing prompt-contract test then locks it).

### 3.5 C3 — catalog memoization (design)

`static CATALOG: LazyLock<serde_json::Value>` +
`static SCHEMA_INDEX: LazyLock<HashMap<&'static str, serde_json::Value>>`
in `api/mcp.rs`. `tools_list_value()` returns a clone of (or serializes
from) `CATALOG`; `input_schema_for_tool` becomes an index lookup. The drift
test and the "unknown verb rejected at dispatch" behavior are unchanged.

## 4. Out of scope (do not do in this WU)

- Governance principal resolution / mux-route gating (C5) — separate WU.
- Knowledge-graph live indexing (C4) — separate WU.
- Workflow/cost MCP verbs (A5) — separate WU.
- Any UI-density work — `ui-density-instructions.md` owns it.
- Retrofitting `%N` into existing IPC command signatures.

## 5. Acceptance gates (all must be green before the WU is claimed)

1. `cargo test --manifest-path src-tauri/Cargo.toml --lib` — including NEW
   tests listed per phase in `fleet-api-instructions.md`.
2. `pnpm exec tsc --noEmit` + `pnpm test` (FE touched only in A3b surfaces).
3. MCP drift test (`catalog_and_schemas_list_exactly_the_same_verbs`) green
   with the four new verbs present in both catalog and schema list.
4. `node scripts/verify-runtime-core-preconditions.mjs` — EXTENDED with:
   (a) broadcast/write_to_terminals contains the waiting_approval skip guard;
   (b) `aelyris.approval.resolve` dispatch delegates to
   `resolve_interactive_approval_core`; (c) marker path includes terminal_id.
5. `pnpm verify:release:hygiene` pass.
6. `aelys` build (`cargo build --bin aelys`) + a Rust unit test for the `%N`
   resolver and the mcp-subcommand arg parsing (HTTP not required in test —
   parse/URL construction level).
7. No modification that loosens ANY existing assertion (reviewer will diff
   test files for weakened expectations — the WU-RT-1 review discipline).
