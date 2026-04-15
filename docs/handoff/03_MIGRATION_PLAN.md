# 03 移行計画 — Tauri → フルネイティブRust

## 方針

**段階的移行 (Big Bang Rewrite ではない)**

1. Tauri版は**動作し続ける** — 移行中も使える状態を維持
2. native-terminal バイナリを段階的に機能追加
3. 機能パリティ達成後にTauri版を deprecate

## Phase 1: ターミナルコア (現在)

**目標**: GPU描画ターミナルが単体で動く

```
Status: ✅ 動作確認済み (グリフ位置ズレあり)
Binary: cargo run --bin native-terminal
```

| タスク | 状態 | 詳細 |
|--------|------|------|
| winit ウィンドウ | ✅ | 1200x700, decorations: false |
| wgpu DX12 初期化 | ✅ | Intel Arc 140V 動作確認 |
| PTY (PowerShell) | ✅ | spawn + reader thread |
| VTE parser → Grid | ✅ | 120x30 グリッド |
| GPU レンダリング | ⚠️ | グリフUVズレ修正必要 |
| キーボード入力 | ✅ | ASCII + 特殊キー |
| Mica 透過 | ⚠️ | DWM設定済み、PreMultiplied非対応GPU |
| IME 入力 | ❌ | 未実装 |
| テキスト選択 | ❌ | 未実装 |
| スクロール | ❌ | マウスホイール未対応 |

### Phase 1 残タスク
1. グリフアトラスのUV座標修正 (renderer.rsのquad計算)
2. IME入力 (winit IME API + 候補ウィンドウ表示)
3. マウスイベント (選択、スクロール、リンククリック)
4. スプリットペイン (複数PTY同一ウィンドウ)

## Phase 2: UI Chrome

**目標**: タブ/ヘッダー/ステータスバーをRustで描画

| タスク | 担当 | 方針 |
|--------|------|------|
| カスタムタイトルバー | wgpu 直描画 | 最小化/最大化/閉じるボタン |
| タブバー | egui or wgpu | ドラッグ&ドロップ並替 |
| ステータスバー | wgpu 直描画 | シェル/ブランチ/エンコーディング |
| コマンドパレット | egui | Ctrl+Shift+P テキスト入力 |

**UIフレームワーク候補**:
- **egui**: 即座に使える。wgpu統合済み。ターミナル以外のUI全般に使用
- **iced**: より構造的だがイベントループの統合が複雑
- **独自実装**: ターミナル描画と同じwgpuパイプラインでUI描画

**推奨**: egui で開始。パフォーマンス問題が出たら部分的に独自描画に移行。

## Phase 3: サイドパネル

**目標**: ファイルツリー/エージェントパネルをRust UIで実装

| タスク | 元のReactコンポーネント | Rust実装方針 |
|--------|----------------------|-------------|
| ファイルツリー | FileTree.tsx (289行) | egui TreeView + git2-rs |
| エージェント一覧 | AgentInspector.tsx (352行) | egui カード表示 |
| ワークフロー | WorkflowPanel.tsx (270行) | egui ステップ表示 |
| ツールキット | ToolkitPanel.tsx (315行) | egui ボタングリッド |

## Phase 4: エディタ

**目標**: Monaco Editor相当をRustで実装

| タスク | 方針 |
|--------|------|
| シンタックスハイライト | tree-sitter |
| テキスト編集 | ropey (rope data structure) |
| Diff表示 | similar crate |
| LSP | tower-lsp or lsp-types |

**注**: エディタは最も複雑。最後に実装。初期版ではTauri版のMonacoを併用してもよい。

## Phase 5: 統合テスト + リリース

**目標**: Tauri版との機能パリティ達成

| タスク | 詳細 |
|--------|------|
| 全機能テスト | MR-1〜MR-7 の動作確認 |
| パフォーマンス計測 | 入力遅延、描画FPS、メモリ使用量 |
| インストーラー | cargo-wix or NSIS |
| Tauri版 deprecation | CLAUDE.md に「native版を使え」記載 |

## タイムライン (目安)

| Phase | 想定期間 | 前提条件 |
|-------|---------|---------|
| Phase 1 完了 | 2-3 セッション | グリフ修正 + IME + マウス |
| Phase 2 完了 | 3-4 セッション | egui 統合 |
| Phase 3 完了 | 4-5 セッション | パネル群移植 |
| Phase 4 完了 | 5-8 セッション | エディタ実装 |
| Phase 5 完了 | 1-2 セッション | 統合テスト |

## リスク

| リスク | 対策 |
|--------|------|
| egui のカスタマイズ性不足 | 部分的にwgpu直描画に切替 |
| IME対応の複雑さ | Windows IMM32 API直接操作 |
| エディタ実装の巨大さ | Phase 4を後回し、Tauri版併用 |
| GPU互換性 | DX12フォールバック + ソフトウェアレンダラー |
