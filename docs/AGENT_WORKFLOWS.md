# Agent Workflow Guide

This guide keeps `AGENTS.md` lean. Use it when deciding which agent workflow,
skill, verifier, or review gate should drive a task.

## Authority Order

1. `AGENTS.md` - shared repo policy and current claim boundary.
2. `docs/requirements.md` - stable requirements and machine-truth policy.
3. `docs/specs/README.md` - active spec index.
4. `docs/specs/CODEX_HANDOFF.md` - Work Unit map and do-not-break list.
5. This file - operational routing for agents and skills.

If any skill, prompt, or older doc conflicts with `AGENTS.md` or
`docs/requirements.md`, follow the claim policy and update the stale workflow.

## Workflow Routing

| Need | Use | Output |
| --- | --- | --- |
| Public readiness or release claim check | `aelyris-release-review` | `PASS / REVIEW / BLOCK` with current verifier evidence |
| Current proof and gate classification | `aelyris-evidence-review` | local verifier commands, artifacts, stale/unknown/external gate split |
| Previous-turn Claude stop gate | `aelyris-stop-gate-review` | `ALLOW` or evidence-backed `BLOCK` |
| One scoped Work Unit or vertical slice | `docs/specs/CODEX_HANDOFF.md` plus owner module verifier | implementation plan and focused checks |
| Large drift-prone implementation | `codex-guided-implementation` | increment plan, read-only review gates, explicit boundaries |
| MCP runtime orchestration | `aelyris-orchestrate` | local-only runtime loop; no public release claim |
| Legacy worktree fleet path | `aelyris-fleet` | fallback/manual workflow only; prefer MCP runtime when available |

## Public Hygiene Rules

- Do not import external skill packs, hooks, slash commands, or personas wholesale.
- Do not enable hooks that rewrite files or inject hidden session behavior.
- Keep `.claude/skills` as Aelyris-specific workflows. They are not product capability proof.
- Machine gates and local verifier outputs outrank reviewer-agent opinions.
- Token-spending AI prompt smoke requires explicit operator consent.

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