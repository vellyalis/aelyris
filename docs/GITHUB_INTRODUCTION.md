# GitHub Introduction Draft

This is a public-facing introduction draft for the project. It uses **Aelyris**
as the product name. Aelyris is pronounced **Aelys** / **エイリス**. The CLI and
short name is **aelys**. Product surfaces use **Aelyris Core**, **Aelyris Grid**,
and **Aelyris Pane**. The coordination engine is **Qralis**.

Use this text for the GitHub repository page, README opening section, social
preview copy, or a launch post. Before publishing, confirm name availability and
keep the current release status aligned with `docs/PUBLICATION_READINESS.md`.

## Short GitHub Description

Aelyris is a Windows-first AI development workspace for coordinating agents,
terminals, tasks, reviews, and evidence around one project.

## Tagline Options

- Project-first AI development workspace for Windows.
- A calm cockpit for multi-agent development.
- Bring agents, terminals, and review into one shared workspace.

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

Aelyris is a Windows-first development workspace for people who want to work
with AI agents without losing sight of the project.

It brings terminals, agent sessions, task lanes, Git worktrees, review flows,
and verification evidence into one place. Instead of treating each AI agent as a
separate chat window or a hidden background job, Aelyris is designed to make the
work visible: what each agent is doing, where it is working, what changed, what
needs review, and what proof exists.

The long-term goal is a calm, inspectable cockpit for multi-agent development.
One agent can implement, another can test, another can review, while the human
operator keeps the final judgment. Aelyris is not here to replace that judgment.
It is here to make parallel AI work easier to guide, easier to trust, and easier
to clean up before it reaches the main branch.

The project is still in active development. The current codebase already has a
real Rust/Tauri terminal foundation, visible agent paths, worktree-aware project
tools, orchestration contracts, review surfaces, and local verification gates.
Release-level claims are intentionally guarded by verifier output, so the public
story can stay honest as the product matures.

## Japanese Introduction

Aelyris（エイリス）は、AI エージェントと人が同じプロジェクトを見ながら作業する
ための Windows 向け開発ワークスペースです。

ターミナル、エージェントのセッション、作業レーン、Git worktree、レビュー、
検証の証跡をひとつの場所に集めます。AI を別々のチャットや見えない裏側の処理
として動かすのではなく、誰が何をしているのか、どのファイルに触れているのか、
何が検証済みなのかを見える形にすることを目指しています。

Aelyris という名前は、air、astral、iris、Elysian のような響きを少しずつ
残した造語です。軽さ、天体感、光、視界、そして AI らしい操作面を感じられる
名前として選んでいます。

**Qralis** は協調エンジン名です。実装する AI、テストする AI、レビューする AI が
役割を分担し、最後の判断は人間が持つ。Qralis はその役割、メッセージ、ペイン、
レビュー、証跡をつなぐ層です。Aelyris はワークスペース、Qralis はその中の協調
ロジックです。

このプロジェクトは現在も開発中です。Rust/Tauri ベースのターミナル、見える
エージェント実行、worktree を意識したプロジェクト操作、オーケストレーション、
レビュー、ローカル検証ゲートの土台はあります。一方で、リリース品質などの
大きな主張は、検証コマンドと証跡で確認できる状態になるまで控えめに扱います。
Aelyris はアルファであり、製品としての完成は主張しません。

## README Opening Variant

```markdown
# Aelyris

Aelyris is a Windows-first AI development workspace for coordinating agents,
terminals, tasks, reviews, and evidence around one project.

It is built for a workflow where multiple AI agents can work in visible lanes:
one implementing, one testing, one reviewing, and the human operator keeping the
final call. Aelyris brings the terminal, project context, Git worktrees, review
surfaces, and verification gates into one calm cockpit, so parallel AI work stays
inspectable instead of becoming scattered background activity.

The project is in active development. The current codebase includes a real
Rust/Tauri terminal foundation, visible agent paths, orchestration contracts,
worktree-aware tooling, and local release evidence checks. Public release claims
remain gated by verifier output rather than marketing copy.
```

## GitHub About Fields

Description:

```text
Windows-first AI development workspace for coordinating agents, terminals, tasks, reviews, and evidence.
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
- complete AI team OS

Aelyris is alpha and does not claim production readiness; capability claims are
gated by verifiers.
