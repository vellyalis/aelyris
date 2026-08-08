# Agent Workflow Guide

This guide keeps `AGENTS.md` lean. Use it when deciding which agent workflow,
skill, verifier, or review gate should drive a task.

## Authority Order

1. `AGENTS.md` - shared repo policy, current claim boundary, and mandatory
   preflight. Task routing starts only after its hard guardrails are checked.
2. `docs/requirements.md` - stable requirements, machine-truth policy, and
   Current Claim Policy when claims/readiness/public wording are touched.
3. `AI_GUIDE.md` - Task Router for selecting only the relevant knowledge docs;
   its layer model is reasoning order, not a requirement to read every file.
4. Judgment material - `GOAL.md` plus the knowledge stack selected by
   `AI_GUIDE.md` (decision framework, delegation framework, architecture,
   contracts).
5. Root work orders - read `refactor-instructions.md`,
   `hardening-instructions.md`, `audit-remediation-instructions.md`,
   `product-delivery-instructions.md`, and `renderer-instructions.md` explicitly when
   `AGENTS.md` requires the work-order safety preflight; do not restart
   completed orders unless a current verifier shows a regression.
6. `docs/specs/README.md` - active spec index and current Work Unit routing.
7. This file - operational routing for agents and skills.

If any skill, prompt, or older doc conflicts with `AGENTS.md` or
`docs/requirements.md`, follow the claim policy and update the stale workflow.

Current machine truth is generated, not duplicated in this workflow guide.
Regenerate it with `pnpm verify:quality-score` and read
`.codex-auto/quality/release-quality-score.json`. Read the downstream final-goal
audit from `.codex-auto/quality/final-goal-audit.json`; it does not feed points
back into the score. A focused proof-registry PASS is not release readiness.
`authenticated-ai-cli-prompt-smoke` requires
`authenticated-ai-cli-consent-packet` and
`AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini`.
`pnpm verify:goal:finalize` excludes git finalization by default;
`AELYRIS_GOAL_FINALIZE_INCLUDE_GIT=1` is
optional, and git is not required for product/safe/finalize evidence.

## Workflow Routing

| Need | Use | Output |
| --- | --- | --- |
| Public readiness or release claim check | `aelyris-release-review` | `PASS / REVIEW / BLOCK` with current verifier evidence |
| Current proof and gate classification | `aelyris-evidence-review` | local verifier commands, artifacts, stale/unknown/external gate split |
| Previous-turn Claude stop gate | `aelyris-stop-gate-review` | `ALLOW` or evidence-backed `BLOCK` |
| Root work-order status | `product-delivery-instructions.md` owns active `AIO-48`; GMV-0..3 and AIO-44/45/46/47 are complete/Claim-Eligible or Product-Accessible, and `audit-remediation-instructions.md` is certification-only after A9.6r1 | one repo-mutating phase at a time; certification-only external work may coexist without repository edits |
| Product delivery and maturity | `product-delivery-instructions.md` plus the owning Mission/Proofbook sources | classify Internal Capability / Product-Accessible / Claim-Eligible and connect one supported user path |
| One scoped Work Unit or vertical slice | `docs/specs/README.md` plus the relevant phase/spec section and owner module verifier | implementation plan and focused checks |
| Large drift-prone implementation | `codex-guided-implementation` | increment plan, read-only review gates, explicit boundaries |
| MCP runtime orchestration | `aelyris-orchestrate` | local-only runtime loop; no public release claim |
| Legacy worktree dispatch path | older fleet scripts | fallback/manual workflow only; prefer MCP runtime when available |

## Verification Lanes

Verification is selected by the decision it can change, not by the number of
available scripts.

| Lane | Default use | Commands / evidence | Blocks |
| --- | --- | --- | --- |
| Local fast | every bounded product/runtime Work Unit | `pnpm verify:fast`, plus one focused owner test or `pnpm test:related -- <files...>` | local commit when red |
| Hosted fast | every push / PR, path-aware | changed frontend tests + typecheck, relevant Rust check/test, dependency audit only when manifests/lockfiles change | next repo mutation when red |
| Full confidence | nightly, manual dispatch, broad shared-owner change | `pnpm verify:full`, full rendered UI, full Rust, current cross-owner gates | release/public claim; a fresh direct defect reopens its owner |
| Historical phase | explicit phase reopen on its accepted exact-SHA checkout/worktree | owning aggregate verifier outside current-main CI | only that historical claim |
| Release / certification | release candidate or operator/external action | quality score, SBOM/provenance, signing, real sleep, authenticated prompt | release readiness |

Rules:

- `pnpm test:changed` is the changed-file local fast command. Existing deterministic
  branch review continues to use full `pnpm test`; use `pnpm test:full` as the
  explicit confidence-lane alias.
- Do not rerun A6/A7 aggregate verifiers for an unrelated GMV or Routine change.
  Completed phase evidence stays bound to its accepted exact SHA and returns only when
  the phase is explicitly reopened; current-main fast/full workflows do not carry it.
- After focused local proof and a green hosted-fast lane, continue to the next
  bounded Work Unit instead of waiting idle for nightly/manual full confidence.
  A fresh full-lane defect preempts the next mutation checkpoint; it does not grant
  permission to weaken or ignore the failing gate.
- A test-only, verifier-only, or report-only loop must identify the implementation
  decision it changes. Otherwise close it and return to product delivery.

### Verification Economy Guard

For every nontrivial implementation Work Unit, activate
`.agents/skills/verification-economy/SKILL.md` before selecting commands. The
deterministic helper records the current diff fingerprint and stops repeated
expensive gates from becoming a substitute for judgment.

```powershell
pnpm verification:plan -- --claim "named behavior" --focused "owner test command" --stage implementation
pnpm verification:run -- --command "owner test command"
```

After the focused proof is green and the feature diff is stable, update the plan
to `--stage final`. A full gate is allowed only with a concrete owner/risk reason.

```powershell
pnpm verification:plan -- --claim "shared contract" --focused "focused command" --risk public_contract,auth --stage final
pnpm verification:run -- --command "pnpm verify:rust:full" --reason "public API and auth boundary changed"
```

The helper appends sanitized decisions to the ignored
`.codex-auto/learning/verification-decisions.jsonl`. It stores commands,
fingerprints, results, durations, and short classifications, but no test output,
environment values, credentials, or secrets. If the same expensive command has
already passed for the unchanged fingerprint, it is skipped unless a new failure
hypothesis is supplied with `--rerun-reason`.

When a gate fails outside the changed owner or claim boundary, record and defer it
instead of repairing it inside the feature Work Unit:

```powershell
pnpm verification:note -- --kind unrelated_failure --command "pnpm verify:rust:full" --summary "short sanitized failure class"
pnpm verification:summary
```

Repeated process defects that materially change future execution are promoted to
`.agents/skills/verification-economy/references/learned-failures.md`. Machine-local
noise stays only in the ignored journal.

## Public Hygiene Rules

- Do not import external skill packs, hooks, slash commands, or personas wholesale.
- Do not enable hooks that rewrite files or inject hidden session behavior.
- Keep `.claude/skills` as Aelyris-specific workflows. They are not product capability proof.
- Machine gates and local verifier outputs outrank reviewer-agent opinions.
- Token-spending AI CLI prompt/probe verifiers have standing operator
  authorization for this repo/WU. Run them only through
  `pnpm verify:goal:operator:token-smoke` with an explicit provider; the wrapper
  mints a short-lived one-use packet for that invocation. Record
  provider/model/command/artifact evidence and never persist secrets, token
  files, signing material, or secret-bearing transcripts.
- Verified phase/Work Unit commits have standing owner authorization. Stage only
  the intended paths and commit after focused gates pass without asking again;
  push, PR, merge, rebase, reset, amend, history rewrite, force push, and Git
  ACL changes remain separately authorized actions.

## Skill Design Rules

- Keep `SKILL.md` short: trigger, preflight, loop, output contract, and hard guardrails.
- Move long verb catalogs, examples, and recovery tables into `references/`.
- Use scripts only for deterministic repeated checks; document inputs, outputs, and side effects.
- Require `unknown` or `external-blocked` when code, spec, or live evidence was not checked.
- A reviewer skill can find risks, but it cannot make a release or readiness claim true.

## Minimum Task Closeout

Before calling work done, report:

- owner module or doc set touched,
- capability maturity and the supported user path or named immediate consumer,
- verifier commands run,
- generated artifact paths when applicable,
- skipped checks and whether they are code gaps, stale evidence, or operator/environment gates,
- remaining public-claim risk, if any.

## Mandatory Work Record And Session Close

Every active implementation/audit program must follow
`docs/WORK_RECORD_AND_CONTINUATION_PROTOCOL.md`.

- Stable scope and acceptance live in a tracked root work order and plan.
- Each session writes an ignored worklog under `.codex-auto/worklogs/<program>/`.
- Each active program has one canonical local handoff under
  `.claude/agent-memory-local/`; replace it at closeout instead of creating
  competing latest files.
- A handoff must name current branch/HEAD/dirty paths, commands and artifacts,
  blocker split, one next exact action, and a pasteable `/goal`.
- Session clear is `clear-safe` only after the program continuation verifier
  passes and a final `git status --short --branch` confirms the recorded state.
- A clear-safe handoff is not a release PASS; it only proves restartability.
- Cross-PC continuation is stronger than local clear-safe. A new machine rebuilds
  its ignored handoff/worklog with `scripts/bootstrap-development.ps1`; before a
  handoff is called available from any PC, `pnpm verify:cross-pc-continuation` must
  prove local HEAD equals both the tracking ref and remote advertised ref. Unpushed
  commits remain an explicit cross-PC BLOCK.

For the current comprehensive audit program, use:

```powershell
pnpm verify:audit-remediation:continuation
```

Use `pnpm verify:goal:safe:no-token` for descriptor-first no-token refreshes.
The legacy `pnpm verify:goal:safe` aggregate may project historical token
evidence and is not current-run no-token proof.
