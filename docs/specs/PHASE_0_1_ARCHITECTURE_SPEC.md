# Phase 0 + Phase 1 Architecture Spec — Runtime Unification & Worktree Auto-Wiring

Status: Draft (implementation spec, no code).
Scope: Phase 0 (consolidation) + Phase 1 backend (worktree auto-wiring).
Audience: a fresh agent who must execute this cold.

This spec is grounded entirely in the current tree. Every claim carries a `file:line`
reference. Shared names (`AgentSession`, `useAgentFleet`, the canonical status taxonomy,
the single branch validator and worktree-path fn) are used verbatim so the three Phase
specs align.

> **North star (binding design — all sibling specs must agree).** Aether is an
> agent-controllable workspace. Its capabilities are **one** backend *Aether Control API*
> (a capability/intent layer). **Two faces** project onto that layer: (1) the human
> **Cockpit UI** via Tauri IPC, and (2) the **Orchestrator AI** (Opus 4.8) via an `aether`
> MCP server. We build the layer once; both faces are thin adapters over it. This spec
> defines the layer and the Cockpit face; the MCP face is specified in the sibling
> `MCP_TOOL_SURFACE_SPEC.md`. The capability domains are **worktree, agent, pane, diff,
> merge, approval**. A hard safety boundary (§5, *Gate model*) splits these into FREE tools
> any AI may call vs GATED operations (`approval`, merge-to-main) the AI may only *request /
> observe / route* — the grant authority is the watchdog policy engine, never the AI.

---

## 0. Current-state map (the problem)

Aether runs agents through **two fully parallel stacks** that never share a model:

| Concern | Headless stack | Interactive (PTY) stack |
|---|---|---|
| Backend manager | `AgentManager` — `src-tauri/src/agent/claude.rs:27` | `InteractiveSessionManager` — `src-tauri/src/agent/interactive.rs:154` |
| Backend session struct | `AgentSessionInfo` — `claude.rs:11` (8 fields) | `InteractiveSessionInfo` — `interactive.rs:135` (15 fields, has worktree) |
| Spawn IPC | `start_agent` — `src-tauri/src/ipc/commands.rs:4387` | `spawn_interactive_agent` — `src-tauri/src/ipc/interactive_commands.rs:52` |
| Frontend hook | `useAgentManager` — `src/shared/hooks/useAgentManager.ts:150` | `useInteractiveAgent` — `src/shared/hooks/useInteractiveAgent.ts:12` |
| Frontend session type | `AgentSession` — `src/shared/types/agent.ts:32` | `InteractiveSession` — `src/shared/types/interactiveAgent.ts:5` |
| Status type | `AgentStatus` union — `agent.ts:1` (7 states) | bare `status: string` — `interactiveAgent.ts:11` |
| Worktree support | **none** (cwd only) | yes (`create_worktree` at `interactive_commands.rs:85`) |

### Three concrete consequences

1. **Orchestra agents get no worktree.** The Orchestra dispatch path
   `handleStartRightRailOrchestra` (`src/App.tsx:4762`) builds prompts with
   `buildOrchestraPrompts` (`src/shared/lib/orchestrator.ts:262`) and launches each via
   `handleStartAgent` (`src/App.tsx:3845` → `useAgentManager.startAgent` →
   `start_agent`/`AgentManager`). That path has **no `branchName` parameter and no
   worktree** (`App.tsx:4787-4790`). Parallel orchestra lanes therefore all write into the
   same working tree — the exact file-conflict the orchestrator's own `conflictPolicy`
   text warns about (`orchestrator.ts:187`).

2. **Two divergent status taxonomies.** `AgentStatus` (`agent.ts:1`) has
   `idle|thinking|coding|waiting|error|done|generating`. The interactive monitor emits a
   different vocabulary as raw strings — `thinking|coding|idle|done|waiting|unknown`
   (`interactive_commands.rs:464-472`) derived from `DetectedStatus`
   (`output_monitor.rs:6`). Neither side has `spawning`, `running_tests`, `blocked`, or
   `waiting_approval`. Status is stringly-typed on the wire in both directions.

3. **Duplicated, *drifting* branch validators + a "keep in sync" worktree-path comment.**
   - `validate_branch_name` is **private** in `worktree.rs:173` (rejects `..`, `/`-prefix,
     `:`; allows ASCII alnum + `- _ / .`).
   - `spawn_interactive_agent` re-implements a **different** validator inline
     (`interactive_commands.rs:67-80`): uses `is_alphanumeric()` (Unicode, not ASCII),
     adds a 1-200 length cap, and rejects leading `-`/`.`. The two disagree on Unicode and
     on leading characters.
   - `predict_worktree_path` (`worktree.rs:195`) carries a comment that it "Mirrors the
     formula in `create_worktree`; the two must stay in sync" (`worktree.rs:194`) — a known
     manual-sync hazard.

---

## 0.5 Capability layer (Aether Control API)

Everything in §0 is a symptom of the same structural gap: **Aether's capabilities exist
only as scattered `#[tauri::command]` functions that are reachable from exactly one caller —
the webview.** `commands.rs` alone is 6795 lines / 140 commands
(`src-tauri/src/ipc/commands.rs:1`, registered at `lib.rs:526`), with more in
`interactive_commands.rs` and `ghostdiff_commands.rs`. There is no transport-agnostic seam:
the command bodies mix IPC marshalling, `AppHandle` state lookups, and the actual capability
logic. That makes a second face (the MCP server) impossible without copy-pasting logic.

The **Aether Control API** is the missing seam. It sits **UNDER** `useAgentFleet` (§1.3) and
**OVER** the runtimes (`PtyManager`, `AgentFleet`, `git2`, `LayerRegistry`, the watchdog
engine). It is a typed, in-process Rust surface — *not* a network service — that both faces
adapt onto:

```
        Cockpit UI (React)            Orchestrator AI (Opus 4.8)
              │                                │
        Tauri IPC adapter              'aether' MCP server adapter
        (ipc/*_commands.rs)            (MCP_TOOL_SURFACE_SPEC.md)
              └───────────────┬────────────────┘
                              ▼
                 Aether Control API   ← THIS layer (src-tauri/src/control/)
            worktree · agent · pane · diff · merge · approval
                              ▼
        PtyManager · AgentFleet · git2/worktree · LayerRegistry · WatchdogEngine
```

The two adapters are *thin*: each command/tool unwraps args, looks up runtime state, calls
**one** control-domain fn, and re-wraps the result. No capability logic lives in an adapter.

### 0.5.1 Canonical capability domains (the command set)

The six domains below are the canonical command set. Today each is a cluster of Tauri
commands reachable only from the webview; the layer formalizes each cluster into a domain
module. Real existing surfaces (the logic to be lifted, not rewritten):

| Domain | What it does | Today's commands (file:line) — to be lifted into the domain module |
|---|---|---|
| `worktree` | create / list / remove isolated trees; predict path; validate branch | `create_worktree` (`commands.rs:3546`) + `crate::git::create_worktree` (`worktree.rs:203`); `list_worktrees` (`commands.rs:3534` → `worktree.rs:29`); `remove_worktree` (`commands.rs:3555` → `worktree.rs:120`); `predict_worktree_path` (`worktree.rs:195`); `validate_branch_name` (`worktree.rs:173`, §3.1) |
| `agent` | spawn / list / stop / route agent sessions | `spawn_interactive_agent` (`interactive_commands.rs:52`, creates worktree at `:85`); `start_agent` (`commands.rs:4387`); `stop_agent` (`commands.rs:4507`); `list_agents` (`commands.rs:4518`); `route_agent` (`commands.rs:4525` → `router.rs:43`) |
| `pane` | split / route input to a multiplexer pane | `mux_split_pane` (`commands.rs:2511`); `send_keys_by_target` (`commands.rs:5313`) + `send_keys*` family; pane rename/role |
| `diff` | observe agent-owned change overlays (read-only view) | `list_ghost_layers` (`ghostdiff_commands.rs:27`); `get_ghost_layer_file` (`ghostdiff_commands.rs:40`); `start_branch_comparison` (read-only overlay, `ghostdiff_commands.rs:191`); `git_diff_file` (`commands.rs:3831`) |
| `merge` | promote agent changes into the user's main worktree | `apply_ghost_hunk` (`ghostdiff_commands.rs:98` → `apply_hunk_to_main`, `ghostdiff_commands.rs:131`); `apply_ghost_file` (`ghostdiff_commands.rs:154`, full-file write to main `:176`) — **GATED** (§5) |
| `approval` | evaluate a tool invocation against policy; route to inbox | `WatchdogEngine::evaluate` (`watchdog/engine.rs:30`); invoked in the agent stream at `commands.rs:4327`; the `AskUser` path feeds the human Decision Inbox (`src/features/decision-inbox/DecisionInboxPanel.tsx`) — **GATED, grant authority** (§5) |

> Note the read-only/mutating split inside ghostdiff is already enforced in code:
> `registry.is_read_only(layer_id)` rejects `apply_*` on branch-comparison layers
> (`ghostdiff_commands.rs:110,163`). The `diff` domain is the read side; `merge` is the
> write side. The layer makes that existing boundary an explicit domain boundary.

### 0.5.2 Proposed module shape (shapes only — no code)

New crate-internal module `src-tauri/src/control/` with one file per domain. Each domain
exposes plain Rust fns that take already-resolved runtime handles (not `AppHandle`), so they
are callable from any adapter and unit-testable without Tauri:

| File | Domain | Shape (signatures only — illustrative, no bodies) |
|---|---|---|
| `control/mod.rs` | re-export | `pub use {worktree,agent,pane,diff,merge,approval}::*;` + a `ControlError` enum the adapters map to their transport's error type. |
| `control/worktree.rs` | `worktree` | `create(repo, branch) -> WorktreeInfo`; `list(repo) -> Vec<WorktreeInfo>`; `remove(repo, name, delete_branch) -> ()`; `predict_path(repo, branch) -> PathBuf`; `validate_branch(name) -> Result<()>` (the §3.1 single validator). |
| `control/agent.rs` | `agent` | `spawn(fleet, SpawnSpec) -> SessionId`; `list(fleet) -> Vec<AgentSessionDto>`; `stop(fleet, id) -> ()`; `route(prompt, budget) -> RoutingDecision`. `SpawnSpec` carries `run_mode`, `cwd`, `prompt`, optional `branch_name` (§3). |
| `control/pane.rs` | `pane` | `split(mux, target, dir) -> PaneId`; `send_keys(mux, target, keys) -> ()`; `set_role(mux, pane, role) -> ()`. |
| `control/diff.rs` | `diff` | `list_layers(registry) -> LayerSnapshot`; `get_file(registry, layer, path) -> Option<FileDelta>`; `start_comparison(registry, repo, base, head) -> LayerSummary` (read-only). |
| `control/merge.rs` | `merge` | `apply_hunk(registry, layer, path, idx) -> ApplyResult`; `apply_file(registry, layer, path) -> ApplyResult`. **Every fn here is GATE-checked at the adapter boundary (§5); the AI face never reaches it directly.** |
| `control/approval.rs` | `approval` | `evaluate(engine, tool_name) -> WatchdogDecision`; `route_to_inbox(decision, ctx) -> InboxTicketId` for the `AskUser` branch. **Grant authority lives here; no `grant(...)` fn is exposed to the AI face.** |

The migration is incremental and *additive*: domain modules wrap the existing logic first
(the current command bodies call into `control::*`), then the MCP adapter is built against
the same fns. No command renames, so the 140-entry handler list (`lib.rs:526`) and every
frontend `invoke()` string stay intact. This dovetails with the §2.1 `commands.rs` split:
the per-domain command files become the **Tauri adapter** for the matching control domain.

---

## 1. Runtime unification

### 1.1 Canonical status taxonomy (one source of truth in Rust)

Define the enum **once** in Rust; derive the TS union from it. Canonical states (exact
order, used everywhere):

```
spawning, thinking, coding, running_tests, waiting_approval, blocked, idle, done, error
```

New Rust type `AgentRunStatus` (new file `src-tauri/src/agent/status.rs`):

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRunStatus {
    Spawning, Thinking, Coding, RunningTests,
    WaitingApproval, Blocked, Idle, Done, Error,
}
```

- `#[serde(rename_all = "snake_case")]` makes the wire format `"running_tests"` etc.
- Provide `AgentRunStatus::as_str()` and `FromStr` so the output monitor and DB layer can
  round-trip without stringly-typed `match` arms scattered around.
- Map the existing `DetectedStatus` (`output_monitor.rs:6`) onto it in **one** place
  (replace the ad-hoc `match` at `interactive_commands.rs:464-472`):
  `Thinking→Thinking, Coding→Coding, Idle→Idle, Done→Done, WaitingPermission→WaitingApproval, Unknown→`(no change)`.
- Headless `AgentManager` currently seeds `"thinking"` literally (`claude.rs:98`); replace
  with `AgentRunStatus::Spawning` at spawn, transitioning to `Thinking` on first token.

TS side — **derived, not hand-written** (`src/shared/types/agentStatus.ts`, new):

```ts
// Keep in lockstep with src-tauri/src/agent/status.rs AgentRunStatus.
export const AGENT_RUN_STATUSES = [
  "spawning","thinking","coding","running_tests",
  "waiting_approval","blocked","idle","done","error",
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];
```

A guard test (`src/__tests__/agentStatusContract.test.ts`) asserts the TS array equals the
Rust serde names; a Rust `#[test]` in `status.rs` asserts every variant serializes to the
expected snake_case string. The two tests are the contract.

> Legacy `AgentStatus` (`agent.ts:1`) and its `generating`/`waiting` members stay as a
> deprecated alias during migration (§1.4) and is deleted in the final cut-over step.
> `generating → coding`, `waiting → waiting_approval` mapping lives in the adapter.

### 1.2 Target backend model: `AgentSession`

One struct replaces both `AgentSessionInfo` (`claude.rs:11`) and `InteractiveSessionInfo`
(`interactive.rs:135`). New file `src-tauri/src/agent/session.rs`:

```rust
pub struct AgentSession {
    // identity
    pub id: String,
    pub run_mode: RunMode,                 // Headless | Interactive
    pub cli: AgentCli,                     // reuse interactive.rs:65
    pub model: String,
    pub status: AgentRunStatus,            // §1.1
    // prompt / placement
    pub prompt: Option<String>,            // headless: required; interactive: initial_prompt
    pub cwd: String,
    // worktree (None when running in repo root)
    pub repo_path: Option<String>,
    pub worktree_branch: Option<String>,
    pub worktree_path: Option<String>,
    // runtime handles (mode-specific, not serialized)
    pub runtime: AgentRuntime,             // enum: Headless{child} | Interactive{pty_id, backend}
    // telemetry
    pub cost: f64,
    pub tokens_used: u64,
    pub started_at: u64,
}

pub enum RunMode { Headless, Interactive }

pub enum AgentRuntime {
    Headless { child: std::process::Child },
    Interactive { pty_id: String, backend: String },
}
```

- `AgentRuntime` is `#[serde(skip)]`; the serialized DTO (`AgentSessionDto`) flattens
  everything except the runtime handle and is what crosses IPC. This unifies the two
  current DTOs (`AgentSessionRaw` in `useAgentManager.ts:18`, `InteractiveSession` in
  `interactiveAgent.ts:5`).
- A single `AgentFleet` manager (new `src-tauri/src/agent/fleet.rs`) owns
  `Arc<Mutex<HashMap<String, AgentSession>>>` and exposes the union of today's two manager
  APIs: `spawn_headless`, `spawn_interactive`, `update_status`, `update_usage`, `list`,
  `stop`, `stop_all`, `reap`. It absorbs the process-tree kill logic from `claude.rs:244`
  and the registration/emit logic from `interactive_commands.rs:409`.

### 1.3 Target frontend hook: `useAgentFleet`

`useAgentFleet` is the **UI-side client of the Aether Control API** (§0.5) — specifically
the Cockpit face's view of the `agent` domain. It does **not** call Tauri commands ad hoc;
it calls the `agent`-domain commands (today `start_agent` / `spawn_interactive_agent` /
`stop_agent` / `list_agents`, which §0.5.2 lifts into `control/agent.rs`) through the Tauri
IPC adapter, and consumes the unified `agent-fleet-updated` event. The MCP face (§5.4)
consumes the *same* `control/agent.rs` fns — `useAgentFleet` is one of two clients, not the
only path to agent capabilities.

`useAgentFleet` (new `src/shared/hooks/useAgentFleet.ts`) replaces **both**
`useAgentManager` (`useAgentManager.ts:150`) and `useInteractiveAgent`
(`useInteractiveAgent.ts:12`) behind one interface:

```ts
interface UseAgentFleet {
  sessions: AgentSession[];                  // unified; carries runMode
  activeSessionId: string | null;
  selectSession(id: string): void;
  // unified spawn — branchName optional, worktree auto-derived when set (Phase 1)
  startAgent(opts: {
    prompt: string; cwd: string; model?: string;
    runMode?: "headless" | "interactive";    // default "interactive" once cut over
    branchName?: string;                      // §3
    meta?: StartAgentMeta;                    // reuse useAgentManager.ts:36
  }): Promise<string | null>;
  stopAgent(id: string): Promise<void>;
  endSessionAndRemoveWorktree(id: string): Promise<void>;
  renameSession(id: string, name: string): void;
}
```

- It listens to a **single** event `agent-fleet-updated` (replacing
  `agent-sessions-updated` at `useAgentManager.ts:207` and
  `interactive-sessions-updated` at `useInteractiveAgent.ts:33`).
- The rich frontend-only telemetry merge logic in `useAgentManager`
  (`mergeAgentSessions` at `:63`, role metadata at `:160`, log/file-change subscription at
  `:247`, snapshot persistence at `:162`) is **preserved verbatim** — it moves into
  `useAgentFleet` unchanged. This is the riskiest code to lose, so it is lifted, not
  rewritten.

### 1.4 SAFE migration path (adapter → cut over, not big-bang)

Five ordered, individually shippable steps. Each step keeps the app green.

| Step | What ships | Old code still live? |
|---|---|---|
| M0 | Add `status.rs` + TS `agentStatus.ts` + contract tests. No behavior change; existing string statuses still flow. | yes |
| M1 | Add `AgentSession`/`AgentFleet` (`session.rs`,`fleet.rs`) **alongside** existing managers. New `agent-fleet-updated` event emitted in parallel with the two legacy events. | yes |
| M2 | Add `useAgentFleet` hook. App.tsx consumes it **read-only** behind a flag (`AETHER_FLEET=1`); legacy hooks still drive writes. Verify parity in dev. | yes |
| M3 | Flip writes: `handleStartAgent`/`handleStartInteractiveSession` call `useAgentFleet.startAgent`. Legacy hooks become thin adapters that delegate to the fleet (so any un-migrated caller still works). | adapters only |
| M4 | Delete `useAgentManager`, `useInteractiveAgent`, `AgentManager`, `InteractiveSessionManager`, legacy events, and the `AgentStatus` alias. | no |

Adapter contract for M3: `useAgentManager()` returns the same shape it does today
(`useAgentManager.ts:476`) but is implemented by selecting `runMode==="headless"` sessions
out of the fleet; `useInteractiveAgent()` selects `runMode==="interactive"`. This lets the
~14 `onStartAgent`/`onStartInteractiveSession` call sites in App.tsx migrate one at a time.

### 1.5 Files to create / modify (Phase 0 runtime)

| File | Create/Modify | One-line purpose |
|---|---|---|
| `src-tauri/src/agent/status.rs` | create | Canonical `AgentRunStatus` enum + `as_str`/`FromStr` + serde test. |
| `src-tauri/src/agent/session.rs` | create | Unified `AgentSession` struct + `AgentSessionDto` + `RunMode`/`AgentRuntime`. |
| `src-tauri/src/agent/fleet.rs` | create | `AgentFleet` manager (union of both legacy managers). |
| `src-tauri/src/agent/mod.rs` | modify | Export `status`, `session`, `fleet`; keep legacy exports until M4. |
| `src-tauri/src/agent/output_monitor.rs` | modify | Map `DetectedStatus → AgentRunStatus` in one place. |
| `src-tauri/src/ipc/interactive_commands.rs` | modify | Emit `agent-fleet-updated`; register into `AgentFleet`. |
| `src-tauri/src/ipc/commands.rs` | modify | `start_agent` registers into `AgentFleet` (and decomposes, §2.1). |
| `src/shared/types/agentStatus.ts` | create | Derived TS status union + status array. |
| `src/shared/types/agentSession.ts` | create | Unified `AgentSession` TS type (supersedes `agent.ts` + `interactiveAgent.ts`). |
| `src/shared/hooks/useAgentFleet.ts` | create | Unified hook wrapping both run modes. |
| `src/shared/hooks/useAgentManager.ts` | modify→delete | Becomes adapter (M3), deleted (M4). |
| `src/shared/hooks/useInteractiveAgent.ts` | modify→delete | Becomes adapter (M3), deleted (M4). |
| `src/__tests__/agentStatusContract.test.ts` | create | Asserts TS status array == Rust serde names. |

---

## 2. God-file decomposition

### 2.1 `commands.rs` (6795 lines, **140** `#[tauri::command]`)

The file already clusters by domain (confirmed by reading the `pub fn` index). Split along
the existing seams into a `src-tauri/src/ipc/commands/` module. Each new file gets a
`pub use` re-export from `ipc/mod.rs` so `tauri::generate_handler!` (`lib.rs:526`) needs
**only import-path edits**, not signature edits.

| New file | Moves (current line ranges in `commands.rs`) | Purpose |
|---|---|---|
| `commands/terminal_io_commands.rs` | spawn/respawn/force_restart (`686`,`935`,`1165`), `write_terminal` (`1931`), `native_terminal_input_*` (`1984`-`2100`), resize/close (`2300`,`2375`), `list_terminals` (`3488`) | PTY/terminal lifecycle + native input host. |
| `commands/mux_commands.rs` | all `mux_*` (`2448`-`2999`), workspace pane cmds (`5005`+), `send_keys*` family (`5054`,`5229`,`5281`,`5313`,`5126`), pane rename/role (`5194`,`5218`) | Tmux-style multiplexer + pane routing. |
| `commands/term_query_commands.rs` | `term_*` snapshot/marks/blocks/history/image (`3230`-`3413`), `performance_observatory_metrics` (`3413`) | Read-only grid/journal/image queries. |
| `commands/git_commands.rs` | branches/worktrees/dir (`3528`-`3565`), `git_*` stage/commit/push (`3565`-`3607`), diff/original (`3796`-`3889`), PR (`3889`-`3948`), `create_worktree`/`remove_worktree` (`3546`,`3555`) | All git2 + git-CLI surface. |
| `commands/search_commands.rs` | `search_files` (`3632`), `grep_files` (`3706`), `list_all_files` (`6165`) | File/content search. |
| `commands/agent_commands.rs` | `start_agent` (`4387`), `stop_agent` (`4507`), `list_agents` (`4518`), `route_agent` (`4525`), `start_chat_agent`/`stop_chat_agent` (`4531`,`4900`) | Headless agent + router IPC (lands `dispatch_agent_route`, §3.4). |
| `commands/fs_commands.rs` | read/write/create/rename/delete file+dir (`3978`-`4232`), `open_in_vscode*` (`4086`-`4122`), image save (`4638`,`4657`) | Filesystem + external-editor + image IO. |
| `commands/workflow_commands.rs` | all `workflow_*` + `list_workflows`/`start_workflow` (`5487`-`5885`) | YAML workflow engine IPC. |
| `commands/session_db_commands.rs` | session/window/pane DB (`4926`-`5000`), agent DB + telemetry (`5904`-`5965`), command history (`5965`-`6030`), audit/event journal (`6039`-`6124`) | SQLite persistence + audit trail. |
| `commands/lsp_commands.rs` | `lsp_*` (`6124`-`6212`), `set_ime_position` (`6212`) | LSP JSON-RPC + IME placement. |
| `commands/config_commands.rs` | `load/save_app_config` (`3948`,`3954`), watchdog rules (`3960`-`3972`), `detect_shells`/`discover_projects`/scan dirs (`3494`-`3512`), fs watcher (`5437`,`5444`) | Config, watchdog rules, shell/project discovery. |

Mechanics: move bodies unchanged; keep shared private helpers (e.g. `agent_output_event`,
`agent_sessions_updated_event`, `persist_prompt_mark_exit_code`) in a small
`commands/shared.rs`; `ipc/mod.rs` does `pub use commands::*;`. **No command renames** so
the 140-entry handler list and all frontend `invoke()` strings are untouched.

### 2.2 `App.tsx` (6922 lines)

Three near-identical `<AgentInspector>` blocks render under different `rightRailMode`
branches: command mode (`App.tsx:6436-6450`), review mode (`App.tsx:6524-6538`), and a
third mode (`App.tsx:6726-6740`). All pass the **same 13 props**. Plus the orchestra
dispatch wiring (`handleStartRightRailOrchestra` at `App.tsx:4762`) is a 50-line callback
living inline.

| New file | Extracts | Purpose |
|---|---|---|
| `src/features/agent-inspector/RightRailAgentsWidget.tsx` | the repeated `<AgentInspector …>` prop bundle (`App.tsx:6436`,`6524`,`6726`) | Single component taking one `agentsProps` object; the 3 sites render `<RightRailAgentsWidget {...agentsProps} />`. |
| `src/shared/hooks/useOrchestraDispatch.ts` | `handleStartRightRailOrchestra` (`App.tsx:4762-4813`) | Owns task-default derivation, `showOrchestra`, `buildOrchestraPrompts`, parallel launch, toasts. Returns `{ dispatchOrchestra }`. |
| `src/features/agent-inspector/useRightRailAgentsProps.ts` | the shared prop object assembled at the 3 call sites | Memoizes the 13-prop bundle once so the 3 widgets stay identical by construction. |
| `src/App.tsx` | modify | Replace 3 inline blocks + inline callback with the extracted component/hooks. |

This removes ~120 lines of duplication and makes the Phase 1 dispatch change (§3) a
**single-file edit** in `useOrchestraDispatch.ts` instead of touching App.tsx's render tree.

---

## 3. Worktree auto-wiring (Phase 1 backend)

Goal: **every fleet agent gets its own worktree by default** so parallel lanes never
collide. The plumbing already exists for interactive sessions
(`spawn_interactive_agent` creates a worktree at `interactive_commands.rs:82-95` and wires
ghostdiff at `:196-222`); Phase 1 routes the Orchestra path through it and unifies the
duplicated helpers.

### 3.1 Unify the branch validator and worktree-path fns (do this first)

Single source of truth in `worktree.rs`:

1. Make `validate_branch_name` **public** (`worktree.rs:173`) and merge in the stricter
   rules currently inlined in `interactive_commands.rs:67-80`: keep ASCII-only
   (`is_ascii_alphanumeric`), add the `1..=200` length cap, reject leading `-` and `.`,
   keep the existing `..`/slash-prefix/`:` rejections. One function, strictest union.
2. Delete the inline validator block at `interactive_commands.rs:67-80`; call
   `crate::git::validate_branch_name(branch)?` instead.
3. `predict_worktree_path` (`worktree.rs:195`) is already the single path formula; make
   `create_worktree` (`worktree.rs:203`) the **only** caller that derives the dir from it
   (it already does, `worktree.rs:206`) and delete the "must stay in sync" comment hazard
   by having nothing else reconstruct the path. `lib.rs:406` already calls
   `predict_worktree_path` — leave it; it now shares the validated formula.
4. Verify the third caller `watchdog/auto_repair.rs:274` (`create_worktree`) still passes a
   validated branch — it now inherits validation for free.

### 3.2 Thread `branchName` through the Orchestra prompt builder

`buildOrchestraPrompts` (`orchestrator.ts:262`) currently returns `{ roleId, model,
prompt }`. Add a derived branch name per lane so each role gets an isolated tree:

- Extend the return shape to `{ roleId, model, prompt, branchName }`.
- Derive deterministically from role + task slug:
  `agent/${roleId}-${slugify(task).slice(0,32)}` (e.g. `agent/implementer-add-login-form`).
  Slugify to the validator's charset (ASCII alnum + `-`), strip leading `-`/`.`.
- Add a TS-side `validateBranchName(name)` mirror in `src/shared/lib/branchName.ts`
  (new) so the UI can pre-flight before invoke; the Rust validator (§3.1) stays
  authoritative. The mirror is covered by a unit test that feeds the same fixtures as the
  Rust test.

### 3.3 Thread `branchName` through dispatch + `handleStartInteractiveSession`

Two edits, both now isolated by §2.2:

- **`useOrchestraDispatch.ts`** (extracted from `App.tsx:4787-4790`): change the launch
  from headless `handleStartAgent(prompt.prompt, prompt.model, …)` to the **interactive**
  path so a worktree is created:
  `startInteractiveSession({ cwd: projectPath, model: prompt.model, initialPrompt: prompt.prompt, branchName: prompt.branchName })`
  (or, post-cut-over, `useAgentFleet.startAgent({ …, runMode: "interactive", branchName })`).
  This is the single line that makes orchestra lanes isolated.
- **`handleStartInteractiveSession`** (`App.tsx:4136-4145`) already forwards `branchName`
  through to `startInteractiveSession` (`useInteractiveAgent.ts:64` → `spawn_interactive_agent`
  `branch_name` param at `interactive_commands.rs:58`). No change needed except it now
  receives a non-null `branchName` from dispatch.

Result: `spawn_interactive_agent` runs its existing worktree branch
(`interactive_commands.rs:82-95`) + ghostdiff registration (`:196-222`) for every orchestra
lane, with zero new backend wiring — the capability was already there, just unreachable
from the dispatch UI.

> Default-on caveat: keep a single explicit opt-out (e.g. `branchName: null` for "run in
> repo root") so single-lane / chat usage can still run in place. Default for multi-lane
> dispatch is "always a worktree".

### 3.4 Wire `router.rs` via a new IPC command + dispatch UI call

`AgentRouter::route` (`router.rs:43`) is fully implemented but only reachable through the
thin `route_agent` IPC (`commands.rs:4525`), and the dispatch UI never calls it — models
are hard-coded per role in `ORCHESTRA_ROLES` (`orchestrator.ts:32-90`). Wire it:

- Add `dispatch_agent_route` in the new `commands/agent_commands.rs`: takes
  `prompt: String, budget: Option<f64>`, returns `RoutingDecision` (`router.rs:10`). (This
  can be `route_agent` renamed/kept; keep `route_agent` as-is and have the UI call it to
  avoid touching the handler list — preferred, zero-risk.)
- In `useOrchestraDispatch.ts`, before launching each lane, call
  `invoke<RoutingDecision>("route_agent", { prompt, budget })` and use
  `decision.recommended_model` as the lane's model **when the role's model is left on
  "auto"**, falling back to the role's static model otherwise. Surface
  `decision.reasoning` + `estimated_cost` in the Orchestra dialog so the routing is
  visible (no silent infra).
- Register nothing new in `lib.rs` if reusing `route_agent` (already at `lib.rs:600`).

### 3.5 Files to create / modify (Phase 1)

| File | Create/Modify | One-line purpose |
|---|---|---|
| `src-tauri/src/git/worktree.rs` | modify | `validate_branch_name` made `pub` + strictest-union rules; remove sync-hazard comment. |
| `src-tauri/src/git/mod.rs` | modify | `pub use` the now-public `validate_branch_name`. |
| `src-tauri/src/ipc/interactive_commands.rs` | modify | Delete inline validator (`:67-80`); call `crate::git::validate_branch_name`. |
| `src/shared/lib/orchestrator.ts` | modify | `buildOrchestraPrompts` returns per-lane `branchName`. |
| `src/shared/lib/branchName.ts` | create | TS `validateBranchName` + `slugifyBranch` mirroring Rust rules. |
| `src/shared/hooks/useOrchestraDispatch.ts` | modify | Launch lanes via interactive/worktree path; call router for `auto` model. |
| `scripts/verify-agent-team-orchestration-readiness.mjs` | modify | Update the dispatch-string assertion (`:218`) to the new worktree launch call. |

---

## 4. Build sequence, risk register, test strategy

### 4.1 Ordered build sequence

| # | Step | Gate before proceeding |
|---|---|---|
| 1 | **§3.1** unify branch validator + worktree-path (smallest, highest leverage). | `cargo test -p aether-terminal --lib` (interactive.rs validator tests `interactive.rs:268-418`), `cargo test --test test_agent`. |
| 2 | **§2.1** decompose `commands.rs` (pure move, no rename). | `cargo build` + full `cargo test`; handler list `lib.rs:526` unchanged. |
| 3 | **§2.2** extract `RightRailAgentsWidget` + `useOrchestraDispatch` from App.tsx. | `pnpm test` (App tests), `pnpm build`, `verify-right-rail-suite.mjs`. |
| 4 | **§1.1** land `AgentRunStatus` + TS mirror (M0). | `cargo test status::` + `agentStatusContract.test.ts`. |
| 5 | **§1.2–1.3** land `AgentSession`/`AgentFleet`/`useAgentFleet` in parallel (M1–M2, flagged). | parity check in dev; existing gates stay green. |
| 6 | **§3.2–3.4** thread `branchName` + router through extracted dispatch. | `verify-agent-team-orchestration-readiness.mjs` (updated), `verify-interactive-ai-cli-boundary.mjs`. |
| 7 | **§1.4 M3–M4** flip writes, delete legacy managers/hooks/events/`AgentStatus`. | full `cargo test` + `pnpm test` + right-rail suite. |

### 4.2 Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| `verify-agent-team-orchestration-readiness.mjs:218` hard-codes the exact dispatch string `handleStartAgent(prompt.prompt, prompt.model, { role: prompt.roleId as OrchestraRoleId })`. Changing dispatch (§3.3) **breaks this gate**. | HIGH | Update the gate string in the **same commit** as the dispatch change (step 6). Listed in §3.5. |
| Two validators disagree on Unicode (`is_alphanumeric` vs `is_ascii_alphanumeric`) — unifying to ASCII-only could reject branch names that worked via the interactive path. | MEDIUM | Strictest-union is intentional; add a regression test feeding a Unicode branch and asserting rejection on both paths. Document in changelog. |
| Orchestra now spawns N worktrees per dispatch; `create_worktree` shells out to `git worktree add` (`worktree.rs:214`) — N parallel git invocations on one repo. | MEDIUM | Serialize worktree creation in dispatch (await each `startInteractiveSession` before the next) instead of `Promise.allSettled` fan-out; keep agent *execution* parallel. |
| `commands.rs` split could drop a `#[tauri::command]` and silently un-register a command. | HIGH | After §2.1, assert the handler count: `generate_handler!` list length stays 140 (+ any new). Add a build-time count check or grep gate. |
| Big-bang manager swap loses the rich telemetry merge (`useAgentManager.ts:63-368`). | HIGH | Adapter path (M3): legacy hooks delegate to fleet; telemetry merge code is **moved, not rewritten**. |
| `AgentSession` name collides: TS already has `AgentSession` (`agent.ts:32`) and Rust will add one. | LOW | Intentional — the new unified types *replace* these. During migration the new TS type lives in `agentSession.ts`; old `agent.ts` keeps its name until M4. |

### 4.3 Test strategy — which gate guards which step

| Step | Rust tests | Frontend / verify gates |
|---|---|---|
| §3.1 validator unify | `interactive.rs:268-418` (validator + manager), `test_agent.rs` | `branchName` unit test (new) |
| §2.1 commands split | full `cargo test` (move must not change behavior), handler-count check | — |
| §2.2 App.tsx extraction | — | `verify-right-rail-suite.mjs`, `verify-right-rail-information-density.mjs`, `AppSilentBugs.test.ts`, `pnpm build` |
| §1.1 status taxonomy | `status.rs` serde test, `output_monitor.rs` mapping tests | `agentStatusContract.test.ts` |
| §1.2–1.3 fleet/hook | `fleet.rs` register/list/stop tests (port from `interactive.rs:268`+`claude.rs`) | dev parity (flagged) |
| §3.2–3.4 dispatch + router | `router.rs:217-247` (unchanged) | `verify-agent-team-orchestration-readiness.mjs` (updated `:218`), `verify-interactive-ai-cli-boundary.mjs`, `orchestrator.test.ts` |
| §1.4 cut-over | full `cargo test` | full `pnpm test`, right-rail suite |

Existing gates to keep green throughout: `verify-interactive-ai-cli-boundary.mjs`,
`verify-agent-team-orchestration-readiness.mjs`, `verify-right-rail-suite.mjs`, and the
`cargo test` worktree/agent/interactive suites.

---

## 5. Gate model (FREE vs GATED — the safety boundary)

The Aether Control API (§0.5) is consumed by two faces. The Cockpit face is driven by a
human, so every capability is implicitly human-authorized. The **MCP face is driven by the
Orchestrator AI**, which means the layer needs a hard, code-enforced boundary deciding what
the AI may do unilaterally vs what requires human authority. This is **the** safety
invariant of the whole design.

### 5.1 Classification

| Domain | Class | Why |
|---|---|---|
| `worktree` | **FREE** | Isolated trees are sandboxes; creating/removing one never touches the user's main tree. Branch validation (`worktree.rs:173`, §3.1) bounds it. |
| `agent` | **FREE** | Spawning / stopping / routing agents *inside* worktrees is the orchestrator's core job. |
| `pane` | **FREE** | Splitting panes and routing keys is UI/runtime plumbing, not a trust decision. |
| `diff` | **FREE** | Read-only observation of agent-owned change overlays. `start_branch_comparison` registers a layer the code itself marks read-only (`ghostdiff_commands.rs:110,163`). |
| `merge` (apply-to-main) | **GATED** | `apply_ghost_hunk` / `apply_ghost_file` write into the user's **main** worktree (`ghostdiff_commands.rs:131,176`). Promoting agent work to main is a human decision. |
| `approval` (grant) | **GATED** | Granting a held tool invocation is the trust decision itself. The grant authority is the watchdog policy engine, **never** the AI. |

> The FREE/GATED line maps onto an existing code boundary: ghostdiff already refuses
> mutation of read-only layers via `registry.is_read_only(...)` (`ghostdiff_commands.rs:110`).
> The gate model generalizes that single check into a layer-wide rule.

### 5.2 The invariant

**The orchestrator MCP face MUST NOT expose a free `grant_approval` tool or a free
`merge_to_main` tool.** The AI may *request*, *observe*, and *route* gated operations; it may
never *grant* them. Concretely, the `aether` MCP server (§5.4, detailed in
`MCP_TOOL_SURFACE_SPEC.md`) surfaces:

- FREE tools: full `worktree` / `agent` / `pane` / `diff` domains.
- For `approval`: a **read/route**-only surface (observe pending tickets, see decisions) — no
  `grant`.
- For `merge`: a **request**-only surface (propose promoting a hunk/file to main) that
  enqueues a ticket; the actual write stays behind the gate.

The grant authority is **`WatchdogEngine`** (`src-tauri/src/watchdog/engine.rs:30`), invoked
today in the agent stream at `commands.rs:4327`. Its three outcomes
(`watchdog/engine.rs:7`) *are* the gate:

- `AutoApprove { rule }` → low-risk, policy auto-grants (no human needed).
- `AutoDeny { rule }` → blocked by policy.
- `AskUser` → high-risk → routed to the **human Decision Inbox**
  (`src/features/decision-inbox/DecisionInboxPanel.tsx`); only a human click grants.

### 5.3 Gated request flow

A gated operation never short-circuits to a grant. The flow:

```
AI (MCP face) ── request(merge hunk / approve tool) ──▶ control::approval::evaluate
                                                              │  (WatchdogEngine, engine.rs:30)
                          ┌───────────────────────────────────┼───────────────────────────┐
                          ▼                                   ▼                             ▼
                 AutoApprove{rule}                      AutoDeny{rule}                    AskUser
              (low-risk: auto-grant)                 (policy blocks)            (high-risk: enqueue)
                          │                                   │                             │
                          ▼                                   ▼                             ▼
              perform gated op                         return denial            Decision Inbox ticket
          (e.g. apply_hunk_to_main)                  to AI as observation       (DecisionInboxPanel)
                          │                                                                 │
                          ▼                                                       human clicks Grant/Deny
                  emit result/event ◀───────────────────────────────────────────────────┘
                 (AI observes outcome; it never held grant authority)
```

Key properties: (1) the AI's call lands on `evaluate`, not on the mutating fn; (2) only the
`AutoApprove` branch — a **policy** decision, not an AI decision — performs the op without a
human; (3) the `AskUser` branch *requires* a human click in the inbox. The AI observes the
outcome either way but is never on the grant path.

### 5.4 Two faces

The capability layer has exactly two clients:

1. **Cockpit UI (human face).** React + Tauri IPC. The `agent` domain is consumed via
   `useAgentFleet` (§1.3); other domains via their command clusters. Human presence is the
   authorization for gated ops (the human *is* the Decision Inbox).
2. **Orchestrator AI (machine face).** Opus 4.8 via an `aether` **MCP server** — a thin
   adapter over the same `control/*` fns (§0.5.2). It gets the FREE domains in full and a
   request/observe/route-only projection of the GATED domains, enforcing §5.2 by simply *not
   defining* grant/merge-to-main tools.

> The MCP tool surface — exact tool names, arg schemas, the read/route-only `approval`
> projection, and the request-only `merge` projection — is specified in the sibling
> **`docs/specs/MCP_TOOL_SURFACE_SPEC.md`**. This spec owns the layer + the gate invariant;
> that spec owns the machine face's concrete tool definitions. The two must agree on the §5.1
> classification and the §5.2 invariant.

---

## Appendix — key grounding references

- Headless manager + status seed: `src-tauri/src/agent/claude.rs:11,27,98,244`
- Interactive manager + `AgentCli` + status update: `src-tauri/src/agent/interactive.rs:65,135,154,203`
- Status detection vocabulary: `src-tauri/src/agent/output_monitor.rs:6`; wire mapping `interactive_commands.rs:464-472`
- Router (implemented, under-wired): `src-tauri/src/agent/router.rs:10,43`
- Worktree validator + path fns: `src-tauri/src/git/worktree.rs:173,195,203`; duplicate inline validator `interactive_commands.rs:67-80`; extra callers `lib.rs:406`, `watchdog/auto_repair.rs:274`
- Interactive spawn (worktree+ghostdiff+monitor in one call): `src-tauri/src/ipc/interactive_commands.rs:52,82-95,196-222`
- `commands.rs` size + handler list: 6795 lines, 140 commands; registered at `src-tauri/src/lib.rs:526`
- Frontend hooks: `useAgentManager` `src/shared/hooks/useAgentManager.ts:150`; `useInteractiveAgent` `useInteractiveAgent.ts:12`; wired in App at `src/App.tsx:2818,2822`
- Orchestra dispatch: `src/App.tsx:4762-4813`; prompt builder `src/shared/lib/orchestrator.ts:262`
- Duplicate right-rail Agents blocks: `src/App.tsx:6436,6524,6726`
- Dispatch-string gate: `scripts/verify-agent-team-orchestration-readiness.mjs:210-219`
- Capability-domain command surfaces (§0.5): `worktree`/`pane` — `commands.rs:2511,3534,3546,3555,5313`; `agent` — `commands.rs:4387,4507,4518,4525`, `interactive_commands.rs:52,85`; `diff`/`merge` — `ghostdiff_commands.rs:27,40,98,131,154,176,191`; read-only guard `ghostdiff_commands.rs:110,163`
- Gate authority (§5): `WatchdogEngine::evaluate` + `WatchdogDecision` `src-tauri/src/watchdog/engine.rs:7,30`; invoked in agent stream `src-tauri/src/ipc/commands.rs:4327-4351`; human inbox `src/features/decision-inbox/DecisionInboxPanel.tsx`
- Sibling spec (machine face / MCP tool surface): `docs/specs/MCP_TOOL_SURFACE_SPEC.md`
