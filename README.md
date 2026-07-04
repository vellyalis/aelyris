**English** | [日本語](README.ja.md)

# Aelyris

![AI coding agents working in parallel inside Aelyris's visible split panes — four interactive agent CLIs coordinating on separate tasks alongside a shell, with the project file tree on the left and the orchestrator rail on the right](docs/assets/hero-fleet.png)

**Mission control for a fleet of AI coding agents — on your own machine.**
Aelyris runs many coding agents in parallel: each one lives in its own
**visible terminal pane**, works on its own **git worktree**, is coordinated
down to the **function level**, and reaches your main branch only through
**commit-bound, auditable merge gates**. The terminal, the multiplexer, and
the agent control plane underneath are not wrappers around existing tools —
they are written from scratch in Rust for exactly this job.

> **Alpha — active development, not yet stable for release.** One discipline
> shapes everything here: **a capability is not claimed until a verifier you
> can run yourself proves it.** This README separates *shipped* from *planned*
> on purpose, and the bigger product claims stay blocked behind gates (live
> durability, restart/replay, native visual quality, signing/updater, external
> operator validation) until those gates go green.

## At a glance

| Pillar | What you get | Status |
| --- | --- | --- |
| **One pane = one agent** | Every agent is a real, interactive AI CLI in a visible terminal pane — watch it scroll, steer it mid-run, debug from the actual session | Shipped |
| **A multiplexer rebuilt for a fleet** | Panes, splits, a real layout engine, sessions that can outlive the app — written from scratch in Rust for many long-running, supervised agents | Shipped |
| **Function-level conflict avoidance** | Ownership is tracked per symbol: agents owning disjoint functions run in parallel; overlapping work serializes automatically | Shipped (parser-backed; LSP tier planned) |
| **Commit-bound review & merge** | Approval binds to the exact commit (old-OID compare-and-swap); mechanical build/test/lint gates can block a merge even after a human approves | Shipped |
| **One capability surface, two faces** | The cockpit UI and a 60+ verb typed MCP control plane drive the same core — drift-tested, governed, audit-trailed | Shipped |

Every row names an architectural property with a runnable check behind it —
see [Verification](#verification).

Current machine truth, refreshed 2026-07-04 JST: `pnpm verify:quality-score`
currently reports `94/100` (`329/351`), grade `A`,
`releaseCandidateReady=false`; after the final-goal evidence-map refresh the
projected score is `94/100` (`329/351`), still
`releaseCandidateReady=false`. The final-goal audit is
`blocked-by-external-gates` with `implementationFixableCount=0`,
`policyBlockedCount=0`, and `externalBlockedCount=8`; Aelyris remains alpha
and not release-ready.

## Why now

AI made writing code the easy part. The bottleneck has moved: it is no longer
*writing* the code, it is **running many coding agents at once without them
stepping on each other — and trusting what they produced enough to ship it.**

Point several agents at one repository the naive way and you get chaos: the
same files edited twice, work silently overwritten, no record of who changed
what. The common answers are worse than the problem — run one agent at a time,
or fan agents out as *invisible* background jobs, which is exactly what a
non-engineer can't supervise and an engineer can't debug.

Aelyris takes a different position: parallel AI development should be
**visible, coordinated, and reviewable by construction**. Work you can watch
and check, not work you have to blindly trust — with the plumbing bundled so
an engineer never hand-wires it and a non-engineer never has to learn it.

## Naming

- Product: **Aelyris**, read as **Aelys** (エイリス).
- CLI / short name: `aelys`.
- Feature families: **Aelyris Core**, **Aelyris Grid**, **Aelyris Pane**.
- Coordination engine: **Qralis**.

## What it does today

These are real, shipped capabilities. The single strong factual claim Aelyris
makes is that it has a working Rust/Tauri terminal, mux, sidecar,
visible-agent, MCP, worktree, ownership, review, and merge substrate — each
section below is part of that substrate and backed by a runnable verifier.

### One pane = one agent (visible, not hidden)

Each agent runs as a **real, interactive AI CLI in its own visible terminal
pane** — not as an opaque background "subagent" you can't see. This is the
core design choice, and it pays off four ways:

- **Observability** — you watch the actual session scroll by, exactly as the
  agent sees it.
- **Steering** — you can redirect a *running* agent mid-flight (e.g. away from
  specific files) instead of waiting for a black box to finish.
- **Trust** — you ship work you actually watched happen, not output a hidden
  swarm asserts is fine.
- **Debuggability** — when something goes wrong, the real terminal session
  *is* the log.

When you launch an agent against a named branch, it gets its **own git
worktree**, so parallel agents never share a working tree.

### A native terminal multiplexer, rebuilt for a fleet

The terminal layer is **not a wrapper around an existing multiplexer** —
panes, splits, persistent sessions, and the layout model are written from
scratch in Rust, designed from the start for many long-running, supervised
agents rather than one person at a keyboard:

- **A real layout engine** — a workspace → window → tab → pane graph over a
  binary split tree: split, close, swap, move, rotate, zoom, balanced tiling,
  even/equalize, synchronized input across panes, plus
  break-a-pane-to-its-own-tab and join-back.
- **A prefix-key binding engine** — a familiar "one prefix chord, then a
  command key" model that resolves into pane and window commands, with
  rebindable, conflict-checked bindings (execution is wired in the UI).
- **Sessions that can outlive the app** — long-running terminals can be hosted
  by an out-of-process daemon kept deliberately outside the app's
  kill-on-close job, so it survives an app restart (or crash) and is
  re-adopted on the next launch. The in-process path rebuilds the **full pane
  layout** from an atomic per-workspace snapshot and backfills **file-backed
  scrollback**, so a restored pane comes back with its history rather than
  blank.
- **Native, no-orphan process ownership** — every pane is a real native
  session (ConPTY on Windows) under Rust-owned input, clipboard, and IME, and
  every spawned child is placed in a kill-on-close job so an agent CLI can
  never be left orphaned.

This is the substrate the visible panes live in — a multiplexer whose design
choices (durable sessions, structured layout state, no orphaned processes)
only make sense if you assume persistent, observed, parallel work.

### Function-level conflict avoidance ("shared brain")

Many agents can work the **same codebase in parallel without clobbering each
other**, because ownership is tracked not just per file but **per symbol
(down to the function)**:

- A claim carries an inclusive line range, a **lease** (a crashed agent's
  claims self-release), and a **confidence tier**: parser-backed exact ranges
  hard-block on overlap, while inferred diff-hunk ranges only warn.
- Orchestrated lanes are conflict-aware: **disjoint symbols run in parallel;
  overlapping work is serialized automatically.** Two agents may edit the
  *same file* as long as they own different functions.
- A code knowledge-graph core answers "if this module changes, what's the
  blast radius?" (the transitive set of dependent modules), so coordination
  reasons about structure, not just filenames.

*Today:* exact ranges are tree-sitter parser-backed and impact analysis is
module-level. *Planned:* an LSP-backed exact tier and symbol-level blast
radius.

### Auditable review and commit-bound merge

Nothing reaches your main branch unsupervised:

- Worktree diff review plus **mechanical pre-merge gates** — objective
  build / test / lint commands run in the task's worktree and can block a
  merge *even after a human approves*.
- An approval is **bound to the exact commit** it was granted against. The git
  update uses an old-OID compare-and-swap, so a branch tip that moved
  underneath is rejected, never silently merged.

### One capability surface, two faces

Everything Aelyris can do lives in **one backend capability layer** with two
faces over it: the **cockpit UI** a human drives, and a **JSON-RPC (MCP)
control plane** an orchestrating AI — or a plain script — drives. Both talk to
the same core, so what you can do by hand and what an agent can do by call
stay in lockstep, against structured state rather than scraped terminal text.

The control plane is **60+ typed verbs**, each wired to a real backend
module — a drift test asserts the catalog and the JSON schemas list the
*identical* set, and any verb without a handler is rejected at dispatch, so
nothing is advertised that isn't implemented. The surface spans:

- **Terminal & multiplexer** — list sessions, capture bounded scrollback, read
  the workspace graph, send guarded input to live panes.
- **Worktree & fleet** — validate / create / remove git worktrees; route,
  spawn, stop, and steer agents; read live fleet status.
- **Coordination** — file- and **symbol-level** ownership (claim / refresh /
  release, with conflicts), a **knowledge-graph blast-radius** query, a shared
  project-decision (ADR) store, a typed **intent bus**, and a no-loss **event
  stream** that survives restart.
- **Review & merge** — request approval, list pending decisions, and a
  **durable, commit-bound merge intent** whose approval call takes *only* an
  intent id, so it can never be re-pointed at a different repo or branch.
- **Shared-brain snapshot** — one call returns the whole picture: live agents,
  activity, ownership, unresolved merges, blockers, and project decisions.

Every verb passes through a single **governance authorization** choke point
(today a local single-operator allow-all seam an enterprise build can swap for
RBAC without touching a handler), privileged actions are **risk-classified**
around shell and file commands — including the input an agent CLI receives —
and the whole stream lands in an **event/audit trail**.

Around all of this sits the rest of the workspace: a Monaco editor with Vim
mode, a file tree, search, Git and worktree tooling, and a pull-request
inspector.

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

The items below are a **roadmap of planned work**, not shipped capabilities.
They are tracked under the same verifier discipline as everything else, and
each is labeled *planned* on purpose to keep the line between done and
intended clear.

**Symbol intelligence (planned)**

- **LSP-backed exact symbol extraction** — extraction today is
  parser/tree-sitter based; a planned LSP `documentSymbol` tier would give
  exact symbol boundaries.
- **Symbol-level knowledge-graph blast-radius** — impact analysis is
  module-level today; per-symbol blast-radius is planned.
- **LSP go-to-definition, diagnostics, and find-references** — editor
  intelligence is currently partial (completion and hover only); these are
  planned.

**Shared brain and session state (planned)**

- **Live shared-brain population from real repo sources** — the
  knowledge-graph and impact-analysis core exists and is unit-tested; live
  indexing from real repo sources is planned.
- **Full session and scrollback restore across restart** — the
  detach/reattach substrate exists today; full live restore is planned.

**Coordination and ownership (planned)**

- **Richer agent messaging and steering** — deeper steering controls layered
  on top of the existing typed intent bus.
- **Claim persistence and a conflict / parallel-safe badge in the UI** —
  planned durability for ownership claims plus a visible parallel-safety
  indicator.
- **Ownership auto-refresh via a file watcher** — planned automatic refresh of
  ownership state as files change.

**Native visuals (planned)**

- **Native text shaping (ligatures) and a real window transparency slider** —
  planned visual-quality work.

These are the planned next layers toward the foundational layer described
below — each one gated behind a verifier before it becomes a claim.

## Where this is going (the goal)

This is a **goal**, framed as a goal, not a current claim.

Aelyris aims to become a **foundational layer** that sits *above* the classic,
hand-configured world of terminal multiplexing and ad-hoc agent
orchestration — so running many AI agents in parallel, at high speed, with
built-in safety/review, becomes the default rather than something you assemble
yourself. The bet underneath it: agent coordination shouldn't be a layer of
scripts scraping a tool built for one person at a keyboard — it should be the
substrate itself. The vision is a calm, inspectable cockpit where one agent
implements, another tests, another reviews, and the human keeps the final
judgment — with the plumbing (persistent multiplexed terminals, governance,
audit, worktrees, merge gates) bundled underneath so neither an engineer nor a
non-engineer has to think about it.

We keep that ambition honest the same way we keep everything else honest: by
gating each claim behind a verifier you can run, and by clearly separating
what ships today from what is still ahead.

## Honest limits (today)

These are deliberate publication-readiness boundaries, not hidden footnotes:

- Aelyris **orchestrates existing coding-agent CLIs**; it doesn't replace your
  IDE or the agents themselves.
- Conflict avoidance applies to **orchestrated lanes** — arbitrary manual git
  outside Aelyris's flow can still bypass it.
- Editor intelligence is partial (completion and hover; go-to-definition,
  diagnostics, and references are not in yet).
- No stable public release yet; the package stays `"private": true` with no
  npm publication intended.
- Full session durability, live shared-brain population, and native-quality
  terminal claims remain blocked behind their gates (live restore /
  restart / replay proof, native visual regression, real-machine
  sleep/resume evidence).
- Some live verification needs WebView2/CDP access, real Windows
  sleep/resume, and host process policies not available in every development
  sandbox.
- Authenticated AI-CLI prompt smoke tests can spend tokens and never run
  without explicit operator consent.
- Release signing / updater artifacts are operator-owned and not produced by
  default.
- Windows-first.

## Tech stack

- Tauri v2 — Rust backend, WebView2 frontend
- Rust: Tokio, portable-pty, git2, rusqlite
- Native, Rust-backed terminal rendering (ConPTY; Rust-owned input, clipboard,
  and IME — no xterm.js)
- React 19, TypeScript, Vite 7
- Monaco editor with Vim mode
- Radix UI primitives, Lucide icons, CSS Modules
- Mica/Acrylic window styling on Windows 11

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

The first Rust/Tauri build can be slow, especially after cleaning Cargo
`target` directories.

## Build

```powershell
pnpm build
pnpm tauri:build:dist
```

## Verification

Aelyris keeps its claims honest by backing them with runnable verifiers.
Useful non-token checks:

```powershell
pnpm verify:release:hygiene
pnpm verify:requirements-spec-design-traceability
pnpm verify:quality-score
pnpm verify:goal:safe
```

Claim gates:

```powershell
pnpm verify:mux-durability-contract
pnpm verify:visible-agent-pane-binding
pnpm verify:terminal:native-boundary
```

Token-spending AI prompt validation is opt-in only and never runs without
explicit operator consent:

```powershell
pnpm verify:terminal:authenticated-ai-cli-consent-packet
```

## Documentation

- Documentation guide: `docs/README.md`
- Introduction: `docs/GITHUB_INTRODUCTION.md`
- Contributor workflow: `docs/AGENT_WORKFLOWS.md`
- Publication readiness: `docs/PUBLICATION_READINESS.md`
- Requirements & claim policy: `docs/requirements.md`
- Spec index: `docs/specs/README.md`
- Visible-agent runtime boundary: `docs/specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md`

## Repository hygiene

Generated local artifacts are intentionally ignored (`node_modules/`, `dist/`,
`src-tauri/target/`, build output, signing material, local `.env` files). Do
not commit secrets, tokens, or generated artifacts.

## Contributing

Aelyris moves quickly. Before opening a change, read `AGENTS.md` and
`CONTRIBUTING.md`, keep requirements / implementation / verifier artifacts
aligned, and don't introduce a claim that its matching gate doesn't yet
support.

## Security

Please don't open a public issue for a suspected vulnerability before it's
been triaged — see `SECURITY.md`.

## License

MIT. See `LICENSE`.
