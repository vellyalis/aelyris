# P0-3 — Durable merge queue & immutable merge intent (locked goal)

Security-first WU from `AETHER_WORLD_RELEASE_HARDENING_AUDIT_2026-06-23.md` §P0-3.
Goal locked with Codex (independent reviewer, different model) on 2026-06-24 — see
`codex-guided-implementation` skill. This file is the drift fence for every increment.

## Scope ruling (Codex A)
- IN: the **operator/MCP-facing** merge intent — `aether.request_merge` → `aether.review.approve` / `aether.review.reject`. This is where the caller-altered-params vulnerability lives.
- OUT (→ P0-1 durable orchestration follow-up): the autonomy-loop self-merge path (`control::loop_ports::merge` + its per-step in-memory `MergeQueue`). We must NOT claim global "durable merge queue" closure, and MUST NOT build the new store in a shape the loop cannot later reuse.

## The vulnerability being closed
`aether.review.approve` (mcp.rs) currently takes caller-supplied `repoPath`/`sourceBranch`/`targetBranch` and passes them straight to `perform_merge` — the intent id is a mere token. A local MCP caller can approve an existing intent id while merging a DIFFERENT source→target in a DIFFERENT repo.

## Design (Codex B/C + robustness)
- Dedicated SSOT: `persistence/merge_repo.rs` (`merge_intents` table) + a thin `MergeIntentStore` wrapping `Arc<ManagedDb>`. The **SQLite row is the arbiter**; any in-memory cache is for reads only. `mcp_pending` is NOT the SoT for merge state (permission approvals stay there).
- Immutable request-time fields: `intent_id, repo_path (canonicalized), source_branch, target_branch, source_oid, target_oid, merge_base_oid?, task_id, session_id (author/legacy), reviewer_id?, author_id?, gates_digest?, created_at`. Mutable: `state, updated_at`. A SQLite trigger blocks UPDATE of immutable columns.
- 9 states: `queued, reviewing, ready_to_merge, merging, merged, conflict, rejected, cleanup_failed, needs_reconcile`.
- Idempotency: UNIQUE `(task_id, source_oid, target_oid)`; duplicate `request_merge` returns the existing intent.
- Claim = DB compare-and-swap: `UPDATE … SET state='merging' WHERE intent_id=? AND state IN ('queued','ready_to_merge')` and assert exactly 1 row. Then release all locks, re-resolve OIDs, run `perform_merge`, persist terminal state. Never hold a store/DB lock across the git merge.
- Approve contract: operator-authority — the verb IS the verdict. Accept `intentId` + approval evidence (`gatesDigest`, or a server digest of `gates`) only. A `verdict` field, if present, is constrained to exactly `"approve"` and ignored for state choice.
- OID reconciliation: at approve, re-resolve current branch tips. If they still match stored OIDs → proceed. If target already contains stored source OID → idempotent `merged`. Otherwise (branch moved) → `needs_reconcile`, refuse. On restart, reconcile dangling `merging` the same way.

## HARD BOUNDARIES (verbatim — non-negotiable, mechanically checkable)
1. `aether.review.approve` MUST NOT accept, parse, read, or forward `repoPath`, `sourceBranch`, or `targetBranch` from caller arguments.
2. Any `aether.review.approve` call containing unknown fields, including `repoPath`, `sourceBranch`, or `targetBranch`, MUST fail server-side before merge execution.
3. MCP merge state MUST be persisted in `merge_intents`; `mcp_pending` MUST NOT be the source of truth for merge intents.
4. `perform_merge` MUST use only the repo/branches loaded from the stored immutable intent, after current OIDs are reconciled against stored OIDs.
5. No mutex or DB lock protecting merge-intent state may be held while git merge execution runs.

## Ordered increments (each gates green + Codex-reviewed before commit)
1. Durable schema/domain — `MergeIntent`, 9-state enum, `merge_repo.rs`, migration + immutable-column trigger + unique idempotency index, repo unit tests.
2. Store wiring — `MergeIntentStore`, attach/hydrate + boot reconcile in `lib.rs`, fail-closed if no store for MCP merge verbs.
3. Request binding — `request_merge` requires canonical `repoPath` + `taskId`, resolves/stores OIDs, returns existing intent on duplicate key.
4. Approval shape — schema + handler to `intentId` + approval evidence only; explicit server-side rejection of `repoPath`/`sourceBranch`/`targetBranch` + all unknown fields (NOT relying on `additionalProperties`).
5. Merge execution — approve loads stored intent, revalidates OIDs, CAS-claims `merging`, runs `perform_merge` outside locks, maps `AlreadyMerged`→`merged`, handles `conflict`/`needs_reconcile`.
6. Pending view + reject — `list_pending_approvals` synthesizes a thin merge view from the store; `review.reject` moves to the store.
7. Verifiers — `scripts/verify-security-mcp-merge-intent-binding.mjs` (static/live binding) + `scripts/verify-merge-idempotency.mjs` (live), using the existing `QUORUM_API_URL`/`QUORUM_API_TOKEN` `/mcp/tools/call` harness.
8. Regression — focused cargo tests + new verifiers + existing `pnpm verify:mcp-orchestrator`; whole-WU Codex review; merge `--no-ff`.

## Follow-ups (explicitly deferred, NOT silently absorbed)
- P0-1: route the autonomy-loop self-merge through this durable store inside a transaction/outbox.
- Live merge verifiers require a temp git repo + running dev server (operator-run, not headless gate).

## Status — LANDED (2026-06-24)

All 8 increments complete; each gated green and Codex-reviewed before commit (the
codex-guided-implementation flow). Branch `feat/p0-3-durable-merge-intent`:

| Inc | Commit | What | Codex |
|-----|--------|------|-------|
| 1 | `78b6734` | durable `MergeIntent`/9-state + `merge_repo` + migration (immutable trigger) | FIX-FIRST → fixed REPLACE/NULL-id/merge_base trigger holes |
| 2 | `d29ca63` | `MergeIntentStore` + boot reconcile + wiring | APPROVE |
| 3 | `e74b12c` | `request_merge` binds repo/taskId/OIDs, idempotent | FIX-FIRST → overclaim + test kind |
| 4+5 | `df4f0cf` | **approve = stored intent only** (OID-bound CAS merge) | FIX-FIRST ×2 → fixed CRITICAL TOCTOU (`reference_matching` CAS) + HIGH type-confusion + LOW dangling state → APPROVE |
| 6 | `304c4f5` | reject + pending-view to the store (boundary #3 closed) | APPROVE |
| 7 | `362192c` | binding (static) + idempotency (live) verifiers | FIX-FIRST → verifier envelope + tightened checks → APPROVE |
| 8 | (this) | regression + whole-WU review + merge | whole-WU: **MERGE-OK**, zero findings |

Final gates: `cargo test` 1026 lib + integration, `cargo clippy --all-targets -D`,
`cargo fmt --check`, `tsc --noEmit` (FE untouched), `verify-security-mcp-merge-intent-binding`
10/10, `verify-mcp-orchestrator-surface`. The 5 hard boundaries hold across the whole
feature (Codex whole-WU verified). Deferred items above remain the honest remainder.
