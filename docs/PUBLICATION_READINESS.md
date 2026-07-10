# Publication Readiness

Status: public-previewable, not release-ready.

This file is the short public-release checklist for Aelyris. It exists so
GitHub readers do not need to infer readiness from scattered historical docs.

## Current Verdict

Aelyris can be published as an alpha / experimental project if the README keeps
the current limitations visible. Aelyris is alpha and does not claim production
readiness; capability claims are gated by verifiers. It should not be published
as a stable release.

Current machine truth refreshed 2026-07-10 JST: `pnpm verify:quality-score`
reports `19/100` (`62/327`), grade `D`, `releaseCandidateReady=false`.
The current final-goal audit is `blocked` with
`implementationFixableCount=196`, `policyBlockedCount=12`, and
`externalBlockedCount=15`; `pnpm verify:goal:safe` is also `blocked` in the
current local run. The safe proof registry target is `28/28`.
`authenticated-ai-cli-prompt-smoke` requires
`authenticated-ai-cli-consent-packet` and
`AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini`. `pnpm verify:goal:finalize`
excludes git finalization by default; `AELYRIS_GOAL_FINALIZE_INCLUDE_GIT=1` is
optional, and git is not required for product/safe/finalize evidence. This is
not release-ready.

Regenerate the machine evidence locally before release decisions:

```powershell
pnpm verify:quality-score
pnpm verify:goal:safe:no-token
pnpm verify:release:hygiene
pnpm verify:requirements-spec-design-traceability
```

## Ready For Public Preview

- Source tree is small after cleaning Cargo `target` directories.
- Generated heavy outputs are ignored by `.gitignore`.
- README now states alpha status and known limitations.
- `LICENSE`, `SECURITY.md`, and `CONTRIBUTING.md` exist.
- Release hygiene verifier passes.
- Requirements and specs have a current traceability map.
- Supply-chain verifier passes on the current lockfiles; rerun
  `pnpm verify:supply-chain` before release decisions.

## Still Not Release-Ready

Remaining gate classes:

- mux live restore proof,
- chunked OSC/WebView2/CDP live proof,
- aggregate readiness gate,
- release claim gates,
- real OS sleep/resume proof,
- right-rail visual QA,
- live command, multipane command, recovered command, and process reconnect
  evidence,
- upstream supply-chain dependency movement,
- real OS/operator host proof. The authenticated prompt gate
  `authenticated-ai-cli-prompt-smoke` and consent packet
  `authenticated-ai-cli-consent-packet` are current, and prompt/probe execution
  still requires the documented provider env and the separate
  `pnpm verify:goal:operator:token-smoke` wrapper. The wrapper automatically
  issues a short-lived one-use execution packet for that invocation; it is not
  part of `pnpm verify:goal:safe:no-token`. Evidence
  must record provider/model/command/artifact; secrets, token files, signing
  material, and secret-bearing transcripts must not be persisted or committed.

`pnpm verify:goal:finalize` excludes git finalization by default. Optional git
finalization requires `AELYRIS_GOAL_FINALIZE_INCLUDE_GIT=1` and is not required
for product/safe/finalize evidence.

## Publish Checklist

Before making the repository public:

```powershell
pnpm verify:release:hygiene
pnpm verify:requirements-spec-design-traceability
pnpm verify:quality-score
pnpm verify:goal:safe:no-token
```

Then confirm:

- README says alpha / not release-ready.
- No `.env`, updater private key, token file, terminal transcript with secrets,
  `node_modules`, Cargo `target`, `.codex-auto`, `dist`, or `artifacts` is staged.
- `package.json` remains `"private": true` unless npm publication is explicitly
  planned.
- Screenshots, if added, do not expose local paths, tokens, private project
  names, shell history, or credentials.
- New public docs avoid machine-specific absolute paths; use `<repo>`,
  `<codex-home>`, or documented environment variables instead.
- GitHub description and topics do not overclaim readiness or completed
  capabilities.

## Suggested GitHub Description

Aelyris — project-first AI development workspace for Windows. Alpha Tauri/Rust/React
app with visible AI-agent panes, worktree/review/merge control, and machine-checked
readiness gates.
