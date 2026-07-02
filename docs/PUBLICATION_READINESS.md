# Publication Readiness

Status: public-previewable, not release-ready.

This file is the short public-release checklist for Aelyris. It exists so
GitHub readers do not need to infer readiness from scattered historical docs.

## Current Verdict

Aelyris can be published as an alpha / experimental project if the README keeps
the current limitations visible. Aelyris is alpha and does not claim production
readiness; capability claims are gated by verifiers. It should not be published
as a stable release.

Current machine truth refreshed 2026-07-03 JST: `pnpm verify:quality-score`
reports `71/100` (`249/351`), grade `D`, `releaseCandidateReady=false`.
The current final-goal audit is `blocked-by-external-gates` with
`implementationFixableCount=0`, `policyBlockedCount=0`, and
`externalBlockedCount=27`; safe proof registry coverage is `28/28`. This is not
release-ready.

Regenerate the machine evidence locally before release decisions:

```powershell
pnpm verify:quality-score
pnpm verify:goal:safe
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

- release signing/updater material,
- mux live restore proof,
- chunked OSC/WebView2/CDP live proof,
- aggregate readiness gate,
- release claim gates,
- real OS sleep/resume proof,
- right-rail visual QA,
- live command, multipane command, recovered command, and process reconnect
  evidence,
- authenticated AI CLI prompt smoke. The gate is `authenticated-ai-cli-prompt-smoke`, the packet is `authenticated-ai-cli-consent-packet`, and prompt/probe execution has standing owner consent for this repo/WU when `AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini` or the documented provider env is set. Evidence must record provider/model/command/artifact; secrets, token files, signing material, and secret-bearing transcripts must not be persisted or committed.

## Publish Checklist

Before making the repository public:

```powershell
pnpm verify:release:hygiene
pnpm verify:requirements-spec-design-traceability
pnpm verify:quality-score
pnpm verify:goal:safe
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
