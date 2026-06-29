# Aelyris — Audit-Driven Implementation Plan (2026-06-23)

Status: **DRAFT for Codex review** (then implement). Author: Claude.

Drives the remaining work from two Codex audits + the symbol-ownership spec
conformance audit, after symbol-ownership slices 1-4 merged to master (`624e901`)
and were **live-verified ALL PASS** (`scripts/verify-symbol-ownership-live.mjs`:
runtime claim surface, live-map block, same-file disjoint co-dispatch / overlap
serialize — proven on the running app).

Inputs: `CLAUDE_HANDOFF_COCKPIT_REQUIREMENTS_AUDIT_2026-06-23.md`,
`AELYRIS_FUSION_COORDINATOR_AUDIT_2026-06-23.md`,
`VISIBLE_AGENT_PANE_RUNTIME_SPEC.md §6`, and the 4-agent spec-conformance audit.

Every step keeps all gates green (`cargo test` / `clippy -D` / `fmt` / `tsc` /
`vitest` / the relevant `scripts/verify-*.mjs`), is purely additive where
possible, and follows the existing `LoopPorts`-style pure-core + thin-adapter
pattern.

---

## Workstream A — Symbol ownership: close conformance gaps, then finish slices 5-6

The merged core/scheduler is faithful, but the conformance audit found **3 real
gaps** (not deferred slices). Close these FIRST (they are correctness fixes to
already-merged code), then build the deferred slices.

### A1 — Shared config/types/schema files default to file-level exclusivity  *(GAP, §6.2 L470 / §6.5 L519)*
- **Problem**: no path classification exists; two agents with disjoint symbols in
  `package.json` / `tsconfig.json` / `Cargo.toml` / `*.schema` / migration files
  are granted symbol-level co-dispatch — the OPPOSITE of the spec default.
- **Approach**: add a pure `fn is_shared_file(path) -> bool` (glob/extension/name
  classifier: lockfiles, `*.json` config, `*.toml`, `*.schema*`, `schema.*`,
  `migrations/**`, `*.proto`, `*.d.ts`, etc. — configurable list). Symbol
  disjointness is honored ONLY when `!is_shared_file(path)`; a shared file always
  collapses to file-level exclusivity. Apply in BOTH layers: `conflict_between`
  (mod.rs runtime claim — a shared-file claim conflicts with any other on it) AND
  `tasks_collide` (autonomy.rs dispatch gate).
- **Escape hatch (sub-deviation)**: spec says the exception is "the LANGUAGE
  SERVER can prove safe boundaries" = **LSP only**, not Parser. So for shared
  files, only `Confidence::Lsp` (not Parser) unlocks symbol-level parallelism.
  Needs distinguishing Lsp from Parser at the gate (today `is_exact` lumps them).
- **Files**: `symbol_ownership/mod.rs` (classifier + conflict_between/intents_block
  shared-file rule), `orchestrator/autonomy.rs` (tasks_collide), tests.
- **Acceptance**: unit tests — disjoint LSP symbols on `src/x.rs` co-dispatch; the
  same on `package.json`/`tsconfig.json` serialize; Parser-confidence on a shared
  file serializes (LSP-only escape); the live `verify-symbol-ownership-live.mjs`
  gets a shared-file case. Effort: **small-medium**.

### A2 — Low-confidence (DiffHunk) overlapping DECLARED intents at dispatch  *(MEDIUM mismatch, §6.5 L522 vs §6.2 L469)*
- **Tension**: §6.2 L469 "low-confidence inferred claims WARN but do not
  hard-block" (current behavior — DiffHunk overlap → Warn at the claim layer) vs
  §6.5 L522/524 listing "low-confidence symbol extraction" under the
  Slow/SERIALIZED path. Today two tasks with overlapping DiffHunk write intents
  **co-dispatch** (intents_block requires both exact).
- **Decision needed** (flag for Codex): the cleanest reconciliation is that the
  two spec lines describe different layers — §6.2's "warn not block" is the
  RUNTIME claim layer (an agent already editing); §6.5's "serialize" is the
  DISPATCH scheduler (a not-yet-running task with an INFERRED range it cannot
  prove disjoint). Recommended: at the **dispatch gate only**, an overlapping
  pair where EITHER side is DiffHunk on the same concrete file serializes
  (conservative — an inferred range can't prove disjointness), while the runtime
  claim layer keeps Warn. This makes the gate match §6.5 without contradicting
  §6.2.
- **Files**: `orchestrator/autonomy.rs` `intents_block` / a new dispatch-only
  predicate; tests. Effort: **small**.

### A3 — Release-on-merge / release-on-fail auto-wiring for symbol claims  *(GAP, audit L128-129 / BR8)*
- **Problem**: file lanes auto-release via `apply_file_lanes` on `report.merged`;
  symbol claims have NO loop wiring — `release_for_task` is only an IPC/MCP verb a
  caller must remember. The merge tail + crash/timeout/rework recovery never free
  a task's symbol claims (mitigated only by the 300s lease).
- **Approach**: mirror `apply_file_lanes` — an `apply_symbol_lanes(symbol_owner,
  report)` that calls `release_for_task` for every `report.merged` AND every
  recovered/failed task (crash/timeout/rework), publishing a `FileReleased`-style
  signal. Wire it in `run_step` + `run_step_visible` next to `apply_file_lanes`
  (both faces). Add a recovery-path sweep / a periodic `expire()` so expired
  leases are released by recovery logic, not only on read.
- **Files**: `control/loop_ports.rs` (apply_symbol_lanes + wiring), tests proving a
  merged/failed task's claims are gone. Effort: **small-medium**.

### A4 — Slice 5: extractor tiers  *(deferred, §6.3)*
- LSP `textDocument/documentSymbol` (NEW plumbing — today only completion+hover
  are wired) → parser fallback → diff-hunk (from a task's git diff hunks) →
  file fallback. Emits `SymbolIntent`/`SymbolClaim` with the right confidence tier.
  Also wires the **file-watcher / tool-event auto-refresh** triggers (§6.2 L471)
  that currently only have the heartbeat channel. Interacts with A1 (shared-file
  LSP-only) and A2 (DiffHunk).
- **Files**: new `symbol_ownership/extract.rs` (+ trait `SymbolExtractor`),
  `lsp/` (documentSymbol request), `watcher.rs` (auto-refresh). Effort: **large**.

### A5 — Slice 6: UI surface  *(deferred, §6.4 / DoD #9-10)*
- Symbol-scoped conflict badge (refine the pre-existing same-file badge to light
  ONLY on overlapping symbol/range claims, distinguishing Block vs Warn / Lsp vs
  inferred confidence), parallel-safe indicator, pane-header `editing
  file:symbol()`, run-graph `agent→symbol→file` edges. Reads the existing
  `symbol_claims` / `symbol_conflicts` IPC (already exposed). Effort: **medium**.

---

## Workstream B — CLAUDE_HANDOFF audit: remaining items

Most are done (verifier CRLF, upper-compat BLOCKED, handoff status, cost cap=4,
mux/upper-compat refresh). Remaining:

### B1 — Current-date live MCP + visible-pane evidence with the bearer token  *(P1)*
- Re-run `verify-mcp-task-surface-live` / `verify-shared-brain-live` /
  `verify-autonomy-loop-live` and the pane proofs with the CURRENT
  `AELYRIS_API_TOKEN` (read from the dev log) + explicit AI-token consent. Needs
  the app running. Effort: **small** (operational), **requires user consent** for
  token spend.

### B2 — Two newly-surfaced REAL gate failures  *(investigate)*
- `aelyris.mcp.server.v1` (upper-compat 5/6 — one gate fails) and
  `native-workspace-agent-identity-boundary` (orchestration-readiness). These
  surfaced once artifacts were refreshed; they are product gates, not staleness.
  Diagnose each (read the gate's assertion + the code path) and fix or document.
  Effort: **unknown until diagnosed — likely small-medium each**.

---

## Workstream C — Fusion Coordinator  *(new feature, AELYRIS_FUSION_COORDINATOR_AUDIT, Codex PASS-conditional)*

A runtime multi-agent/model composition layer (advisor fan-out → judge synthesis
→ gated apply to the Task Graph) as a THIN composition layer over the existing
`LoopPorts`/review/cost/intent/event substrate — NOT a new runtime or chat panel.
Follows the audit's §6 order. **6 hard boundaries (non-negotiable)**: (1) never
bypass merge/approval/reviewer gate; (2) never auto-write ContextStore decisions
(explicit context.set/intent only); (3) advisor fan-out bounded by CostManager
cap; (4) judge/reviewer ≠ advisor/implementer identity; (5) MCP tools go through
the existing `tools_call` governance choke point; (6) reasoning-only advisors use
`outputs=[]` / `symbols=[]` (claim NO file/symbol lanes) and the **headless batch
path** (not PaneFleet — pure-advisory has no declared outputs and would hang).

- **C1** Refresh full gates before starting (per audit §6.1).
- **C2** `orchestrator/fusion.rs` pure core + `FusionPorts` trait + fake-port unit
  tests (FusionRunSpec, FusionMode{Advisory,GatedApply}, advisor/judge specs).
- **C3** Headless advisor adapter over the existing `start_headless` /
  `AgentManager` path (NOT visible PaneFleet; `-p` allowed for headless advisors).
- **C4** Cost reservation / active-agent cap enforcement via `CostManager`.
- **C5** Judge synthesis with self-review / same-identity rejection.
- **C6** MCP tools under `aelyris.fusion.*` (plan/deliberate/status/consensus/
  cancel/apply_as_tasks) — typed, `additionalProperties:false`, through the
  governance choke point; `apply_as_tasks` creates tasks, never merges.
- **C7** Typed event records for the deliberation lifecycle (started/finished/
  failed/candidate/verdict/confidence/dissent/evidence — compact, not raw logs).
- **C8** Cockpit UI READ surface folded into Orchestrator / Fleet HUD / Agent
  Inspector (NOT a new chat surface).
- **C9** `gated_apply`: consensus → `aelyris.task.create` items → normal dispatch/
  review/gate/merge flow.
- **C10** Verification scripts: cost cap, no visible `-p`, no direct merge,
  advisor timeout behavior, restart-safe event history.
- **Effort: very large (multi-session).**

---

## Recommended sequencing + dependency graph

1. **A1 → A3 → A2** (close the 3 symbol conformance gaps — correctness fixes to
   merged code; small/medium; gate-green each; can land on master incrementally).
2. **B2** (diagnose the 2 real gate fails — independent; may be quick wins).
3. **A4 (slice 5 extractors)** — large; unblocks real auto-derived symbols (A1/A2
   confidence policy plugs in here). **B1** (live evidence) can run opportunistically.
4. **A5 (slice 6 UI)** — surfaces the now-populated symbol map.
5. **C (Fusion Coordinator)** — large new feature; depends on a stable, gate-green
   orchestrator/symbol base (its §6.1 says "fix live drift first"). Build per
   C1-C10 with the 6 boundaries, each slice gated + adversarially reviewed.

---

## Codex plan review → revisions (APPLIED, supersede the above where they conflict)

Codex verdict: **revise-then-proceed** (Fusion's 6 boundaries confirmed captured).
Revisions folded in:

- **A1+A2 unify into one confidence/shared-file gating rule** (Codex HIGH: A2
  under-serialized). Symbol-level parallelism on a shared FILE is honored ONLY
  when, on that concrete file, **both sides' symbols are EXACT**, where "exact" =
  Lsp **or** Parser for a NORMAL source file, but **Lsp ONLY** for a shared
  config/schema/types file (Parser does NOT unlock a shared file). Any **DiffHunk
  (inferred) symbol on a file → file-level exclusivity for that file** (an
  inferred range can't prove disjointness). Apply in BOTH the planned gate
  (`tasks_collide`/`intents_block`) AND the live-map dispatch check
  (`SymbolOwnership::intent_blocked`). The RUNTIME claim layer keeps Warn for
  DiffHunk overlaps (§6.2 L469 unchanged) — only the DISPATCH gate serializes.
- **A1 classifier (Codex LOW)**: named globs, NOT blanket `*.json` —
  lockfiles, `package.json`/manifests, `tsconfig*`, `Cargo.toml`/`Cargo.lock`,
  `tauri.conf.json`, `*.schema*`/openapi/graphql/`*.proto`, `*.d.ts`,
  `migrations/**`.
- **A3 (Codex MED)**: release a task's symbol claims on EVERY terminal path —
  `report.merged`, recovered (crash/timeout), `rejected` rework, and Failed task
  ids from `escalations` — in BOTH `run_step` and `run_step_visible`. Tests must
  prove stale claims are freed WITHOUT weakening the pre-merge file-lane guard.
- **NEW A6 — agent-context + shared-brain symbol integration (Codex HIGH, §6.4/§6.6)**:
  new-agent prompts include active symbol claims ("do not edit symbols claimed by
  @x"); `send_steer` avoidance targeting; Planner decomposes WUs by symbol/file
  ownership; bounded typed shared-brain records (active claims + evidence refs,
  not raw logs). Sits between A4 (produces symbols) and A5 (renders them).
- **NEW B3 — release/evidence gate reconciliation (Codex MED)**: A/B/C do NOT
  equal release readiness. Track that `release-quality-score.json` is grade D /
  `releaseCandidateReady=false` and reconcile the live-evidence + the two real
  gate fails (B2) before any "production" claim.
- **Fusion first increment narrowed (Codex)**: C2-C5 + advisory MCP
  `aelyris.fusion.plan/deliberate/status/cancel` + internal judge consensus.
  **Defer `apply_as_tasks` and ALL UI** to a later Fusion increment. A pure C2
  design spike is allowed after A1-A3, but NO Fusion runtime/MCP rollout before
  the symbol extractors (A4) and gate drift are stable.

### Resolved open decisions
(a) A2 → layered; dispatch serializes any same-file pair where DiffHunk is the
symbol proof; runtime claims still warn. (b) A1 globs → the named list above. (c)
Fusion first increment → C2-C5 + advisory MCP + internal judge; defer
apply_as_tasks/UI. (d) Order → A1-A3 → B2 → A4 + A6 → A5 → Fusion.

### Implementation order (final)
**WU1 = A1+A2** (confidence/shared-file gating rule, with Codex's test matrix:
normal-source LSP/Parser co-dispatch, shared-file LSP-only, shared-file Parser
serializes, shared config co-dispatch denied, DiffHunk pair serializes) →
**WU2 = A3** → **WU3 = B2** → **WU4 = A4** → **WU5 = A6** → **WU6 = A5** →
**WU7+ = Fusion C2-C5 + advisory MCP**. Each WU gated + committed; large WUs
(A4, Fusion) adversarially reviewed.

---

## A4 — STATUS 2026-06-23: COMPLETE as non-LSP symbol extraction (branch `feat/symbol-extractors`)

Done: ~~WU1 (A1+A2)~~, ~~WU2 (A3)~~, ~~WU3 (B2)~~ (master `d91f71a`), ~~WU4 (A4)~~ (this branch).

Codex set the A4 scope this session (consult): finish A4 as **non-LSP extraction**. The Rust
LSP client is a frontend-correlated passthrough (request↔response correlation lives in
`src/features/editor/lsp/useLsp.ts`; `didOpen` is editor-driven; `didChange` unwired), so a
BACKEND `documentSymbol` extractor needs new request-correlation plumbing + a headless
`didOpen` — split into its own WU. Built, gated, and **Codex-reviewed per increment**:

- **A4.0** `6632fde` — diff-hunk extractor (`symbol_ownership/extract.rs`:
  `parse_diff_hunks` / `intents_from_diff`, `Confidence::DiffHunk`) + MCP verb
  `aelyris.symbol.claim_from_diff` (records into the live ownership map). Untrusted input clamped.
- **A4.1 + A4.2** `bc5fb13` — tree-sitter parser tier (Rust + TS/TSX, `Confidence::Parser`,
  exact 1-based ranges for fn/method/class/struct/enum/trait/arrow-component; unsupported
  language or an unclean parse → file-level fallback, never a guessed range) +
  `SymbolOwnership::release_for_prefix` (origin-scoped parser reconcile — `parse:`/`dh:`
  reserved id prefixes so source-reconcile keeps diff-hunk + hand-made claims) + MCP verb
  `aelyris.symbol.claim_from_source`. Deps: `tree-sitter` 0.26 / `tree-sitter-rust` 0.24 /
  `tree-sitter-typescript` 0.23 (`cargo audit`: 0 new advisories).
- **A4.3** `4fb34d6` — dispatch-gate matrix fully pinned: Parser disjoint symbols UNLOCK
  same-file co-dispatch on a normal source file; shared-config Parser / DiffHunk / overlapping
  ranges all serialize; empty symbols → file-level exclusivity (§6.2 / §6.5).

**Hard boundaries held** (Codex re-checked each review): no regex labelled `Parser` (real
tree-sitter parse); DiffHunk never unlocks parallelism; **no backend LSP** in A4; **no
git-diff/parse polling** in the autonomy loop (extractors are agent/MCP-driven); scope did
NOT leak into A6 / A5 / Fusion.

### Follow-up WUs (explicitly DEFERRED — not done, named so they aren't silently absorbed)
- **A4-LSP** — backend LSP request↔response correlation (a pending-request map + oneshot
  channels) + a headless `didOpen` / `didChange`, so `textDocument/documentSymbol` can feed
  `Confidence::Lsp` extraction at PLAN time — the only tier that unlocks shared
  config/schema/types files (`is_shared_file` honors LSP-only). This is the heavy piece the
  frontend-correlation finding split out.
- **A4-watch** — file-watcher / tool-event auto-refresh of symbol claims (today agents call the
  MCP verbs; the lease + `refresh`/`release` keep claims live; the `fs:changed` watcher event is
  frontend-facing only).
- **B1 (live)** — exercise the extractor MCP verbs (`claim_from_diff` / `claim_from_source` over
  HTTP with the current `AELYRIS_API_TOKEN`) on the running app. NOTE: `verify-symbol-ownership-live.mjs`
  drives the **Tauri IPC** surface (`symbol_claims`/`symbol_conflicts`/`symbol_release`), not the
  MCP verbs — a live MCP harness + token consent is the operator step.
- **A6 / A5 / Fusion** — unchanged, still sequenced after A4 per the order above.
