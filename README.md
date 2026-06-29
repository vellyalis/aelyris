**English** | [日本語](README.ja.md)

# Aelyris

**A project-first AI development workspace for Windows.** Run coding agents in visible terminal panes, keep work isolated by worktree and ownership boundaries, and review changes through auditable gates before merge.


> **Alpha — active development, not yet release-ready.** Every readiness claim is
> backed by a verifier you can run yourself. Expect rough edges; APIs are moving.

## The problem

Point several AI coding agents at one repository and it usually turns into chaos:
they edit the same files, overwrite each other, and you can't tell who changed
what. Most tooling runs a single agent, or fans agents out invisibly with no real
guardrails.

## What makes it different

- **Visible, steerable parallelism.** Each agent runs as an interactive CLI in its
  own pane and its own git worktree. You watch them work — and can steer a running
  agent away from specific files mid-flight — instead of trusting an invisible
  headless swarm.
- **Coordination in code, not just prompts.** Ownership is tracked per file *and
  per symbol*, using tree-sitter extraction (Rust / TS / TSX) with a diff-hunk
  fallback. Orchestrated lanes are conflict-aware: disjoint symbols run in
  parallel, overlapping work is serialized automatically.
- **Coordination roadmap with gated claims.** Local agent messaging, shared-brain replay, and code-graph reasoning are active design targets, but public claims stay behind verifier gates until the evidence is current.
- **Merges bound to a commit.** An approval is bound to the exact commit it was
  granted against; the git update uses an old-OID compare-and-swap, so a moved
  branch tip is rejected, never silently merged. Objective gate commands
  (build / test / lint) run in the task's worktree and can block a merge even
  after a human approves.
- **Local-first and auditable.** A broad MCP control plane (terminal, mux,
  worktree, fleet, task graph, events, ownership, review, merge — over JSON-RPC), an event/audit trail, and risk classification
  around shell, file, and AI-CLI actions. It runs on your machine — not a hosted
  dashboard.

## What's here today

**Agent coordination**
- Visible multi-agent fleet, per-agent worktrees, role-routed dispatch
  (implementer / tester / reviewer) with deterministic branch names.
- File- and symbol-level ownership leasing with automatic conflict serialization.
- Worktree diff review, mechanical pre-merge gates, and commit-bound merge.
- A broad MCP surface and an event/audit timeline.

**Terminal & workspace**
- Native, Rust-backed terminal (ConPTY) with Rust-owned input, clipboard, and IME,
  true split panes, and a session/scrollback substrate.
- Monaco editor with Vim mode, file tree, search, Git and worktree tooling, and a
  pull-request inspector.

## Honest limits (today)

- Aelyris orchestrates existing coding-agent CLIs; it doesn't replace your IDE or
  the agents themselves.
- Conflict-awareness applies to orchestrated lanes — arbitrary manual git outside
  Aelyris's flow can still bypass it.
- Editor intelligence is partial (completion and hover; go-to-definition,
  diagnostics, and references are not in yet).
- Full session restore across restarts, native-rendering polish, and
  signing/updater are still being hardened.
- Windows-first.

## Roadmap

- End-to-end session restore across restarts (detach/reattach substrate exists
  today).
- Native visual quality: advanced text shaping and font fallback.
- LSP go-to-definition, diagnostics, and references.
- Broader parallel dispatch into the central pane tree.

## Tech stack

- Tauri v2 — Rust backend, WebView2 frontend
- Rust: Tokio, portable-pty, git2, rusqlite
- Native, Rust-backed terminal rendering (ConPTY; no xterm.js)
- React 19, TypeScript, Vite 7
- Monaco editor with Vim mode
- Radix UI primitives, Lucide icons, CSS Modules

## Requirements

- Windows 11 recommended (Windows 10 runs with reduced visuals)
- Rust toolchain
- Node.js 24+, pnpm 10+
- WebView2 runtime

## Development

```powershell
pnpm install
pnpm tauri dev
```

The first Rust/Tauri build can be slow, especially after cleaning Cargo `target`
directories.

## Build

```powershell
pnpm build
pnpm tauri:build:dist
```

## Verification

Aelyris keeps its claims honest by backing them with runnable verifiers. Useful
non-token checks:

```powershell
pnpm verify:release:hygiene
pnpm verify:requirements-spec-design-traceability
pnpm verify:quality-score
```

Token-spending AI prompt validation is opt-in only and never runs without
explicit operator consent.

## Documentation

- Documentation guide: `docs/README.md`
- Introduction: `docs/GITHUB_INTRODUCTION.md`
- Contributor workflow: `docs/AGENT_WORKFLOWS.md`
- Publication readiness: `docs/PUBLICATION_READINESS.md`
- Requirements & claim policy: `docs/requirements.md`
- Visible-agent runtime boundary: `docs/specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md`

## Repository hygiene

Generated local artifacts are intentionally ignored (`node_modules/`, `dist/`,
`src-tauri/target/`, build output, signing material, local `.env` files). Do not
commit secrets, tokens, or generated artifacts.

## Contributing

Aelyris moves quickly. Before opening a change, read `AGENTS.md` and
`CONTRIBUTING.md`, keep requirements / implementation / verifier artifacts
aligned, and don't introduce a claim that its matching gate doesn't yet support.

## Security

Please don't open a public issue for a suspected vulnerability before it's been
triaged — see `SECURITY.md`.

## License

MIT. See `LICENSE`.
