# Comprehensive Audit Remediation Work Order

STATUS: ACTIVE  
PROGRAM: `audit-remediation`  
CURRENT PHASE: `R0` (`ready-to-commit`; continuation gate PASS).  
NEXT PHASE: `A0` after the R0 phase commit is authorized and created.  
NEXT IMPLEMENTATION SLICE: `A0.1 no-token/token-spending authority split`.

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
| A2 | Windows trust, updater lifecycle, immutable evidence DAG | A1 complete | signed install/update/relaunch proof PASS |
| A3 | pane liveness, reconnect, paste, close/shortcut/fleet truth | A2 complete | focused + rendered trust gates PASS |
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

## A0.1 Exact Next Slice

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

## Work and Session Rules

- Follow `docs/WORK_RECORD_AND_CONTINUATION_PROTOCOL.md` before every session clear.
- Record exact commands and artifact paths; do not summarize a failure as PASS.
- Keep implementation, stale evidence, policy, and external blockers separate.
- Keep local handoff/worklogs ignored and secret-free.
- Do not commit or push unless authorized. If dirty work crosses session clear, list every
  intended path and the exact next action in the local handoff.
- At most one phase can be ACTIVE. Completed phases reopen only for a fresh regression.
