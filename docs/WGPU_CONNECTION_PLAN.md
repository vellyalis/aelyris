# wgpu接続完成計画

**目標:** xterm.jsとwgpuの切替が動作する状態。Settings UIから「GPU描画（実験的）」を選択可能。

## 現状のギャップ

| コンポーネント | 実装状態 | 問題 |
|--------------|---------|------|
| Grid + VTE パーサー | ✅ 完成 | — |
| FontManager + GlyphAtlas | ✅ 完成 | — |
| WGSLシェーダー | ✅ 完成 | — |
| TerminalRenderer | ✅ コード完成 | GpuTerminalに含まれていない |
| TerminalSurface | ✅ コード完成 | placeholderしか使われていない |
| ensure_wgpu() | ✅ コード完成 | 呼ばれていない |
| render_tick() | △ 未完成 | render_frame()を呼んでいない |
| render loop thread | ❌ 未実装 | render_tick()を呼ぶスレッドがない |
| gpu_spawn_terminal | △ 部分実装 | async化+Surface/Renderer作成が必要 |
| gpu_write_terminal | △ 部分実装 | key→PTYバイト変換が必要 |
| フィーチャーフラグ | ✅ フック存在 | "xterm"固定 |

## 実装ステップ（5段階）

### Step 1: GpuTerminal構造体拡張 + wgpuコンテキスト公開

**mod.rs変更:**
- GpuTerminalにrenderer: TerminalRenderer フィールド追加
- GpuTerminalManagerからwgpuコンテキスト（instance/adapter/device/queue）を取得するメソッド追加
- WgpuContextのdevice/queueをClone可能に（Arc共有済み）

### Step 2: gpu_spawn_terminal async化 + 実Surface/Renderer作成

**commands.rs変更:**
- gpu_spawn_terminalを`async fn`に
- ensure_wgpu().awaitで初期化保証
- get_webview_window("main")で親HWND取得
- TerminalSurface::new()で実Child HWND作成
- TerminalRenderer::new()でGPUパイプライン初期化
- GpuTerminalに全コンポーネントを格納

### Step 3: render loop thread起動 + render_tick()完成

**mod.rs変更:**
- GpuTerminalManagerをArc化（Tauri managed stateとして）
- render loop threadをlib.rs setup内で起動
- render_tick()内でrenderer.upload_atlas() + renderer.render_frame()呼び出し
- 16ms周期（~60fps上限）、Grid.needs_redraw時のみ描画

### Step 4: 入力処理 + gpu_write_terminal改善

**commands.rs変更:**
- gpu_write_terminalでkey名→input::key_to_pty_bytes()変換
- Gridのmode（DECCKM等）を参照して正しいエスケープシーケンス生成
- Ctrl/Alt/Shift修飾キー対応

### Step 5: フィーチャーフラグ切替 + 動作確認

**commands.rs変更:**
- get_terminal_renderer()で"wgpu"返却
- Settings UIに切替トグル追加（オプション）
- pnpm tauri devで実機確認

## リスクと回避策

| リスク | 対策 |
|--------|------|
| Child HWNDがWebViewの下に隠れる | WS_CHILD | WS_VISIBLE + Z-order調整 |
| Mutex contentionでPTYスレッドブロック | Grid lockを最小化、dirty checkで早期return |
| 初回フレームが遅い（フォントラスタライズ） | ASCII 95文字を事前キャッシュ |
| CSPがwgpuを阻害 | wgpuはWebView外なので影響なし |
| React keydown + Win32 keydownの二重入力 | GpuTerminalAreaでpreventDefault済み |

## テスト計画

| テスト | 種類 | 件数 |
|--------|------|------|
| ensure_wgpu()初期化 | ユニット | 1 |
| render_tick()フレームレート | ベンチマーク | 1 |
| Grid→Atlas→Renderer パイプライン | 統合 | 3 |
| key→PTYバイト変換 | ユニット | 完了済み(7件) |
| フォントラスタライズ | ユニット | 完了済み(4件) |
| グリフアトラスパッキング | ユニット | 完了済み(5件) |
