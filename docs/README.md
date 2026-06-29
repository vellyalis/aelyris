# Documentation Guide

This directory contains both current implementation guidance and historical audit
snapshots. For public readers and new contributors, start here instead of opening
older progress files directly.

## Current Truth Sources

The current project status is controlled by requirements, spec indexes, and
machine-readable verifier artifacts. These sources override older progress notes
and historical score snapshots.

Read in this order:

1. `../README.md` - public project overview and current alpha status.
2. `GITHUB_INTRODUCTION.md` - public GitHub introduction draft and Aelyris naming copy.
3. `PUBLICATION_READINESS.md` - public-release checklist and current blockers.
4. `requirements.md` - stable requirements entrypoint referenced by `AGENTS.md`.
5. `specs/README.md` - active spec index and work-unit map.
6. `AGENT_WORKFLOWS.md` - agent/skill workflow routing and closeout rules.
7. Verifier commands such as `pnpm verify:quality-score` and `pnpm verify:goal:safe` - generate local `.codex-auto/quality/*.json` evidence.

Aelyris is alpha and does not claim production readiness; capability claims are
gated by verifiers. Regenerate the machine evidence locally before release
decisions rather than quoting any score from older docs:

```powershell
pnpm verify:quality-score
pnpm verify:goal:safe
```

Do not use older score mentions in historical progress files as current release
truth.

Some historical docs and verifier logs include local absolute paths from the
authoring machine, such as Windows user profile paths or Codex automation
locations. Treat those as historical evidence, not portable setup instructions.
New public docs should prefer placeholders like `<repo>`, `<codex-home>`, or
environment variables.

## Active Planning Documents

These files are active entrypoints:

- `requirements.md`
- `GITHUB_INTRODUCTION.md`
- `PUBLICATION_READINESS.md`
- `specs/README.md`
- `specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md`
- `specs/AELYRIS_AGENT_MESSAGE_BUS_SUPERSET_SPEC.md`
- `AGENT_WORKFLOWS.md`

These documents define what can be claimed, what is still gated, and which
verifiers prove the current state.

## Historical And Background Documents

Older audit trails, implementation plans, and progress logs may surface in git
history or work-unit notes. They can contain stale score values such as old `S`,
`A`, `95/100`, or `96/100` release snapshots. Treat any such material as
historical unless it explicitly points back to `requirements.md`,
`specs/README.md`, or freshly generated local `.codex-auto/quality` artifacts.

## Public Claim Policy

Aelyris is alpha and does not claim production readiness; capability claims are
gated by verifiers. Do not claim readiness or completed capabilities in
public-facing docs until the matching gate is green.

The safe public claim is narrower: Aelyris has a real terminal, mux, sidecar,
visible-agent, MCP, worktree, ownership, review, and merge substrate, while
larger product claims remain gated.

## Maintenance Rule

When implementation changes affect readiness or positioning, update all three:

1. the relevant spec or requirement,
2. the verifier script/artifact,
3. the public-facing status text if the claim boundary changed.





