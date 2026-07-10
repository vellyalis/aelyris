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
   `hardening-instructions.md`, and `renderer-instructions.md` explicitly when
   `AGENTS.md` requires the work-order safety preflight; do not restart
   completed orders unless a current verifier shows a regression.
6. `docs/specs/README.md` - active spec index and current Work Unit routing.
7. This file - operational routing for agents and skills.

If any skill, prompt, or older doc conflicts with `AGENTS.md` or
`docs/requirements.md`, follow the claim policy and update the stale workflow.

Current machine truth refreshed 2026-07-10 JST by the comprehensive audit safe
chain: `pnpm verify:quality-score` reports `65/100` (`228/351`), grade `D`,
`releaseCandidateReady=false`.
The current final-goal audit is `blocked` with `implementationFixableCount=17`,
`policyBlockedCount=3`, and `externalBlockedCount=19`.

## Workflow Routing

| Need | Use | Output |
| --- | --- | --- |
| Public readiness or release claim check | `aelyris-release-review` | `PASS / REVIEW / BLOCK` with current verifier evidence |
| Current proof and gate classification | `aelyris-evidence-review` | local verifier commands, artifacts, stale/unknown/external gate split |
| Previous-turn Claude stop gate | `aelyris-stop-gate-review` | `ALLOW` or evidence-backed `BLOCK` |
| Root work-order status | `audit-remediation-instructions.md` is ACTIVE; refactor/hardening are complete, UI quality belongs to phase A3, renderer is deferred to conditional A8 | one phase at a time, one commit per phase, no concurrent execution |
| One scoped Work Unit or vertical slice | `docs/specs/README.md` plus the relevant phase/spec section and owner module verifier | implementation plan and focused checks |
| Large drift-prone implementation | `codex-guided-implementation` | increment plan, read-only review gates, explicit boundaries |
| MCP runtime orchestration | `aelyris-orchestrate` | local-only runtime loop; no public release claim |
| Legacy worktree dispatch path | older fleet scripts | fallback/manual workflow only; prefer MCP runtime when available |

## Public Hygiene Rules

- Do not import external skill packs, hooks, slash commands, or personas wholesale.
- Do not enable hooks that rewrite files or inject hidden session behavior.
- Keep `.claude/skills` as Aelyris-specific workflows. They are not product capability proof.
- Machine gates and local verifier outputs outrank reviewer-agent opinions.
- Token-spending AI CLI prompt/probe verifiers have standing operator consent for this repo/WU. Use the documented provider/consent env vars when required, record provider/model/command/artifact evidence, and never persist secrets, token files, signing material, or secret-bearing transcripts.

## Skill Design Rules

- Keep `SKILL.md` short: trigger, preflight, loop, output contract, and hard guardrails.
- Move long verb catalogs, examples, and recovery tables into `references/`.
- Use scripts only for deterministic repeated checks; document inputs, outputs, and side effects.
- Require `unknown` or `external-blocked` when code, spec, or live evidence was not checked.
- A reviewer skill can find risks, but it cannot make a release or readiness claim true.

## Minimum Task Closeout

Before calling work done, report:

- owner module or doc set touched,
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

For the current comprehensive audit program, use:

```powershell
pnpm verify:audit-remediation:continuation
```

Until audit-remediation phase A0 splits the command contract, do not call
`pnpm verify:goal:safe` a no-token gate. Its 2026-07-10 run reported
`tokenSpendingPromptExecuted=true` under standing consent.
