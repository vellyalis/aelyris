# Phase 3 机上コードレビュー

**実施日**: 2026-04-18
**対象**: Phase 3A / 3B / 3C-1 (commit 25016df 時点)
**観点**: race condition、メモリリーク、エッジケース、silent failure、ux 劣化
**目的**: 実機視覚検証が難しい (Claude 経由で操作不可) ので、コードレビューで潜在バグ候補を先に炙り出す

## Severity

| レベル | 意味 |
|---|---|
| 🔴 HIGH | 実運用でよく踏みそう or 誤適用・データロス系 |
| 🟡 MED | 稀に踏む or UX 劣化 |
| 🟢 LOW | 理論上、実害は小さい |

## 🔴 HIGH

### H1. Tab 連打で意図しない hunk が apply される

**場所**: [useGhostPaintForFile.ts](src/features/editor/useGhostPaintForFile.ts) `acceptHunkAtLine`

**問題**:
1. Tab#1 押下 → `acceptHunkAtLine(line)` 開始 → IPC `apply_ghost_hunk(layer_id, file, hunk_index=0)` in-flight
2. IPC 完了前に Tab#2 発火 (人間の連打でもあり得る)
3. Tab#2 は **前回 render 時の hunkAnchors** を参照する
4. Tab#1 の結果が Rust 側で `registry.remove_hunk(layer, file, 0)` → `layer.hunks.remove(0)` → 配列が左詰め
5. Tab#2 が同じ `hunk_index=0` を指定して invoke → Rust 側で **remove 後の新しい hunks[0] = 元の hunks[1]** が apply される
6. ユーザーは「hunk 1 個だけ試したい」と思って Tab 1 回押しただけのつもりが、**隣接 hunk も巻き込んで適用される**

**再現手順** (目視):
- 同じファイルに複数 hunk の ghost layer
- hunk 行にカーソル置いて Tab 2 回連続 (IPC より早く)

**軽減案**: `useGhostPaintForFile` に in-flight フラグ追加
```ts
const inFlightRef = useRef(false);
const acceptHunkAtLine = useCallback(async (line) => {
  if (inFlightRef.current) return null;
  inFlightRef.current = true;
  try {
    // ... 既存処理
  } finally {
    inFlightRef.current = false;
  }
}, [hunksAtLine]);
```

**コスト**: 小 (~10行 + 2 tests)

---

### H2. apply_ghost_hunk が hunk_index ベースで脆弱

**場所**: [ipc/ghostdiff_commands.rs](src-tauri/src/ipc/ghostdiff_commands.rs) `apply_ghost_hunk`

**問題**: H1 の根本原因。frontend が送る `hunk_index` は frontend snapshot 時点の index だが、Rust 側では他操作で shifts している可能性がある。backend は盲目的に `hunks.get(hunk_index)` を引く。

**例** (H1 以外の踏み方):
- 別の editor tab で同じ file の別 hunk を accept (遠隔 mutation)
- auto-repair が走って layer に新 hunk が push されて array 先頭に入る場合

**軽減案**: 2 案
- **A (軽)**: H1 の in-flight ロックで事実上防ぐ (他 tab での操作は rare)
- **B (重)**: `DiffHunk` に content hash (head_content の blake3 short) を持たせて、IPC 側で「hunk_index の hunk の hash が frontend のと一致」を verify、不一致なら reject

Phase 3C-1c の現実運用では A で十分。B は 3C-2 以降で multi-tab apply が増えたら検討。

**コスト**: A → H1 と同時、B → 中

---

### H3. auto-repair poller thread が panic すると ghost-diff events が永久停止

**場所**: [lib.rs](src-tauri/src/lib.rs) の 500ms poller スレッド

**問題**:
- 同一 thread が auto-repair poll + ghost-diff `registry.poll()` 両方を emit
- thread 内で panic すると **両機能とも永久停止** (process は生存、UI は単に更新止まる)
- `catch_unwind` 等のガードなし
- panic 要因: registry.poll() は Mutex::lock() poisoned 時に空 Vec を返すので安全だが、`repair_handle.emit()` 周辺でシリアライズエラー等の panic 可能性は残る

**軽減案**: thread body を `std::panic::catch_unwind` で包む、または tokio spawn + `JoinHandle::abort_handle()` 経由で監視スレッド追加

**コスト**: 中 (panic 時の復旧ポリシー設計が要る)。後回し可。

---

## 🟡 MED

### M1. apply 後カーソルが (1,1) に飛ぶ

**場所**: [EditorPanel.tsx](src/features/editor/EditorPanel.tsx) `replaceModelValue`

**問題**: `editor.setValue(next)` は Monaco 仕様で cursor を (1,1) にリセットする。ユーザーが Tab で hunk apply した直後に何か打つと、ファイル先頭から入力が始まってしまう。plan の「カーソル位置がおおむね保たれている」要件を満たさない。

**軽減案**:
```ts
const replaceModelValue = (next: string) => {
  const pos = editor.getPosition();
  suppressModelChangesRef.current = true;
  editor.setValue(next);
  setContent(next);
  if (pos) {
    // 行数変化があっても最も近い line に戻す
    const model = editor.getModel();
    const clamped = model
      ? Math.min(pos.lineNumber, model.getLineCount())
      : pos.lineNumber;
    editor.setPosition({ lineNumber: clamped, column: pos.column });
  }
  queueMicrotask(() => { suppressModelChangesRef.current = false; });
};
```

**コスト**: 小 (~10行 + 1 test)

---

### M2. multi-cursor 編集中に Tab の default (indent) が奪われる

**場所**: [EditorPanel.tsx](src/features/editor/EditorPanel.tsx) ContextKey 条件

**問題**: preempt 条件は `"aetherGhostHunkAtCursor && !suggestWidgetVisible && !editorHasSelection"`。multi-cursor 状態で secondary cursor が ghost hunk 行に乗ると aetherGhostHunkAtCursor = true、primary cursor で indent したくても Tab は ghost accept に奪われる。

**軽減案**: `!editorHasMultipleSelections` 等の条件を追加。Monaco の standard context key あれば利用、なければ custom で管理。

**コスト**: 小。ただし multi-cursor 利用頻度は低いので優先度下げて良い。

---

### M3. dismissFileLayers が IPC エラーを silent

**場所**: [useGhostPaintForFile.ts](src/features/editor/useGhostPaintForFile.ts) `dismissFileLayers`

**問題**: `try { await invoke("dismiss_ghost_file", ...) } catch {}` で全部握りつぶす。backend で registry lock poisoned の場合など、ユーザーに理由不明のまま消えない。

**軽減案**: catch で toast.warn or console.warn に詳細残す。
```ts
catch (e) {
  console.warn(`dismiss_ghost_file failed for ${layer.id}: ${e}`);
}
```

**コスト**: 極小。

---

### M4. ghostdiff 初期 diff 失敗時、UI に何も通知されない

**場所**: [ghostdiff/mod.rs](src-tauri/src/ghostdiff/mod.rs) `register_worktree_and_watch`

**問題**: `diff_engine::compute_diff` の初期呼出が Err のとき `log::warn!` のみ。panel には layer だけ空で表示される (hunkCount=0)。ユーザーは「なぜ空？」と思う。

**軽減案**: エラー時に layer に `error_message: Option<String>` を持たせて UI で "diff unavailable" 表示。あるいは `log::error!` で開発時だけ気付ける。

**コスト**: 中 (Layer 型 + Panel UI 変更)。後回し可。

---

## 🟢 LOW

### L1. `resolve_main_path` の過剰 reject (既知、report-only)

`file_path.contains("..")` が `foo..bar.ts` みたいな珍しいファイル名を弾く。segment-level check で十分。既に 3C-1c 承認時に報告済、修正保留中。

---

### L2. 500ms poller で ghost-diff events が最大 500ms 遅延

**場所**: [lib.rs](src-tauri/src/lib.rs) 

**問題**: fs watcher は 300ms debounce → `refresh` → `tx.send`。これを拾う poller は 500ms 周期。最悪 ghost paint の更新までに 800ms かかる。plan の「1 秒以内出現」を満たすが僅差。

**軽減案**: poller 周期 200ms に、debounce 150ms に。ただしコストはトータル事件量依存。現状で実用上問題ないなら放置。

---

### L3. `acceptAllInFile` が全 layer sequential invoke

**場所**: [useGhostPaintForFile.ts](src/features/editor/useGhostPaintForFile.ts) `acceptAllInFile`

**問題**: layer 数 × IPC round-trip で待つ。1 file に 10 layer あると Shift+Tab で 10×~20ms = 200ms。

**軽減案**: Rust 側に `apply_ghost_file_multi(layer_ids, file)` を作って 1 IPC で複数 layer 処理。ただし現状 1 file に layer 数個程度の想定なので overkill。

---

### L4. EditorPanel の再マウント時 suppressRef が true のまま残る可能性

**場所**: [EditorPanel.tsx](src/features/editor/EditorPanel.tsx)

**問題**: `replaceModelValue` 実行中 (microtask 未実行) にコンポーネントが unmount → suppressRef は無意味だが、新たな editor インスタンスで `useRef(false)` 初期化されるため実害なし。確認のみ、実害ゼロ。

---

### L5. `isNoise` filter に `dist/` や `coverage/` が無い

**場所**: [ghostdiff/watcher.rs](src-tauri/src/ghostdiff/watcher.rs) `is_noise`

**問題**: Next.js は `.next/` を filter 済だが、`dist/` (tsc output)、`coverage/` (jest/vitest) は filter されてない。プロジェクトによっては build 成果物が頻繁に変わって ghost-diff が反応する。

**軽減案**: `is_noise` に追加 `/dist/` `/coverage/` `/.cache/` `/.turbo/`。

**コスト**: 極小。

---

## 推奨対応順

1. **H1 + H2 (軽減案 A)**: in-flight lock で Tab 連打をブロック。**最優先**。影響大、コスト小
2. **M1**: カーソル位置保持 (UX 大きく改善)。コスト小
3. **L5**: `is_noise` フィルタ拡充。コスト極小、設定忘れ防止
4. **M3**: dismiss 失敗の warn ログ。コスト極小
5. **H3 / M4 / L1 / L2 / L3**: 後回し、必要になったら対応

## 非観察項目

以下は本レビューで精査していない (必要になったら別途)。

- Phase 3A-1 auto-repair の TimeoutError / claude CLI 非存在時の挙動
- Phase 3A-2 ghost typing の PSReadLine 干渉回帰
- Phase 3B-1 Orchestra の role 制約 (implementer だけ起動可能か等)
- Phase 3B-2 semantic search の embedding 精度
