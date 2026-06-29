# Publication Readiness

Status: public-previewable, not release-ready.

This file is the short public-release checklist for Aelyris. It exists so
GitHub readers do not need to infer readiness from scattered historical docs.

## Current Verdict

Aelyris can be published as an alpha / experimental project if the README keeps
the current limitations visible. It should not be published as a stable release
or advertised as tmux-equivalent, BridgeSpace-plus complete, Ghostty/WezTerm-class,
world-class, release-ready, or a strict `agmsg` superset.

Latest documented machine evidence, generated locally on 2026-06-29 JST. Regenerate before release decisions:

| Gate | Current state |
| --- | --- |
| Release quality | `35/100`, `124/351`, grade `D` |
| Release candidate | `false` |
| Machine release flag | `releaseCandidateReady=false` |
| Final safe gate | `ok=false`, `blocked` |
| Requirements/spec/design traceability | `pass-doc-traceability-current` |
| World-class terminal AI OS | `external-blocked` |
| Release hygiene | `pass-current-release-hygiene-contract` |
| Final audit residuals | `implementationFixableCount=46`, `policyBlockedCount=1`, `externalBlockedCount=12` |

## Ready For Public Preview

- Source tree is small after cleaning Cargo `target` directories.
- Generated heavy outputs are ignored by `.gitignore`.
- README now states alpha status and known limitations.
- `LICENSE`, `SECURITY.md`, and `CONTRIBUTING.md` exist.
- Release hygiene verifier passes.
- Requirements and specs have a current traceability map.

## Still Not Release-Ready

Remaining gate classes:

- release signing/updater material,
- npm supply-chain audit child-process environment block,
- mux live restore proof,
- chunked OSC/WebView2/CDP live proof,
- world-class aggregate gate,
- tmux / BridgeSpace / Ghostty / release claim gates,
- real OS sleep/resume proof,
- right-rail visual QA,
- live command, multipane command, recovered command, and process reconnect
  evidence,
- authenticated AI CLI prompt smoke, which requires explicit token-spend consent. The gate is `authenticated-ai-cli-prompt-smoke`, the packet is `authenticated-ai-cli-consent-packet`, and prompt execution requires `AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini` plus explicit consent.

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
- GitHub description and topics do not overclaim world-class or release-ready
  status.

## Suggested GitHub Description

Aelyris — project-first AI development workspace for Windows. Alpha Tauri/Rust/React
app with visible AI-agent panes, worktree/review/merge control, and machine-checked
readiness gates.


