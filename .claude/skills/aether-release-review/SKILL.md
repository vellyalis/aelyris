---
name: aether-release-review
description: Audit Aether Terminal public docs, README text, GitHub positioning, and release-facing claims for public hygiene. Use before publishing to GitHub, editing README/docs, changing package metadata, or making claims about tmux, BridgeSpace, Ghostty, WezTerm, world-class status, release readiness, or production readiness.
---

# Aether Release Review

Use this skill to keep public text aligned with current machine truth.

## Claim Boundary

Allowed narrow claim:

> Aether has a Rust/Tauri terminal, mux, sidecar, visible-agent, MCP, worktree,
> ownership, review, and merge substrate.

Forbidden until gates are green:

- tmux-equivalent or full tmux replacement,
- BridgeSpace-plus complete,
- Ghostty-class or WezTerm-class daily-driver terminal,
- world-class Windows terminal AI OS,
- release-ready or production-ready.

## Audit Steps

1. Read `README.md`, `docs/README.md`, `docs/PUBLICATION_READINESS.md`,
   `docs/requirements.md`, and `docs/specs/README.md`.
2. Search public-facing docs for forbidden or stale claims.
3. Regenerate or read current verifier evidence:

```powershell
pnpm verify:release:hygiene
pnpm verify:quality-score
pnpm verify:goal:safe
pnpm verify:world-class-terminal-ai-os
```

4. Check repo hygiene:
   - no `.env*` except `.env.example`,
   - no build outputs or Cargo targets,
   - no generated signing material,
   - no `.codex-auto` artifacts,
   - no local Claude runtime files such as `.claude/launch.json`,
   - no unreviewed external skill packs, hooks, or slash commands.

## Output Contract

Return `PASS`, `REVIEW`, or `BLOCK`, then list:

- public claim issues by file,
- hygiene issues by path,
- commands and artifacts,
- edits required before publication.

Reviewer agents are advisory. Machine verifier output controls readiness.