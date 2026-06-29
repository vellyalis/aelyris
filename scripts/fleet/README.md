# Fleet dispatch — worktree-based parallel development

HANDOFF の Work Unit を「1 WU = 1 worktree = 1 エージェント」で並列実装するための運転ツール。
**このツールは git worktree とブリーフを捌くだけ。Aelyris ソースは触らない**（実装はあなたが起動するエージェントがやる）。

- `wu-manifest.json` — 全 WU のメタ（HANDOFF 由来：title / slug / phase / spec / files / deps / suggestedAgent / notes）
- `fleet-dispatch.ps1` — Windows ネイティブ（PowerShell 7+）。**こちらが主**
- `fleet-dispatch.sh` — Git Bash 用コンパニオン（要 `jq`）

## 5要素ループ

```
①分解(済=HANDOFF) → ②worktree隔離 → ③エージェントN体起動 → ④観測/steer → ⑤順次マージ
```

## 使い方（PowerShell）

```powershell
# 一覧（依存・担当つき）
./fleet-dispatch.ps1 list

# ③ 依存ゼロの Batch A をまず空打ち確認 → 本実行
./fleet-dispatch.ps1 dispatch 1.3 0.5 0.1 -DryRun
./fleet-dispatch.ps1 dispatch 1.3 0.5 0.1

#    各 worktree でエージェントを起動（別ターミナル/ペインで同時に）:
#      cd ../aelyris-wt-1.3 ; claude   → "Read FLEET_BRIEF.md and implement it."
#      cd ../aelyris-wt-0.5 ; codex
#      cd ../aelyris-wt-0.1 ; codex

# ④ 観測（ahead/behind）
./fleet-dispatch.ps1 status

# ⑤ レビュー → 順次マージ → 撤去
./fleet-dispatch.ps1 collect 1.3
git merge --no-ff wu/1.3-ui-token-dials      # ゲート緑なら
./fleet-dispatch.ps1 cleanup 1.3 -DeleteBranch
```

Git Bash 版は `./fleet-dispatch.sh list` / `dispatch 1.3 --dry-run` / `status` / `collect 1.3` / `cleanup 1.3 --delete-branch`。

## 仕組みと安全性

- worktree はリポジトリの**外（兄弟ディレクトリ `../aelyris-wt-<id>`）**に作る → main の git status を汚さない。
- 新 worktree は現ブランチの**コミット済み HEAD** から作られる。main worktree の未コミット WIP はそのまま残る（安全・可逆）。
- `dispatch` は各 worktree に `FLEET_BRIEF.md`（自己完結ブリーフ）を生成。エージェントにはこれを読ませるだけ。
- `-DryRun` / `--dry-run` は git を一切変更せず、実行されるコマンドだけ表示。

## 通信モデル（星型・メッシュ禁止）

並列エージェントは**互いに直接通信しない**。オーケストレーター（あなた / Opus）が唯一のバス:

- **指示（orchestrator → agent）**: Aelyris の `send_keys_by_target`（`@role` / `role:` / pty-id 宛先解決）。将来は MCP `aelyris.send_steer`。tmux なら `tmux send-keys -t <pane>`。
- **観測（agent → orchestrator）**: `status` の ahead/behind、各 worktree の `git diff`、エージェントが任意で書く `.fleet/status.md`。
- **結果の受け渡し**: 共有アーティファクト（ファイル）経由。peer-to-peer はしない。

## 粒度・並列度

- 同時実行は **3〜4本**まで（マージ/レビューが律速）。割りすぎ禁止。
- 並列に出すのは「触るファイルが重ならない WU」だけ（`list` の deps と files で確認）。
- ⚠ **WU-1.1** は dispatch 前に注意: `verify-agent-team-orchestration-readiness.mjs:218` が dispatch 行を文字列一致検査。`branchName` 追加時は同コミットで gate 文字列も更新（ブリーフにも記載される）。

## 関連

- マスタープラン: [`../../docs/specs/CODEX_HANDOFF.md`](../../docs/specs/CODEX_HANDOFF.md)
- 設計索引: [`../../docs/specs/README.md`](../../docs/specs/README.md)
- 段取りスキル: `subagent-orchestration`（同一モデル fan-out）/ `dmux-workflows`（tmux グリッドで Claude+Codex 混在）
