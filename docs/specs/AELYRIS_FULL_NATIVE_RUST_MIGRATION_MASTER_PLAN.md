# Aelyris Full-Native Rust Migration — Master Plan

Status: accepted with amendments; queued post-A9; not active implementation
Decision class: **Critical / high blast radius / reversible staged migration**
Primary target: Windows 11, Rust-native operator surface
Final claim level: N4 WebView-free distribution

---

## 0. Repository integration decision

This package is adopted as the high-priority native UI migration contract, but
it does not create a concurrent work order. Current execution remains the exact
slice declared by root `audit-remediation-instructions.md`.

Dependency order:

```text
completed A4/A6/A7 remediation
  -> A8.0 product-goal/architecture decision (complete)
  -> A8.1 measured native terminal evidence and disposition
  -> A9 release and operator-proof closeout
  -> NUI-F0..F7 as the priority-1 next program
```

This sequencing preserves three facts:

1. startup reconciliation and execution fencing must be authoritative before a
   second UI process depends on them;
2. the native UI must project the settled Mission/Control owners instead of
   freezing incomplete React-era ownership into a new framework;
3. the existing A8 measured terminal decision remains the current release-path
   evidence gate and later feeds NUI baseline/promotion evidence without being
   rewritten into an unapproved full-product migration.

ADR-014 is accepted with amendments. The N4 direction is settled, but NUI-0.1
may activate it only after A9. A8.0 authorized neither pre-A9 execution nor a
shell-framework dependency. Current Tauri/React architecture and
alpha/not-release-ready claims remain authoritative until activation and later
promotion evidence.

NUI-F0 must compare Slint and the Aelyris retained-runtime candidate on one
same vertical before selecting at most one. Windows 11 x64 is the primary
target; Windows 10 compatibility is measured separately.

## 1. Executive decision

Aelyris の主要製品面を、Tauri + React + WebView2 から **Rust-native operator surface** へ移行する。

ただし、これは UI を一括で書き直す big-bang rewrite ではない。既存の Aelyris Core、Control API、mux daemon、PTY、persistence、Mission、proof、governance を保持したまま、UI face を次の順に置き換える。

```text
現在
┌─────────────────────┐
│ Tauri / React / DOM │  primary operator face
└──────────┬──────────┘
           │ Tauri IPC
┌──────────▼──────────┐
│ Aelyris Control API │
└──────────┬──────────┘
           │
      domain/runtime

移行中
┌─────────────────────┐    ┌─────────────────────┐
│ Native Rust Cockpit │    │ Tauri Compatibility │
└──────────┬──────────┘    └──────────┬──────────┘
           └──────────┬────────────────┘
                      ▼
              Aelyris Control API

完成
┌──────────────────────────────┐
│ Native Rust Operator Surface │ primary + complete
└──────────────┬───────────────┘
               ▼
       Aelyris Control API
```

### 1.1 Retained-runtime candidate を選んだ場合に独自開発するもの

以下は NUI-F0 の比較で retained-runtime candidate が勝った場合の契約である。Slint が同じ要件をより低い総所有コストで満たす場合は、同等 owner を再実装しない。どちらの場合も OS/API/レイアウト/アクセシビリティを二重所有しない。

独自 owner:

- retained UI tree と keyed reconciliation
- typed style/token model
- focus/event/command routing
- invalidation と scene generation
- Aelyris 向け widget set
- terminal/editor high-throughput surface
- Mission/agent/review/proof projection
- window material policy
- verifier/evidence hooks

再利用する owner:

- `winit`: window/event loop
- `windows-rs`: Win32、DWM、IME、clipboard、dialogs、power、taskbar、UIA
- `wgpu`: GPU abstraction、DX12 surface
- `taffy`: Block/Flexbox/Grid
- `AccessKit`: semantic accessibility tree
- DirectWrite: shaping、font fallback、glyph authority
- `alacritty_terminal`: VT/grid model
- 既存 Aelyris mux/PTY/control/persistence

全部自作は完成を遠ざける。Aelyris の moat はブラウザエンジンの再実装ではなく、agent fleet の可視性・統治・証拠・完了判定にある。

---

## 2. Current state assessment

### 2.1 すでに再利用可能な土台

現行 tree には、フルネイティブ移行の proof がかなり存在する。

- `src-tauri/Cargo.toml` に `aelyris-native` binary がある。
- `winit`、`wgpu`、`swash`、`windows-rs`、DirectWrite/DWM/IME/UIA feature が既に入っている。
- `aelyris_native.rs` は window、GPU、font atlas、IME、settings、command center、mode rail、inspector、UIA、visual QA、primary shell の proof command を持つ。
- `NativeRenderFrame` は WebView/React 非依存の renderer-neutral contract。
- `NativeRenderPipeline` は full/partial/unchanged の repaint commit を Rust 側で決める。
- `NativeTerminalInputHost` は committed input、native composition surface、paste guard の ownership を Rust へ寄せている。
- `verify-full-native-rust-gap-audit.mjs` は native proof の completeness を machine-readable に追跡している。

つまり、設計の問題は「可能か」ではなく、**proof 群を production architecture に昇格できるか**へ移っている。

### 2.2 現在の構造的問題

1. `aelyris_native.rs` が proof command の集積地になっている。新機能を追加し続けると第二の god file になる。
2. `src-tauri/src/lib.rs` が domain module export と Tauri composition root を兼ねる。Tauri managed state から runtime assembly を抽出する必要がある。
3. 既存 ADR は Tauri + React を primary とする。履歴を書き換えず、新 ADR で supersede する。
4. `TERMINAL_CORE_DESIGN.md` は full native rewrite を以前 reject している。Goal 変更と proof 成熟を理由に決定を更新する。
5. terminal は native proof が強いが、editor/Monaco replacement は別難易度。ここを独立 workstream にしないと WebView を最後まで消せない。

---

## 3. Product claim ladder

### N0 — Native Proof

- native window/GPU/input/UIA 等の proof がある
- 製品主役ではない
- focused proof の集合であり、移行完了ではない

### N1 — Native Terminal Primary

- 通常起動で native shell が primary
- terminal pane、split、input、IME、clipboard、selection、scrollback が実用可能
- Tauri は fallback
- editor/review/settings は legacy でもよい
- 「full native」とは呼ばない

### N2 — Native Cockpit Primary

- mode rail、inspector、command center、settings、dialogs、notifications が native
- terminal + agent fleet + Mission の日常運用が native shell で完結
- legacy editor を明示的に開く場合だけ Tauri
- Tauri は product truth を所有しない

### N3 — Native Core Workflow Complete

```text
Mission確認
→ agent/pane起動
→ terminal監督
→ project tree/search
→ diff/review
→ verifier evidence確認
→ approval/merge
→ settings/recovery
```

この流れが WebView なしで完結する。Tauri は optional compatibility。

### N4 — WebView-Free Distribution

- shipping binary に Tauri/Wry/WebView2/React/Vite/Node runtime dependency がない
- installer/updater/signing が native
- clean machine で native distribution のみで acceptance gate が通る
- ここで初めて「Aelyris はフルネイティブ Rust UI」と主張可能

---

## 4. Architectural principles

### P1. Rust truth remains authoritative

UI は状態を作らない。UI は backend-owned projection を描画し、typed intent を Control Kernel へ送る。

禁止:

- UI 独自の completion 判定
- UI 独自の merge eligibility
- UI 独自の agent status taxonomy
- UI から DB/managers への抜け道
- native UI 専用の第二 command registry

### P2. Tauri is strangled, not detonated

- native と Tauri は同じ runtime/control projection を使う
- feature parity を gate で証明
- surface 単位で primary ownership を移す
- compatibility face を最後に削除

### P3. Aelyris-specific framework only

Aelyris 内部で必要な widget と rendering primitive だけ作る。公開 toolkit、plugin ABI、CSS selector、HTML parser は scope 外。

### P4. Special surfaces may bypass generic widgets

Terminal、editor、large diff、fleet graph は generic text/widget path へ押し込まない。

- layout/focus/hit-test/a11y には参加
- paint は dedicated surface renderer
- data update は dedicated mailbox
- generic UI tree 全体の reconciliation を起こさない

### P5. Contract before visual polish

typed state、event/command、focus/input、recovery、verifier を先に固定し、その後 glass/animation を積む。

### P6. Every capability claim is verifier-backed

N1〜N4 の promotion は aggregate verifier bundle が PASS しない限り禁止。

---

## 5. Target architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                    aelyris-native-shell                      │
│  winit event loop / HWND / window lifecycle / app startup   │
└───────────────────────┬──────────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────────┐
│                 Aelyris Native UI Runtime                    │
│  UiTree · reconcile · style · layout · focus · input        │
│  command registry · a11y · invalidation · animation         │
└──────────────┬───────────────────────┬───────────────────────┘
               │                       │
┌──────────────▼─────────────┐  ┌──────▼──────────────────────┐
│ Generic UI Scene Renderer  │  │ Dedicated High-throughput   │
│ rect/text/icon/image/clip  │  │ terminal/editor/diff views  │
└──────────────┬─────────────┘  └──────┬──────────────────────┘
               └──────────────┬────────┘
                              ▼
                 wgpu / DX12 / glyph atlas
                              │
                    HWND / DWM / compositor

Native UI actions
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│ Native Control Adapter                                      │
│ principal · command ID · idempotency · correlation · audit  │
└───────────────────────┬──────────────────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────────────────┐
│ Canonical Aelyris Control Kernel / API                       │
│ Mission · agent · pane · worktree · diff · proof · merge    │
└───────────────────────┬──────────────────────────────────────┘
                        ▼
  existing domain owners / SQLite / mux daemon / PTY / sidecars
```

### 5.1 Runtime composition root

```rust
pub struct AelyrisRuntime {
    pub control: Arc<ControlKernel>,
    pub projections: Arc<ProjectionHub>,
    pub terminals: Arc<TerminalRuntime>,
    pub missions: Arc<MissionRuntime>,
    pub database: Arc<Database>,
    pub events: Arc<EventBus>,
    pub shutdown: ShutdownCoordinator,
}
```

Tauri adapter と native shell は同じ `Arc<AelyrisRuntime>` を受け取る。

### 5.2 Adapter rule

```text
Native UI → NativeControlAdapter → ControlKernel → domain owner
Tauri    → Tauri IPC adapter     → ControlKernel → domain owner
MCP      → MCP adapter           → ControlKernel → domain owner
```

Adapter は marshalling と principal/context 付与だけ。business logic を置かない。

### 5.3 Projection model

```rust
pub struct ProjectionSnapshot<T> {
    pub revision: u64,
    pub generated_at: SystemTime,
    pub value: Arc<T>,
}
```

- general projection: latest-wins/coalesced
- audit/decision/evidence: no-loss event stream
- terminal frame: per-pane bounded mailbox + snapshot resync
- large lists: paged/virtualized query

---

## 6. Recommended crate/workspace shape

```text
Cargo.toml
apps/
  aelyris-native/
  aelyris-cli/
  aelyris-tauri-compat/
crates/
  aelyris-core/
  aelyris-runtime/
  aelyris-control/
  aelyris-projection/
  aelyris-platform-windows/
  aelyris-ui-core/
  aelyris-ui-layout/
  aelyris-ui-render/
  aelyris-ui-text/
  aelyris-ui-accessibility/
  aelyris-terminal-view/
  aelyris-editor-core/
  aelyris-editor-view/
  aelyris-native-components/
  aelyris-verify/
```

最初にファイルを全部移動しない。

1. root workspace を作るが `src-tauri` package を member として維持。
2. `AelyrisRuntimeBuilder` を新 crate に抽出。
3. Tauri `run()` は runtime を build して adapter へ渡すだけにする。
4. native app が同じ runtime を使用。
5. ownership が安定した module だけ順次 crate 化。
6. `aelyris_native.rs` proof command は各 crate の integration test/verifier へ移す。
7. proof binary は薄い dispatcher へ縮小し、最終的に `aelyris-verify` へ統合。

---

## 7. Framework strategy

**Retained tree + declarative builder + keyed reconciliation** を採用する。

```text
Application projection
    ↓ build Element tree
Keyed reconciliation
    ↓ stable UiNode tree
Style resolution
    ↓
Taffy layout + custom split/grid layout
    ↓
Hit-test / focus / accessibility tree
    ↓
Scene generation
    ↓
wgpu passes
```

各 node dirty flag:

```text
TREE
STYLE
LAYOUT
PAINT
A11Y
HIT_TEST
```

terminal frame 更新は terminal surface の `PAINT` のみで、cockpit 全体の reconcile/layout を起こさない。

Event model:

- capture → target → bubble
- pointer capture
- focus scopes
- modal stack
- typed `UiAction`
- shortcut command は Rust の単一 registry
- command execution は Control API を経由

---

## 8. Windows-native platform policy

### 8.1 Window

- `winit` を event loop/window abstraction に使用
- raw HWND を `windows-rs` integration へ渡す
- custom titlebar/hit-test/snap support
- per-monitor DPI v2
- system theme/high contrast/reduced motion
- power/suspend/resume event

### 8.2 Transparency/material modes

```rust
pub enum MaterialMode {
    SeeThrough,  // DWMSBT_NONE + premultiplied alpha
    Mica,
    Acrylic,
    Wallpaper,
    Opaque,
}
```

Hard rule:

- `SeeThrough` は DWM backdrop material を使わない
- glyph/text は最終合成で完全不透明
- background alpha と content alpha を分離
- `SurfaceCapabilities::alpha_modes` を起動時に検証
- transparency claim は OS screenshot proof のみ

### 8.3 IME

最初は既存 `NativeTerminalInputHost` を productionize。

- focused surface ごとに caret rectangle を screen coordinate へ変換
- preedit と candidate selection を native HWND で扱う
- result string のみ PTY/editor transaction へ commit
- `WM_CHAR` 二重 commit を禁止
- terminal/editor 共通 `TextInputService`
- IMM32 を N1、TSF backend は editor requirement が反証した場合に昇格
- 日本語 candidate UI は manual dogfood gate 必須

### 8.4 Accessibility

- generic UI: AccessKit semantic tree
- Windows bridge: AccessKit adapter + existing UIA proof
- terminal/editor:必要に応じて custom UIA TextPattern provider
- unnamed focusable node = hard fail
- keyboard-only core workflow
- Narrator manual sweep を release gate に含める

---

## 9. Terminal migration

既存 `GridSnapshot` → `NativeRenderFrame` → `NativeRenderPipeline` を canonical hot path にする。

Render passes:

1. background/material
2. terminal cell backgrounds
3. inline images
4. glyph instances
5. search/selection/link overlays
6. cursor
7. IME preedit/candidate anchor
8. focus/diagnostic overlay

DirectWrite を Windows text authority とする。

```rust
pub trait TextSystem {
    fn shape(&mut self, request: ShapeRequest) -> Result<ShapedRun, TextError>;
    fn rasterize(&mut self, key: GlyphKey) -> Result<GlyphBitmap, TextError>;
    fn measure(&mut self, request: MeasureRequest) -> Result<TextMetrics, TextError>;
    fn resolve_font(&mut self, request: FontRequest) -> Result<FontFaceId, TextError>;
}
```

Terminal では contiguous cluster を run 化し、wide cell / combining mark / ligature の cell↔cluster map を保持する。Missing glyph を黙って `?` にしない。

Failure recovery:

- surface lost → reconfigure
- device lost → renderer rebuild
- atlas overflow → atlas reset
- GPU denylist → safe fallback
- blank pane は禁止

---

## 10. Cockpit migration

Native cockpit の最小構成:

- mode rail
- titlebar/workspace selector
- central pane tree
- contextual inspector
- command center/attention
- status bar
- command palette
- settings
- dialogs/toasts

移植順:

```text
terminal pane tree
→ mode switching
→ selected entity projection
→ inspector
→ command center actions
→ settings/material
→ project tree/search
→ diff/review
→ editor
```

既存 React component を機械的に1対1 port しない。backend projection と user job を再確認し、view-local fake state を持ち込まない。

---

## 11. Editor/Monaco strategy

### E0 — Legacy editor compatibility

Native shell から legacy editor を明示起動。N1/N2 をブロックしない。

### E1 — Native read-only source/diff viewer

- virtualized text
- syntax highlight
- selection/copy/search
- inline diff
- diagnostics
- review comment anchor

これで review/merge workflow を WebView なしで成立させる。

### E2 — Native core editor

- Rope document model
- transaction-based undo/redo
- multi-selection
- grapheme movement
- IME
- incremental Tree-sitter
- LSP core
- save/conflict/recovery

### E3 — Advanced parity

- rename/code actions polish
- merge editor
- advanced multi-cursor
- large file mode polish
- plugin story は別判断

N4 は「Monaco全API同等」ではなく、Aelyris core workflow の acceptance matrix を満たすことを条件にする。

---

## 12. Migration sequence

### F0 — Authority and baseline

ADR、requirements/spec/design/gate、surface inventory、baseline、proof decomposition。

### F1 — Runtime extraction

`AelyrisRuntimeBuilder`、ProjectionHub、NativeControlAdapter、Tauri compatibility adapter、parity verifier。

### F2 — UI runtime foundation

winit shell、Windows platform、wgpu、UiTree、Taffy、focus/input、DirectWrite、AccessKit、visual harness。

### F3 — Native terminal primary

terminal surface、multi-pane、IME/clipboard、selection/search/link/image、live AI CLI、recovery。N1。

### F4 — Native cockpit primary

mode rail、command center、inspector、Mission、settings、dialogs、a11y。N2。

### F5 — Workspace and review

project tree、search、git/worktree、diff、review/evidence/merge。

### F6 — Native editor

E1→E2、LSP、save/recovery/large-file/IME/a11y。N3。

### F7 — Distribution replacement

native updater/installer/signing、legacy demotion/removal、clean-machine test。N4。

---

## 13. Stop conditions and rollback

Rollback a WU when:

- Current Best より入力遅延/安定性が明確に悪化
- native path が Control API bypass を生む
- IME commit 二重化/文字欠落
- device loss で blank pane
- accessibility tree が壊れる
- proof artifact が観測ではなく自己申告になる

Reopen architecture when:

- winit/wgpu surface で premultiplied alpha が target GPU matrix を満たさない
- DirectWrite pipeline が throughput target を満たさない
- AccessKit で terminal/editor semantics を表せない
- editor IMM32 で candidate/caret correctness を達成できない
- native UI framework の保守量が product work を恒常的に上回る

Rollback shape:

- surface ownership feature flag
- same runtime/projection
- Tauri compatibility client
- schema/version backward compatibility
- evidence artifact に active surface owner を記録

---

## 14. Success picture

- native window が高速に立ち上がる
- see-through/Mica/Acrylic/wallpaperを正しく選べる
- 16 pane 級の fleet を低遅延で監督できる
- 日本語で agent に直接指示できる
- Mission、proof、review、merge が native cockpit にある
- sleep/restart 後も daemon-owned session と UI state が戻る
- WebView lifecycle failure が全体を巻き込まない
- UI action は同じ Control Kernel、governance、audit を通る
- Tauri/React/Node を shipping runtime に必要としない

ここまで到達して、Aelyris は **Windows と一体化した Rust-native Verifiable Agent Work OS** になる。
