# Contributing

Thanks for taking a look at Aelyris.

The project is in alpha development. Contributions are welcome, but changes
should preserve the current proof-first workflow: implementation claims need
matching specs, tests, and verifier evidence.

## Before You Start

Read these files first:

- `AGENTS.md`
- `docs/requirements.md`
- `docs/specs/README.md`

Pick one scoped work unit. Avoid broad rewrites unless the current work unit
requires them.

## Development Setup

```powershell
pnpm install
pnpm tauri dev
```

If Cargo `target` directories were cleaned, the first build will take longer.

## Verification

Run focused checks for the area you changed. Useful general checks:

```powershell
pnpm verify:release:hygiene
pnpm verify:requirements-spec-design-traceability
pnpm verify:quality-score
pnpm verify:goal:safe
```

Do not treat host-blocked external gates as implementation success. If a gate is
blocked by WebView2/CDP, Windows sleep/resume, process policy, signing material,
or explicit AI-token consent, state that directly in the change notes.

## Claim Policy

Aelyris is alpha and does not claim production readiness; capability claims are
gated by verifiers. Do not add public wording that claims readiness or completed
capabilities unless the matching gate is green.

The current safe public framing is that Aelyris has a real terminal, mux,
visible-agent, MCP, worktree, ownership, review, and merge substrate, while
larger product claims remain gated.

## Pull Request Expectations

Include:

- what changed,
- which files or modules are intentionally in scope,
- which verifier commands were run,
- which gates are blocked by environment/operator requirements,
- screenshots or artifacts for UI changes when practical.

Do not include:

- generated Cargo `target` output,
- `node_modules`,
- `.codex-auto` artifacts unless explicitly requested,
- local `.env` files,
- updater private keys or signing material,
- raw AI CLI transcripts containing secrets.

## Code Style

Prefer existing local patterns over new abstractions. Keep changes narrow and
update the relevant verifier or documentation when a behavior contract changes.
