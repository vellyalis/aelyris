# Product Direction Proposals — API-ification, Core Hardening, Fleet UX (2026-07-03)

> **STATUS: PROPOSAL / DECISION RECORD — nothing below is shipped or claimed.**
> This document exists so a future work-order author (codex or owner) can turn
> individual items into gated work units. Every item cites the code evidence it
> was derived from. Claim policy applies: an item becomes a claim only when its
> verifier is green. Owner (product) decisions are marked `DECIDE:`.

Sources: owner product review 2026-07-03; parallel code audits (API surface,
core risks, UI pixel budget); external reference: the herdr agent-multiplexer
write-up (kazuph.github.io, 2026-05-28) analyzed for adoptable elements.

The vision bar this document serves: **usable by engineers AND non-engineers,
uniquely productive, not a clone of any existing terminal tool.** Aelyris'
moat is the governed, auditable, visible-fleet substrate; every proposal below
either widens that moat or removes friction in front of it.

---

## 0. Where the product stands (pointers, not prose numbers)

- Quality score / grade / releaseCandidateReady: regenerate with
  `pnpm verify:quality-score`, read `.codex-auto/quality/release-quality-score.json`.
- Final-goal audit residuals: `pnpm verify:final-goal-audit`,
  read `.codex-auto/quality/final-goal-audit.json` (as of writing:
  implementation-fixable residuals are zero; remaining blockers are
  external/operator/upstream gated — signing, token-consented live prompts,
  real-OS sleep, live host proofs).
- Interpretation for planning purposes: the **backbone is functionally
  complete and machine-verified** (terminal core, mux, visible fleet,
  ownership, review/merge, MCP control plane, session lifecycle). What remains
  is (a) operator-gated release evidence, (b) the depth items in §2/§3, and
  (c) the fleet-UX surface in §4 and the density work in
  `UI_DENSITY_AUDIT_2026-07-03.md`.

---

## 1. API-ification — close the gap between the cockpit and the control plane

The MCP control plane (`src-tauri/src/api/mcp.rs`, `tool_names()` at :19-90)
is the product's second face, but several load-bearing capabilities are
IPC/cockpit-only today. Priority order:

### A1. `aelyris.approval.resolve` (MCP) — highest value single verb
- Today: `resolve_interactive_approval` (`src-tauri/src/ipc/send_keys_commands.rs:157-241`)
  is IPC-only; MCP can observe pending approvals
  (`aelyris.list_pending_approvals`, GATED_OBSERVE_ONLY) but cannot resolve.
- Proposal: add `aelyris.approval.resolve { terminalId, decision, expectedPromptKey }`
  delegating to the SAME function (fingerprint check inside the write lock —
  do not re-implement). Risk-classify as GATED; audit event already exists.
- Why: closes the last human-only step for supervised-headless operation; an
  orchestrator (or a phone client, see §4.3) can answer a gate the same way
  the Decision Inbox does, with the same stale-approval protection.
- Gate: extend `verify-runtime-core-preconditions.mjs` to assert the MCP verb
  routes through `verify_current_interactive_approval`.

### A2. Visible-pane spawn over MCP
- Today: `aelyris.spawn_agent` spawns a HEADLESS worker only; the visible
  interactive TUI spawn (`spawn_interactive_agent`,
  `src-tauri/src/ipc/interactive_commands.rs:54-75`) is IPC-only.
- Proposal: `aelyris.agent.spawn_visible { cwd, model, initialPrompt?, branchName?, cols?, rows? }`
  → same internal fn (cost gate BR7 included). Programmatic fleets become
  visible in the cockpit — which is the product's core differentiator
  (1 pane = 1 visible agent).

### A3. Pane/layout verbs + short pane IDs (`%N`)
- Today: split/zoom/rotate/equalize/swap/break/join/synchronize exist as IPC
  (`src-tauri/src/lib.rs:1030-1038`) and untyped REST (`api/mux.rs:55-90`)
  but have NO typed MCP verbs — and the REST mux routes bypass the governance
  choke point (acknowledged in `governance/mod.rs:13-18`).
- Terminal ids are raw UUIDs (`pty/manager.rs:224`); no tmux-style short id
  exists anywhere. Pane name/role addressing (`send_keys_by_name/by_role`)
  is IPC-only.
- Proposal: (a) typed `aelyris.pane.*` verbs for split/zoom/equalize/rotate,
  routed through governance; (b) a session-scoped monotonic short-id table
  (`%1`, `%2`…) in the pane registry, shown in the pane header and resolvable
  by every addressed verb; (c) `aelyris.pane.rename` / `aelyris.pane.set_role`.
- Why: agent-to-agent delegation ("tell %3 to rebase") needs human-routable
  addresses; this is herdr's most battle-tested idea (§5) and we have all the
  plumbing except the alias table.

### A4. `aelys` CLI as the in-pane agent API
- Today: `aelys` EXISTS (`src-tauri/src/bin/aelys.rs`, REST client for PTY/mux
  on 127.0.0.1:9333, token auth) but never calls `/mcp/tools/call`, so all
  ~65 typed verbs are unreachable from a shell. Every agent pane already has
  `AELYRIS_TERMINAL_ID` injected (`pty/manager.rs:274`) — unused by the CLI.
- Proposal, in order:
  1. `aelys mcp <verb> [json]` passthrough to `/mcp/tools/call` — one small
     subcommand unlocks the whole control plane for shell-native agents.
  2. Default `--target` to `$AELYRIS_TERMINAL_ID` so `aelys report`,
     `aelys send-to %2`, `aelys status` work inside a pane with zero args.
  3. `aelys report --title "<task>"` → pane title (needs A3c backend verb) —
     herdr's task-reporting: pane headers become live task labels.
  4. `aelys notify-on-exit <cmd>` → run a background command, toast + event on
     completion with exit code (backend: small REST route + EventBus publish;
     the completion sensing pattern already exists in `pane_fleet.rs`).
- Why: for CLI agents, **the shell IS the API**. Teaching every agent
  "you can call `aelys …`" (via the repo-guidelines injection that already
  exists) turns each pane into a first-class fleet citizen without MCP client
  code. Ship a `aelys help --agent` with an agent-recipes section the prompt
  injector can reference.

### A5. Workflow/phase-gate verbs + cost caps over MCP
- Today: the phased workflow engine (start/phase_done/approve_gate/evidence…,
  `lib.rs:1177-1192`) and `cost_set_caps`/`cost_caps` (`lib.rs:1069-1071`)
  are cockpit-only. An MCP-driven loop cannot advance phases or read/adjust
  the budget that will halt it (BR7).
- Proposal: `aelyris.workflow.*` mirror (status/phase_done/approve_gate with
  reviewer≠implementer enforcement) and `aelyris.cost.get_caps` (read) +
  `aelyris.cost.set_caps` (GATED, audited).

---

## 2. Core hardening (correctness/safety before new features)

### C1. Uniform stale-approval guard on ALL write paths — safety bug
- `resolve_interactive_approval` re-verifies the approval fingerprint inside
  the per-terminal write lock, but `send_keys`, `broadcast_keys`,
  `send_keys_by_name/by_role/by_target` and shared `write_to_terminals`
  (`send_keys_commands.rs:24,271,395,461,493,551-625`) do not — a broadcast
  `1\r` can silently accept a permission menu on a pane in `waiting_approval`.
- Step: in `write_to_terminals`/`broadcast_keys`, under the already-held
  write lock, skip-or-deny panes whose session is `waiting_approval` unless
  the caller passed a matching `expectedPromptKey`. Verifier: extend the
  runtime-core preconditions gate.

### C2. Collision-proof done-markers — correctness bug
- `done_marker_path` derives the filename from the sanitized task id only
  (`control/pane_fleet.rs:67-75`); `task/1` and `task:1` collide, and two
  tasks sharing a worktree can complete each other and kill a live pane.
- Step: include `terminal_id` (already unique) in the marker filename, or make
  the sanitizer injective (hash suffix). Add a collision test.

### C3. Memoize the MCP catalog — hot-path waste
- `input_schema_for_tool` rebuilds the entire ~65-verb catalog JSON per
  `tools_call` (`mcp.rs:1350-1358`, called at :1697).
- Step: `LazyLock` the catalog + a name→schema `HashMap` index; the existing
  drift test (:3267) keeps it safe.

### C4. Knowledge graph: live incremental indexing
- `populate_knowledge_graph` is a manual, whole-graph, module-level replace
  (`ipc/knowledge_commands.rs:12-25`), triggered only on project switch
  (`App.tsx:1814`, errors swallowed). `start_fs_watcher` (`lib.rs:1174`) is
  not wired to it. Blast-radius answers go stale as soon as agents edit code.
- Step: debounced incremental re-index on watcher events; `aelyris.knowledge.reindex`
  verb; later, promote the indexer to symbol-level edges to match the
  symbol-ownership layer.

### C5. Governance: real principal + gate the mux routes
- `mcp.rs:1684` hardcodes `actor = "operator"`; the mux REST routes bypass
  `authorize` entirely (by documented design). Single token = omnipotent.
- Step: resolve a `Principal` from the token via the existing
  `PrincipalResolver` seam (`governance/mod.rs:100-111`); route `api/mux.rs`
  through `derive_capability`/`authorize` like the session routes. This is
  the prerequisite for a reviewer-identity (not just task-ownership) gate on
  `aelyris.review.approve`.

### C6. Event bus: loud pending-buffer overflow
- Durable log is no-loss EXCEPT under sustained DB-write failure, where the
  bounded pending buffer sheds oldest events with only a `tracing::warn!`
  (`event_bus/manager.rs:143-152`).
- Step: publish a high-severity system event/metric on shed; consider a small
  on-disk WAL spill; document "no db ⇒ no durability" on the
  `aelyris.event.since` verb description.

---

## 3. herdr comparison — adopt / already-have / skip

Reference: herdr fork write-up (agent multiplexer on tmux lineage). Verdict
per element:

| herdr element | Aelyris today | Verdict |
|---|---|---|
| Worktree ops in sidebar, branch visibility | Shipped (worktree create/remove, branch in header) | HAVE |
| Agent state per pane (working/blocked/idle) | Shipped, richer (11 statuses incl. waiting_approval, summarizing, retiring) | HAVE |
| Layout ops (equalize/cycle/rotate), context-aware menus | Shipped in mux engine + UI | HAVE (API-ify per A3) |
| Fail-closed session restore, no focus-inference identity | Shipped (RT-1e fail-closed resume; `AELYRIS_TERMINAL_ID` ancestry, not focus) | HAVE |
| **Short pane IDs (%N) as routing addresses** | Missing (UUIDs only) | **ADOPT — A3b** |
| **Agent task-reporting into pane title** (`report-agent --title`) | Missing (`rename_pane` exists but IPC-only, agents can't call it) | **ADOPT — A4.3** |
| **CLI-native agent API + agent recipes in help** | `aelys` exists but PTY-only; no MCP bridge, no recipes | **ADOPT — A4.1/A4.2** |
| **`run-notify` (bg command completion toast)** | Missing | **ADOPT — A4.4** |
| Intelligent toasts: last-response excerpt, dedup window, don't interrupt open questions | Partial (Decision Inbox for gates; no excerpt toasts / dedup policy) | ADOPT (small): completion/blocked toasts with 120-char excerpt + 10s dedup, sourced from the existing monitor |
| Buffered `agent send` (type, wait, submit) | Partial (guarded send exists; no settle-delay contract) | ADOPT (small): settle-delay option on send verbs — prevents the classic "typed but never submitted" loss |
| Restore dry-run preview + explicit unrecoverable list | Partial (fail-closed, but no preview UI) | ADOPT (small): dry-run mode on resume showing exact respawn commands |
| Vim keybinding mode for pane/workspace nav | Missing (prefix-key engine only) | LATER (nice-to-have; prefix engine covers power users) |
| Mobile/narrow SSH attach (Tailscale) | Missing (desktop app) | TRANSFORM → §4.3 read-only web fleet monitor instead of SSH TUI |
| Workspace sections/favorites | Missing | LATER (low value at current scale) |

Net: herdr's durable ideas are **address-ability (%N), agent self-reporting,
and shell-native control** — all three are A3/A4 items above. Aelyris should
NOT chase its SSH/TUI form factor; our answer to remote is §4.3.

---

## 4. Beyond herdr — differentiating elements (owner-vision candidates)

These serve "non-engineers productive too, existing tools don't have this".
Each is deliberately built ON the substrate we already verified.

### 4.1 Fleet Briefing ("what happened while you were away")
One click / one verb: summarize per-agent activity since a timestamp — tasks
touched, diffs produced, gates waiting, cost spent — rendered as plain
language for non-engineers. Backend exists: no-loss event log
(`aelyris.event.since`), agent activity, scrollback, cost. This is the
single most non-engineer-friendly feature we can ship cheaply, and no
terminal tool has it. `DECIDE:` naming + where it lives (right rail widget +
`aelyris.brain.briefing` verb).

### 4.2 Risk-sorted approval batching
The Decision Inbox already classifies risk. Add: batch-approve all LOW-risk
gates in one action; require per-item confirmation for HIGH/CRITICAL. Cuts
the #1 non-engineer friction (permission fatigue) without weakening the
gate model (batch action is itself audited).

### 4.3 Read-only remote fleet monitor (phone/web)
The HTTP API + token auth already exist. A single read-only page (fleet
status, decision inbox, briefing) served by the daemon, reachable over
Tailscale — approve/deny wired ONLY through A1's fingerprint-checked verb.
This replaces herdr's "SSH from phone" story with something a non-engineer
can actually use. `DECIDE:` scope (read-only first vs approve-capable).

### 4.4 Plain-language task intake
`decompose_to_plan` → `validate_plan` → `submit_plan` already exist
(`task/decompose.rs`, `task/planner.rs`, `task/manager.rs`). Wrap them in a
non-engineer intake: describe the goal in a sentence, preview the plan in
plain language (which agents, which files, what gates), one button to
dispatch. The Orchestra dialog is 80% of this UI already.

### 4.5 Live cost/token grid ("the meter")
Already backlog #1 (cost/token grid + BR7 bind). Elevate: per-agent live
spend, projected burn, one-click cap adjust (A5). Non-engineers fear
runaway cost more than anything; making the meter visible is trust.

### 4.6 Fleet recipes (one-click presets)
Named presets ("implement+test+review this issue", "audit this module",
"upgrade dependency safely") = Orchestra roles + prompts + gates as data.
GUI equivalent of herdr's agent recipes; shareable as JSON in-repo.

---

## 5. Recommended execution order (for the next work-order author)

> Status legend maintained as items land. Resume rule: the next work unit is
> always the **lowest-numbered item not marked DONE**.

1. **C1 + C2** (safety/correctness bugs — small, verifier-gated) —
   **DONE 2026-07-03 (WU-FA-1 F1/F2, merged via PR #14).**
2. **A1** (approval.resolve over MCP) + **C3** (memoization, trivial) —
   **DONE (WU-FA-1 F3/F4, PR #14).**
3. **A3b short IDs + A4.1/A4.2 CLI bridge** (address-ability foundation) —
   **DONE (WU-FA-1 F6/F7, PR #14).**
4. **A4.3 report --title + A2 visible spawn** (fleet legibility) —
   **DONE (WU-FA-1 F5/F7, PR #14; F8 notify-on-exit skipped as optional).**
5. **UI density work order** (`UI_DENSITY_AUDIT_2026-07-03.md` — parallel-safe
   with the above, different files) — **DONE 2026-07-03, merged to main
   (WU-UD-1).**
6. **⏭ NEXT UP — WU-UQ-1 safety subset: phases Q0–Q3 only**
   (`UI_PRODUCT_QUALITY_AUDIT_2026-07-05.md` + root
   `ui-quality-instructions.md`). These are correctness/safety bugs, not
   polish: gate-first trust verifier (Q0), pane liveness wiring (Q1),
   sidecar reconnect visibility (Q2), multi-line paste guard (Q3).
   **To start: paste Packet 1 from `ui-quality-instructions.md` into a
   cleared codex/opus session.** WU-FA-1 is merged (2026-07-05), so the
   former same-session conflict is moot — but rebase-aware: TerminalInfoBar
   now carries the `%N` prefix; keep it intact. Window transparency is
   absolute (owner law) — see the work order's ground rules.
7. **4.1 Fleet Briefing + 4.2 approval batching** (non-engineer value)
8. **C4 KG live indexing / C5 governance principal** (depth)
9. **WU-UQ-1 remainder: phases Q4–Q11** (ownership/blocker rendering,
   keyboard approvals, evidence-honesty labels, small-honesty batch,
   keyboard-complete shell + persisted nav, dead-layer cleanup,
   enforce + rendered-truth CI, stretch contrast gate). Normal priority.
   Phases Q2/Q6/Q8/Q10 carry judgment calls — prefer an opus checkpoint
   before/after those when executed by codex.
10. **4.3 remote monitor** (after A1/C5, since it rides them)

Everything above follows the standing rules: one work unit = one branch,
verifier before claim, no weakening of existing gates, owner decides `DECIDE:`
items before implementation starts.
