# 03 移行計画 — Tauri → フルネイティブRust

## 方針

**段階的移行 (Big Bang Rewrite ではない)**

1. Tauri版は**動作し続ける** — 移行中も使える状態を維持
2. native-terminal バイナリを段階的に機能追加
3. 機能パリティ達成後にTauri版を deprecate

## Phase 1: ターミナルコア ✅ 完了

**目標**: GPU描画ターミナルが単体で動く

```
Status: ✅ Phase 1 完了
Binary: cargo run --bin native-terminal
```

| タスク | 状態 | 詳細 |
|--------|------|------|
| winit ウィンドウ | ✅ | 1200x700, decorations: false |
| wgpu DX12 初期化 | ✅ | Intel Arc 140V 動作確認 |
| PTY (PowerShell) | ✅ | spawn + reader thread |
| VTE parser → Grid | ✅ | 120x30 グリッド |
| GPU レンダリング | ✅ | premultiplied alpha + bearing + ascent baseline |
| キーボード入力 | ✅ | ASCII + 特殊キー + Ctrl修飾 |
| Mica 透過 | ✅ | alpha modeフォールバックチェーン |
| IME 入力 | ✅ | winit Ime events + カーソルエリア |
| テキスト選択 | ✅ | マウスドラッグ + Catppuccin blueハイライト |
| スクロール | ✅ | viewport_offset + alt screenカーソル送信 |
| コピー&ペースト | ✅ | Ctrl+Shift+C / Ctrl+V (bracketed paste) |

### Phase 1 残 (Phase 2で対応)
1. スプリットペイン (複数PTY同一ウィンドウ) — UI Chromeと同時実装

## Phase 2: UI Chrome ✅ 完了

**目標**: タブ/ヘッダー/ステータスバーをRustで描画

```
Status: ✅ Phase 2 完了 (コマンドパレット除く)
Binary: cargo run --bin native-terminal
```

| タスク | 状態 | 詳細 |
|--------|------|------|
| カスタムタイトルバー | ✅ | wgpu 直描画 — ドラッグ移動 + 最小化/最大化/閉じる + ホバー効果 |
| タブバー | ✅ | wgpu 直描画 — タブ切替 + 閉じる + 新規タブボタン + ホバー効果 |
| ステータスバー | ✅ | wgpu 直描画 — シェル名/Gitブランチ/エンコーディング |
| コマンドパレット | 📋 | Phase 3 以降で実装（テキスト入力が必要） |

**UIフレームワーク**: egui は wgpu 25 とのバージョン非互換のため不採用。
ターミナルと同じ RectInstance + GlyphInstance パイプラインで UI Chrome を直接描画。
ヒットテストはフレーム毎に生成する HitRegion 配列で処理。

### Phase 2 実装詳細
- **`src/ui/mod.rs`**: ChromeState, HitRegion, render_text ヘルパー
- **content_offset**: シェーダーに content_offset uniform 追加（将来のスクロール対応用）
- **レイアウト**: タイトルバー(32px) + タブバー(34px) + ターミナル + ステータスバー(24px)
- **Catppuccin Mocha**: UI Chrome も同一パレットで統一描画

## Phase 3: サイドパネル 🔧 進行中

**目標**: ファイルツリー/エージェントパネルをRust UIで実装

| タスク | 状態 | 詳細 |
|--------|------|------|
| ファイルツリー | ✅ | wgpu 直描画 — Ctrl+B トグル、展開/折畳、スクロール、ホバー |
| エージェント一覧 | 📋 | Phase 3+ |
| ワークフロー | 📋 | Phase 3+ |
| ツールキット | 📋 | Phase 3+ |

### Phase 3 実装詳細
- **`src/ui/sidebar.rs`**: SidebarState, FileTreeState, TreeEntry
- **レイアウト**: サイドバー(260px, トグル式) + ターミナル幅自動調整
- **ファイルスキャン**: `std::fs::read_dir` — .git/node_modules/target 除外、ディレクトリ優先ソート
- **操作**: クリックで展開/折畳、マウスホイールスクロール、Ctrl+B トグル

## Phase 4: エディタ 🔧 進行中

**目標**: Monaco Editor相当をRustで段階的に実装

```
Status: 🔧 Phase 4a 完了 (読み取り専用ファイルビューア)
Binary: cargo run --bin native-terminal
```

### Phase 4a: 読み取り専用ファイルビューア ✅ 完了

| タスク | 状態 | 詳細 |
|--------|------|------|
| ファイル表示 | ✅ | サイドバーのファイルクリックで表示 — 行番号、ガター、カーソル行ハイライト |
| スクロール | ✅ | マウスホイール + 矢印キー + PgUp/PgDn + Home/End |
| バイナリ検出 | ✅ | 先頭8KBにnullバイト → 拒否 / 10MB超 → 拒否 |
| ステータスバー | ✅ | ファイル名 / Ln X/Y / READ-ONLY 表示 |
| ターミナル復帰 | ✅ | Escape でターミナルに戻る（PTYはバックグラウンド維持） |

#### Phase 4a 実装詳細
- **`src/ui/editor.rs`**: FileViewerState — open/build/scroll/cursor
- **ContentPane enum**: Terminal | FileViewer — コンテンツエリアの切替
- **レンダリング**: 既存の RectInstance + GlyphInstance パイプラインで描画
- **ガター**: 行番号桁数に応じた動的幅、整数演算で正確な桁数計算
- **安全性**: saturating_add で全オーバーフロー防止、visible_count >= 1 保証

### Phase 4b: テキスト編集 ✅ 完了

| タスク | 状態 | 詳細 |
|--------|------|------|
| テキストバッファ | ✅ | ropey::Rope — CRLF→LF正規化、保存時復元 |
| カーソル操作 | ✅ | 行/列、sticky desired_col、点滅カーソル（30フレーム周期） |
| 挿入/削除 | ✅ | 文字入力、Enter、Backspace、Delete、Tab（4スペース） |
| Undo/Redo | ✅ | EditOp + char_count（マルチバイト安全）、saved_undo_depth追跡 |
| 保存 | ✅ | Ctrl+S（元の改行コード復元）、[+] 修正マーカー表示 |

#### Phase 4b 実装詳細
- **ropey 1.x**: Rope データ構造 — 大ファイルの効率的な編集
- **CRLF正規化**: open()でLFに正規化、save()で元のCRLFに復元
- **Undo/Redo**: `EditOp::Insert/Delete` に `char_count` フィールド（`text.len()` バイト数ではなくchar数）
- **modified追跡**: `saved_undo_depth` でディスク読み込み不要のmodified判定
- **カーソル安全**: `char_idx_to_pos` はcol を `line_len` でclamp

### Phase 4c: シンタックスハイライト 📋

| タスク | 方針 |
|--------|------|
| パーサー | tree-sitter (インクリメンタル) |
| 言語検出 | ファイル拡張子 → 言語マッピング |
| カラー | Catppuccin Mocha パレット |

### Phase 4d: LSP 統合 📋

| タスク | 方針 |
|--------|------|
| プロトコル | lsp-types |
| 診断 | エラー/警告 下線表示 |
| Go to Definition | Ctrl+Click / F12 |
| 補完 | `.` / `::` トリガー |

**注**: エディタは段階的に実装。Phase 4a (ビューア) → 4b (編集) → 4c (ハイライト) → 4d (LSP)。

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
