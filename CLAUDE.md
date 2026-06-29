# Claude Code Guide For Aelyris

Claude Code should treat `AGENTS.md` as the shared source of truth for this repo.
Read it first, then use this file only for Claude-specific operating notes.

## Priority

1. `AGENTS.md`
2. `docs/requirements.md`
3. `docs/AGENT_WORKFLOWS.md`
4. `docs/specs/CODEX_HANDOFF.md`
5. The Work Unit spec section for the task at hand
6. This Claude-specific note

If this file conflicts with `AGENTS.md` or the current claim policy, follow
`AGENTS.md` and update this file in the same change.

## Claude-Specific Notes

- Do not start from old progress logs. Use `docs/README.md` to distinguish current docs from historical docs.
- Do not claim release readiness or world-class status from old score snapshots. Regenerate with `pnpm verify:quality-score` and `pnpm verify:goal:safe` when readiness matters.
- Visible agent work must use interactive/visible PTY paths. Do not route human-visible panes through `-p` / `--print`.
- Keep `package.json` as `"private": true` unless npm publication is explicitly planned.
- Do not run token-spending authenticated AI prompt smoke tests without the documented explicit consent environment variables.
- Do not run `cargo test` and `pnpm test` in parallel on Windows.
- Treat `.claude/skills` as Aelyris-specific workflow helpers, not product capability proof. Use verifier commands for claims.

## Extra Quality Bar

Before code edits, identify the owner module and the verifier that proves the behavior. After code edits, state which checks were run and whether any blocker is an external/operator gate.

Check for these debt risks before finishing:

- duplicated logic,
- dead code or un wired infrastructure,
- mixed ownership of state,
- unclear Rust/TypeScript contract boundaries,
- tests that only prove mocks while the claim requires live behavior,
- security boundary drift around shell, file, MCP, AI CLI, token, and signing paths.

## Known UI/LSP Caveat

Do not describe F12 as Monaco Go to Definition unless the LSP implementation and verifier prove it. Current historical notes say F12 is used as a terminal function-key path, while LSP go-to-definition/diagnostics/references still need current proof.
