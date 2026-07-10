# Aelyris Task Layer

Status: active task packet index.
Purpose: define how current work is described so agents do not infer scope from
chat history.

## Task Layer Role

Tasks are the volatile layer. They say what to do now. They do not replace
principles, project knowledge, or contracts.

Read order for a scoped task:

```text
AGENTS.md -> GOAL.md -> AI_GUIDE.md -> DECISION_FRAMEWORK.md -> DELEGATION_FRAMEWORK.md -> ARCHITECTURE.md -> contracts/README.md -> task packet -> owning spec -> source files
```

If uncertain, inspect. Never infer file contents.

## Active Task Sources

Current task instructions may live in:

- root work-order files such as `refactor-instructions.md`,
  `hardening-instructions.md`, `renderer-instructions.md`,
  `fleet-api-instructions.md`, and `ui-density-instructions.md`,
- continuation docs under `docs/specs/*_CONTINUATION.md`,
- handoff files under local-only ignored directories when explicitly marked,
- a user-provided `/goal` packet.

Fresh machine truth and `git status` outrank stale task prose.

## Task Packet Shape

Every non-trivial task should provide or derive this shape:

```text
Goal:
  What outcome should be true?

Scope:
  Which files/modules/specs are in bounds?

Owner Contract:
  Which contract/spec owns the behavior?

Done:
  What observable behavior or artifact proves completion?

Forbidden:
  What must not be changed or claimed?

Gates:
  Which commands/verifiers must run?

Handoff:
  What should the next agent read or run if interrupted?
```

## Work Unit Rules

- One work unit at a time.
- Create one commit per verified phase under the owner's standing commit
  authorization; do not pause for per-commit approval.
- Stage explicitly; do not sweep unrelated files.
- Push, PR, merge, rebase, reset, amend, history rewrite, and force push remain
  separately authorized actions.
- Do not mix docs-only design gates with runtime implementation unless the task
  explicitly selects that slice.
- Do not broaden a PR branch without noting the scope change.
- Report skipped checks as implementation gaps, stale evidence, or
  operator/environment gates.

## Done Report Minimum

A closeout must name:

- files or modules touched,
- contract owner,
- commands run and pass/fail result,
- generated artifact paths,
- skipped checks and exact blocker,
- remaining claim risk.

## Handoff Minimum

A restartable handoff should include:

- current branch and dirty state,
- read order,
- current machine-truth commands/artifacts,
- next work unit,
- forbidden files or scopes,
- pasteable command or `/goal` packet.

For an active long-running program this minimum is mandatory and is implemented
through `docs/WORK_RECORD_AND_CONTINUATION_PROTOCOL.md`: a tracked work order and
plan, an append-only ignored worklog, and one canonical local handoff. Session
clear is `clear-safe` only after the program continuation verifier passes.
