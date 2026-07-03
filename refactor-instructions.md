# refactor-instructions.md — Debt Paydown Wave 1 + CX-4 Approval Safety

Generated: 2026-07-02, from the five-track audit of the same date (doc scoring, tech-stack review, debt-map refresh). Evidence anchors below were re-verified against the working tree on 2026-07-02. This file is the complete work order: execute it top to bottom.

---

## 1. Objective

Land two things without changing any other behavior:

1. **CX-4** — close the stale-approval hole in `resolve_interactive_approval` (an operator's Approve/Deny click must never land on a prompt different from the one they saw).
2. **Debt paydown wave 1** — remove two verified-dead Rust modules, extract ~1,900 lines of pure functions out of `src/App.tsx`, produce a read-only IPC wiring ledger, and add a theme single-source consistency test.

The goal is NOT visual cleanliness. Every phase must leave the app behaving identically (except the CX-4 fix, whose behavior change is precisely specified below).

## 2. Project Understanding (read before coding)

- **What this is**: Aelyris — a Windows-first Tauri v2 terminal where AI agents (claude/codex/gemini CLIs) run in real visible PTY panes, coordinated by a Rust runtime (task graph, file/symbol ownership, durable merge intents, MCP control plane with ~55 verbs, SQLite persistence).
- **Read order**: `AGENTS.md` → `docs/requirements.md` → `docs/specs/README.md` → `docs/specs/QUALITY_REMEDIATION_PLAN_2026-07-02.md` (this file implements its Sprint 0 + Sprint 3).
- **Two faces, one capability layer**: Tauri IPC (`src-tauri/src/ipc/*` registered in `lib.rs` `generate_handler`, ~217 commands) for the human cockpit; MCP/HTTP (`src-tauri/src/api/mcp.rs`, `api/mod.rs`) for orchestrator AIs. Domain logic lives under `src-tauri/src/control/`, `agent/`, `task/`, `orchestrator/`, `persistence/`.
- **Frontend**: React 19 + Zustand, no Tailwind. `src/App.tsx` (7,273 lines) is the composition root and the biggest debt. Terminal rendering is a native Rust VT engine (`alacritty_terminal`) diffed over IPC onto Canvas2D.
- **Data flow (approval path, relevant to CX-4)**: PTY bytes → `agent/output_monitor.rs` (ClaudeParser detects a real permission menu, captures `approval_prompt`) → `ipc/interactive_commands.rs` `run_output_monitor` sets it on the session → serialized `InteractiveSessionInfo` → FE `InteractiveSession` → `agentFleet.ts` `interactiveToFleetSession` (`approvalPrompt`) → `decisionInbox.ts` builds a resolvable item (ptyId only when approvalPrompt exists) → `DecisionInboxPanel` Approve/Deny → `App.tsx` `handleDecideDecision` → `invoke("resolve_interactive_approval")` → `src-tauri/src/ipc/send_keys_commands.rs:103` writes Enter (`\r`) or Esc (`\x1b`) through the P0-4 command-risk gate in `GateMode::Atomic` (`:146`) + audit event.
- **Verification stack**: vitest (~1,889 tests), `cargo test --lib` (~1,111), `tsc`, biome, plus 100+ `pnpm verify:*` scripts. CI v1 exists in `.github/workflows/ci.yml` (may not be merged to main yet).

## 3. Behaviors To Preserve (regression = failure)

1. A genuine Claude permission menu still surfaces in the Decision Inbox with the command text visible, and Approve/Deny still resolves it via Enter/Esc.
2. `send_keys` keeps `HoldUntilApproved` gating; `resolve_interactive_approval` keeps `GateMode::Atomic` + its dedicated audit event (`approval_resolved`). Never bypass `gate_ipc_input` / P0-4.
3. Human gates are surfaced, never auto-cleared. `autonomous_flags` (interactive.rs) remains the single source of auto-approve truth.
4. Visible agents run the interactive TUI — never add `-p`/`--print` to a visible pane path.
5. All existing test counts stay green: full `pnpm test`, `cargo test --manifest-path src-tauri/Cargo.toml --lib`, `pnpm exec tsc --noEmit`.
6. `src/__tests__/AppSilentBugs.test.ts` contains source-substring gates that scan `App.tsx` (e.g. asserting `tauriInvoke("resolve_interactive_approval"…` and `onDecide={handleDecideDecision}` wiring). Moving code requires updating these scans IN THE SAME COMMIT — they are the contract, not an obstacle.
7. Right-rail edge score/feedback UI renders and behaves identically after the App.tsx extraction (pure move, zero logic edits).

## 4. Non-Negotiables

- **First action: `git status`.** The working tree may contain uncommitted WU-RT-1 work by another agent. If these files are dirty, DO NOT TOUCH THEM: `src-tauri/src/ipc/interactive_commands.rs`, `src-tauri/src/api/mod.rs`, `src-tauri/src/api/mux.rs`, `src-tauri/src/lib.rs`, `package.json`, `docs/specs/CONTEXT_SESSION_LIFECYCLE_*.md`, `docs/specs/README.md`, `AGENTS.md`, `CLAUDE.md`. Never mix their hunks into your commits; stage your files explicitly (`git add <path>`), never `git add -A`.
- One phase = one commit (conventional commits: `fix:`/`refactor:`/`test:`/`chore:`). Pushing the current feature branch after a phase's gates are green is allowed (CI re-verifies); **never push to `main`, never `--force`, never open/merge a PR** — merges stay with the owner. If push fails (sandbox network), report "push pending" and continue.
- No drive-by reformatting: do not run repo-wide formatters; `cargo fmt` only on files you created/edited (`rustfmt <file>` or scope-check), biome only on touched files.
- On Windows never run `cargo test` and `pnpm test` at the same time (link.exe contention).
- No behavior changes outside the CX-4 spec. No deletions without the evidence procedure in the phase. No API/DB/schema changes at all in this work order.
- If a gate is red BEFORE you start (record in baseline), it is not yours to fix — note it and move on; never "fix" a pre-existing red by weakening the test.

## 5. Stop And Ask Conditions

Stop, write the question into your report, and do not proceed on that item if:

1. Any file listed in the Debt Map has materially changed from the evidence anchors below (line numbers may drift slightly — that's fine; structural change is not).
2. `agent/parser.rs` or `agent/watchdog.rs` turns out to have a non-test consumer your grep finds (Phase 2/3 include the exact re-verification commands — any hit outside the module itself and `mod.rs` = stop).
3. The AppSilentBugs substring gates cannot be satisfied by a pure path update (i.e. the test asserts something that becomes semantically different after the move).
4. CX-4: you find an existing prompt-fingerprint mechanism other than `stableTextKey` in `decisionInbox.ts` that the inbox already uses — reconcile with it rather than inventing a second one; if unclear, ask.
5. Anything requires touching public API surface (MCP verbs), DB schema, auth/token handling, or the P0-4 gate internals.
6. You believe a test is wrong. Do not change tests to pass; report.

## 6. Baseline Commands (Phase 0 — run and record BEFORE any edit)

```
git status --short
git log --oneline -3
pnpm exec tsc --noEmit
pnpm test                                              # record: N passed / files
cargo test --manifest-path src-tauri/Cargo.toml --lib  # record: N passed
```
Record exact pass counts and any pre-existing failures in your report. These are your regression reference. (Known noise: jsdom `getContext not implemented` warnings in TerminalCanvas tests are expected and green.)

## 7. Debt Map (evidence, verified 2026-07-02)

| id | debt | evidence | why it's debt | risk if touched wrong | action |
|---|---|---|---|---|---|
| D1 | Stale-approval write (CX-4) | `src-tauri/src/ipc/send_keys_commands.rs:103-151` `resolve_interactive_approval` writes Enter/Esc with no check that the session is still `waiting_approval` showing the same prompt | Security: operator can approve a prompt they never saw (TOCTOU) | Breaking legit approvals; bypassing gate | **Implement now (Phase 1)** |
| D2 | Dead module `agent/parser.rs` (258 lines) | `grep -rn "agent::parser\|agent/parser" src-tauri/src --include=*.rs` → zero hits outside the file itself; `mod` decl at `src-tauri/src/agent/mod.rs:5` | Unowned code rots and confuses searches | Hidden consumer (re-verify) | **Implement now (Phase 2)** |
| D3 | Dead module `agent/watchdog.rs` (388 lines) + `SessionMonitor` | Never instantiated; live watchdog is `src-tauri/src/watchdog/`; a log-string literal `"aelyris_lib::agent::watchdog"` exists at `ipc/commands.rs:~3398`; `mod` decl at `agent/mod.rs:9`; `watchdog/monitor.rs::SessionMonitor` declared+pub-used only | Two watchdogs = ownership ambiguity (June audit C-17) | The regex constants might be wanted as reference | **Implement now (Phase 3)** with the verification steps |
| D4 | `src/App.tsx` 7,273 lines; ~1,860 of them module-level pure code | Right-rail edge feedback/score universe: fixture builders ~`:937-1250`, persistence helpers `:1775-1872` (`readRightRailEdgeFeedbackHistoryState/Url`), component `RightRailDestinationPromptCard` `:2155`, `deriveRightRailEdgeScore` `:2173-2306`; consumed inside App() at `:4915` and `:5152`. No hook/state coupling in the block | Composition root unnavigable; every feature session grows it (+57% since June) | Substring gates (see Behaviors #6); accidental logic edits during move | **Implement now (Phase 4)** as a pure move |
| D5 | App() body still ~4,900 lines after D4 | Orchestra dispatch wiring ~`:2700-2900`; decision-inbox/workflow wiring ~`:2898-3100`; agent-fleet glue ~`:3007-3400` | Same | Hook extraction changes render/effect ordering if done carelessly | **Implement (Phase 5)** only `useOrchestraDispatch` + `useDecisionInbox`; further slices = proposal |
| D6 | ~77 of 217 registered IPC handlers have no FE `invoke(` caller | `lib.rs` `generate_handler` (~217) vs `grep -rn "invoke(\"" src/` (~141 distinct) | Unclear which are API-face/verifier-driven vs truly dead | Deleting a handler used by MCP/HTTP/verifiers/WU-RT-1 | **Ledger only (Phase 6)** — classification artifact; deletions are proposals |
| D7 | Theme values defined twice | `src/shared/themes/moods/{tokens,surfaces}.ts` AND `src/styles/global.css` `:root[data-mood…]` blocks (sakura overrides ~`:728`; acknowledged comment ~`:182`) | Editing one source silently loses to the other (caused a real bug 2026-06-29) | CSS specificity assumptions | **Implement (Phase 7)**: consistency TEST only — do not unify the sources in this work order |
| D8 | `mcp.rs` 3,502 / `api/mod.rs` 3,055 / `interactive_commands.rs` 2,228 / `queries.rs` 3,221 / `aelyris_native.rs` 8,759 | line counts | God files | api/mod.rs, mux.rs, interactive_commands.rs are DIRTY (WU-RT-1) | **Out of scope** — do not touch |

## 8. Implementation Phases (in order; gates between every phase)

### Phase 0 — Baseline
Run §6, record results. If `git status` shows dirty files beyond the WU-RT-1 list in §4, stop and ask.

### Phase 1 — CX-4: re-verify before approval write (`fix:`)
Files: `src-tauri/src/ipc/send_keys_commands.rs`, `src/App.tsx` (handler only), `src/shared/lib/decisionInbox.ts` (read-only reference for the fingerprint), tests.
1. Write failing Rust tests first: (a) session no longer `waiting_approval` → typed error, nothing written; (b) session waiting but current `approval_prompt` fingerprint ≠ caller's expected fingerprint → typed error `stale_approval`, nothing written; (c) matching case → keystroke flushed exactly as today (Atomic gate + audit event unchanged).
2. Implement in `resolve_interactive_approval`: add parameter `expected_prompt_key: Option<String>`. Before writing: look up the session via the interactive session manager (it is Tauri-managed state; access it the same way `interactive_commands.rs` handlers do — do NOT edit that file); require `run_status == waiting_approval`; compute the fingerprint of the session's current `approval_prompt` with the SAME algorithm the FE uses for inbox item identity (`stableTextKey` in `src/shared/lib/decisionInbox.ts`) — port it to Rust as a small pure function with a cross-language test vector (same input string → same key asserted on both sides), and compare. `None` expected_prompt_key = reject (fail closed) so old callers can't skip the check.
3. FE: `handleDecideDecision` in `App.tsx` passes the item's prompt key; on `stale_approval` error show the existing toast mechanism and refresh rather than write. Update the AppSilentBugs source-scan for the new invoke arg in the same commit.
4. Update the CX-4 row in `docs/specs/CONTEXT_SESSION_LIFECYCLE_IMPLEMENTATION.md` §1 ONLY IF that file is clean in `git status` at the time; otherwise record the needed doc edit in your report instead.
5. **Verifier coverage (audit 2026-07-02 PM found none)**: extend `scripts/verify-runtime-core-preconditions.mjs` with source-scan assertions that (a) `resolve_interactive_approval` references the interactive session manager / `waiting_approval` re-check, (b) an `expected_prompt_key`-style fingerprint parameter exists and `None` fails closed, (c) a `stale_approval` typed error exists. Without this, the fix can silently regress — the current gate name ("preconditions") covers PRE-1/PRE-2 only.
Verification: new tests green; full GATES green; `node scripts/verify-runtime-core-preconditions.mjs` green.

### Phase 2 — Delete `agent/parser.rs` (`refactor:`)
1. Re-verify zero consumers: `grep -rn "agent::parser\|agent/parser\|StreamParser" src-tauri/src --include=*.rs` — hits allowed only inside the file itself and `agent/mod.rs:5`. Any other hit → Stop And Ask.
2. Delete file, remove `pub mod parser;` from `agent/mod.rs`.
Verification: `cargo test --lib` green, `cargo build` green.

### Phase 3 — Retire `agent/watchdog.rs` + `SessionMonitor` (`refactor:`)
1. Re-verify: `grep -rn "agent::watchdog\|WatchdogManager\|PERMISSION_PATTERNS" src-tauri/src --include=*.rs`. Expected: the module itself, `agent/mod.rs:9`, and a log-string literal in `ipc/commands.rs` (~:3398). If `PERMISSION_PATTERNS` (or anything else) is referenced from live code (e.g. `agent/output_monitor.rs`) → Stop And Ask.
2. Fix the `commands.rs` literal: it is a log/tracing target string — change it to the module that actually owns that code path (inspect the surrounding function; likely `aelyris_lib::ipc::commands`), do not silently delete the log line.
3. Delete `agent/watchdog.rs`, remove the mod decl. For `SessionMonitor` (`src-tauri/src/watchdog/monitor.rs`): if the struct is declared and re-exported but never constructed (`grep -rn "SessionMonitor::new\|SessionMonitor {"`), delete it and its re-export; if constructed anywhere, leave it and note.
Verification: cargo green; `git grep -n "agent::watchdog"` returns nothing.

### Phase 4 — Extract App.tsx pure-function block (`refactor:`, the big one)
1. Create `src/features/right-rail/` modules (suggested: `edgeScore.ts` for derivations incl. `deriveRightRailEdgeScore` + types, `edgeFeedbackStorage.ts` for the persistence readers, `fixtures.ts` for the QA fixture builders, `RightRailDestinationPromptCard.tsx` for the component). **Pure move**: cut from `App.tsx`, paste, add explicit exports/imports. Zero logic edits, zero renames, keep comments.
2. Move ONLY module-level declarations (functions/consts/types/component defined outside App()). Anything referencing App()'s state/hooks stays.
3. Update `src/__tests__/AppSilentBugs.test.ts` scans in the SAME commit: any assertion that greps App.tsx for moved code must now read the new module file(s). Do not weaken assertions — repoint them.
4. Sanity target: App.tsx drops to roughly ≤5,400 lines (don't force a number by moving coupled code; the number is a smell check, not a goal).
Verification: full GATES green; `pnpm build` green (catches broken imports vitest can miss); zero behavioral diff expected — if any snapshot/test changes content (not path), stop and ask.

### Phase 5 — Extract two hooks from App() (`refactor:`)
1. `useOrchestraDispatch` (orchestra role-pane state + launch/route glue, ~`:2700-2900`) and `useDecisionInbox` (workflow statuses + buildDecisionInbox + handleDecideDecision wiring, ~`:2898-3100`) into `src/features/orchestrator/` and `src/features/decision-inbox/` respectively.
2. Rules: preserve hook call order (extract contiguous blocks into one hook each; the hook is called at the same position in App()); pass dependencies explicitly as arguments; no `useEffect` merging/splitting; same deps arrays.
3. AppSilentBugs scans updated same commit.
Verification: full GATES + `pnpm build`. If any effect-ordering test or runtime warning appears, revert the phase (keep Phase 4) and downgrade Phase 5 to a proposal in your report.

### Phase 6 — IPC wiring ledger (`chore:`, read-only artifact)
1. New script `scripts/generate-ipc-ledger.mjs`: parse `src-tauri/src/lib.rs` `generate_handler![...]` names; grep FE `src/` for `invoke("name"`; grep `src-tauri/src/api/` for the name (MCP/HTTP face); grep `scripts/` (verifier-driven); classify each handler: `fe-wired` / `api-face` / `verifier` / `wu-rt-1-pending` (names matching `session_checkpoint|session_resume|session_handoff|reset_context|session_summarize`) / `unreferenced`.
2. Emit `.codex-auto/quality/ipc-ledger.json` + a markdown summary table to stdout. **Do not delete any handler.** List `unreferenced` ones as proposals in your report.
Verification: script runs green; counts in report.

### Phase 7 — Theme single-source consistency test (`test:`)
1. New vitest that imports the mood definitions from `src/shared/themes/moods/` and parses `src/styles/global.css` `[data-mood="…"]` blocks, asserting that for every CSS var defined in BOTH places the values agree (or that the CSS-side override list is explicitly enumerated in the test as the known-intentional set, e.g. the sakura block). The test's job: any FUTURE divergence fails loudly.
2. If current sources genuinely disagree beyond the known sakura overrides, do not "fix" the values — enumerate them in the known-set with a `// TODO(unify)` and report.
Verification: full GATES.

## 9. Verification Requirements

- After every phase: `pnpm exec tsc --noEmit` && `pnpm test` && `cargo test --manifest-path src-tauri/Cargo.toml --lib` (serial, never parallel) && `pnpm exec biome lint <touched files>`. Phases 4/5 additionally `pnpm build`.
- Compare pass counts against the Phase 0 baseline: new failures = your regression; pre-existing reds are recorded, not fixed.
- UI-touching phases (4/5): note in the report that live visual verification (`pnpm tauri:dev`, right-rail renders, inbox Approve works) is required by the operator before merge — you cannot claim it.

## 10. Reporting Format

Per phase, in the final report:
```
### Phase N — <name>
- Status: completed | stopped (question) | skipped (reason)
- Commit: <sha> <message>
- Diffstat: N files, +A/-B
- Commands run + results: tsc OK | vitest N passed (baseline N) | cargo N passed (baseline N) | build OK
- Notes / follow-ups / proposals:
```
End with: (a) all Stop-And-Ask questions raised, (b) proposals NOT implemented (D5 further slices, D6 deletion candidates, D8), (c) exact final `git log --oneline` of your commits.

## 11. Out-of-scope (do not touch, even if tempting)

- `src-tauri/src/api/mod.rs`, `api/mux.rs`, `ipc/interactive_commands.rs`, `lib.rs` (except nothing — you don't need lib.rs; handler list is unchanged by these phases… note: Phase 2/3 remove no registered handlers, only unregistered modules), `package.json`, `AGENTS.md`, `CLAUDE.md`, `docs/specs/CONTEXT_SESSION_LIFECYCLE_*` (unless clean, Phase 1 step 4), `docs/specs/README.md` — WU-RT-1 territory.
- `src-tauri/src/bin/aelyris_native.rs` (unshipped spike, promote/retire is a product decision).
- Splitting `mcp.rs`/`api/mod.rs`/`queries.rs`; DB schema/migrations; MCP schema enforcement; invoke<T> validation framework; wgpu renderer — all later sprints (see `docs/specs/QUALITY_REMEDIATION_PLAN_2026-07-02.md` S4/S5).
- Any doc rewrites beyond the single CX-4 row (Sprint 1 is a separate work order).
- Formatting sweeps, dependency bumps, renames-for-taste.
