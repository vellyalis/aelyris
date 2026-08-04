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

On a fresh Windows clone, use the tracked bootstrap:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-development.ps1
```

It installs the frozen JavaScript dependency graph, rebuilds machine-local
continuation state from tracked Git truth, and runs the fresh-clone gate. Then start
development with `pnpm tauri dev`.

Run `pnpm verify:cross-pc-continuation` before claiming a handoff is available from
another PC. An unpushed commit is a cross-PC continuation BLOCK even when local tests
and the local continuation verifier pass.

If Cargo `target` directories were cleaned, the first build will take longer.

## Verification

Run the smallest lane that can decide the behavior and risk you changed:

```powershell
pnpm verify:fast
pnpm test:related -- src/path/to/owner.ts
pnpm verify:rust:fast
pnpm verify:rust:native-proof
```

Add `pnpm verify:rust:unit` when Rust app owners change. Add
`pnpm verify:rust:integration` when a cross-test boundary requires the whole local
integration suite. Hosted fast CI executes only changed integration test binaries;
the nightly/manual Full Confidence lane still runs all Rust targets.

Run `pnpm verify:rust:examples` or `pnpm verify:rust:benches` only when those
target families change. Hosted fast CI selects them path-wise.

Add `pnpm verify:rust:pty` only when the PTY sidecar or one of its imported
`aelyris_lib` boundaries changes.

`pnpm test:changed` runs tests related to changed frontend modules. Existing
branch-review automation keeps full `pnpm test`. Use `pnpm test:full` directly only
for a broad shared-owner change, a named regression that
crosses owner boundaries, or an explicit full-confidence refresh. UI changes should
run the focused Playwright scenario locally when practical; the hosted fast lane also
runs four critical rendered journeys. Complete frontend, rendered UI, Rust, and
release-hardening confidence is nightly/manual rather than a prerequisite for every
bounded Work Unit.

Release/public claim work still uses the applicable wider gates, including
`pnpm verify:release:hygiene`, `pnpm verify:quality-score`, and
`pnpm verify:goal:safe:no-token`. Completed A6/A7 aggregate verifiers are historical
exact-SHA evidence, not general-purpose checks for unrelated product changes. Reopen
them only in an explicit historical checkout/worktree rather than current-main CI.

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
