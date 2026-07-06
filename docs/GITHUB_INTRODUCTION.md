# GitHub Introduction Draft

This is a public-facing introduction draft for the project. It uses **Aelyris**
as the product name. Aelyris is pronounced **Aelys** / **エイリス**. The CLI and
short name is **aelys**. Product surfaces use **Aelyris Core**, **Aelyris Grid**,
and **Aelyris Pane**. The coordination engine is **Qralis**.

Use this text for the GitHub repository page, README opening section, social
preview copy, or a launch post. Before publishing, confirm name availability and
keep the current release status aligned with `docs/PUBLICATION_READINESS.md`.

## Short GitHub Description

Aelyris is mission control for a fleet of AI coding agents on your own
machine: every agent in a visible terminal pane, on its own git worktree,
coordinated down to the function level, merged only through commit-bound,
auditable gates.

## Tagline Options

- Mission control for a fleet of AI coding agents — on your own machine.
- A calm cockpit for parallel, supervised AI development.
- Visible panes, isolated worktrees, function-level coordination, gated merges.

## Why The Name Aelyris

**Aelyris** is a coined name, pronounced **Aelys** / **エイリス**.

The name is meant to feel light, celestial, and technical without sounding like
only a terminal. It carries traces of airy, astral, iris, and Elysian imagery:
space, light, sight, and a clear operating surface. That fits the product's
long-term direction: a workspace where AI agents, panes, tasks, reviews, and
proof are visible instead of hidden behind disconnected chats.

**Qralis** names the coordination engine: the layer that keeps agents, roles,
messages, panes, reviews, and evidence connected. Aelyris is the workspace;
Qralis is the coordination logic inside it.

## Main Introduction

Aelyris is a Windows-first, local-first workspace for running many AI coding
agents in parallel on one real project — without them stepping on each other,
and without hiding their work behind invisible background jobs.

Every agent runs as a real, interactive AI CLI in its own visible terminal
pane, on its own git worktree. Ownership is tracked per symbol, down to the
function: agents owning disjoint functions run in parallel, overlapping work
serializes automatically. Nothing reaches the main branch unsupervised —
approval binds to the exact commit it was granted against, and mechanical
build/test/lint gates can block a merge even after a human approves. The
terminal, the multiplexer, and the agent control plane underneath are written
from scratch in Rust for exactly this job, and everything the cockpit UI can
do is also exposed as a typed MCP control plane with a full audit trail.

The long-term goal is a calm, inspectable cockpit for multi-agent development.
One agent implements, another tests, another reviews, while the human operator
keeps the final judgment. Aelyris is not here to replace that judgment. It is
here to make parallel AI work easier to guide, easier to trust, and easier to
clean up before it ships.

The project is alpha and in active development. One discipline shapes the
public story: a capability is not claimed until a verifier you can run
yourself proves it. Release-level claims stay gated behind verifier output as
the product matures.

## Japanese Introduction

Aelyris（エイリス）は、複数の AI コーディングエージェントを自分のマシンの上で
並列に働かせるための管制室です。Windows ファースト・ローカルファーストで、
ひとつの本物のプロジェクトを相手に、エージェント同士を衝突させず、しかも
その仕事ぶりを隠さず見せることを目的にしています。

エージェントは一体ずつ、目に見えるターミナルペインの中で本物の対話型 AI CLI
として動き、それぞれ専用の git worktree を持ちます。所有権は関数単位で追跡
され、別々の関数を持つエージェントは並列に、重なった作業は自動で直列に
捌かれます。main ブランチには無監督では何も入りません——承認はその時点の
コミットに紐づき、ビルド・テスト・リントの機械ゲートは人間が承認した後でも
マージを止められます。土台のターミナルとマルチプレクサ、エージェント制御
プレーンは、この用途のために Rust でゼロから書いたものです。

Aelyris という名前は、air、astral、iris、Elysian のような響きを少しずつ
残した造語です。軽さ、天体感、光、視界、そして澄んだ操作面を感じられる
名前として選びました。**Qralis** は協調エンジンの名前です。実装する AI、
テストする AI、レビューする AI が役割を分担し、最後の判断は人間が持つ——
Qralis はその役割・メッセージ・ペイン・レビュー・証跡をつなぐ層で、
Aelyris がワークスペース、Qralis がその中の協調ロジックにあたります。

プロジェクトはアルファ版で、開発は現在進行形です。方針はひとつだけ徹底して
います——自分の手で実行できる verifier が証明するまで、その機能は「ある」と
言わない。リリース品質のような大きな主張は、検証コマンドと証跡が揃うまで
主張しません。

## README Opening Variant

```markdown
# Aelyris

Mission control for a fleet of AI coding agents — on your own machine.
Aelyris runs many coding agents in parallel: each one lives in its own visible
terminal pane, works on its own git worktree, is coordinated down to the
function level, and reaches your main branch only through commit-bound,
auditable merge gates.

It is built for a workflow where one agent implements, one tests, one reviews,
and the human operator keeps the final call — with the plumbing (persistent
multiplexed terminals, governance, audit, worktrees, merge gates) bundled
underneath so parallel AI work stays inspectable instead of becoming scattered
background activity.

The project is alpha and in active development. A capability is not claimed
until a verifier you can run yourself proves it; public release claims remain
gated by verifier output rather than marketing copy.
```

## GitHub About Fields

Description:

```text
Mission control for a fleet of AI coding agents: visible panes, isolated git worktrees, function-level coordination, commit-bound merge gates. Windows-first, local-first.
```

Website:

```text
Leave blank until a stable project page exists.
```

Topics:

```text
tauri, rust, react, typescript, terminal, ai-agents, multi-agent, developer-tools, windows, worktree, mcp
```

## Claim Boundaries

Good public wording:

- AI development workspace
- multi-agent development cockpit
- visible AI-agent lanes
- project-first terminal workspace
- review and verification oriented
- alpha / active development

Avoid until the matching gates are green:

- release-ready / production-ready
- fully autonomous swarm intelligence
- completed autonomous multi-agent platform

Aelyris is alpha and does not claim production readiness; capability claims are
gated by verifiers.
