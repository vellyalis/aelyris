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

Latest documented release evidence as of the 2026-06-29 JST public-doc refresh. Regenerate locally before release decisions:

- `release-quality-score`: `35/100`, `124/351`, grade `D`
- `releaseCandidateReady`: `false`
- Machine field: `releaseCandidateReady=false`
- `final-goal-safe`: `ok=false`, `status=blocked`
- `world-class-terminal-ai-os`: `status=external-blocked`

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
- `../PLAN.md`
- `specs/README.md`
- `specs/CODEX_HANDOFF.md`
- `specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md`
- `specs/AELYRIS_REQUIREMENTS_SPEC_DESIGN_TRACEABILITY_2026-06-27.md`
- `specs/AELYRIS_AGENT_MESSAGE_BUS_SUPERSET_SPEC.md`
- `specs/AELYRIS_GAP_CLOSURE_DESIGN_2026-06-25.md`
- `specs/AELYRIS_COMPETITIVE_GAP_AUDIT_2026-06-25.md`
- `AGENT_WORKFLOWS.md`

These documents define what can be claimed, what is still gated, and which
verifiers prove the current state.

## Historical And Background Documents

Many root-level `docs/*.md` files are audit trails, older implementation plans,
or progress logs. They are useful for context but may contain stale score values
such as old `S`, `A`, `95/100`, or `96/100` release snapshots.

Treat these as historical unless they explicitly point back to `requirements.md`,
`specs/README.md`, or freshly generated local `.codex-auto/quality` artifacts:

- `AELYRIS_COMMAND_CENTER_EDGE_PROGRESS.md`
- `AELYRIS_COMMAND_CENTER_EDGE_PLAN.md`
- `RUST_CORE_WEZTERM_TMUX_WIZARD_GOALS.md`
- `NATIVE_RUST_WEZTERM_PLUS_MIGRATION_PLAN.md`
- `TERMINAL_NATIVE_CORE_AND_EDITOR_DESCOPE_PLAN_2026-05-17.md`
- `AI_WORKSTATION_*`
- `LONGRUN_*`
- older competitive audits and migration plans

Do not delete or rewrite these casually. They are useful history and may be
referenced by work-unit docs. If a historical file becomes actively maintained
again, update this index and ensure its status section names the current machine
truth.

## Public Claim Policy

Do not claim any of the following in public-facing docs until the matching gate
is green:

- tmux-equivalent or full tmux replacement,
- BridgeSpace-plus complete,
- Ghostty-class or WezTerm-class daily-driver terminal,
- world-class Windows terminal AI OS,
- release-ready,
- strict `agmsg` superset or completed agent-message-bus coordination.

The safe public claim is narrower: Aelyris has a real terminal, mux, sidecar,
visible-agent, MCP, worktree, ownership, review, and merge substrate, while the
world-class product claim remains gated.

## Maintenance Rule

When implementation changes affect readiness or positioning, update all three:

1. the relevant spec or requirement,
2. the verifier script/artifact,
3. the public-facing status text if the claim boundary changed.





