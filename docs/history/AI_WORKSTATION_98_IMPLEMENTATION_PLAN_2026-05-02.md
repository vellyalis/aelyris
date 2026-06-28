# Aether Terminal 9.8 Implementation Plan

Date: 2026-05-02
Source audit: `docs/history/AI_WORKSTATION_QUALITY_AUDIT_2026-05-02.md`
Target: **9.8 / 10**

## Goal

Aether Terminal を「AI ワークステーションとして強い」段階から、長時間・複数プロジェクト・複数エージェント・日本語 IME・クラッシュ/スリープ復旧まで任せられる **9.8 点級の実用品質** に引き上げる。

9.8 点の定義は、単に機能数が多いことではない。ユーザーと Codex が常に次を 5 秒以内に判断できる状態を指す。

- 何が動いているか
- 今どこまで進んでいるか
- 何が完了したか
- 何が止まっているか
- なぜ止まったか
- 自動復旧できるか
- 人間判断が必要か
- どのファイル・テスト・リスクに影響したか
- 終わったら誰に、どう報告されるか
- 再起動・リロード・スリープ・回線断後も同じ真実が見えるか

## Score Model

現状監査値: **7.9 / 10**
9.8 到達に必要な上積み: **+1.9**

| Category | Current | Target | Gap | Weight | Main Lever |
| --- | ---: | ---: | ---: | ---: | --- |
| Authoritative operational core | 7.2 | 9.9 | +2.7 | Critical | Event journal, DB snapshots, replay |
| Longrun / dashboard truth | 7.7 | 9.9 | +2.2 | Critical | canonical URL, no flicker, notifications, blocker semantics |
| Terminal / IME | 8.4 | 9.8 | +1.4 | Critical | native IME matrix, blur/paste/AI CLI fixes |
| Pane / tmux model | 7.6 | 9.7 | +2.1 | High | durable sessions, attach/detach, resurrect, roles |
| AI workstation graph | 8.0 | 9.8 | +1.8 | High | unified graph, mission control, context packs |
| Review / SCM | 7.5 | 9.6 | +2.1 | High | risk scoring, test impact, merge readiness |
| UI / design / typography | 7.5 | 9.7 | +2.2 | High | design tokens, density modes, visual QA matrix |
| Resilience / self-heal | 7.7 | 9.8 | +2.1 | High | recovery drills, typed retry, chaos tests |
| Security / permission safety | 7.3 | 9.6 | +2.3 | High | command firewall, approvals, redaction |
| Release / distribution | 8.0 | 9.6 | +1.6 | Medium | signed builds, updater, smoke, rollback |
| Performance | 8.0 est. | 9.6 | +1.6 | Medium | terminal/render/IPC/DB budgets |
| Docs / operations | 8.0 est. | 9.5 | +1.5 | Medium | runbooks, reports, workspace profiles |

## Priority Bands

### P0 - 9.8 の土台。先にやらないと他機能が信用できない

- Authoritative Event Store
- Tauri Event Bus + DB Snapshot E2E
- Longrun dashboard truth
- Blocker taxonomy / retry / self-heal probe
- Completion/final-report notification path
- Terminal IME critical matrix
- No stale dashboard / no dead-active / no surprise task generation

### P1 - AI ワークステーションの中核価値

- True tmux layer
- Unified Workstation Graph
- Context Pack Builder
- Agent Run Graph
- Gantt + Kanban Hybrid
- Review Queue v2
- Process Manager / Live Panes unification
- Mission Control Home

### P2 - プロ品質へ押し上げる面

- Command Risk Firewall
- Workspace Profile System
- Design System Hardening
- Performance Observatory
- Release Doctor
- Human Decision Inbox
- Error boundary and recovery UI

### P3 - 9.8 を安定維持する細部

- Empty-state polish
- Typography rhythm
- Rail pinning and custom ordering
- Keyboard coverage
- Accessibility refinements
- Docs, runbooks, troubleshooting
- Optional advanced GPU / wgpu roadmap continuation

## Execution Gates

9.8 を目指す途中で品質が崩れないよう、フェーズごとにゲートを置く。

| Gate | Expected Score | Must Be True |
| --- | ---: | --- |
| G0 Baseline | 7.9 | 監査・リスク・現行テスト・既知バグが整理されている |
| G1 Truth Kernel | 8.6 | 重要イベントが DB に残り、再起動後に読める |
| G2 Longrun Trust | 8.9 | 進捗・停止理由・完了報告・通知が信用できる |
| G3 Terminal Trust | 9.1 | 日本語 IME / AI CLI / PowerShell の主要バグが再現テスト付きで潰れている |
| G4 Workstation Core | 9.4 | ペイン・エージェント・ファイル・テスト・リスクが一つのグラフで結びつく |
| G5 Pro UX | 9.6 | UI ジャンプ・スクロール戻り・密度崩れ・曖昧な空状態が消えている |
| G6 Release Ready | 9.8 | 配布・復旧・監査・通知・セキュリティ・性能まで運用品質で閉じている |

## Phase 0 - Baseline And Control Plane

Priority: P0
Purpose: これ以降の変更で「何が良くなったか」「何が壊れたか」を測れる状態にする。

### Implementation

- `AGENT_STATE.md`、`.codex-auto/final-report.md`、risk register、監査 docs を現在地として固定する。
- 既知の未解決リスクに ID を振る。
- テストが重すぎる場合の分割方針を決める。
- `pnpm test` の全体タイムアウトを補う focused test list を定義する。
- Visual QA URL と canonical dashboard URL を記録する。
- 現在の dirty worktree を壊さない作業ルールを明文化する。

### Deliverables

- `docs/history/AI_WORKSTATION_98_IMPLEMENTATION_PLAN_2026-05-02.md`
- `docs/history/AI_WORKSTATION_98_PROGRESS.md`
- `.codex-auto/quality-baseline.json`

### Acceptance

- 以後の作業カードが、必ず priority、owner surface、risk、validation を持つ。
- 「完了したが何をやったか分からない」状態を禁止する。

## Phase 1 - Authoritative Event Store

Priority: P0
Score impact: +0.35 to +0.45
Depends on: Phase 0

現状の最大ギャップ。UI 各所が個別の状態を持つ限り、進捗・復旧・監査・再生が不安定になる。ここで Aether の black box recorder を作る。

### Backend Schema

- SQLite に append-only event journal を追加する。
- Event fields:
  - `id`
  - `workspace_id`
  - `thread_id`
  - `session_id`
  - `pane_id`
  - `terminal_id`
  - `agent_id`
  - `workflow_id`
  - `task_id`
  - `correlation_id`
  - `sequence`
  - `kind`
  - `severity`
  - `source`
  - `confidence`
  - `created_at`
  - `payload_json`
  - `redacted_payload_json`
  - `hash`
- Event kinds:
  - terminal input
  - terminal output checkpoint
  - IME composition
  - pane created
  - pane attached
  - pane detached
  - pane closed
  - process spawned
  - process exited
  - process killed
  - agent started
  - agent output
  - agent tool call
  - agent blocked
  - agent completed
  - workflow phase started
  - workflow phase completed
  - workflow gate requested
  - workflow gate decided
  - file changed
  - review item created
  - test started
  - test completed
  - watchdog decision
  - retry scheduled
  - self-heal probe
  - notification delivered
  - notification failed
  - final report written

### Backend APIs

- `append_audit_event(event)`
- `append_audit_events(events[])`
- `list_audit_events(filter)`
- `get_audit_trace(correlation_id)`
- `get_latest_snapshot(workspace_id)`
- `rebuild_snapshot_from_events(workspace_id)`
- `compact_event_journal(workspace_id, before_sequence)`

### Frontend Integration

- `useAuditEvents` を authoritative backend source に寄せる。
- Audit Timeline、Reliability、Tool Ledger、Run Graph、Workstation Pulse が同じ stream/snapshot を読む。
- 各 UI が「推定」「未接続」「バックエンド確認済み」を区別する。

### Redaction

- コマンド全文、トークン、キー、環境変数、ファイル内容は redaction layer を通す。
- UI には `redacted_payload_json` を優先表示する。
- raw payload は明示的な debug mode 以外では表示しない。

### Tests

- Rust unit:
  - append ordering
  - sequence monotonicity
  - workspace isolation
  - redaction
  - rebuild snapshot
  - corrupted payload rejection
- Frontend:
  - audit stream renders stable order
  - filters do not lose trace state
  - reliability and audit timeline share same recovery classifier

### Acceptance

- アプリ再起動後も直近イベントと final report が復元できる。
- Event ordering が UI reload で変わらない。
- 重要な blocker / complete / notification が journal に残る。

## Phase 2 - Tauri Event Bus And DB Snapshot E2E

Priority: P0
Score impact: +0.20 to +0.30
Depends on: Phase 1

イベントを DB に入れるだけでは足りない。Rust backend、Tauri IPC/event、frontend subscription、DB snapshot が一体で動くことを証明する。

### Implementation

- Real Tauri event bus test harness を作る。
- Backend event emission と DB write を同じ correlation id で結ぶ。
- Frontend mock ではなく、実際の IPC serialization を通す E2E を追加する。
- Snapshot commands が event journal から作った状態を返すようにする。

### Required Scenarios

- Agent output is emitted, persisted, rendered.
- Watchdog decision is emitted, persisted, rendered.
- Tool result is emitted, persisted, rendered.
- Session complete is emitted, persisted, rendered.
- App reload reconstructs dashboard/right rail state.
- DB lock or write failure becomes explicit incident.

### Acceptance

- 「UI には出たが DB にない」「DB にはあるが UI に出ない」がテストで検出される。
- Crash/reload replay で active card と done count が復元される。

## Phase 3 - Longrun Supervisor And Dashboard Truth

Priority: P0
Score impact: +0.30 to +0.40
Depends on: Phase 1 partially, can start in parallel after Phase 0

ユーザーが最も不信感を持った領域。100% 表示なのに 96% のタスクがある、古い URL が空っぽ、勝手にタスクが増える、止まっている理由が分からない、という状態を根絶する。

### Canonical Dashboard

- workspace/thread ごとに canonical dashboard URL を 1 つにする。
- 古い port は stale banner または redirect を出す。
- `/state` に `canonicalUrl`, `isStaleDashboard`, `stateVersion`, `lastSupervisorHeartbeat` を含める。
- dashboard process が落ちた場合は明確な down state にする。

### No Flicker / Scroll Preservation

- polling による full reload を禁止する。
- state diff patch または SSE/WebSocket に移行する。
- scroll position、expanded section、selected tab、filter、sort を保持する。
- dashboard update で viewport が先頭に戻らないようにする。

### Blocker Taxonomy

- `permission`
- `external_dependency`
- `validation_failed`
- `oversized_task`
- `timeout`
- `product_decision`
- `environment_down`
- `test_flake`
- `code_conflict`
- `unknown`

### Retry Policy By Kind

- permission: no automatic restart, decision required
- external_dependency: probe with backoff
- validation_failed: limited retry after targeted fix
- oversized_task: auto-split and requeue
- timeout: split or extend only with reason
- product_decision: human decision inbox
- environment_down: self-heal process/service
- test_flake: rerun with cap and mark confidence
- code_conflict: stop and request merge/rebase decision
- unknown: one diagnostic pass, then attention

### Self-Heal Probe

- external service availability
- dashboard alive
- longrun process alive
- workspace path exists
- git status readable
- package manager available
- dev server reachable
- test command executable

### Notifications

- Browser notification
- In-app toast
- Dashboard notification center
- Codex thread heartbeat
- Final report summary
- Local file `.codex-auto/notifications.jsonl`

Self-heal できないものだけ Codex/ユーザーへ通知する。ただし complete、needs_attention、stale、dashboard down は必ず通知する。

### No Surprise Task Generation

- original roadmap continuation
- blocker decomposition
- improvement slice
- user-requested new task

上記のどれかを必ず task metadata に持たせる。ユーザーが「元のタスクは終わったのか」と聞いた時に即答できること。

### Tests

- blocked -> no restart
- external dependency -> probe
- complete -> no dead-active
- stale dashboard -> redirect/banner
- denied notification -> fallback visible
- scroll position survives state update
- original task remains queryable after decomposition
- no new task without parent reason

### Acceptance

- ダッシュボードの 100% と card-level progress が矛盾しない。
- 「なぜ止まっているか」「次に何が起きるか」が card 上に出る。
- 完了時に final report が dashboard と Codex thread へ要約される。

## Phase 4 - Terminal And IME Trust

Priority: P0
Score impact: +0.25 to +0.35
Depends on: Phase 0, Phase 2 for telemetry evidence

日本語入力は体感品質の核心。ここが不安定だと他が強くても信頼されない。

### Input Model

- direct PTY input と controlled composer input を明確に分離する。
- IME composition state:
  - idle
  - composing
  - candidate_open
  - committed
  - cancelled
  - blurred
  - recovered
- composition を blur で消さない。
- blur 時は preserve / commit / cancel の挙動を明示的に扱う。
- long composition の scroll / selection / deletion を安定化する。

### Candidate Position

- terminal cell coordinate
- CSS transform
- devicePixelRatio
- scroll offset
- pane offset
- WebView2 IME candidate rect

これらを diagnostics に出し、候補ウィンドウが遠くに飛ぶ原因を切り分ける。

### Shell / CLI Matrix

- PowerShell
- cmd
- WSL
- Git Bash
- Claude Code
- Gemini CLI
- Codex CLI
- alternate screen
- full-screen TUI

### Input Scenarios

- long Japanese composition
- conversion candidate popup
- Backspace during composition
- Delete during composition
- Escape cancel
- Enter commit
- blur during composition
- resize during composition
- paste while composing
- multi-line paste
- command history search
- candidate popup near right edge
- DPI 100%
- DPI 125%
- DPI 150%
- multiple panes
- hidden/inactive pane

### Lower Input Bar

日本語 direct input が安定した後、下部 IME/input bar は TUI 的な command composer に寄せる。

- file attach
- image attach
- clipboard image paste
- multi-line prompt
- model/agent target
- shell-safe command preview
- send to PTY / send to agent / save as context
- drag/drop files
- attachment chips
- paste danger confirmation

### Debug UX

- input-state debug overlay
- active pane target
- terminal id
- composition state
- write path
- last committed text
- dropped key count
- candidate rect

### Tests

- `useCanvasIME`
- `IMEInputBar`
- `TerminalCanvasInput`
- native WebView2 CDP IME verifier
- visual screenshot for candidate alignment where possible

### Acceptance

- 長い日本語入力後に ghost text が残らない。
- 消せない preedit が残らない。
- 別文字入力が 1 文字しか表示されない状態が再発しない。
- PowerShell 直接入力ができる。
- AI CLI alternate screen で candidate/caret が大きくズレない。

## Phase 5 - True tmux Layer

Priority: P1
Score impact: +0.25 to +0.35
Depends on: Phase 1, Phase 4

AI ワークステーションでは pane は単なる UI split ではなく、作業単位・実行単位・復旧単位になる。

### Session Model

- durable session id
- pane id
- terminal id
- process id
- cwd
- branch
- command
- role
- name
- layout id
- created_at
- last_active_at
- attach state
- health state
- scrollback checkpoint

### Operations

- attach
- detach
- resurrect
- rename
- assign role
- split horizontal
- split vertical
- close
- restart
- send command
- broadcast to role
- synchronized input
- search panes
- choose-tree
- export layout
- import layout
- restore last workspace

### UI Surfaces

- Pane Switcher
- Live Panes
- Process Manager
- Command Palette
- Right Rail
- Status Bar
- Workspace Tabs

全て同じ attach contract を使う。

### Safety

- last pane close guard
- stale terminal id guard
- ended pane guard
- cross-tab action guard
- role fanout preflight
- destructive action confirm
- post-action verification

### tmux Capability Target

- session list
- window/pane list equivalent
- pane names
- pane roles
- attach/detach
- layout persistence
- command broadcast
- synchronized panes
- choose-tree
- pane search
- restart/resurrect
- status health

### Acceptance

- app reload 後に pane layout と session intent が復元される。
- Live Panes から attach できる。
- Process Manager の live count が controllable live pane と一致する。
- role broadcast が silent fanout しない。

## Phase 6 - Process Manager And Live Panes Native Quality

Priority: P1
Score impact: +0.15 to +0.25
Depends on: Phase 5 partially

ユーザーが指摘した「WebView っぽい手抜き感」を消す。プロセスはアプリケーションとして見せ、すぐ安全に止められるようにする。

### Process Rows

- app/process icon
- process name
- command
- cwd
- pane/session link
- pid
- parent pid
- CPU
- memory
- uptime
- health
- kill/restart/attach actions
- controllable vs orphan
- cleanup-only marker

### Safe Kill Ladder

1. interrupt
2. terminate shell
3. kill process
4. kill process tree
5. cleanup orphan record
6. verify gone

### Design

- equal rail padding
- stable widths
- no nested card clutter
- compact row actions with icons/tooltips
- danger action affordance without visual panic

### Acceptance

- kill が簡単だが危険すぎない。
- cleanup-only orphan は live process として数えない。
- Process Manager と Live Panes の情報が矛盾しない。

## Phase 7 - Unified Workstation Graph

Priority: P1
Score impact: +0.25 to +0.35
Depends on: Phase 1, Phase 5

右 rail の各カードを独立した widget 群から、同じ graph の filtered view にする。

### Graph Nodes

- workspace
- thread
- pane
- terminal
- process
- agent
- subagent
- workflow
- phase
- tool call
- file
- diff cluster
- test
- blocker
- risk
- notification
- final report
- context pack

### Graph Edges

- spawned
- owns
- wrote
- read
- changed
- tested
- blocked_by
- retried_by
- reviewed_by
- reports_to
- attached_to
- derived_from

### Surfaces

- Workstation Pulse
- Run Graph
- Tool Ledger
- Review Queue
- Context Panel
- Reliability
- Audit Timeline
- Mission Control

### Acceptance

- 1 つの agent から「変更ファイル」「使ったツール」「走ったテスト」「残ったリスク」「final report」へ辿れる。
- 選択した pane/agent/workflow に応じて rail が意味のある絞り込みを行う。

## Phase 8 - Mission Control Home

Priority: P1
Score impact: +0.15 to +0.25
Depends on: Phase 7

起動直後またはプロジェクトを開いた瞬間に、AI ワークステーションとしての現在地を見せる。

### Content

- active project
- active panes
- active agents
- current longrun
- review queue
- context pressure
- recent blockers
- current next action
- last final report
- release readiness
- workspace health

### UX

- first viewport で全体像
- marketing page にしない
- dense but calm
- empty state は行動可能にする

### Acceptance

- 「今何をするべきか」が 5 秒で分かる。
- project が空の時も Recent Projects の typographic alignment が崩れない。

## Phase 9 - Context Pack Builder

Priority: P1
Score impact: +0.20 to +0.30
Depends on: Phase 7

長時間作業・別セッション・別プロジェクト・Codex への報告で必要。コンテキスト圧縮を手作業にしない。

### Inputs

- changed files
- git diff summary
- terminal transcript excerpts
- test results
- active blockers
- decisions
- open risks
- pane state
- agent transcripts
- final report
- dashboard state
- commands run

### Outputs

- handoff markdown
- machine-readable json
- Codex thread summary
- next action list
- risk list

### Acceptance

- 別スレッドでも「何をやっていたか」が即復元できる。
- final report が context pack に自動で入る。

## Phase 10 - Agent Run Graph And Subagent Control

Priority: P1
Score impact: +0.20 to +0.30
Depends on: Phase 7, Phase 9

サブエージェントをフル活用するには、投げた後の実態が見える必要がある。

### Features

- parent/child agent DAG
- task ownership
- workspace scope
- file write set
- active/done/blocked/stale
- token/context pressure
- tool approvals
- final report status
- close completed agent indicator
- orphaned agent detection

### Policies

- completed agents are closed/collected.
- blocked agents show reason and next required actor.
- heavy task can auto-split only if failure kind is oversized/timeout.
- external dependency uses probe.
- permission/product decision does not restart.

### Acceptance

- ユーザーが「何を実装させたの？」と聞いたら graph/report から答えられる。
- 止まったタスクが勝手に意味不明な別タスクへ変わらない。

## Phase 11 - Gantt + Kanban Hybrid

Priority: P1
Score impact: +0.15 to +0.25
Depends on: Phase 3, Phase 7

Kanban は状態、Gantt は時間と依存関係を見るために必要。長時間自動モードの「本当に進んでる？」を解消する。

### Kanban

- Todo
- In Progress
- Blocked
- Needs Decision
- Verifying
- Done
- Archived

### Gantt

- planned start/end
- actual start/end
- elapsed
- remaining estimate
- blocked duration
- dependency lines
- critical path
- retry marks
- probe marks

### UX

- refresh flickerなし
- scroll位置保持
- completed cards visible
- original task lineage visible
- filters by workspace/thread/project

### Acceptance

- 全体ロードマップ、完了済み、現在作業、残り時間が同じ画面で分かる。
- block と done が混在しても progress が矛盾しない。

## Phase 12 - Review Queue v2

Priority: P1
Score impact: +0.15 to +0.25
Depends on: Phase 7

AI ワークステーションでは「変更した」より「安全に入れられる」が重要。

### Scoring Inputs

- diffstat
- file risk class
- security-sensitive path
- config/dependency migration
- generated file
- test coverage
- ownership
- conflicts
- binary/asset changes
- agent author
- last validation

### Actions

- spawn reviewer
- open diff
- run targeted tests
- stage safe cluster
- mark reviewed
- request human decision
- create validation plan
- export review summary

### Acceptance

- review mode が横に間延びしない。
- changed files が多い時も優先度が分かる。
- merge readiness が曖昧でない。

## Phase 13 - Workflow Engine Upgrade

Priority: P1/P2
Score impact: +0.15 to +0.25
Depends on: Phase 1, Phase 3

### Features

- phase duration persistence
- retry count
- produced artifacts
- commands run
- validation evidence
- final report
- resume from phase
- split heavy task
- convert blocker to decision request
- gate approval with comment
- conditional approval
- phase diff preview

### Templates

- Bug Fix
- Feature Implementation
- Refactor
- Review
- Release
- IME Regression
- Visual QA Sweep
- Longrun Reliability

### Acceptance

- workflow が途中で止まっても再開点と理由が残る。
- phase ごとの成果物と validation が追える。

## Phase 14 - Command Risk Firewall

Priority: P2
Score impact: +0.15 to +0.25
Depends on: Phase 1

### Risk Classes

- read-only
- build/test
- file mutation
- git mutation
- package install
- network
- process kill
- delete
- permission
- secret-bearing
- destructive
- unknown

### Enforcement

- pre-execution classification
- approval policy
- command preview
- multi-line paste guard
- path scope guard
- secret redaction
- audit event
- replayable approval record

### Acceptance

- 危険な操作はなぜ危険か表示される。
- 許可/拒否が後から追跡できる。
- safe command は邪魔せず進む。

## Phase 15 - Human Decision Inbox

Priority: P2
Score impact: +0.10 to +0.20
Depends on: Phase 3, Phase 14

### Purpose

self-heal できないものだけユーザーに出す。通知疲れを防ぎ、重要な判断を見落とさない。

### Decision Types

- permission required
- product direction
- destructive operation
- external account/login
- merge conflict strategy
- test expectation changed
- security exception

### UI

- minimum context
- recommended option
- risk
- consequence
- timeout policy
- decision history

### Acceptance

- 自動で済むものは通知されない。
- 人間判断が必要なものは埋もれない。

## Phase 16 - Design System Hardening

Priority: P2
Score impact: +0.20 to +0.30
Depends on: can run throughout

神は細部に宿る領域。UI が揺れる、文字がズレる、スクロールで戻る、左右マージンが違う、という体験を潰す。

### Tokens

- spacing scale
- rail inset
- scrollbar gutter
- card radius max 8px
- type scale
- icon sizes
- row height
- grid tracks
- focus ring
- danger/success/warn colors
- glass opacity levels

### Density Modes

- Focus
- Balanced
- Dense

### Typography

- terminal chrome
- rail section title
- card title
- metadata label
- metric value
- mono telemetry
- empty state
- button label

### Layout Rules

- no width jump on tab switch
- reserve scrollbar gutter
- no card-in-card clutter
- no decorative logo in terminal center
- no unnecessary icon in top status bar
- equal left/right rail padding
- stable terminal minimum width
- stable right rail modes
- no overlapping row action and title

### Visual QA Matrix

- 584 width
- 960 width
- 1440 width
- 1920 width
- 100% DPI
- 125% DPI
- 150% DPI
- scrollbar present
- scrollbar absent
- settings modal
- welcome
- command palette
- prompt dialog
- confirm dialog
- right rail command/review/observe
- process manager
- review queue
- pane switcher
- dashboard kanban/gantt

### Acceptance

- UI の横幅・中央揃え・スクロール位置が状態変更でズレない。
- 重要情報の階層が明確。
- 画面密度は高いが読める。

## Phase 17 - Performance Observatory

Priority: P2
Score impact: +0.10 to +0.20
Depends on: Phase 1

### Metrics

- terminal FPS
- frame time
- dropped render count
- WebGL fallback
- scrollback memory
- pane count
- IPC latency
- DB write latency
- event queue lag
- right rail render time
- dashboard update latency
- CPU/memory per process

### Budgets

- terminal input latency target
- dashboard update max
- right rail render max
- DB event append max
- visual update no flicker

### UI

- performance panel
- health badges
- regression warnings
- export diagnostic bundle

### Acceptance

- 重くなった時に原因が分かる。
- 長時間 run 中の dashboard が止まったのか動いているのか判断できる。

## Phase 18 - Chaos / Recovery Test Pack

Priority: P2
Score impact: +0.15 to +0.25
Depends on: Phase 1, Phase 3

### Scenarios

- sleep/resume
- network loss
- killed AI CLI
- killed dashboard
- killed longrun supervisor
- killed PTY
- app reload
- localStorage deletion
- SQLite DB lock
- port conflict
- test timeout
- browser notification denied
- stale dashboard URL
- workspace path moved

### Acceptance

- self-healable failure recovers or probes.
- non-self-healable failure stops loudly with reason.
- final report still appears after recovery.

## Phase 19 - Workspace Profile System

Priority: P2
Score impact: +0.10 to +0.20
Depends on: Phase 3, Phase 7

他プロジェクトでも使えるために必要。

### Profile Fields

- workspace root
- thread id
- default shell
- preferred model
- agents
- workflows
- watch rules
- safe paths
- dashboard port policy
- notification policy
- visual density
- pane layout
- command risk policy
- context pack policy

### Scope Rules

- global defaults
- per-workspace override
- per-thread run state
- never mix unrelated workspace events

### Acceptance

- 別フォルダーのプロジェクトでも同じ監視/進捗/通知体系が使える。
- ただし thread ごとの作業状態は混ざらない。

## Phase 20 - Release Doctor And Distribution

Priority: P2/P3
Score impact: +0.10 to +0.20
Depends on: core stabilization

### Release Doctor

- version match
- icon integrity
- dist artifacts
- Tauri build
- installer artifact
- signing state
- updater config
- latest release gate
- known risks
- crash log status
- rollback package

### Distribution

- signed Windows exe/msi/msix
- smoke install
- smoke uninstall
- update channel
- release notes
- rollback instructions

### Acceptance

- 配布用 exe が用意できる。
- インストール後の初回起動、IME、dashboard、terminal が smoke される。

## Phase 21 - Accessibility, Keyboard, And Power-User Polish

Priority: P3
Score impact: +0.05 to +0.15
Depends on: Design system

### Work Items

- aria-label coverage
- focus traps
- keyboard navigation for rail tabs
- pane navigation shortcuts
- command palette entries for all major actions
- tooltip consistency
- high contrast checks
- reduced motion handling
- screen reader labels for state badges

### Acceptance

- mouse なしでも主要操作ができる。
- dense UI でも focus が見失われない。

## Phase 22 - Documentation And Operational Runbooks

Priority: P3
Score impact: +0.05 to +0.15
Depends on: ongoing

### Docs

- AI workstation guide
- dashboard/longrun guide
- blocker taxonomy guide
- IME troubleshooting
- process kill policy
- workspace profile guide
- release build playbook
- visual QA guide
- context pack/handoff guide
- chaos recovery guide

### Acceptance

- 新しいスレッドでも引き継ぎが短時間で可能。
- ユーザーがどこを見れば進捗確認できるか迷わない。

## Full Backlog By Priority

### P0 Backlog

| ID | Work | Acceptance |
| --- | --- | --- |
| P0-01 | Event journal migration | append/read/rebuild passes tests |
| P0-02 | Event redaction | sensitive payload not displayed |
| P0-03 | Event snapshot API | right rail can read backend snapshot |
| P0-04 | Tauri event-bus E2E | emitted/persisted/rendered proven |
| P0-05 | Canonical dashboard URL | old ports redirect or stale-banner |
| P0-06 | Dashboard diff/SSE update | no flicker and no forced top scroll |
| P0-07 | Blocker taxonomy JSON | blocker-analysis.json is typed |
| P0-08 | Retry policy by kind | no restart for permission/product decision |
| P0-09 | External dependency probe | probe/backoff visible |
| P0-10 | Complete no dead-active test | complete run cannot show active stale card |
| P0-11 | Final report surfacing | dashboard and Codex summary show result |
| P0-12 | Notification fallback | denied browser notification still visible |
| P0-13 | No surprise task lineage | every generated task has parent/reason |
| P0-14 | IME long Japanese regression | no stuck/ghost text |
| P0-15 | IME blur preservation | blur does not silently lose preedit |
| P0-16 | PowerShell direct input | direct typing works |
| P0-17 | AI CLI alternate-screen IME | caret/candidate does not fly off |

### P1 Backlog

| ID | Work | Acceptance |
| --- | --- | --- |
| P1-01 | Durable pane/session model | reload restores intent |
| P1-02 | Live Panes attach | attach available outside process manager |
| P1-03 | Process live-count truth | orphan cleanup not counted live |
| P1-04 | Pane rename/role | visible across pane surfaces |
| P1-05 | Role broadcast preflight | no silent fanout |
| P1-06 | Choose-tree polish | tmux-like navigation |
| P1-07 | Unified graph schema | agent/pane/file/test/risk connected |
| P1-08 | Mission Control home | current next action visible |
| P1-09 | Context Pack Builder | markdown/json handoff generated |
| P1-10 | Agent Run Graph | subagent DAG and result visible |
| P1-11 | Gantt + Kanban hybrid | roadmap/done/current/blocked visible |
| P1-12 | Review Queue v2 scoring | risk/test impact visible |
| P1-13 | Workflow resume/split | stopped work can resume safely |
| P1-14 | Process native rows | app-like process manager |
| P1-15 | Safe kill ladder | kill is verified and audited |

### P2 Backlog

| ID | Work | Acceptance |
| --- | --- | --- |
| P2-01 | Command Risk Firewall | commands classified before execution |
| P2-02 | Approval replay | decisions auditably replayed |
| P2-03 | Human Decision Inbox | only true decisions notify user |
| P2-04 | Workspace profiles | per-project settings with thread isolation |
| P2-05 | Design tokens hardening | stable spacing/type/radius rules |
| P2-06 | Density modes | Focus/Balanced/Dense |
| P2-07 | Visual QA full matrix | modal/rail/dashboard/IME layout guarded |
| P2-08 | Performance metrics | frame/IPC/DB/render visible |
| P2-09 | Chaos test pack | sleep/network/kill/reload covered |
| P2-10 | Release Doctor | signing/artifact/updater/risk visible |
| P2-11 | Error boundaries | panel crash isolated |
| P2-12 | Paste policy | multi-line/danger/image/binary handled |
| P2-13 | Attachment composer | file/image/clipboard attach in lower bar |

### P3 Backlog

| ID | Work | Acceptance |
| --- | --- | --- |
| P3-01 | Empty state polish | useful action, no decorative clutter |
| P3-02 | Typography rhythm | labels/metrics/titles consistent |
| P3-03 | Rail pinning/order | workspace custom ordering |
| P3-04 | Accessibility sweep | aria/focus/keyboard complete |
| P3-05 | Shortcut coverage | command palette reaches major actions |
| P3-06 | Release docs | build/distribution/runbook updated |
| P3-07 | IME troubleshooting doc | reproducible matrix documented |
| P3-08 | Dashboard user guide | progress monitoring is obvious |
| P3-09 | Context handoff guide | cross-thread reuse reliable |
| P3-10 | Optional GPU roadmap | wgpu continuation scoped separately |

## Suggested Implementation Order

1. Create `AI_WORKSTATION_98_PROGRESS.md` and machine-readable baseline.
2. Implement canonical dashboard URL / stale dashboard redirect.
3. Implement dashboard no-flicker update and scroll preservation.
4. Add blocker taxonomy and `blocker-analysis.json`.
5. Split retry policy by blocker kind.
6. Add external dependency self-heal probe.
7. Add complete/no-dead-active and blocked/no-restart tests.
8. Add final report and notification fallback surfacing.
9. Implement minimal event journal schema and append/read APIs.
10. Connect event journal to longrun/dashboard state.
11. Build Tauri event bus + DB snapshot E2E harness.
12. Expand IME native CDP matrix and fix blur/ghost cases.
13. Stabilize PowerShell and AI CLI direct input.
14. Add terminal input diagnostics overlay.
15. Implement Live Panes attach and process live-count semantics.
16. Upgrade pane/session model toward tmux attach/detach/resurrect.
17. Add pane role/name/broadcast preflight.
18. Build unified workstation graph schema.
19. Refactor right rail widgets to graph-derived views.
20. Add Context Pack Builder.
21. Add Agent Run Graph with subagent status and final reports.
22. Add Gantt + Kanban hybrid dashboard.
23. Implement Review Queue v2 risk/test scoring.
24. Upgrade workflow resume/split/decision conversion.
25. Add Command Risk Firewall and approval replay.
26. Add Human Decision Inbox.
27. Add Workspace Profile System.
28. Harden design tokens, density modes, typography.
29. Expand visual QA matrix.
30. Add Performance Observatory.
31. Add Chaos / Recovery Test Pack.
32. Add Release Doctor and signed distribution checks.
33. Complete docs/runbooks.
34. Run full release gate, IME gate, visual QA, chaos smoke.

## Verification Plan

### Per Slice

- TypeScript check
- focused Vitest
- focused Rust test
- focused Playwright visual QA
- manual browser check when UI changed
- screenshot comparison for visual polish
- audit event verification when operational state changed

### Before 9.8 Claim

```powershell
pnpm.cmd exec tsc --noEmit
pnpm.cmd test
cargo test
pnpm.cmd exec playwright test e2e/visual-qa-layout.spec.ts --project=frontend
pnpm.cmd verify:release:ime
pnpm.cmd verify:release
pnpm.cmd tauri build
```

If full `pnpm.cmd test` is too heavy, split into documented shards and require all shards to pass.

## Risks

| Risk | Mitigation |
| --- | --- |
| Event journal becomes too large | compaction and snapshotting |
| Telemetry leaks sensitive data | redaction-first UI and raw debug opt-in |
| Dashboard becomes too complex | Mission Control summary plus drill-down |
| IME bugs depend on WebView2/Windows state | native CDP verifier, manual matrix, diagnostics |
| Auto-retry causes user distrust | typed blocker policy, no surprise lineage |
| UI density becomes unreadable | density modes and visual QA matrix |
| Long tests slow iteration | shard tests by risk and run focused gates |
| Process kill is dangerous | safe kill ladder and post-kill verification |
| Multi-project monitoring mixes state | workspace/thread scoped profiles |

## Definition Of Done For 9.8

- Every important event is persisted, replayable, redacted, and traceable.
- Dashboard has one canonical truth per workspace/thread.
- Old dashboards cannot silently mislead.
- Longrun progress cannot show contradictory 100%/96% states.
- Completed work has final report and notification.
- Blocked work has reason, owner, retry policy, and next action.
- Japanese IME works across direct terminal, PowerShell, and AI CLIs.
- Pane/session/process state is attachable and recoverable.
- Right rail surfaces are graph-derived and mutually consistent.
- Review queue can prioritize risk and validation.
- UI does not jump, overlap, drift, or reset scroll during normal updates.
- Security-sensitive commands are classified and audited.
- Sleep/resume, network loss, killed process, reload, and stale dashboard are tested.
- Release artifacts and installer smoke are visible in Release Doctor.
- A new Codex thread can pick up work from context pack/final report without guessing.

## Addendum 2026-05-05: Longrun Full Autonomy S++

The 9.8 plan now includes an operational-autonomy extension for the longrun system itself. The goal is to move from a resilient single-loop executor to a fully autonomous control plane with safe parallel execution.

Reference plan: `docs/history/LONGRUN_FULL_AUTONOMY_SPP_PLAN_2026-05-05.md`
Machine-readable extension: `.codex-auto/roadmap-extension-longrun-autonomy-2026-05-05.json`
Safe merge helper: `scripts/merge-longrun-autonomy-roadmap.mjs`

Additional P0 slices to merge after the current active turn is no longer writing roadmap artifacts:

1. `P0-16` Autonomous scheduler leases and generation locks
2. `P0-17` Parallel worktree scheduler and lane planner
3. `P0-18` Autonomous failure triage and replan engine
4. `P0-19` Parallel integration gate and merge arbiter
5. `P0-20` Fleet telemetry utilization and truth dashboard
6. `P0-21` Autonomous quality critic and promotion gates

These slices are intentionally gated behind safe merge timing because the active longrun turn may be writing `.codex-auto/project-roadmap.json`. The helper refuses to merge while `current-child.json` reports a live `codex exec` child unless explicitly forced.
