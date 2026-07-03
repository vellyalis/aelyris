# Cockpit UX Spec — Multi-Agent Dev Cockpit

> **STATUS (2026-07-02): SHIPPED 2026-06-30** (PR #3 cockpit surfaces, PR #4 approval
> inbox). Statements below like "a NEW merge backend" being missing or `useAgentFleet`
> being a precondition describe June's **pre-implementation** state — the shipped
> owners are `src-tauri/src/ipc/merge_commands.rs`, `src/shared/hooks/useAgentFleet.ts`,
> and `src/features/decision-inbox/`. Body kept as the original design record.

> Status: design spec (analysis only — no source changes)
> Date: 2026-06-13
> Scope: the operator-facing surfaces for supervising 3–4 Claude/Codex agents, each in its own git worktree.
> Companion specs: Backend Session Model spec, Frontend Hook spec. This file uses the
> **shared contract** names so all three align.

---

## 0. Shared contract (binding names)

These names are fixed across all three specs. This spec consumes them; it does not redefine them.

| Contract item | Meaning in this spec |
|---|---|
| `AgentSession` (Rust) | One struct for **both** headless (`useAgentManager` / `start_agent`) and PTY/interactive (`spawn_interactive_agent`) runtimes. Today these are two shapes: `AgentSession` in `src/shared/types/agent.ts:32` and `InteractiveSession` in `src/shared/types/interactiveAgent.ts:5`. The cockpit assumes they are unified. |
| `useAgentFleet` (TS) | One hook replacing `useAgentManager` (`src/shared/hooks/useAgentManager.ts:150`) **and** `useInteractiveAgent` (`src/shared/hooks/useInteractiveAgent.ts:12`). Returns the single fleet list + actions. **Every cockpit surface reads from this one hook.** |
| Status taxonomy | Canonical states, defined once in Rust, TS union derived: `spawning, thinking, coding, running_tests, waiting_approval, blocked, idle, done, error`. See §1.1 for how this maps onto today's two divergent taxonomies. |
| `validate_branch_name(name)` | One validator, shared everywhere. Exists today at `src-tauri/src/git/worktree.rs:173` but is **private (`fn`, not `pub`)** and only called inside `create_worktree`/`remove_worktree`. Must be promoted to the shared validator. |
| `predict_worktree_path(repo, branch)` | One worktree-path function. Exists today at `src-tauri/src/git/worktree.rs:195` (`pub`). The kanban launcher currently re-derives a path-less branch slug instead (`src/features/kanban/KanbanBoard.tsx:83`) — it must route through this. |

### 0.1 Status taxonomy mapping (today → canonical)

Two taxonomies exist today and disagree. The cockpit needs them collapsed into the canonical 9.

| Canonical (contract) | Headless today (`agent.ts:1`) | PTY detector today (`output_monitor.rs:6`) | Backend stream verb (`commands.rs:4330`) |
|---|---|---|---|
| `spawning` | — (implicit, pre-first-event) | — | — |
| `thinking` | `thinking` | `DetectedStatus::Thinking` | — |
| `coding` | `coding` / `generating` | `DetectedStatus::Coding` | `"coding"` |
| `running_tests` | — (folded into `coding`) | — | — |
| `waiting_approval` | `waiting` | `DetectedStatus::WaitingPermission` | `"waiting"` |
| `blocked` | — (derived from `error`+`blockedReason`, `workstationGraph.ts:313`) | — | — |
| `idle` | `idle` | `DetectedStatus::Idle` | — |
| `done` | `done` | `DetectedStatus::Done` | `"done"` |
| `error` | `error` | — | `"error"` |

Gaps the cockpit depends on the backend closing: `spawning`, `running_tests`, and a first-class `blocked` (today `blocked` is a frontend derivation inside `buildRunGraph`, `src/shared/lib/workstationGraph.ts:274-287`, not a real session state).

---

## 1. Single source of truth — data flow

The whole cockpit is a projection of **one ordered list**: `useAgentFleet().sessions: AgentSession[]`. Rail, grid, inbox, and outcomes are pure views over that list (plus, for outcomes, one git/PR read). They cannot disagree because they never hold independent copies of agent state.

```
                  Rust backend (one AgentSession registry, both runtimes)
                                     │
        emits  agent-sessions-updated  +  interactive-sessions-updated
        emits  agent-output-{id}  +  watchdog-decision-{id}  +  agent-exit-{id}
                                     │
                            ┌────────▼─────────┐
                            │   useAgentFleet   │   (one merge, one status taxonomy)
                            │  sessions: AgentSession[] │
                            └────────┬─────────┘
              ┌──────────────┬───────┼────────────┬───────────────┐
              ▼              ▼       ▼            ▼               ▼
      buildWorkstation  (grid maps   Approval     (4) Outcomes    native toast
        Summary()       sessions[])   Inbox        = sessions[]    on transition
      = rail order +                = sessions      filtered to    into waiting_/
        attention counter            filtered to    done + git/PR   done/error
      (workstationSummary.ts:120)    waiting_approval read
```

**Derivations already implemented and reusable as the projection layer:**

| Derivation | Function | File:line | Feeds |
|---|---|---|---|
| Attention-first ordering | `rankAgentSessions` | `src/shared/lib/workstationSummary.ts:96` | Rail (1) |
| Global attention counter | `buildWorkstationSummary().attentionCount` | `src/shared/lib/workstationSummary.ts:126` | Rail counter (1), Inbox badge (2) |
| Live / blocked / collectable counts | `buildRunGraph` (`liveCount`, `blockedCount`, `collectableCount`) | `src/shared/lib/workstationGraph.ts:450-454` | Rail header chips, Outcomes (4) |
| Per-session blocked reason / next actor | `blockedReason()`, `nextActor()` | `src/shared/lib/workstationGraph.ts:313,327` | Inbox rows (2) |
| Cross-agent file conflicts | `detectFileConflicts` | `src/shared/lib/orchestrator.ts:107` | Grid borders (3), Outcomes merge-risk (4) |
| Per-session changed-file diffs | `InlineResultPanel` | `src/features/agent-inspector/InlineResultPanel.tsx:69` | Inline review (5) |

Because all five derivations are **pure functions of `sessions[]`**, a single `useMemo` over `useAgentFleet().sessions` produces every cockpit number. There is no second store, no polling loop per surface, and no risk of the rail counter saying "2 need attention" while the inbox shows 3.

---

## 2. Surface 1 — Agent Rail (needs-attention-first + global counter)

### Purpose
The persistent left/right column listing all 3–4 fleet agents, sorted so anything needing the operator floats to the top, with a single global "N need attention" counter the operator can trust at a glance.

### Data source
- List + ordering: `useAgentFleet().sessions` → `rankAgentSessions()` (`workstationSummary.ts:96`). Today the inspector sorts inline with `STATUS_ORDER` at `src/features/agent-inspector/AgentInspector.tsx:84` and `sortedSessions` at `:198` — same intent, must converge on `rankAgentSessions`.
- Global counter: `buildWorkstationSummary().attentionCount` (`workstationSummary.ts:126`) = count of `waiting`/`error`. Under the canonical taxonomy this becomes `waiting_approval` + `blocked` + `error`.
- Live status / cost / tokens per row: pushed via `agent-sessions-updated` (`useAgentManager.ts:207`) and `interactive-sessions-updated` (`useInteractiveAgent.ts:33`), both folded into `useAgentFleet`.

### Component breakdown
| Component | Reuse / build | Source |
|---|---|---|
| Rail container | Build (thin) — extract from inspector's `sessions` tab | `AgentInspector.tsx:546-605` |
| Rail row | **Reuse** `SessionCard` | `src/features/agent-inspector/SessionCard.tsx:47` |
| Status dot + label | **Reuse** `StatusIcon` + `STATUS_COLORS`/`STATUS_LABELS` | `agent.ts:89,101`; `StatusCard` uses at `:58` |
| Per-session color | **Reuse** `getSessionColor` | `agent.ts:165` |
| Global attention counter chip | Build — bind to `attentionCount` | new, fed by `workstationSummary.ts:126` |
| Conflict badge on row | **Reuse** `conflictingPaths` plumbing | `AgentInspector.tsx:209-220`, `SessionCard.tsx:44` |

### Interaction model
| Control | Action → command/handler |
|---|---|
| Click row | `onSelect(id)` → selects session; grid (3) focuses that pane |
| Stop button | `onStop(id)` → `stop_agent` (`useAgentManager.ts:438`) or `stop_interactive_agent` (`useInteractiveAgent.ts:93`) |
| Handoff | `onHandoff` → `showHandoff` then `start_agent` with `handoffFrom` (`AgentInspector.tsx:291-309`) |
| Counter chip click | Scroll/focus first `waiting_approval` row → opens Inbox (2) |
| Multi-select + Stop selected | `handleStopSelected` (`AgentInspector.tsx:231`) |

### Effort: **S** (ordering, counter, and row are all built; this is extraction + binding to `useAgentFleet`).

---

## 3. Surface 2 — Approval Inbox (pending tool-call approvals across ALL agents)

### Purpose
One queue aggregating every agent currently stuck at `waiting_approval`, so the operator answers approvals in one place instead of hunting each terminal. This is the cockpit's highest-value surface for the 3–4-agent case: it is the bottleneck the operator actually sits on.

### Data source
- **Existing.** Per-session approval state is already produced: the headless watchdog emits `watchdog-decision-{id}` with `decision: "manual"` and flips status to `waiting` (`src-tauri/src/ipc/commands.rs:4327-4351`; consumed `useAgentManager.ts:318-336`). The derived reason is `blockedReason()` → `"Awaiting approval for {tool}"` (`workstationGraph.ts:313-320`), and `nextActor()` → `"human"` (`:327`).
- **Aggregation:** `useAgentFleet().sessions.filter(s => s.status === "waiting_approval")` — pure derivation, no new query.
- Inbox badge count = the same `attentionCount` slice used by the rail (single source of truth, §1).

### Dependency (call-out)
**This surface depends on the unified `useAgentFleet` session list.** Today the headless path has a real approval signal (`watchdog-decision-{id}`) but the PTY/interactive path does **not** — the watchdog engine is never wired into `interactive.rs` (grep for `WatchdogEngine`/`evaluate` in `src-tauri/src/agent/interactive.rs` returns **no matches**; the PTY-side approval auto-answer in `src-tauri/src/agent/watchdog.rs:139` exists but emits no per-session "manual/waiting" event). So the inbox is only complete once `useAgentFleet` exposes a uniform `waiting_approval` state for **both** runtimes. Until then it shows headless agents only.

### Component breakdown
| Component | Reuse / build | Source |
|---|---|---|
| Inbox panel shell | **Reuse** `PanelHeader` | used throughout, e.g. `SCMPanel.tsx:239` |
| Approval row (agent name, tool, color dot) | Build — read `session.name`, `blockedReason`, `getSessionColor` | `workstationGraph.ts:313`; `agent.ts:165` |
| Tool badge | **Reuse** `ToolBadge` + `extractToolName` | `AgentInspector.tsx:39,623` |
| Approve / Deny buttons | Build (wraps the answer command) | see interaction model |
| Empty state | **Reuse** `EmptyState` | `AgentInspector.tsx:716` |

### Interaction model
| Control | Action → command |
|---|---|
| Approve | **PTY agents:** `send_keys(terminal_id, "y\r")` (`src-tauri/src/ipc/commands.rs:5054`) or `send_keys_by_target(target, "y\r")` (`:5313`). **Headless agents:** NEW — a backend approval-answer command (today headless `AskUser` only emits an event; there is no resolve path). |
| Deny | Same as Approve with `"n\r"` |
| Approve-all visible | Iterate inbox rows, fire the per-row Approve. Mirrors `handleStopOverBudget` loop shape (`AgentInspector.tsx:222-229`) |
| Click row | `onSelect(id)` → grid (3) focuses that agent's pane so the operator sees context before answering |
| Open watchdog rule | Offer "always allow `{tool}`" → `WatchdogRules` (`src-tauri/src/watchdog/rules.rs`), evaluated at `engine.rs:30` |

### What to reuse vs build
- **Reuse:** waiting-state detection, `blockedReason`, tool badge, `send_keys`/`send_keys_by_target` for PTY answers, panel chrome.
- **Build:** the aggregated panel itself; the per-row Approve/Deny wiring; **NEW backend approval-resolve command for headless agents** (PTY answers already have a key-send path).

### Effort: **M** (panel is straightforward; the headless approval-resolve command and uniform `waiting_approval` from both runtimes are the real work, and the latter is a `useAgentFleet`/backend dependency).

---

## 4. Surface 3 — Fleet Grid (N live agent terminals, state-colored borders)

### Purpose
A grid of the live agents' terminals (one tile per worktree agent) so the operator watches all 3–4 run at once, with each tile's border color encoding session state for peripheral-vision triage.

### Data source
- Tiles: `useAgentFleet().sessions` filtered to live (`isLiveAgentStatus`, `workstationSummary.ts:44`). Today the inspector's Parallel view already renders exactly this from `activeSessions` (`AgentInspector.tsx:188,732-856`).
- Border color: `STATUS_COLORS[status]` (`agent.ts:89`) for state; `getSessionColor(id).accent` (`agent.ts:165`) for per-agent identity. The Parallel view already drives borders via `--session-accent`/`--session-glow` CSS vars (`AgentInspector.tsx:792-797`).
- Live terminal content: PTY agents render in the native `TerminalCanvas` against their `pty_id` (`interactiveAgent.ts:6`); headless agents render their `logs` tail (Parallel view does `s.logs.slice(-5)` at `AgentInspector.tsx:830`).
- Per-tile progress %: token-based, already computed (`AgentInspector.tsx:775-782`).

### Component breakdown
| Component | Reuse / build | Source |
|---|---|---|
| Grid layout (N tiles) | **Reuse/extend** Parallel view | `AgentInspector.tsx:732` |
| Tile header (avatar, name, status, %) | **Reuse** `PixelAvatar`, `StatusIcon`, `StopButton` | `AgentInspector.tsx:808-821` |
| State-colored border | **Reuse** the `--session-accent`/`--session-glow` pattern; add a status-tinted ring from `STATUS_COLORS` | `AgentInspector.tsx:792-797` |
| Live PTY surface in tile | **Build** — embed `TerminalCanvas` keyed by `pty_id` (Parallel view shows log tail today, not a live PTY) | `interactiveAgent.ts:6` |
| Fleet summary bar (count, total cost, conflict count) | **Reuse** | `AgentInspector.tsx:734-764` |

### Interaction model
| Control | Action → command |
|---|---|
| Click tile | `onSelect(id)` → also drives rail (1) selection (shared state) |
| Stop on tile | `onStopAgent(id)` → `stop_agent` / `stop_interactive_agent` |
| Stop All | loop `onStopAgent` over live tiles (`AgentInspector.tsx:752-763`) |
| Split a tile into a new pane | `mux_split_pane(workspace_id, target_pane_id, axis, …)` (`src-tauri/src/ipc/commands.rs:2511`) |
| Type into a focused tile | `send_keys(terminal_id, data)` (`:5054`) |
| Conflict chip hover | shows conflicting paths (`detectFileConflicts`, `orchestrator.ts:107`; rendered `AgentInspector.tsx:738-751`) |

### What to reuse vs build
- **Reuse:** the entire Parallel view structure, summary bar, conflict chip, stop-all, per-session colors.
- **Build:** swap the per-tile **log tail** for a **live PTY surface** (`TerminalCanvas` per `pty_id`); add the status-tinted border ring on top of identity color.

### Effort: **M** (grid + borders + summary already exist as the Parallel view; the live-PTY-per-tile embed is the new work).

---

## 5. Surface 4 — Merge Queue / "Ready to Merge" Outcomes

### Purpose
A list of agents that finished, showing each worktree's branch, file changes, conflict risk, and (when a PR exists) review/CI rollup — the operator's "what can I land?" view. The terminal action is **merge**, which is the one genuinely new backend.

### Data source
- Finished agents: `useAgentFleet().sessions` filtered to `done` / `collectable` (`buildRunGraph().doneCount`/`collectableCount`, `workstationGraph.ts:453-454`; `closeState` "collectable" set at `useAgentManager.ts:91,313,454`).
- Per-agent worktree: `session.worktree` (`agent.ts:47`, `WorktreeInfo` mirrors `src-tauri/src/git/worktree.rs:5`), plus `git_status(repoPath)` per worktree (`SCMPanel.tsx:74` → `commands.rs:3565`).
- Conflict / merge risk: `detectFileConflicts` across the fleet (`orchestrator.ts:107`) flags two agents touching the same path **before** merge.
- PR/review/CI rollup (when pushed): `list_pull_requests(cwd)` (`src-tauri/src/ipc/commands.rs:3889`, returns `PullRequestInfo` at `:3909` with `reviewDecision` + `statusCheckRollup`). Frontend already derives review/CI state: `deriveCiState`/`deriveReviewState` (`src/features/pr-inspector/PRInspector.tsx:69,105`).

### Dependency (call-out)
**This surface depends on (a) the unified `useAgentFleet` session list** (to know which agents are `done` and which worktree each owns) **and (b) a NEW merge backend** — a Phase-3 dependency. **Do not design the merge internals here.** Today there is no merge command: `commands.rs` exposes `create_worktree`/`remove_worktree`/`git_commit`/`git_push`/`list_pull_requests` but **no `git_merge`/`merge_worktree`**. The outcomes list is fully buildable now as a **read-only review + commit/push + open-PR** surface; the "Merge" button is stubbed/disabled until the Phase-3 merge backend lands.

### Component breakdown
| Component | Reuse / build | Source |
|---|---|---|
| Outcomes list shell | **Reuse** `PanelHeader` + `EmptyState` | `PRInspector.tsx:211,238` |
| Outcome row (branch, files, state pill) | **Reuse** PR row pattern + state pills | `PRInspector.tsx:260-298` |
| CI / review pills | **Reuse** `CI_META`/`REVIEW_META` + derive fns | `PRInspector.tsx:96,114,69,105` |
| Merge-risk badge | **Reuse** `detectFileConflicts` output | `orchestrator.ts:107` |
| Inline diff on expand | **Reuse** `InlineResultPanel` (per-agent) or `get_pr_diff` (per-PR) | `InlineResultPanel.tsx:69`; `commands.rs:3934` |

### Interaction model
| Control | Action → command |
|---|---|
| Expand row | Load diff: per-agent `git_file_original` + `read_file` (`InlineResultPanel.tsx:130-132`) or per-PR `get_pr_diff` (`PRInspector.tsx:191`) |
| Review with Agent | `onStartReview(prompt)` → `start_agent` (already wired, `PRInspector.tsx:306-313`) |
| Commit & Push | `git_commit` then `git_push` (`SCMPanel.tsx:212-213`) |
| Discard worktree | `remove_worktree(repo, name, deleteBranch)` (`commands.rs:3555`) — must route the worktree name through `validate_branch_name` (`worktree.rs:173`) |
| **Merge** | **NEW (Phase-3): `merge_worktree` backend.** Disabled until it exists. |

### What to reuse vs build
- **Reuse:** PR row, CI/review derivations, `list_pull_requests`/`get_pr_diff`, `InlineResultPanel`, `git_commit`/`git_push`, conflict detection.
- **Build:** the done-agent → outcome-row mapping; **NEW merge backend (Phase-3, internals out of scope here).**

### Effort: **L** (the read-only/review/push half is **M** from reuse; the merge backend pushes the whole surface to **L** and is explicitly Phase-3).

---

## 6. Surface 5 — Kanban-card-as-agent-launcher + inline review

### Purpose
Turn a task card into the launch point for an agent-in-a-worktree, then let the operator review that agent's diff inline on the card without leaving the board. Closes the loop: plan → dispatch → review.

### Data source
- Launch (already wired): `handleLaunchTask` creates a worktree then starts an agent and links it to the task: `create_worktree(repoPath, branchName)` → `onStartAgent(task.title)` → `updateKanbanTask({ branch, worktreePath, assignedAgentId, column: "in_progress" })` (`src/features/kanban/KanbanBoard.tsx:80-118`).
- Live status badge on card (already wired): `agentStatuses[assignedAgentId].status` colored by `STATUS_COLORS` (`KanbanBoard.tsx:234-246`). The `agentStatuses` map is itself a projection of `useAgentFleet().sessions`.
- Inline review source: the linked session's `changedFileDetails` via `InlineResultPanel` (`InlineResultPanel.tsx:69-86`).

### Component breakdown
| Component | Reuse / build | Source |
|---|---|---|
| Task card + Launch button | **Reuse** | `KanbanBoard.tsx:247-272` |
| Agent status badge | **Reuse** | `KanbanBoard.tsx:234-246` |
| Inline review (diff, revert, AI-fix) | **Reuse** `InlineResultPanel` | `InlineResultPanel.tsx:69` |
| Card → fleet link | **Reuse** `assignedAgentId` | `KanbanBoard.tsx:111-115` |

### Interaction model
| Control | Action → command |
|---|---|
| Launch | `create_worktree` (`commands.rs:3546`) → `start_agent` (`useAgentManager.ts:374`) → `updateKanbanTask` |
| Review (expand card) | mount `InlineResultPanel` for `assignedAgentId`; diff via `git_file_original` + `read_file` (`InlineResultPanel.tsx:130-132`) |
| Revert a file | `write_file(path, original)` (`InlineResultPanel.tsx:285`) |
| Ask AI to review | `onStartAgent(prompt)` (`InlineResultPanel.tsx:327`) |
| Move column | `moveKanbanTask` + `onMoveWithSideEffects` (`KanbanBoard.tsx:120-131`) |

### What to reuse vs build
- **Reuse:** essentially everything — launch flow, status badge, `InlineResultPanel`.
- **Build:** the **branch-name unification** — `handleLaunchTask` builds `task/{id}` ad hoc (`KanbanBoard.tsx:83`) and never calls `validate_branch_name` or `predict_worktree_path`. Route both through the shared contract functions so the kanban branch and the worktree path match what every other surface expects.

### Effort: **S** (launch + badge + inline review exist; work is the shared validator/path wiring + mounting `InlineResultPanel` on the card).

---

## 7. Surface 6 — Native Windows Toasts

### Purpose
Pull the operator back when an agent crosses a state boundary they care about while the cockpit is unfocused — chiefly `→ waiting_approval` (needs you now) and `→ done` / `→ error` (outcome ready). The 3–4-agent operator is often in another window; this is how the cockpit reaches out.

### Data source
- **Existing transport.** Native toasts are already wired: `@tauri-apps/plugin-notification` via `sendWindowsNotification` (`src/shared/hooks/useTerminalNotifications.ts:113-137`), gated on `isPermissionGranted`/`requestPermission`. Backend has `tauri-plugin-notification = "2"` (`src-tauri/Cargo.toml:40`) and `notification:default` capability (`src-tauri/capabilities/default.json:17`).
- **Trigger source today** is the terminal `terminal:bell` event (`useTerminalNotifications.ts:68`), opt-in via localStorage, debounced + min-interval throttled (`:15,47-55`).
- **NEW trigger:** subscribe to `useAgentFleet().sessions` and fire on **state transitions** into `waiting_approval` / `done` / `error` (diff previous vs current session map), not on bells.

### Component breakdown
| Component | Reuse / build | Source |
|---|---|---|
| Toast transport (`sendNotification`) | **Reuse** | `useTerminalNotifications.ts:113` |
| Permission gate | **Reuse** | `useTerminalNotifications.ts:118-120` |
| Focus gate (`document.hasFocus()`) | **Reuse** | `useTerminalNotifications.ts:47` |
| Debounce / min-interval throttle | **Reuse** pattern | `useTerminalNotifications.ts:15,33,49` |
| Transition detector over `sessions[]` | **Build** | NEW — `useAgentFleetToasts(sessions)` |
| Per-state opt-in setting | **Build** (extend localStorage pattern) | `useTerminalNotifications.ts:103` |

### Interaction model
| Trigger (transition) | Toast | Click target |
|---|---|---|
| `→ waiting_approval` | "{agent} needs approval: {tool}" | open Approval Inbox (2), select agent |
| `→ done` | "{agent} finished — N files changed" | open Outcomes (4), expand row |
| `→ error` / `→ blocked` | "{agent} blocked: {reason}" | open Inbox/rail, select agent (`blockedReason`, `workstationGraph.ts:313`) |

Click routing uses the same `onSelect(id)` that the rail and grid share, so a toast click lands the operator on the exact agent in every surface.

### What to reuse vs build
- **Reuse:** transport, permission gate, focus gate, throttle — all live in `useTerminalNotifications.ts`.
- **Build:** the transition detector hook over `useAgentFleet().sessions`, and per-state opt-in (so `done` toasts don't spam during big Orchestra runs).

### Effort: **S** (transport is done; this is a transition-diff hook + routing).

---

## 8. Effort summary & build order

| # | Surface | Effort | Net-new vs reuse | Hard dependency |
|---|---|---|---|---|
| 1 | Agent Rail + counter | **S** | mostly reuse (`rankAgentSessions`, `SessionCard`, `attentionCount`) | `useAgentFleet` |
| 2 | Approval Inbox | **M** | reuse waiting-state; build panel + **NEW headless approval-resolve cmd** | `useAgentFleet` (uniform `waiting_approval` both runtimes) |
| 3 | Fleet Grid + borders | **M** | reuse Parallel view; build live-PTY-per-tile | `useAgentFleet` |
| 4 | Merge Queue / Outcomes | **L** | reuse PR row + diff + push; **NEW merge backend** | `useAgentFleet` **+ NEW merge backend (Phase-3)** |
| 5 | Kanban launcher + inline review | **S** | reuse launch + `InlineResultPanel`; wire shared validator/path | shared `validate_branch_name` / `predict_worktree_path` |
| 6 | Native toasts | **S** | reuse transport; build transition detector | `useAgentFleet` |

**Recommended order:** 1 → 6 → 3 → 2 → 5 → 4. Rail + toasts + grid give the operator situational awareness immediately on top of the unified hook; Inbox and Kanban add control; Outcomes lands last because it carries the Phase-3 merge-backend dependency.

### Cross-cutting dependencies (restated)
1. **`useAgentFleet`** (unified session list) is a hard prerequisite for surfaces 1, 2, 3, 4, 6. Today state is split across `useAgentManager` (`useAgentManager.ts:150`) and `useInteractiveAgent` (`useInteractiveAgent.ts:12`); the cockpit assumes one list.
2. **Canonical status taxonomy** (§1.1) must close the `spawning` / `running_tests` / first-class `blocked` gaps; the grid border, rail order, inbox filter, and toast triggers all key off it.
3. **Shared `validate_branch_name` + `predict_worktree_path`** must become the single branch/path authority (promote `worktree.rs:173` to public; route `KanbanBoard.tsx:83` through `predict_worktree_path`).
4. **NEW merge backend** is a Phase-3 dependency for surface 4 only — internals are out of scope for this UX spec.
