# 05 既知の問題とバグ

## Critical

### KI-1: グリフUV座標ズレ (native-terminal)
- **症状**: テキストが白い四角の断片として表示される
- **原因**: renderer.rs のquad計算がアトラスのUV座標とズレている
- **影響**: テキストが読めない
- **修正方針**: GlyphInstance の uv_rect を atlas.get_or_insert() の返り値と正しくマッピング
- **ファイル**: gpu/renderer.rs (render_frame), gpu/mod.rs (build_glyph_instances)

### KI-2: PreMultiplied Alpha 非対応 (Intel Arc 140V)
- **症状**: 透過が効かず、背景が不透明黒
- **原因**: Intel Arc DX12ドライバが CompositeAlphaMode::PreMultiplied をサポートしない
- **影響**: Mica backdrop が見えない
- **修正方針**: 
  1. DX12 swap chain の alpha を DirectComposition 経由で制御
  2. または wgpu のフォーク / 低レベルDX12操作
- **ファイル**: bin/native_terminal.rs (init_wgpu)

## High

### KI-3: IME未対応 (native-terminal)
- **症状**: 日本語入力ができない
- **原因**: winit の IME イベント処理が未実装
- **修正方針**: winit の Ime event + Windows IMM32 API で候補ウィンドウ配置
- **ファイル**: bin/native_terminal.rs (handle_key_input)

### KI-4: セッション復元が未接続 (Tauri版)
- **症状**: アプリ再起動時にPTYセッションが失われる
- **原因**: restore_last_session() が App.tsx から呼ばれていない
- **影響**: タブのメタデータは復元されるが PTY は新規スポーン
- **修正方針**: App.tsx の useEffect で restore_last_session を invoke
- **ファイル**: App.tsx, db/queries.rs

### KI-5: agent-exit イベント未送信 (Tauri版)
- **症状**: ヘッドレスエージェント完了時にUI上のステータスが更新されない
- **原因**: Rust backend がPTY終了時に agent-exit-{id} を emit していない
- **修正方針**: agent/claude.rs の output monitor 終了時に emit 追加
- **ファイル**: agent/claude.rs, agent/router.rs

## Medium

### KI-6: マウスイベント未対応 (native-terminal)
- テキスト選択、スクロール、リンククリック全て未実装

### KI-7: Output monitor スレッド停止なし (Tauri版)
- stop_interactive_agent 時に reader thread が graceful shutdown しない
- PTY close でEOF→breakで終了するが、一時的にCPUを消費

### KI-8: タブクローズ時の PTY クリーンアップ
- closeAllPtys を追加済みだが、useEffect cleanup のタイミングに依存
- 急速なタブ開閉で PTY がリークする可能性あり

## Low

### KI-9: 複数の catch {} でエラーが握り潰されている
- useInteractiveAgent, useAgentManager 等の async 処理
- ログ出力すべきだが、Tauri 外では console.error が見えないため放置

### KI-10: base64 エンコーダーが dead code (Tauri版)
- Vec<u8> 直接送信に切替済みだが、Base64Encoder struct が残っている
- interactive_commands.rs の base64_encode / Base64Encoder は削除可能
