# hardening-instructions.md — Verifier Integrity + Lifecycle API Face + Shared-Brain Hardening

Generated: 2026-07-02 (PM), from the post-WU-RT-1 delta audit (4-track: Rust implementation review, shared-brain wiring map, world-class-bar re-verification, remediation-plan reconciliation). Execute AFTER `refactor-instructions.md` (that work order owns CX-4 + debt wave 1; this one owns everything else from the same audit).

This file is a forward-looking work order. It contains no completion claims; completion is proven by the named gates (`docs/requirements.md` claim policy).

---

## 1. Objective

Land five hardening work units and two design-first work units, without changing any unrelated behavior:

1. **H1** — restore verifier integrity (two discovered gate weakenings + one stale doc row + stack-risk wiring).
2. **H2** — wire the `session_*` lifecycle verbs onto the MCP face (spec conformance: CONTEXT_SESSION_LIFECYCLE_SPEC promises IPC **and** MCP; only IPC exists).
3. **H3** — persist the intent bus (deliberations currently vanish on restart while tasks/ownership/merge survive).
4. **H4** — inject repo guidelines (`AGENTS.md`) into dispatched agent prompts (shared-brain gap: agents currently receive only ADR + ownership headers).
5. **H5** — split the session-lifecycle IPC out of `interactive_commands.rs` (pure move; the file is 2,228 lines and ~65% lifecycle code).
6. **H6 (design-first)** — live cost/token telemetry via grid snapshot + BR7 cap binding for visible agents.
7. **H7 (design-first)** — agent-signaled done-marker completion detection (replace first-file-exists kills).
8. **H8** — enforce MCP inputSchema at dispatch + bound the `mcp_pending` queue (agents currently get no machine feedback on malformed args; the pending queue is unbounded RAM).

## 2. Preconditions and execution order

- **P0 (OWNER gate):** the WU-RT-1 working tree must be committed first. As of 2026-07-02 15:19 this HAS happened (commits `d5010e8`, `31fb14c`, `1d6c3e6`). **First action: `git status --short`** — if the tree is dirty on any of `src-tauri/src/ipc/interactive_commands.rs`, `src-tauri/src/api/mod.rs`, `src-tauri/src/api/mux.rs`, `src-tauri/src/lib.rs`, `package.json`, `scripts/score-release-quality.mjs`, `scripts/verify-final-goal-safe.mjs`, `scripts/verify-stack-risk.mjs`, `docs/specs/CONTEXT_SESSION_LIFECYCLE_*.md`, **stop and report**; another session may be mid-work.
- **H0 baseline:** run and record `pnpm exec tsc --noEmit`, `pnpm test`, `cargo test --manifest-path src-tauri/Cargo.toml --lib` (serial, never parallel with pnpm test), `git log --oneline -3`. Pre-existing reds are recorded, never "fixed" by weakening a test.
- `refactor-instructions.md` must be complete (or its report filed) before H1. Its CX-4 fix is a dependency of nothing here, but the two work orders share reporting conventions and must not interleave commits.
- One phase = one commit (`fix:` / `feat:` / `refactor:` / `test:`), stage files explicitly (`git add <path>`), never `git add -A`.
- **Git policy**: the current `AGENTS.md` standing authorization covers focused
  local phase commits only. Historical feature-branch push permission is
  superseded; push, PR, merge, rebase, reset, amend, force push, and history
  rewrite require fresh explicit authorization.
- Read order if cold-starting: `AGENTS.md` → `docs/requirements.md` → `docs/specs/README.md` → `docs/specs/CONTEXT_SESSION_LIFECYCLE_SPEC.md` → `docs/specs/QUALITY_REMEDIATION_PLAN_2026-07-02.md` → this file.

## 3. Non-negotiables

- Never weaken a verifier to make it pass. H1 exists because two verifiers were weakened; do not add a third.
- Visible agents stay on interactive TUI paths — never add `-p`/`--print` to a visible pane path.
- Never bypass `gate_ipc_input` / P0-4; human gates are surfaced, never auto-cleared.
- No DB schema edits outside H3's single new table. No dependency bumps. No formatting sweeps.
- Windows: never run `cargo test` and `pnpm test` in parallel (link.exe contention).
- Token-spending AI CLI probes are consented for this repo (see `AGENTS.md` / `docs/specs/README.md`): record provider/model/command/artifact, never persist secrets.
- **Four-layer sync rule** (`docs/requirements.md` Documentation Maintenance Rule): every phase that changes behavior updates the OWNING spec section and its gate row in the SAME commit. Owning specs: H2 → `CONTEXT_SESSION_LIFECYCLE_SPEC.md` (public-API table) + `MCP_TOOL_SURFACE_SPEC.md` (catalog); H3 → `MCP_TOOL_SURFACE_SPEC.md` (intent verbs gain durability note); H4 → `VISIBLE_AGENT_PANE_RUNTIME_SPEC.md` (dispatch prompt contract); H6 → `CONTEXT_SESSION_LIFECYCLE_SPEC.md` (telemetry section); H7 → `VISIBLE_AGENT_PANE_RUNTIME_SPEC.md` (completion contract); H8 → `MCP_TOOL_SURFACE_SPEC.md` (schema-enforcement + queue-bound sections). A phase whose spec edit is missing is incomplete even if its code gates are green.

## 4. Phases

### H1 — Verifier integrity restoration (`fix:`)

Evidence (verified 2026-07-02 PM; line numbers may drift slightly — some of these files were committed at 15:19, re-verify anchors first):

| id | weakening | evidence |
|---|---|---|
| H1a | `commandProofEnvironmentBlockedFresh` in `scripts/score-release-quality.mjs` (~:2088) was broadened from `PowerShell failed \(null\)` to `PowerShell failed \((?:null|\d+)\)` — a real PowerShell failure with any numeric exit code now passes as "environment blocked" | diff vs main |
| H1b | `scripts/verify-native-hwnd-paste-live.mjs` requires WebView2 CDP (header, ~:3) but at ~:547 accepts a substitute no-CDP Rust-binary proof (`source: "aelyris-native-paste-guard-proof"`, ~:136; `noCdp` flag ~:153) and reports a plain pass — the production WebView2 path is never exercised yet the gate is green | file read |
| H1c | `docs/specs/CONTEXT_SESSION_LIFECYCLE_IMPLEMENTATION.md` §1 still lists SEC-1 as a pending pre-commit fix; it is implemented with regression tests (`src-tauri/src/agent/session_lifecycle.rs:210-238` sanitize/canonicalize/containment; tests ~:827-854) | code + doc read |
| H1d | `scripts/verify-stack-risk.mjs` runs only in CI (`.github/workflows/ci.yml` release-hardening job, `--allow-upstream-bound`); it has no `package.json` script and is not a `verify:goal:safe` step — local runs and the safe gate can silently skip supply-chain classification | grep package.json + verify-final-goal-safe.mjs |

Tasks:
1. **H1a**: revert the regex to `PowerShell failed \(null\)`. If a legitimate numeric-exit case motivated the broadening, do NOT re-broaden — enumerate that exact case as its own named, commented condition and report it.
2. **H1b**: keep the fallback (it has real value) but make it honest: the emitted artifact gains `"degraded": true` and a distinct status (e.g. `pass-degraded-no-cdp`); every consumer that string-matches the old status (grep `scripts/` and `score-release-quality.mjs` for the artifact filename and status strings) must treat degraded as "pass with surfaced warning", printing one line naming the unexercised path (WebView2/CDP WM_PASTE). If any consumer requires the full status to score a point, it must NOT award full credit for the degraded form — split the credit or add a partial classification. Do not flip the gate to fail.
3. **H1c**: update the SEC-1 row to "fixed with regression tests" + the evidence pointers above. Leave CX-4's row pending unless `refactor-instructions.md` Phase 1 has landed (then update it with its commit/test evidence).
4. **H1d**: add `"verify:stack-risk": "node scripts/verify-stack-risk.mjs --allow-upstream-bound"` to `package.json` and add it as a step in `scripts/verify-final-goal-safe.mjs` (same flag, blocking, mirroring CI so local truth == CI truth).

Verification: full GATES green; `pnpm verify:stack-risk` green; `pnpm verify:quality-score` still runs green end-to-end; report any score delta caused by H1a/H1b honestly — a score DROP here is expected and correct if degraded evidence was previously over-credited.

### H2 — `session_*` verbs on the MCP face (`feat:`)

The spec's public-API table (docs/specs/CONTEXT_SESSION_LIFECYCLE_SPEC.md) promises the lifecycle verbs on both faces. IPC exists (`lib.rs` ~:1180-1184 registers `session_summarize`/`session_checkpoint`/`session_handoff`/`session_resume`/`session_reset_context`); MCP/HTTP has zero (`grep -n "session_handoff\|session_resume\|reset_context" src-tauri/src/api/` = 0).

1. Add MCP verbs `aelyris.session.summarize / checkpoint / handoff / resume / reset_context` in `src-tauri/src/api/mcp.rs`, delegating to the SAME runtime functions the IPC commands call (extract shared free functions if the IPC handlers currently inline logic — move logic, do not duplicate it; the pure business logic already lives in `agent/session_lifecycle.rs`, keep it there).

   **Verb contract (mirror the existing IPC signatures EXACTLY — do not invent params; verified against `ipc/interactive_commands.rs` 2026-07-02):**

   | verb | params (inputSchema) | delegates to | returns (serialize the existing result struct) | key typed failures |
   |---|---|---|---|---|
   | `aelyris.session.summarize` | `session_id` (string, required), `reason` (string, opt), `timeout_ms` (int, opt) | `session_summarize` (~:430) | `SessionSummarizeResult` (~:418: logical_session_id, handoff_seq, summary_path, redaction_count, validation report, summary doc) | unknown session; summary validation failure |
   | `aelyris.session.checkpoint` | `session_id` (req), `summary_json` (object, opt), `summary_seq` (int, opt), `inflight_ref` (string, opt), `predecessor_session_id` (string, opt) | `session_checkpoint` (~:524) | `SessionCheckpointResult` (~:512) | unknown session; SEC-1 path containment rejection |
   | `aelyris.session.handoff` | `session_id` (req), `reason` (opt), `timeout_ms` (opt), `cols`/`rows` (int, opt) | `session_handoff` (~:623) | `SessionHandoffResult` (~:581: predecessor/successor ids, handoff_seq, correlation_id, checkpoint seqs) | non-PendingSummary state; successor mismatch (idempotency reject) |
   | `aelyris.session.resume` | `logical_session_id` (string, opt), `timeout_ms` (opt) | `session_resume` (~:973) | `SessionResumeResult` (~:600: reconciled/unresolved counts, adopted id, ack_reconfirmed) | identity mismatch (fail-closed); requires DB state |
   | `aelyris.session.reset_context` | `session_id` (req), `timeout_ms` (opt), `cols`/`rows` (opt) | `session_reset_context` (~:1092) | `SessionResetContextResult` (~:612: reset_context, lineage ids, worktree_deleted=false, nested handoff) | session not live (`done`/`error` rejected) |

   Error mapping: the IPC layer returns `Result<_, String>`; on the MCP face wrap the message intact in the standard MCP tool error — do not re-classify or swallow. The result structs already derive Serialize; return them as the tool-result JSON unchanged so the two faces stay contract-identical.
2. Authority classification: all five **GATED** (they inject prompts into live agent PTYs / retire sessions). Follow the existing GATED-verb pattern in `mcp.rs` (intent/approval routing), do not invent a new gate path.
3. Catalog + inputSchema entries for all five; the drift test `catalog_and_schemas_list_exactly_the_same_verbs` must stay green. Regenerate the verb table in `docs/specs/MCP_TOOL_SURFACE_SPEC.md` the same way S1-1 did (from the catalog, not by hand-typing).
4. Rust tests: verb dispatch reaches the same code path as IPC (e.g. resume identity-mismatch fail-closed returns a typed MCP error), GATED enforcement test.

Stop-and-ask: if the MCP layer cannot reach `InteractiveSessionManager`/native registry state without a new global — report the seam instead of hacking one in.

Verification: full GATES; drift test green; `pnpm verify:runtime-core:session-handoff` and `verify:runtime-core:session-resume` still green.

### H3 — Intent bus persistence (`feat:`)

`src-tauri/src/intent/manager.rs` is `Mutex<Vec<Intent>>` — no table, no hydrate. Tasks/ownership/merge intents are durable; deliberations are not (asymmetry, audit finding).

1. New table `intents` in `src-tauri/src/db/migrations.rs` following the existing `CREATE TABLE IF NOT EXISTS` pattern (no user_version framework yet — that is S4-1, out of scope here). Columns mirror the `Intent` struct + `updated_at`.
2. New `src-tauri/src/persistence/intent_repo.rs` modeled on the context_store `DecisionRepo` write-through pattern: manager is the single choke point, writes through under the manager lock on real change, best-effort (DB error logs, never fails the in-memory op).
3. Hydrate on boot in `lib.rs` setup in the same position/order as context_store `attach_db` (restore completes before the MCP HTTP server binds — preserve that ordering guarantee).
4. Round-trip test: propose/resolve → fresh manager hydrate → identical list (mirror `context_store/manager.rs` restart test ~:125-155).

Verification: full GATES; existing intent IPC/MCP tests green (`aelyris.intent.propose/list/all/resolve`, `mcp.rs` ~:68-71).

### H4 — Repo-guideline injection into dispatched agents (`feat:`, small)

`control/loop_ports.rs` injects an ADR header (`build_adr_header`, ~:614-625) and live ownership claims (~:631-639) into every dispatched agent spec (`run_step` ~:679, `run_step_visible` ~:752). It never injects `AGENTS.md`/`CLAUDE.md` (grep = 0) — spawned agents don't know the repo's rules.

1. Add `build_guidelines_header(project_root)`: read `AGENTS.md` from the project root; if present, truncate to a hard cap (suggest 4,000 chars, constant with a comment) and wrap as `[Repo guidelines — follow these]`. Missing file = empty header, no error.
2. Inject in BOTH `run_step` and `run_step_visible`, after the ADR header. Redact nothing (AGENTS.md is repo-public), but apply the cap strictly.
3. Tests: present→injected+capped, absent→empty, injection order stable.

Verification: full GATES; no verifier that asserts exact dispatch-prompt text breaks (if one does, update its expectation in the same commit — that is a contract update, not a weakening; name it in the report).

### H5 — Split lifecycle IPC out of `interactive_commands.rs` (`refactor:`, pure move)

`ipc/interactive_commands.rs` (2,228 lines) hosts the lifecycle command wrappers (~lines 416-1881: summarize/checkpoint/handoff/resume/reset_context/boot-reconcile + helpers) interleaved with spawn/stop code. The extraction pattern precedent is `ipc/send_keys_commands.rs`.

1. Create `src-tauri/src/ipc/session_lifecycle_commands.rs`; pure-move the lifecycle commands, their helpers, and their `#[cfg(test)]` mods. Zero logic edits, zero renames.
2. Update `ipc/mod.rs` + the `generate_handler![...]` list in `lib.rs` (paths only — the handler set is unchanged).
3. Business logic stays in `agent/session_lifecycle.rs` — this phase moves only the IPC wrapper layer.

Verification: full GATES; `pnpm verify:runtime-core:session-handoff`, `verify:runtime-core:session-resume`, `verify:runtime-core:session-checkpoint` green; `interactive_commands.rs` shrinks by roughly 1,300-1,500 lines (smell check, not a target to force).

### H6 — Live cost/token via grid + BR7 bind (design-first, then `feat:`)

Context: context% is now measured from the real grid for Claude (`agent/context_lifecycle.rs:127` + `ipc/interactive_commands.rs` ~:2115-2131). Cost/token still ride the dead chunk-regex path (`agent/output_monitor.rs` ~:250-252 — patterns live TUIs never emit), so BR7 token/cost caps (`cost/manager.rs`) never bind for visible agents. This is the top item of the 2026-07-01 backend audit.

1. **Design deliverable first** (commit as `docs:` or in your report): analyze `src-tauri/src/agent/__fixtures__/rt1a0-provider-matrix.json` (+ rerun `pnpm capture:runtime-core:rt1a0-live` if consent env is set) for stable cost/token surfaces per provider — e.g. Claude statusline/`/cost` output regions in the grid. If the fixtures contain no cost/token lines, STOP after the design doc and propose the exact capture plan (which provider, which command, which grid region) instead of guessing regexes.
2. Implement `parse_claude_cost_tokens_from_grid` next to the context parser (same module, same confidence enum — `Parsed`/`Estimated`/`Unknown`), wire it in the same monitor loop, feed the session's cost/token fields, and make `cost/manager.rs` cap evaluation consume the parsed values for visible sessions. Non-Claude providers stay `Unknown` (do not fake).
3. Leave the old regex path intact for headless output. Extend the runtime-core verifier with fixture-backed assertions.

Verification: full GATES; extended verifier green; a fixture-driven test proving a cap trip on synthetic grid values.

### H7 — Done-marker completion detection (design-first, then `feat:`)

Context: `control/pane_fleet.rs` `outputs_present` (~:67-75) declares an agent done the moment all declared output files exist — an agent mid-refactor gets killed after the first save. Backend audit item #2.

1. **Design deliverable first**: propose the marker contract — dispatch prompt instructs the agent to write `.aelyris/done/<sanitized-task-id>.done` as its LAST action (reuse the sanitize/containment helpers from `agent/session_lifecycle.rs`; never trust the path). Completion = marker present; fallback = outputs present AND pane idle for a configurable grace window (backward compatible for agents that don't know the contract). Get the prompt wording into the design note.
2. Implement behind the existing completion path in `pane_fleet.rs` with tests: marker → done; outputs-only → done only after grace; neither → running.

Stop-and-ask: if the dispatch prompt template lives in more than one place (grep for the outputs instruction text) — reconcile with the single owner, don't fork the wording.

Verification: full GATES; new pane_fleet tests; no change to the no-orphan/Job-Object kill safety paths.

### H8 — MCP inputSchema enforcement + `mcp_pending` bound (`feat:`; run AFTER H2 — both touch `mcp.rs`, keep commits separate)

Context (audit 2026-07-02): `api/mcp.rs` `tools_call` (~:1000) reads `body.arguments` as a raw map; each verb hand-pulls args via `arg_string`/`arg_usize`/`arg_bool` with ad-hoc clamps (e.g. ~:1029, comment ~:1657 "Clamp server-side, independent of inputSchema validation"). The declared `inputSchema` blobs (~:231+) are advertisement only — an orchestrator AI that sends a wrong type/missing field gets an opaque per-verb error or a silent default, not a schema violation it can machine-correct. Separately, `api/mod.rs:200` `mcp_pending: Arc<Mutex<Vec<McpPendingDecision>>>` grows without bound (contrast: the rate-limit map IS bounded via `MAX_RATE_LIMIT_IPS`, ~:664-677).

1. **Schema validation at dispatch, no new crate** (do NOT add a jsonschema dependency): implement a small validator for the schema subset the catalog actually uses — `type: object`, `properties`, `required`, primitive `type`s (string/integer/number/boolean/object/array), and `enum` if present. Validate `body.arguments` against the verb's declared schema BEFORE verb dispatch in `tools_call`.
2. **Error contract**: on violation return the standard MCP tool error with a machine-usable payload: `{"schema_violation": {"verb": ..., "missing": [...], "wrong_type": [{"field": ..., "expected": ..., "got": ...}]}}` — the point is that an AI caller can self-correct in one retry without a human reading logs.
3. **Subset drift test**: a Rust test iterating every catalog schema asserting it is fully expressible in the supported subset — so a future verb author cannot silently add schema features the validator ignores (that would be advertisement-without-enforcement again). Keep the existing hand clamps as defense in depth; do not remove them.
4. **Bound `mcp_pending`**: cap the queue (suggest a `MAX_MCP_PENDING` constant, ~500, same style as `MAX_RATE_LIMIT_IPS`). On overflow, drop the OLDEST entry and emit a `tracing::warn!` + an EventBus system event so the loss is observable, not silent. Test: push past the cap → length == cap, oldest gone, warning path exercised.

Stop-and-ask: if any existing catalog schema is NOT expressible in the subset (step 3 fails on current code), list the offending verbs and ask whether to extend the validator or simplify the schema — do not skip validation for those verbs silently.

Verification: full GATES; drift test green; `catalog_and_schemas_list_exactly_the_same_verbs` still green; a test proving a malformed `tools_call` gets the structured `schema_violation` error and a well-formed one is unaffected.

## 5. Out of scope (owner-scheduled, do not touch)

wgpu renderer productization; RBAC E2; `PRAGMA user_version` migration framework (S4-1); AMB message bus build-out (`AELYRIS_AGENT_MESSAGE_BUS_SUPERSET_SPEC` — needs its own work order); KG→planner gating; semantic recall / organizational memory layer; App.tsx slices beyond `refactor-instructions.md`; `aelyris_native.rs`; roadmap generated view (S1-6); TERMINAL_CORE_DESIGN.md (S1-7); deleting `docs/specs/WU_RT_1_CONTINUATION.md` (S1-5, owner does it when the branch lands).

## 6. Reporting format

Per phase:
```
### HN — <name>
- Status: completed | stopped (question) | skipped (reason)
- Commit: <sha> <message>
- Diffstat: N files, +A/-B
- Gates: tsc OK | vitest N passed (baseline N) | cargo N passed (baseline N) | phase verifiers listed with results
- Notes / follow-ups / proposals:
```
End with: all Stop-And-Ask questions, proposals not implemented, and the final `git log --oneline` of your commits.
