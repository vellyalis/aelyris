**English** | [日本語](README.ja.md)

# Aelyris

![AI coding agents working in parallel inside Aelyris's visible split panes — four interactive agent CLIs coordinating on separate tasks alongside a shell, with the project file tree on the left and the orchestrator rail on the right](docs/assets/hero-fleet.png)

**A project-first AI development workspace for Windows.** Run many AI coding
agents in parallel — each in its own visible terminal pane — and ship their work
safely through worktree isolation, function-level conflict avoidance, and
auditable review/merge gates.

> **Alpha — active development, not yet stable for release.** Every readiness
> claim is backed by a verifier you can run yourself. Expect rough edges; APIs
> are moving.

## Why now

AI has made writing code the easy part. A new wave of builders — many of them not
career engineers — can now describe what they want and have an agent write it.
The hard part has moved: it is no longer *writing* the code, it is **orchestrating
many AI coding agents at once without them stepping on each other — and trusting
what they produced enough to ship it.**

Run several agents at one repository the naive way and it turns into chaos: they
edit the same files, overwrite each other, and you can't tell who changed what.
A common failure mode is tooling that either runs one agent at a time, or fans
agents out *invisibly* as hidden background jobs — which is exactly what a
non-engineer can't supervise and an engineer can't debug.

Aelyris is the layer that makes parallel AI development **visible, coordinated,
and reviewable** — so the work is easy to watch and check rather than blindly
trusted, and an engineer never has to hand-wire the plumbing while a
non-engineer never has to learn it.

## What it does today

These are real, shipped capabilities. The single strong factual claim Aelyris
makes is that it has a Rust/Tauri terminal, mux, sidecar, visible-agent, MCP,
worktree, ownership, review, and merge substrate — each item below is part of
that substrate and backed by a runnable verifier.

### One pane = one agent (visible, not hidden)

Each agent runs as a **real, interactive AI CLI in its own visible terminal
pane** — not as an opaque background "subagent" you can't see. This is the core
design choice, and it pays off four ways:

- **Observability** — you watch the actual session scroll by, exactly as the
  agent sees it.
- **Steering** — you can redirect a *running* agent mid-flight (e.g. away from
  specific files) instead of waiting for a black box to finish.
- **Trust** — you ship work you actually watched happen, not output a hidden
  swarm asserts is fine.
- **Debuggability** — when something goes wrong, the real terminal session *is*
  the log.

When you launch an agent against a named branch, it gets its **own git
worktree**, so those parallel agents never share a working tree.

### Function-level conflict avoidance ("shared brain")

Many agents can work the **same codebase in parallel without clobbering each
other**, because ownership is tracked not just per file but **per symbol (down to
the function)**:

- Claims/locks carry an inclusive line range with a **lease** (a crashed agent's
  claims self-release) and a **confidence tier** — exact ranges are parser-backed
  today (a tree-sitter parse) and hard-block on overlap; inferred diff-hunk ranges
  only warn. An LSP-backed exact tier is planned but not yet wired.
- Orchestrated lanes are conflict-aware: **disjoint symbols run in parallel;
  overlapping work is serialized automatically.** Two agents may edit the *same
  file* as long as they own different functions.
- A code knowledge-graph core answers "if this module changes, what's the blast
  radius?" (the transitive set of dependent modules), so coordination reasons
  about structure, not just filenames. The indexer is module-level today;
  symbol-level impact is a planned refinement.

### Auditable review and commit-bound merge

Nothing reaches your main branch unsupervised:

- Worktree diff review plus **mechanical pre-merge gates** — objective
  build / test / lint commands run in the task's worktree and can block a merge
  *even after a human approves*.
- An approval is **bound to the exact commit** it was granted against. The git
  update uses an old-OID compare-and-swap, so a branch tip that moved underneath
  is rejected, never silently merged.

### Persistent terminal & workspace substrate

- **Native, Rust-backed terminal** (ConPTY) with Rust-owned input, clipboard, and
  IME; true split panes; and a **session/scrollback substrate** with a
  detach/reattach path — the foundation for not losing long-running parallel work
  across restarts.
- A broad **MCP control plane** over JSON-RPC (terminal, mux, worktree, fleet,
  task graph, events, ownership, review, merge), an **event/audit trail**, and
  **risk classification** around shell, file, and AI-CLI actions.
- Monaco editor with Vim mode, file tree, search, Git and worktree tooling, and a
  pull-request inspector.

It is **local-first**: this runs on your machine, not a hosted dashboard.

### Who this is for

- **Engineers** get fast, safe parallel agent development without hand-wiring
  worktrees, locks, gates, and audit — the low-level plumbing is bundled.
- **Non-engineers** (the "vibe coding" wave) get the same plumbing as
  **guardrails**: the review/merge gates, audit trail, and function-level
  conflict avoidance are the safety net that helps make work visible and
  reviewable for someone who *can't* self-review — a safety net, not a
  safe-to-ship guarantee.

## What is coming next

The items below are a **roadmap of planned work**, not shipped capabilities. They
are tracked under the same verifier discipline as everything else, and each is
labeled *planned* on purpose to keep the line between done and intended clear.

**Symbol intelligence (planned)**

- **LSP-backed exact symbol extraction** — extraction today is parser/tree-sitter
  based; a planned LSP `documentSymbol` tier would give exact symbol boundaries.
- **Symbol-level knowledge-graph blast-radius** — impact analysis is module-level
  today; per-symbol blast-radius is planned.
- **LSP go-to-definition, diagnostics, and find-references** — editor intelligence
  is currently partial (completion and hover only); these are planned.

**Shared brain and session state (planned)**

- **Live shared-brain population from real repo sources** — the knowledge-graph
  and impact-analysis core exists and is unit-tested; live indexing from real
  repo sources is planned.
- **Full session and scrollback restore across restart** — the detach/reattach
  substrate exists today; full live restore is planned.

**Coordination and ownership (planned)**

- **Typed intent bus and richer agent steering** — planned local agent messaging
  and steering controls.
- **Claim persistence and a conflict / parallel-safe badge in the UI** — planned
  durability for ownership claims plus a visible parallel-safety indicator.
- **Ownership auto-refresh via a file watcher** — planned automatic refresh of
  ownership state as files change.

**Native visuals (planned)**

- **Native text shaping (ligatures) and a real window transparency slider** —
  planned visual-quality work.

These are the planned next layers toward the foundational layer described below —
each one gated behind a verifier before it becomes a claim.

## Where this is going (the goal)

This is a **goal**, framed as a goal, not a current claim.

Aelyris aims to become a **foundational layer** that sits *above* the classic,
hand-configured world of terminal multiplexing and ad-hoc agent orchestration —
so running many AI agents in parallel, at high speed, with built-in
safety/review, becomes the default rather than something you assemble yourself.
The vision is a calm, inspectable cockpit where one agent implements, another
tests, another reviews, and the human keeps the final judgment — with the
plumbing (persistent multiplexed terminals, governance, audit, worktrees, merge
gates) bundled underneath so neither an engineer nor a non-engineer has to think
about it.

We keep that ambition honest the same way we keep everything else honest: by
gating each claim behind a verifier you can run, and by clearly separating what
ships today from what is still ahead.

## Honest limits (today)

- Aelyris **orchestrates existing coding-agent CLIs**; it doesn't replace your
  IDE or the agents themselves.
- Conflict avoidance applies to **orchestrated lanes** — arbitrary manual git
  outside Aelyris's flow can still bypass it.
- Editor intelligence is partial (completion and hover; go-to-definition,
  diagnostics, and references are not in yet).
- Full session restore across restarts, native-rendering polish, and
  signing/updater are still being hardened.
- Windows-first.

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
pnpm verify:goal:safe
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
