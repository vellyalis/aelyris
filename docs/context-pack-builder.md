# Context Pack Builder

The Context Pack Builder produces a handoff packet from the current workspace state so another thread can resume without reconstructing the run manually.

## Inputs

- workspace name/path/branch/thread id
- active task id/title/status/next action and lineage
- changed files and diff summary
- agent sessions and recent transcript excerpts
- pane state
- commands and validation results
- blockers, decisions, and risks
- audit-derived final report events
- dashboard state and workstation graph summary

## Outputs

- handoff markdown for a new Codex thread
- machine-readable JSON with the same redacted state
- short thread summary
- next action list
- redaction count

## Redaction

The builder redacts known token forms, bearer headers, common API key variables, password/secret flags, sensitive dashboard payload keys, and raw file-content fields before generating markdown or JSON. UI callers should copy or display the generated output, not raw transcript or dashboard payloads.

## Validation

Focused coverage lives in `src/__tests__/contextPack.test.ts` and `src/__tests__/ContextPanel.test.tsx`. The shard covers markdown/JSON fixture generation, final-report inclusion from audit events, and redaction of commands, transcripts, dashboard payloads, and sensitive metadata.
