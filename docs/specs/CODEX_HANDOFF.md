# Aether Cockpit — Codex Implementation Handoff

Status: **Ready for implementation.** Design complete; no source code written yet.
Branch context: authored on `codex/release-hardening-quality-gates` (working tree dirty with unrelated WIP — see §7).
Implementer: **Codex** (GPT-5.x). Orchestration/integration owner: human + Opus.

> This is the master plan. Each **Work Unit (WU)** below is self-contained: read its
> spec section + listed files, honor the Shared Contract (§3), implement, then pass the
> Acceptance Criteria. Pick WUs top-to-bottom respecting the dependency DAG (§5).
> **Do not** start a WU whose dependencies are unmet.

---

## 1. North star

Aether becomes an **agent-controllable workspace**, not just an IDE. Its capabilities
(worktree · agent · pane · diff · merge · approval) become **one backend capability
layer** ("Aether Control API"). Two clients project onto it:

- **Face 1 — Cockpit UI** (human operator, via Tauri IPC) — supervises by exception.
- **Face 2 — Orchestrator AI** (Opus 4.8, via an `aether` MCP server) — drives the mechanics.

Build the layer **once**; both faces consume it. The orchestrator runs 3–4 worker agents
(Claude/Codex CLIs), each in its own git worktree, and the human supervises through the
cockpit. **Safety invariant:** `approval` and `merge-to-main` are GATED — the AI may
request/observe but the **watchdog policy engine + human** grant. Never expose a free
"grant approval" or "merge to main" tool.

## 2. Spec map (which doc owns what)

| Spec | Owns | Phase |
|---|---|---|
| [PHASE_0_1_ARCHITECTURE_SPEC.md](./PHASE_0_1_ARCHITECTURE_SPEC.md) | Capability layer (§0.5), runtime unification, god-file split, worktree auto-wiring, **gate model (§5)** | 0, 1 |
| [UI_TOKEN_DIAL_SPEC.md](./UI_TOKEN_DIAL_SPEC.md) | `global.css` token dial-up change list, new tokens, accent unification, motion | 1 |
| [COCKPIT_UX_SPEC.md](./COCKPIT_UX_SPEC.md) | 6 cockpit surfaces as projections of `useAgentFleet().sessions` | 2, 4 |
| [MCP_TOOL_SURFACE_SPEC.md](./MCP_TOOL_SURFACE_SPEC.md) | `aether.mcp.v1` tool catalog, transport, gate enforcement | 2.5 |
| **CODEX_HANDOFF.md** (this) | Work breakdown, dependency DAG, acceptance gates, paste-ready prompts | all |

## 3. Shared contract (binding — every WU must honor)

- **`AgentSession`** — one unified backend session struct for both runtimes (headless `AgentManager` + PTY `InteractiveSessionManager`).
- **`AgentRunStatus`** enum, defined **once in Rust**, TS union **derived**: `spawning, thinking, coding, running_tests, waiting_approval, blocked, idle, done, error`.
- **`useAgentFleet`** — one frontend hook; replaces `useAgentManager` + `useInteractiveAgent`. It is the **UI-side client of the capability layer**, not an ad-hoc Tauri caller.
- **Capability layer** — proposed `src-tauri/src/control/` with per-domain modules (worktree/agent/pane/diff/merge/approval). Tauri IPC and the MCP server are thin adapters over it.
- **One** branch-name validator (`validate_branch_name`, `worktree.rs:173`) and **one** worktree-path fn (`predict_worktree_path`, `worktree.rs:195`) — delete the duplicates.
- **Gate model** — `worktree/agent/pane/diff` = FREE; `approval`/`merge-to-main` = GATED via `WatchdogEngine::evaluate` (`watchdog/engine.rs:30`, outcomes `AutoApprove|AutoDeny|AskUser`). Gated calls return `pending`/`queued`, never self-grant.
- **Contract enforcement** — the Rust⇄TS shared types (`AgentRunStatus`, `AgentSession`) are frozen by a **contract test** against a shared fixture (WU-0.7); drift fails a test, not at runtime. Frontend may build against a fixture-conforming **mock** before the backend command lands — this is what makes front/back work simultaneous.
- **Migration style** — additive adapter → cutover. No big-bang renames; keep gates green at each step.

## 4. Work units

Effort: **S** ≈ <½ day · **M** ≈ 1–2 days · **L** ≈ 3+ days. "⚠" = a do-not-break trap.

### Phase 0 — Consolidation (foundation)

| WU | Title | Eff | Deps | Notes |
|---|---|---|---|---|
| **0.1** | `AgentRunStatus` single source (Rust enum + derived TS union; map `output_monitor::DetectedStatus` → it in one place) | S | — | Blocks 0.2, 2.x, 4.4. Define in new `src-tauri/src/agent/status.rs` (spec §1.1). |
| **0.2** | Unified `AgentSession` model + adapter over both runtimes | M | 0.1 | Spec §1.2. Adapter wraps `AgentSessionInfo` (claude.rs:11) + `InteractiveSessionInfo` (interactive.rs:135). |
| **0.3** | `useAgentFleet` hook (merges `useAgentManager` + `useInteractiveAgent`) | M | 0.2 | Spec §1.3. AgentInspector consumes one list. |
| **0.4** | Capability layer scaffold `src-tauri/src/control/` (per-domain modules wrapping existing commands; no behavior change) | M | 0.1 | Spec §0.5. This is the substrate both faces need. |
| **0.5** | Single branch validator + single worktree-path fn (remove the divergent inline validator at `interactive_commands.rs:67-80`) | S | — | Spec §3 / §0. Independent — do early. |
| **0.6** | God-file decomposition: `commands.rs` (6795 lines) → `git_commands.rs`/`terminal_io_commands.rs`/`mux_commands.rs`/`agent_commands.rs`; `App.tsx` (6922 lines) → extract the ~3 duplicate right-rail blocks + orchestration wiring | L | 0.3, 0.4 | Spec §2. Incremental; can trail other phases. |
| **0.7** | Type bridge: Rust⇄TS **contract tests** for `AgentRunStatus`/`AgentSession` against a shared fixture + a contract-typed `invoke` wrapper with a **frontend mock**. (Optional `tauri-specta` codegen is deferred — §7.) | M | 0.1, 0.2 | TYPE_BRIDGE_SPEC. **Enables simultaneous front/back dev**: drift fails a test, and the frontend builds against a fixture mock before the backend command exists. No new dependency for Tier 1. |

### Phase 1 — Worktree auto-wiring + immediate UI

| WU | Title | Eff | Deps | Notes |
|---|---|---|---|---|
| **1.1** ⚠ | Thread `branchName` through Orchestra dispatch so each lane gets its own worktree | S | 0.5 | `handleStartRightRailOrchestra` (`App.tsx:4762`) → `handleStartAgent` (`App.tsx:4787-4790`) currently passes **no** `branchName` → lanes collide. **Must update the gate string in lockstep** (see §6). Spec §3. |
| **1.2** | `router.rs` IPC + dispatch UI wiring (auto model assign) | S | 0.4 | `AgentRouter::route` is implemented+tested but has **no IPC/UI** (no-infra-without-wiring violation). |
| **1.3** | UI token dials in `global.css` (type register up, border alpha up, kill weight 800–950) | S | — | UI_TOKEN_DIAL_SPEC §1–3. Fully independent — can ship anytime. Single-blur rule must stay intact. |
| **1.4** | New tokens (`--surface-selected`/`-inset`/`-rim`, `--tracking-kicker`, `--type-ui-small`) + apply to active states | S | 1.3 | UI_TOKEN_DIAL_SPEC §4–5. |

### Phase 2 — Cockpit surfaces (all depend on the unified fleet list 0.3)

| WU | Title | Eff | Deps | Notes |
|---|---|---|---|---|
| **2.1** | Agent rail (needs-attention-first sort + global attention counter) | M | 0.3 | COCKPIT_UX_SPEC §2. Reuse `rankAgentSessions` / `buildWorkstationSummary.attentionCount`. |
| **2.2** | Approval inbox (aggregate watchdog `AskUser` across ALL agents) | M | 0.3 | COCKPIT_UX_SPEC §3. Reuse `DecisionInboxPanel`. GATED grants only. |
| **2.3** | Fleet grid (N live agent terminals, state-colored borders, maximize hotkey) | M | 0.3 | COCKPIT_UX_SPEC §4. Compose `AgentTerminal` / `mux_split_pane`. |
| **2.4** | branch-vs-target diff in ghostdiff (today only vs own base) | M | 0.4 | COCKPIT_UX_SPEC §5 / arch. Feeds merge-readiness. |

### Phase 2.5 — MCP server (Face 2)

| WU | Title | Eff | Deps | Notes |
|---|---|---|---|---|
| **2.5.1** | `aether` MCP server scaffold (stdio) over the control layer — FREE tools only | M | 0.4 | MCP_TOOL_SURFACE_SPEC §2–3. Precedent: `/mcp/*` routes at `api/mod.rs:964-966`. |
| **2.5.2** | Gate enforcement for GATED tools (`request_approval`/`list_pending_approvals`/`request_merge`) — enqueue+observe, watchdog/human resolves | M | 0.4, 3.1 | MCP_TOOL_SURFACE_SPEC §4. No self-grant invariant. |
| **2.5.3** | Streamable HTTP transport option (reuse daemon bearer-token auth) | S | 2.5.1 | MCP_TOOL_SURFACE_SPEC §2.2. |

### Phase 3 — Merge tail (the missing defining capability)

| WU | Title | Eff | Deps | Notes |
|---|---|---|---|---|
| **3.1** | Merge backend `src-tauri/src/git/merge.rs` (`merge_worktree_branch` / `abort` / conflict status) — **0 merge commands exist today** | L | 0.5 | arch §0.5 (merge domain = NEW). git2-rs. |
| **3.2** | Merge-queue state machine (sequential integration, ahead/behind, ready-to-merge gating) | L | 3.1, 0.2 | Build on the existing `collectableCount` run-summary marker. GATED. |
| **3.3** | Ready-to-merge / outcomes UI (diffstat + test badge + Merge/Discard) | M | 3.2, 0.3 | COCKPIT_UX_SPEC §5. |
| **3.4** | `create_pr` via gh (optional) | S | 3.1 | Local-only project → low priority; `list_pull_requests` already read-only exists. |

### Phase 4 — Finish

| WU | Title | Eff | Deps | Notes |
|---|---|---|---|---|
| **4.1** | Kanban card = agent launcher + inline review (drag to In-Progress → spawn agent in worktree) | M | 0.3, 3.3 | COCKPIT_UX_SPEC §6. |
| **4.2** | Native Windows toasts per agent event (blocked / done / test-failed / budget) + click-to-focus | S | 0.3 | COCKPIT_UX_SPEC §7. Tauri notification. |
| **4.3** | Per-line comment threads on agent diff + "send back to agent" | M | 2.4, 3.3 | Extends `InlineResultPanel`. |
| **4.4** | `output_monitor`: structured status (prefer stream-json) + fill Codex/Gemini parser stubs | M | 0.1 | Brittle TUI scraping today; Gemini/Codex parsers near-empty. |

### Phase 5 — Autonomous orchestration (capstone)

The **only missing layer** of the autonomous team-dev vision; everything below it exists or is built above. See PLANNER_SPEC.

| WU | Title | Eff | Deps | Notes |
|---|---|---|---|---|
| **5.1** | **Autonomous planner**: one-line task → requirements spec + WU decomposition emitted as `scripts/fleet/wu-manifest.json`. Planning pass (LLM stream-json → manifest) prepended to the Orchestra dispatch. | L | 0.1, 0.2, 0.3 | PLANNER_SPEC §1. The `aether-plan` skill does this **manually today**. Model = Opus. The manifest is the planner↔fleet contract. |
| **5.2** | **Autonomous loop**: plan → dispatch (worktree per WU) → monitor → impl/test/review roles → sequential **gated** merge → repeat, until WUs done or round/budget cap. Human supervises by exception. | L | 5.1, 3.2, 2.2 | PLANNER_SPEC §2. Star comms only. `approval`/`merge-to-main` stay GATED (`control/approval.rs`) — never self-grant. Runaway guard required. |

## 5. Dependency DAG & execution order

```
0.5 ─┬─────────────► 1.1 ⚠ ──────────────────────────► 3.1 ─► 3.2 ─► 3.3 ─► 4.1
     └─► 3.1
0.1 ─┬─► 0.2 ─┬─► 0.3 ─┬─► 0.6        ┌─► 2.1            3.3 ─► 4.3
     │        └─► 0.7  ├─► 2.1/2.2/2.3 │   2.2/2.3       2.4 ─► 4.3
     │      (contract  │              │
     │       tests →   │              │
     │       front/back│              │
     │       parallel) │              │
     └─► 0.4 ─┬────────┴─► 2.4         └─► 4.2            0.3 ─► 4.2
              ├─► 1.2
              └─► 2.5.1 ─► 2.5.3
                  2.5.2 (needs 0.4 + 3.1)
1.3 ─► 1.4   (fully independent island — ship first for a quick win)
```

**Recommended batches** (each batch internally parallel-safe; use one git worktree per WU):

1. **Batch A (quick wins, no deps):** `1.3` → `1.4` (UI), and `0.5` (validator), and `0.1` (status). Ship UI dials immediately.
2. **Batch B (foundation):** `0.2` → `0.3`, and `0.4` in parallel; then `0.7` (contract tests) — after which front/back WUs can run simultaneously.
3. **Batch C (the highest-ROI behavior fix):** `1.1` ⚠ + `1.2`.
4. **Batch D (cockpit):** `2.1`, `2.2`, `2.3`, `2.4`, `2.5.1` in parallel.
5. **Batch E (merge tail):** `3.1` → `3.2` → `3.3`, then `2.5.2`.
6. **Batch F (finish):** `0.6`, `4.1`, `4.2`, `4.3`, `4.4`.
7. **Batch G (capstone — autonomous):** `5.1` (planner) → `5.2` (autonomous loop). Assembles the whole stack; build last. Usable manually before then via the `aether-plan` + `aether-fleet` skills.

## 6. Do-not-break list & test gates

Before handing back any WU, run from `src-tauri/`: `cargo test` · `cargo clippy --all-targets -- -D warnings` · `cargo fmt --check`. From repo root: `pnpm test` (vitest).

- ⚠ **WU-1.1 lockstep:** `scripts/verify-agent-team-orchestration-readiness.mjs:218` asserts the **exact** string `handleStartAgent(prompt.prompt, prompt.model, { role: prompt.roleId as OrchestraRoleId })`. If you change that dispatch call to pass `branchName`, update this gate string (and `:210-219` block) in the same commit, or `npm run verify:*` fails.
- **Doc-freshness gate:** `scripts/verify-goal-documentation-freshness.mjs` tracks 5 live goal docs — don't let edits stale them.
- **Right-rail suite:** `verify-right-rail-*.mjs` (orchestrated by `verify-right-rail-suite.mjs`) guards rail/density — re-run after WU-2.1 and any token dial.
- **Single-blur rule:** UI WUs change only alpha/size/tokens — never add a second `backdrop-filter` to a child.
- **Gate invariant:** no MCP tool may grant its own approval or merge to main (WU-2.5.x).
- **Conventions:** immutability, files <800 lines, explicit error handling, no `console.log`. **Local-only project — never push or open PRs** (`project_local_only`).

## 7. Out of scope / deferred

- **Repo cleanup** (archive the 2026-05-06 `docs/` historical cluster via `git mv`; prune `.codex-auto/` 138MB; remove orphan probe scripts) — a **separate chore** after the current dirty branch lands. Not part of this build.
- GitButler-style virtual lanes / stacked-branch auto-restack — future, post-cockpit.
- **`tauri-specta` / `ts-rs` codegen** (Tier 2 of WU-0.7) — deferred until Phase 0/1 land; do not churn the in-flight hand-written types now. WU-0.7 ships only the no-dependency contract tests + frontend mock for now.
- Merge **internals** beyond WU-3.1's stated surface (conflict-resolution UX depth) — design later.

> **Codex availability note:** per project memory, the operator's Codex account is usage-limited until **2026-07-01**. This handoff is durable — execute whenever Codex is available; the WUs are dated only by the branch state above.
