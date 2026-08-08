# GitHub Introduction Copy

Aelyris is pronounced **Aelys** / **エイリス**. The CLI and short name is `aelys`. The coordination engine is **Qralis**.

Use this file as the canonical source for the repository About text, launch copy, and short public introductions. Keep every claim aligned with `README.md`, `README.ja.md`, `docs/requirements.md`, and the current verifier evidence.

## Repository description

```text
Local-first mission control for AI coding agents: visible PTY work, isolated Git worktrees, backend-owned review, exact-OID merge, and immutable completion receipts.
```

## One-line pitch

**Aelyris turns a development Goal into a durable, visible, reviewable Mission — from AI planning and isolated worktrees to exact-OID merge and restart-safe completion evidence.**

## Short introduction

Aelyris is a Windows-first, local-first Mission OS for AI coding agents. Each worker runs as a real interactive CLI in a visible terminal pane and an isolated Git worktree. Planning, TaskGraph state, review, merge authority, immutable completion packets, and restart recovery remain backend-owned.

The verified path is:

```text
Goal → Mission/TaskGraph → visible PTY implementation → fresh gates
     → independent review → exact-OID merge → immutable receipt → restart recovery
```

The human Cockpit and typed MCP/JSON-RPC control plane use the same Rust owners. An AI may request the next operation, but it cannot invent its reviewer verdict, candidate OID, merge token, or completion packet.

Aelyris is alpha and not release-ready. Signing, updater publication, installer lifecycle, real sleep/resume, and selected external certification remain explicit gates.

## Longer introduction

AI made generating code cheap. The difficult part is now coordinating several agents on one real repository without hiding their work, losing ownership, trusting stale test output, or merging the wrong commit.

Aelyris treats that coordination layer as the product:

- one visible terminal pane per agent;
- one isolated Git worktree per orchestrated worker;
- file and symbol ownership with conflict detection;
- durable Mission and TaskGraph state in SQLite;
- fresh mechanical gates and fixed independent review;
- exact candidate binding and old-OID compare-and-swap merge;
- immutable `CompletedWorkPacket` and `MissionCompletionPacket` evidence;
- restart-safe current Mission, bounded history, and completion receipt;
- one Governance and audit boundary shared by the Cockpit and MCP control plane.

The terminal, multiplexer, agent runtime, Mission authority, and evidence path are built for supervised multi-agent development rather than bolted onto invisible background jobs.

Aelyris is provider-neutral. Visible PTY is the current best execution path. OpenCode or another structured runtime is not a dependency and is adopted only if it proves a material advantage without duplicating Aelyris-owned Mission, session, permission, evidence, review, or merge state.

## 日本語の短い紹介

**Aelyris（エイリス）は、AI コーディングエージェントの作業を見える Mission として管理する、Windows ファースト・ローカルファーストの開発管制室です。**

自然言語の Goal から Mission／TaskGraph を作り、各 agent を専用 git worktree と visible PTY で動かし、fresh gate、独立 review、exact-OID merge、不変 completion receipt、再起動後の復元までを 1 本の backend-owned 経路として扱います。

Cockpit UI と MCP／JSON-RPC control plane は同じ Rust owner を使います。AI は操作を要求できますが、review verdict、candidate OID、merge token、completion packet を自分で作ることはできません。

Aelyris は現在アルファ版で、release-ready ではありません。正式署名、updater 公開、installer lifecycle、real sleep/resume、外部 certification は別 gate のままです。

## Tagline options

- Verifiable mission control for AI coding agents.
- Visible agent work. Exact-commit review. Durable completion truth.
- From Goal to exact-OID merge, without hiding the agents.
- A local Mission OS for supervised multi-agent development.

Japanese:

- AI コーディングエージェントのための、検証可能な Mission 管制室。
- 作業は見える。レビューは exact commit。完了は packet で証明する。
- Goal から exact-OID merge まで、AI の仕事を隠さない。

## GitHub About fields

Description:

```text
Local-first mission control for AI coding agents: visible PTY work, isolated Git worktrees, backend-owned review, exact-OID merge, and immutable completion receipts.
```

Website:

```text
Leave blank until a stable public project page exists.
```

Topics:

```text
rust, tauri, ai-agents, agent-orchestration, multi-agent, terminal, developer-tools, git-worktree, mcp, windows, local-first
```

## Social post copy

```text
Aelyris turns a dev Goal into a durable Mission: visible AI terminals, isolated worktrees, fresh gates, independent review, exact-OID merge, immutable completion receipts, and restart recovery. Local-first, Windows-first, alpha.
```

Japanese:

```text
Aelyrisは、開発Goalを耐久的なMissionへ変える。見えるAI端末、隔離worktree、fresh gate、独立review、exact-OID merge、不変receipt、再起動復元までをローカルで一つに。現在alpha。
```

## Claim boundaries

Good public wording:

- alpha / active development;
- local-first Mission OS for AI coding agents;
- visible agent terminals;
- isolated Git worktrees;
- backend-owned review and exact-OID merge;
- immutable packet-backed completion;
- restart-safe current Mission, bounded history, and receipt readback;
- Cockpit and MCP over shared owners.

Do not use until the matching release gates are closed:

- release-ready / production-ready;
- fully autonomous;
- safe-to-ship without operator judgment;
- full provider parity;
- full-native / WebView-free product;
- remote multi-client control;
- completed Mission Time Machine.

Focused proof is not aggregate release readiness. Regenerate current evidence on the exact current HEAD before changing public claims.
