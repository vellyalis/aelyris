# Clauge Source Audit And Good-Parts Plan

Date: 2026-05-27

## Source Snapshot

- Repository: `ansxuman/Clauge`
- Local clone used for this audit: `C:\tmp\Clauge`
- Commit inspected: `1aceff9f014eb997ba5b21eabf93f23c0da2b71c`
- License observed in the source tree: PolyForm Noncommercial 1.0.0

This audit is source-informed, not a visual impression pass. Do not copy Clauge
code into Aether. Use the source to identify product architecture and interaction
patterns that Aether should exceed inside its own terminal-first scope.

The claim being tracked is upper compatibility inside Aether's terminal-first domain.

## What Clauge Actually Does Well

The strongest parts in the inspected source are product structure, not decorative
style:

- `README.md` frames the product as one window for multiple developer workflows:
  Agent, Workspace, REST, SQL, NoSQL, SSH, Explorer, plus History.
- `src/routes/+page.svelte` keeps all mode panels mounted and only toggles
  visibility. That preserves expensive state such as xterm instances, SSH
  handles, SFTP sessions, CodeMirror state, scroll position, and focus.
- `src/lib/components/sidebar/Sidebar.svelte` provides explicit mode identity
  through a compact left rail.
- `src/lib/components/topbar/Topbar.svelte` gives every mode a tab model and
  close semantics with mode-aware cleanup.
- `src/lib/stores/app.ts` persists the last primary mode and keeps per-mode AI
  chat history.
- `src/lib/components/ai/AIPanel.svelte` gives workflow-specific AI prompts and
  tool routing rather than one generic side chat.
- `src/lib/modes/agent/components/AgentNav.svelte` groups agent sessions by
  project and exposes purpose, provider, worktree, context usage, activity, and
  recency.
- `src/lib/modes/workspace/components/WorkspacePanel.svelte` treats boards,
  notes, inbox, and coworkers as first-class workspace surfaces.
- The README positions MCP and local-first persistence as core product
  primitives, not optional decoration.

## Aether Equivalents Already Implemented

Aether has already adopted the useful information architecture while keeping a
different product center of gravity:

- Left mode rail with 8 Aether-specific modes:
  Terminal, Agents, Workspace, Review, Git, Context, History, Settings.
- Center surface remains the terminal/workspace, not a marketing dashboard.
- Right side is presented as `Contextual inspector`, not Mission Control.
- Rust/native owns terminal truth, mux/session graph, pane lifecycle,
  scrollback, command history, recovery, settings data, Command Center data, and
  AI CLI orchestration contracts.
- Native-first proofs cover mode shell, mode rail window, contextual inspector
  window, right-rail demotion readiness, primary shell, accessibility, and
  visual QA.
- Theme customization and Sakura isolation are tested as product constraints,
  not one-off CSS tweaks.

## Gaps Before Claiming Practical Upper Compatibility

Upper compatibility should mean Aether is better at its chosen job: a
terminal-first AI workspace with native-grade terminal trust. It should not mean
copying Clauge's broad REST/SQL/NoSQL/S3 scope before the terminal loop is
excellent.

Remaining gaps to track:

1. Aether needs a real MCP surface.
   Clauge exposes workspace/cards/notes/REST/coworker tools through an MCP
   server. Aether should expose terminal sessions, pane evidence, command
   history, review queue, tasks, context packs, handoff traces, and safe actions
   through Rust-owned MCP tools. A React-only helper is not enough.

2. Workspace mode data must be real product data.
   Notes, task/card state, context packs, review records, and agent handoffs
   should be Rust/SQLite-owned and externally addressable. UI-only task boards
   do not qualify.

3. Mode state preservation must stay explicit.
   Clauge's always-mounted mode panels avoid state loss. Aether must keep the
   equivalent guarantee for terminal panes, inspectors, settings, and workflow
   surfaces, especially after mode switches, split/close, and reload.

4. Per-mode AI needs to be obvious.
   Aether has agent and inspector actions, but the first-minute UX still needs a
   clearer explanation of what Terminal, Agents, Review, Git, Context, and
   History can ask or do.

5. Agent sessions need a tighter identity row.
   Clauge exposes purpose, provider, worktree, context usage, activity, and time
   in the session list. Aether should keep those concepts visible in the right
   inspector and session surfaces without making the rail noisy.

6. Workspace needs to be agent-readable and action-oriented.
   Boards, tasks, notes, review requests, and handoff traces must be clearly
   connected to the running pane or agent session.

7. Cross-mode history must become a core retrieval surface.
   Aether should search commands, pane output, actions, reviews, risks, and
   handoffs from one History mode, with Rust-owned provenance.

8. MCP-ready workspace actions must remain Rust-owned.
   Any external-agent API should expose Aether's own terminal/agent/review data
   contracts instead of React-only UI state.

9. Broad dev-tool modes stay deferred by design.
   REST, SQL, NoSQL, S3, FTP, and similar modes are not the immediate Aether
   edge. Add them only when the terminal-agent-review loop is already
   release-grade and they can be Rust-contract-backed.

## New Acceptance Gates For True Upper Compatibility

Before claiming Aether is practically upper-compatible with Clauge in the
AI-terminal domain, add green proof for these gates:

- `aether.mcp.server.v1`: Rust-owned MCP server exposes terminal, agent,
  workspace, review, context, history, and safe-action tools.
- `aether.workspace.data.v1`: tasks, notes, handoffs, review records, and
  context packs are persisted in SQLite and queryable outside React state.
- `aether.mode-preservation.v1`: switching every mode and reloading preserves
  terminal panes, agent sessions, selected inspector target, review filters,
  context packs, and history cursor.
- `aether.history.search.v1`: one History mode searches command output,
  shell launches, pane actions, reviews, Git/worktree events, and handoffs with
  Rust-owned provenance ids.
- `aether.agent-identity.v1`: every agent session exposes provider, purpose,
  worktree, context usage, auth/install state, binary/profile source, usage
  limits, and guardrail profile.

These gates are the next implementation target after the current
native-first-hybrid implementation audit. They are not satisfied merely by
having a visible right rail.

## Updated Product Target

Aether should beat Clauge for users who live in AI CLIs and terminals:

- native-first terminal hot path;
- tmux/WezTerm-class mux, scrollback, and recovery;
- Codex/Claude/Gemini/OpenCode session orchestration;
- purpose/worktree/context/guardrail identity for each run;
- right inspector that explains next safe action, evidence, recovery, and
  blocker ownership;
- project history and handoff trails that can be queried and replayed;
- local-first, MCP-ready data contracts;
- React/Tauri only for bounded, contract-backed presentation.

The final implementation claim remains:

```powershell
pnpm verify:native-first:audit
```

The Clauge-specific UI/source claim remains:

```powershell
pnpm verify:clauge-ui-refresh
```

Both must stay green before saying the Clauge-inspired product direction is
implemented. Public release readiness still requires the separate
release-operation gates listed in the native-first goal documents.
