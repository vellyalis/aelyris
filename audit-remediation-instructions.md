# Comprehensive Audit Remediation Work Order

STATUS: ACTIVE  
PROGRAM: `audit-remediation`  
CURRENT PHASE: `A6` (`R0-A5 repo-owned work complete`; A2 signed lifecycle and A4
real-host sleep/power-loss proof remain explicit A9 operator gates).
ACTIVE SLICE: `A6.2 review correction`.
NEXT PHASE: `A7` after A6 modularity ratchet acceptance is complete.
NEXT IMPLEMENTATION SLICE: `A6.2e0 exact continuation and worklog contract hardening`.
A6.2c-A6.2d moved right-rail, pane, evidence, and project/tab responsibilities to
dedicated owners and lowered the current ceilings to `App.tsx=4215` and
`rightRailModel.tsx=688`. The 2026-07-13 review reopened A6.2 acceptance because
the green ratchet still permits code-motion-only success, App retains a whole-store
subscription, app evidence hooks reverse-depend on the right-rail model, and most
new stateful owners have source-string rather than behavioral proof. Execute the
corrected A6.2e-A6.2g order in the tracked plan; exact continuation hardening comes
before further code motion, and A6.3 must not start early.

## Objective

Execute the comprehensive 2026-07-10 remediation program without losing scope,
creating duplicate state owners, or relying on stale evidence. The detailed plan is
`docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md`.

This work order supersedes generic renderer/release continuation while it is ACTIVE.
Completed refactor/hardening orders remain historical preflight only. WU-UQ-1 is an
input to phase A3, not a concurrent active work order. Renderer Stage 2 is deferred to
conditional phase A8.

## Mandatory Read Order

1. `AGENTS.md` current status and work rules.
2. This work order.
3. `.claude/agent-memory-local/CODEX_MUST_READ_NEXT_SESSION_COMPREHENSIVE_AUDIT_REMEDIATION_LOCAL_ONLY.md` when it exists.
4. `docs/WORK_RECORD_AND_CONTINUATION_PROTOCOL.md`.
5. `docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md`, active phase only.
6. Current Git truth and generated artifacts named by the local handoff.
7. Active phase owner files only.

The local handoff is routing guidance. Fresh Git/verifier truth wins if they disagree.

## Continuation Contract

```yaml
continuation_contract:
  tracked_plan: docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md
  root_work_order: audit-remediation-instructions.md
  worklog_dir: .codex-auto/worklogs/audit-remediation/
  local_handoff: .claude/agent-memory-local/CODEX_MUST_READ_NEXT_SESSION_COMPREHENSIVE_AUDIT_REMEDIATION_LOCAL_ONLY.md
  verifier: pnpm verify:audit-remediation:continuation
```

## Phase Order

| Phase | Scope | Entry condition | Completion evidence |
| --- | --- | --- | --- |
| R0 | tracked plan, records, resume routing, continuation verifier | audit complete | continuation gate PASS |
| A0 | consent, score, evidence provenance, signing/updater/native claim truth | R0 complete | authority/evidence gates PASS |
| A1 | one daemon-owned terminal write/approval authority | A0 complete | adversarial all-face input tests PASS |
| A2 | Windows trust, updater lifecycle, immutable evidence DAG | A1 complete | repo-owned trust/evidence PASS; signed lifecycle remains an A9 release gate |
| A3 | pane liveness, reconnect, paste, close/shortcut/fleet truth | A2 repo-owned work complete and release-only external proof explicitly deferred | focused + rendered trust gates PASS |
| A4 | session/DB migration, backup, restore, failure durability | A3 complete | upgrade/restart/fault tests PASS |
| A5 | supervised execution and lock/concurrency boundaries | A4 complete | timeout/cancel/concurrency gates PASS |
| A6 | owner-based splits and modularity ratchets | A5 complete | ratchet + focused tests PASS |
| A7 | CompletedWorkPacket and first complete product mission | A6 complete | commit-bound completion scenario PASS |
| A8 | measured terminal-only native spike | A7 complete and metrics justify | parity/perf/soak decision artifact |
| A9 | CI/release/external proof closeout | A0-A8 complete/deferred by evidence | enforced release lane + operator proof |

Do not skip to a later phase because it is easier to score. Do not parallelize phases
that touch shared scripts, IPC, terminal, or claim docs.

## R0 Acceptance

```powershell
node --check scripts/verify-audit-remediation-continuation.mjs
pnpm verify:audit-remediation:continuation
pnpm verify:ai-decision-knowledge
pnpm verify:requirements-spec-design-traceability
git diff --check
git status --short --branch
```

R0 is `ready-to-commit` when these pass and the local handoff/worklog contain the exact
dirty-tree truth. Mark R0 `complete` after its one phase commit when commit is authorized.

## A0.1 Complete - No-Token / Token-Spending Authority Split

Objective: ensure a command named or documented as no-token cannot execute an
authenticated prompt, while retaining a separately consented operator smoke.

Read/owner files:

- `package.json`
- `scripts/verify-final-goal-safe.mjs`
- authenticated prompt/preflight/consent verifiers
- `AGENTS.md`
- `docs/requirements.md`
- `docs/AGENT_WORKFLOWS.md`
- release/final-goal score-path docs selected by the claim router

Required output:

1. Explicit `verify:goal:safe:no-token` command and artifact.
2. Explicit token-spending operator command and current consent packet.
3. Runtime assertion that the no-token chain contains and executes no token step.
4. Documentation with one authority and no contradictory wording.
5. Focused mutation test proving accidental token-step inclusion fails.

Forbidden in A0.1:

- terminal/product implementation,
- score threshold changes,
- manual artifact edits,
- running a token prompt merely to make the no-token gate green,
- renderer/full-native work.

Completion evidence:

- `pnpm verify:goal:authority-contract` passes the descriptor, environment-scrub,
  one-use packet, replay, expiry, digest, provider, and path-indirection checks.
- `pnpm verify:goal:safe:no-token` records
  `tokenSpendingPromptExecutedByThisRun=false` and a separate historical evidence
  field even when product, stale-evidence, policy, or external blockers keep the
  aggregate safe chain blocked.
- the token-bearing smoke has one operator entry point,
  `pnpm verify:goal:operator:token-smoke -- --provider <provider>`, and is not part
  of the no-token graph or operator-finish path.

## A0.2 Exact Next Slice

Objective: make every scored artifact prove where it came from and when it is valid,
then remove score/final-audit dependency cycles so one direct defect is not multiplied
through derived rows.

Read/owner files:

- `scripts/score-release-quality.mjs`
- `scripts/verify-final-goal-audit.mjs`
- score/final-audit artifact readers selected from those two owners
- provenance/freshness helpers and focused mutation verifiers
- score-path and claim-policy docs selected by `AI_GUIDE.md`

Required output:

1. One provenance schema binding generated evidence to Git HEAD, verifier digest,
   input hashes, execution identity, generation time, and expiry/freshness policy.
2. Fail-closed score ingestion for missing, stale, mismatched, or cyclic evidence.
3. An explicit dependency graph that separates direct defects from aggregate and
   derived rows.
4. Focused mutations for stale evidence, wrong HEAD/digest/input hash, graph cycles,
   and duplicate root-cause counting.
5. Current score/final-audit/docs regenerated through commands only; generated JSON
   is never edited by hand.

Forbidden in A0.2:

- lowering score thresholds or reclassifying failures to recover points,
- signing/updater implementation, terminal/product implementation, or UI work,
- treating aggregate failures as additional unique direct defects,
- running the operator token smoke merely to refresh score evidence.

## A0.2 Complete - Evidence Provenance And Acyclic Score Truth

Completion contract:

- `aelyris.evidence-provenance/v1` binds evidence to Git HEAD, verifier digest,
  input hashes, execution identity, generation time, and expiry.
- score and final-audit readers fail closed on missing, stale, mismatched, or
  expired provenance; non-JSON artifact credit requires a validated sidecar.
- release score contains only direct rows in its numerator/denominator;
  aggregate and derived rows remain visible but cannot duplicate score credit or
  unique direct defect counts.
- final-goal audit is downstream of release score and cannot feed points back
  into its own input.
- `pnpm verify:evidence-provenance-contract` rejects stale, wrong-HEAD,
  wrong-verifier, wrong-input, cycle, duplicate-node, and duplicate-root-cause
  mutations.

Legacy artifacts without the envelope intentionally receive zero artifact-backed
credit. Their migration is explicit evidence debt, not permission to restore mtime
fallbacks.

## A0.3 Exact Next Slice

Objective: remove the remaining false-positive release credit and ambiguous native
readiness wording, then make blocked release health enforceable in CI.

Read/owner files:

- release signing/updater verifiers and distribution score rows
- `scripts/verify-full-native-rust-gap-audit.mjs`
- `scripts/score-release-quality.mjs` enforce-mode entry point
- release/claim docs selected by `AI_GUIDE.md`

Required output:

1. Authenticode identity and timestamp-chain proof; detached updater signatures
   cannot substitute for Windows executable signing.
2. Updater credit requires capability wiring, reachable metadata, signature
   verification, install/relaunch, rollback/failure, and current provenance.
3. Full-native artifact and score labels describe measured coverage/gap only and
   cannot imply shipping-shell readiness.
4. `--enforce` exits non-zero for a D or release-blocked result while the default
   diagnostic command continues to emit the report.
5. Focused mutations cover unsigned binaries, stale/unreachable metadata,
   lifecycle failure, misleading native-ready labels, and enforce-mode blocking.

Forbidden in A0.3:

- creating signing material or committing signatures/secrets,
- awarding partial signing credit from file existence,
- lowering score thresholds,
- terminal/product/UI implementation,
- running token-spending prompt smoke.

## A0.3 Complete - Windows Trust Claim And Enforcement Truth

Completion contract:

- signing readiness requires valid Authenticode signer and timestamp chains for
  app exe, NSIS, and MSI plus separate current updater signatures.
- updater readiness requires wired capability, valid current manifest, reachable
  production metadata, and a provenance-valid install/relaunch plus rollback/failure
  lifecycle proof.
- unsigned local dist remains useful smoke evidence but receives zero signed
  distribution credit.
- native audit emits `aelyris.native-coverage-gap/v2` with
  `measuredCoveragePercent` and `shippingShellReady=false`; it cannot emit the
  old `fullNativeReady`/bare `percent` claim shape.
- `pnpm verify:quality-score:enforce` exits non-zero while the score is D or
  release-blocked.
- `pnpm verify:release-evidence-truth` rejects unsigned, missing timestamp,
  unreachable metadata, lifecycle failure, misleading native-ready label, and
  blocked enforce-mode mutations.

Current missing signing identity, endpoint reachability, and live updater lifecycle
proof remain external/operator evidence blockers. They do not reopen A0.3 repo-owned
truth logic.

## A1 Complete - Daemon-Owned Terminal Input Authority

Completion contract:

- every terminal write face constructs a typed envelope and delegates classification
  and delivery to `TerminalInputAuthority`, including REST, WS, MCP, mux, IPC,
  broadcast, native input/paste, sidecar, and runtime lifecycle prompts,
- ACK is emitted only after every effective target accepts the raw write; failures
  return a typed NACK and queue acceptance is never represented as execution success,
- waiting interactive approvals are session, prompt-fingerprint, and effective-target
  bound; raw programmatic Enter, stale claims, replay, and cross-target mutation fail
  closed,
- the sidecar input-authority capability and human-approval capability are separate
  from public bearer possession,
- `verify-runtime-core-preconditions` covers the authority contract and the full Rust
  library suite passes 1207/1207.

The two changed API integration executables compile but cannot start on the current
host (`STATUS_ENTRYPOINT_NOT_FOUND`, `0xc0000139`); this is recorded as host execution
evidence debt, not a passing integration run. `cargo check --all-targets` also exposes
an older out-of-scope `tests/test_agent.rs` reference to the removed `agent::parser`.

## A3 Complete - Repo-Owned UI Trust Surface

- Q0-Q10 and the rendered repair are committed through `8fb3d4e`.
- `verify:ui:trust` is enforced and registered in goal-safe and quality-score truth.
- the Aelyris-owned rendered Playwright suite is a blocking Windows CI job.
- the unrelated roadmap dashboard on port 48371 is excluded from that product gate and
  remains an explicit operator visual check via `AELYRIS_E2E_EXTERNAL_DASHBOARD=1`.
- live IME, staged sidecar kill, populated-cockpit review, and final DWM/WebView2 glass
  parity remain external/operator proof debt and do not become repo-owned PASS claims.

## A4 Complete - Repo-Owned Session and Database Durability

- `verify:a4:durability:acceptance` passes all twelve deterministic restart, upgrade,
  locked/corrupt DB, injected power-loss, quota, restore, and multi-connection scenarios.
- `verify:a4:durability` validates the provenance-bound A4 contract and acceptance
  artifact; final-goal safe and release-score truth consume that evidence.
- real OS sleep/resume and abrupt host power-loss evidence is not claimed by the
  deterministic matrix. It remains an A9 operator gate at
  `.codex-auto/operator-evidence/real-sleep-power-loss-durability.json`.

## Work and Session Rules

- Follow `docs/WORK_RECORD_AND_CONTINUATION_PROTOCOL.md` before every session clear.
- Record exact commands and artifact paths; do not summarize a failure as PASS.
- Keep implementation, stale evidence, policy, and external blockers separate.
- Keep local handoff/worklogs ignored and secret-free.
- Verified phase commits are standing-authorized by the owner: explicitly stage the
  phase paths and commit after its focused gates pass without asking again. Push,
  PR, merge, rebase, reset, amend, history rewrite, and force push remain separately
  authorized. If dirty work crosses session clear, list every intended path and the
  exact next action in the local handoff.
- At most one phase can be ACTIVE. Completed phases reopen only for a fresh regression.
