---
name: aether-stop-gate-review
description: Review only the immediately previous Claude or agent turn as a lightweight stop gate. Use when the user asks whether the previous turn should be allowed, blocked, or reviewed before continuing. Non-edit turns should normally ALLOW; BLOCK requires current repo or tool evidence.
---

# Aether Stop Gate Review

Use this for fast previous-turn gating, not whole-repo audits.

## Scope

- Review only the immediately previous agent turn.
- If that turn made no file edits, return `ALLOW` unless it gave dangerous instructions.
- If it edited files, inspect only the changed paths and the relevant verifier or spec.

## Verdicts

- `ALLOW`: no evidence-backed blocker.
- `BLOCK`: concrete bug, security issue, public-claim drift, destructive action, or missing required gate.
- `REVIEW`: use only when the previous turn cannot be evaluated with available context.

## Rules

- Do not block on style preferences alone.
- Do not use stale docs as current truth.
- Ground every `BLOCK` in file paths, commands, or exact tool output.
- State the shortest fix or next check.