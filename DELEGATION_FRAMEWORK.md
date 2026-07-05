# Aelyris Delegation Framework

Status: active delegation decision engine.
Purpose: define when to delegate and who should explore, review, or verify.
This file is about who chooses or investigates, not what the architecture should
be.

## 0. Who Chooses

Decision Framework answers what to choose.
Delegation Framework answers who should choose, explore, review, or verify.

The conductor remains responsible for final synthesis, scope control, and the
claim made to the user.

## 1. Delegate When

Delegate when the work is:

- independent exploration,
- parallelizable,
- conclusion-only research,
- large-context inspection,
- review that benefits from independence,
- comparison of alternatives,
- verifier or CI log triage that can be summarized with exact evidence.

Delegation is strongest when the worker can return a decision-ready summary
without editing shared files.

## 2. Do Not Delegate When

Do not delegate when:

- the current agent is editing the same files,
- the change location must be understood deeply before editing,
- the task is small enough to inspect directly,
- the work requires editing while reasoning,
- secrets, credentials, signing material, or private transcripts are involved,
- the repository has dirty overlapping files and no isolated worktree,
- the delegated result would still require rereading everything to be trusted.

Implementation stays with the current owner agent unless there is a separate
worktree and a clear file boundary.

## 3. Role Routing

Use capability classes, not hard-coded model names, as the stable rule:

Strong models are not default implementers. Use strong models for decisions
with high ambiguity, high blast radius, or long-term architectural cost. Once
contracts, placement, and done criteria are clear, prefer cheaper or faster
agents for bounded implementation, mechanical review, search, classification,
formatting, and repeatable verification.

| Work type | Preferred delegate | Output expected |
| --- | --- | --- |
| Broad search / source map | Sonnet-class researcher | files, owners, risks, exact references |
| Design tradeoff | Opus-class designer | options, recommendation, contract impact |
| Contract or boundary design | Opus-class designer | invariant, authority owner, migration and verifier impact |
| Rule improvement / meta-audit | Opus-class reviewer | obsolete rules, missing criteria, safer framework edits |
| Code review | independent reviewer | findings ordered by severity |
| Security boundary | security reviewer | source-to-sink risk and blocker level |
| CI / verifier failure | tester | command, artifact, root cause, next fix |
| Implementation | current owner agent | scoped edits and proof |

Model names can change. The durable rule is the work shape: exploratory,
review, design, testing, or implementation.

## 4. Cost And Capability Discipline

Do not spend the strongest model on default execution work just because it is
available. Route by ambiguity, blast radius, and reversibility:

- Use strong models for design, contract, governance, architecture, delegation,
  audit, risk, and rule-improvement decisions.
- Use mid-tier models for scoped implementation after the contract and owner are
  clear.
- Use fast or cheap models, scripts, or deterministic tools for broad search,
  formatting, simple classification, log reading, and repeatable checks.
- Escalate back to a strong model when implementation reveals an unclear
  contract, cross-module ownership conflict, security boundary, or product claim
  change.
- A strong-model review should decide whether the framework or task definition
  is wrong, not only whether a diff has local mistakes.

## 5. Delegation Packet

A useful delegation packet contains:

```text
Goal:
Scope:
Read First:
Allowed Files:
Forbidden Files:
Do Not Edit:
Question To Answer:
Output Format:
Required Evidence:
```

For Aelyris, include the current branch, dirty-state warning, owning contract,
and verifier names when relevant.

## 6. Integration Rules

- Use worktrees or separate lanes for parallel editing.
- Do not let multiple workers rewrite the same UI shell, config file, or large
  owner module.
- The conductor owns final decisions and must inspect any source it will edit.
- Delegated findings are evidence, not authority. If uncertain, inspect.
- Never infer file contents from a delegate summary when editing.

## 7. Stop Conditions

Stop delegation and return to direct inspection when:

- worker results conflict,
- source has changed since the worker read it,
- the proposed fix crosses contract boundaries,
- the task needs a product claim update,
- the delegate cannot cite files, commands, or artifacts,
- final synthesis would require trusting unverified summaries.
