# GitHub Introduction Draft

This is a public-facing introduction draft for the project. It assumes **Astra**
as the public product-name candidate, while the repository may still contain
older Aether Terminal naming during the transition.

Use this text for the GitHub repository page, README opening section, social
preview copy, or a launch post. Before publishing, confirm name availability and
keep the current release status aligned with `docs/PUBLICATION_READINESS.md`.

## Short GitHub Description

Astra is a Windows-first AI development workspace for coordinating agents,
terminals, tasks, reviews, and evidence around one project.

## Tagline Options

- Where AI agents align.
- A calm cockpit for multi-agent development.
- Bring agents, terminals, and review into one shared workspace.

## Why The Name Astra

**Astra** suggests a constellation.

A single star is beautiful, but a constellation becomes meaningful when the
points are connected. Astra carries that idea into software work: each AI agent
can take a different role, while the workspace helps their work stay connected
through shared context, visible progress, review, and evidence.

The name also keeps the product from sounding like only a terminal. Astra can
still include a serious terminal foundation, but the bigger promise is a place
where human judgment and multiple AI agents can move together without losing
track of what changed, why it changed, and whether it was actually checked.

## Main Introduction

Astra is a Windows-first development workspace for people who want to work with
AI agents without losing sight of the project.

It brings terminals, agent sessions, task lanes, Git worktrees, review flows,
and verification evidence into one place. Instead of treating each AI agent as a
separate chat window or a hidden background job, Astra is designed to make the
work visible: what each agent is doing, where it is working, what changed, what
needs review, and what proof exists.

The long-term goal is a calm, inspectable cockpit for multi-agent development.
One agent can implement, another can test, another can review, while the human
operator keeps the final judgment. Astra is not here to replace that judgment.
It is here to make parallel AI work easier to guide, easier to trust, and easier
to clean up before it reaches the main branch.

The project is still in active development. The current codebase already has a
real Rust/Tauri terminal foundation, visible agent paths, worktree-aware project
tools, orchestration contracts, review surfaces, and local verification gates.
Release-level claims are intentionally guarded by verifier output, so the public
story can stay honest as the product matures.

## Japanese Introduction

Astra は、AI エージェントと人が同じプロジェクトを見ながら作業するための
Windows 向け開発ワークスペースです。

ターミナル、エージェントのセッション、作業レーン、Git worktree、レビュー、
検証の証跡をひとつの場所に集めます。AI を別々のチャットや見えない裏側の処理
として動かすのではなく、誰が何をしているのか、どのファイルに触れているのか、
何が検証済みなのかを見える形にすることを目指しています。

Astra という名前には、星座のように「点と点がつながって意味を持つ」という感覚
を込めています。ひとつの AI だけではなく、実装する AI、テストする AI、レビュー
する AI、そして最後に判断する人間が、同じ方向を見ながら進めるための場所です。

Astra は人間の判断を置き換える道具ではありません。複数の AI の力を整理し、導
き、信頼できる形で使うための作業空間です。並列に進む作業を見えるようにし、レ
ビューしやすくし、main ブランチに入る前にきちんと整えられることを大切にしてい
ます。

このプロジェクトは現在も開発中です。Rust/Tauri ベースのターミナル、見える
エージェント実行、worktree を意識したプロジェクト操作、オーケストレーション、
レビュー、ローカル検証ゲートの土台はあります。一方で、リリース品質や
world-class といった大きな主張は、検証コマンドと証跡で確認できる状態になるま
で控えめに扱います。

## README Opening Variant

```markdown
# Astra

Astra is a Windows-first AI development workspace for coordinating agents,
terminals, tasks, reviews, and evidence around one project.

It is built for a workflow where multiple AI agents can work in visible lanes:
one implementing, one testing, one reviewing, and the human operator keeping the
final call. Astra brings the terminal, project context, Git worktrees, review
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

- release-ready
- fully autonomous swarm intelligence
- complete AI team OS
- tmux replacement
- Ghostty-class or WezTerm-class terminal
- BridgeSpace-plus complete
- world-class terminal AI OS

