# Aelyris Native UI Requirements

Status: high-priority queued proposal; not current implementation or product claim
Authority layer: Requirements
Requirement prefix: `NUI-*`
Claim policy: verifier-backed; prose aloneでshipped扱いしない。

Activation boundary: priority-1 after A9 by default. A8.0 may recommend an
earlier takeover only through an explicit owner decision and a rebaselined
tracked program. Current Tauri/React product truth remains authoritative until
an N-level aggregate gate promotes a native surface.

---

## 1. Scope

本書は、Aelyris の primary operator surface を Tauri/React/WebView2 から Rust-native UI へ移行するための要求を定義する。

対象:

- Windows window/chrome/material
- terminal pane/multiplexer projection
- agent/Mission/cockpit
- project tree/search/git/diff/review
- native editor
- input/IME/clipboard/mouse
- accessibility
- rendering/performance/recovery
- installer/updater/signing
- Tauri compatibility demotion/removal

非対象:

- Mission/TaskGraph/Control API の第二実装
- mux daemon/PTY protocol の再発明
- 汎用 GUI toolkit の公開
- macOS/Linux shipping parity
- Monaco 全機能の無条件な完全複製
- CSS/DOM/HTML engine
- unrestricted plugin ecosystem

---

## 2. Requirement metadata

各 requirement は次を持つ。

```text
ID
Title
Priority: MUST / SHOULD / MAY
Owner
Rationale
Acceptance
Evidence artifact
Dependencies
Status
Supersedes / conflicts
```

Status:

- `proposed`
- `accepted`
- `in_progress`
- `verified`
- `blocked`
- `rejected`
- `superseded`

---

## 3. Product and authority requirements

### NUI-PROD-001 — Native surface is the final primary product

Priority: MUST
Owner: product architecture

N4 では、通常ユーザーが操作する shipping surface は Rust-native process でなければならない。

Acceptance:

- default launcher が native binary
- core workflow が WebView を起動しない
- installer manifest に WebView frontend bundle が含まれない
- dependency/binary/runtime probe が一致

Evidence: `.codex-auto/quality/native-ui/webview-free-distribution.json`

### NUI-PROD-002 — Product truth remains backend-owned

Priority: MUST
Owner: Aelyris Control Kernel

UI は次を所有してはならない。

- Mission completion
- merge eligibility
- proof validity
- agent lifecycle truth
- ownership conflict truth
- permission grant
- durable session truth

Acceptance:

- UI action は canonical command ID を通る
- UI projection は backend revision を参照
- bypass inventory が空
- direct manager/DB access が検出されない

### NUI-PROD-003 — Tauri is a compatibility face during migration

Priority: MUST

N4 以前は Tauri を破壊的に消さない。各 surface は native parity gate 後にのみ compatibility へ降格する。

### NUI-PROD-004 — No second runtime/control plane

Priority: MUST

Native UI のために第二の TaskGraph、Mission runner、PTY manager、merge path、approval engine、event journal を作らない。

---

## 4. Runtime requirements

### NUI-RUN-001 — Tauri-neutral composition root

Priority: MUST
Owner: `aelyris-runtime`

`AelyrisRuntimeBuilder` は Tauri 型に依存せず、native/Tauri/MCP/CLI から同じ runtime を構築できる。

Acceptance:

- runtime crate に `tauri::*` import がない
- Tauri `run()` は adapter/composition の薄いコード
- native app integration test が同じ service graph を起動

### NUI-RUN-002 — Explicit lifecycle and shutdown

Runtime は以下を区別する。

- UI close
- native process exit
- daemon detach
- full application shutdown
- crash recovery
- OS suspend/resume
- updater restart

No-orphan invariant を維持しつつ、daemon-owned session を意図通り保持する。

### NUI-RUN-003 — Projection hub

UI は typed、revisioned projection を購読する。

Acceptance:

- each projection has `revision`
- stale update rejection
- snapshot resync
- bounded channel
- no-loss channel for audit/decision/evidence
- latest-wins channel for high-frequency summaries

### NUI-RUN-004 — Backpressure policy is explicit

| Class | Policy |
|---|---|
| audit / approval / proof | no-loss, durable |
| Mission/agent summary | latest-wins + revision |
| terminal frame | bounded diff + full snapshot resync |
| telemetry | sampled/drop allowed |
| user input | ordered, no silent drop |

### NUI-RUN-005 — Native adapter uses canonical Control Kernel

Native UI は in-process typed adapter を使用し、HTTP/JSON loopback を primary path にしない。

```rust
pub struct CommandEnvelope<T> {
    pub command_id: ControlCommandId,
    pub principal: Principal,
    pub correlation_id: CorrelationId,
    pub idempotency_key: Option<IdempotencyKey>,
    pub expected_revision: Option<u64>,
    pub payload: T,
}
```

---

## 5. Window/platform requirements

### NUI-WIN-001 — Windows 11 primary

First shipping target は Windows 11 x64。Windows 10 は compatibility/measurement 結果で別判定。

### NUI-WIN-002 — Per-monitor DPI v2

- mixed-DPI multi-monitor
- live monitor move
- scale change
- pointer/hit-test/text/caret coordinate conversion
- screenshot proof at 100/125/150/200%

### NUI-WIN-003 — Custom chrome without breaking OS affordances

- drag region
- resize border
- minimize/maximize/close
- Snap Layout
- system menu
- Alt+Space
- taskbar grouping
- high contrast
- window restore bounds

### NUI-WIN-004 — Material modes are distinct

`SeeThrough`, `Mica`, `Acrylic`, `Wallpaper`, `Opaque` を別 mode として扱う。

`SeeThrough`:

- DWM material none
- premultiplied alpha
- desktop/window-behind visibility
- opaque glyphs

`Mica/Acrylic` は see-through と同一 claim をしない。

### NUI-WIN-005 — No blank-window failure

GPU/device/surface/material failure で blank window を出さない。fallback または fatal diagnostic screen を表示する。

### NUI-WIN-006 — Power lifecycle

Suspend/resume、display change、GPU adapter reset 後に:

- window visible
- input works
- terminal frames resume
- no duplicate PTY
- no lost Mission/review state

---

## 6. UI framework requirements

### NUI-UI-001 — Stable retained node identity

- generational NodeId
- keyed reconciliation
- stable focus/accessibility identity
- removed node cannot be mistaken for reused node

### NUI-UI-002 — Typed style and tokens

CSS selector/string cascade を作らず、Rust type と design tokens で style を定義する。

Required tokens:

- color roles
- spacing
- typography
- radius
- border
- elevation/shadow
- opacity/material
- motion duration/easing
- density
- focus ring

### NUI-UI-003 — Layout reuse

Block/Flex/Grid は Taffy。Aelyris は custom split pane、terminal cell grid、editor viewport だけを独自 layout owner とする。

### NUI-UI-004 — Event phases and pointer capture

- capture/target/bubble
- pointer capture
- hover/pressed/drag states
- wheel precision
- multi-click
- context menu
- touchpad scrolling
- keyboard modifiers

### NUI-UI-005 — Focus correctness

- one focused node per window
- focus scopes
- modal trapping
- restoration after dialog
- keyboard traversal
- visible focus
- terminal/editor focus handoff
- no focus trap between input HWND and main surface

### NUI-UI-006 — Single shortcut owner in Rust

Global cockpit shortcuts、command palette、help labels は Rust command registry から生成する。TS registry は native promotion 後に compatibility projection へ降格する。

### NUI-UI-007 — Virtualization

- tree/list/grid
- terminal scrollback
- code/diff
- agent/event history
- large evidence lists

### NUI-UI-008 — Deterministic scene output

同じ projection/theme/viewport から stable scene snapshot/hash を生成する。

### NUI-UI-009 — Internal framework only

N4 まで public toolkit API、third-party widget ABI、CSS compatibility を約束しない。

---

## 7. Rendering requirements

### NUI-REN-001 — wgpu DX12 primary

- DX12 first-class
- adapter/device selection logged
- capability/limit capture
- device lost recovery
- safe fallback policy

### NUI-REN-002 — Idle means no continuous redraw

Animation/terminal update がなければ event loop は wait し、無意味な frame を描画しない。

### NUI-REN-003 — Premultiplied alpha contract

- scene/texture alpha conventionを統一
- surface alpha capability probe
- text/glyph opacity contract
- transparent clear
- screenshot proof

### NUI-REN-004 — Render pass contract

1. window background/material
2. generic opaque panels
3. shadow/elevation
4. terminal/editor/diff surfaces
5. overlays
6. text/icons
7. focus/IME/debug

### NUI-REN-005 — Clip correctness

- rectangular/rounded/nested clip
- terminal viewport clip
- no glyph bleed
- no fractional-DPI seam

### NUI-REN-006 — Renderer diagnostics

- frame time
- scene build/layout
- submit/present
- glyph atlas
- texture memory
- dirty node/cell count
- recovery count

---

## 8. Text requirements

### NUI-TXT-001 — DirectWrite authority on Windows

Shaping/font fallback/glyph identity は DirectWrite を authority とする。

### NUI-TXT-002 — No silent missing-glyph substitution

Font fallback failure は telemetry/diagnostic に出し、黙って `?` を描いて成功扱いしない。

### NUI-TXT-003 — Japanese and mixed-script correctness

Fixtures:

- 日本語
- Latin
- combining marks
- emoji
- CJK wide cell
- RTL sample
- ligature sample
- Powerline/Nerd Font symbols

### NUI-TXT-004 — Glyph atlas

Key must include:

- font face
- glyph id
- pixel size
- DPI scale
- weight/style
- render mode
- subpixel quantization
- color/monochrome mode

### NUI-TXT-005 — Text measurement consistency

Layout measurement、caret hit-test、rendered glyph positions が同じ shaping result を使う。

---

## 9. Terminal requirements

### NUI-TERM-001 — Existing terminal truth is reused

`GridSnapshot`, `NativeRenderFrame`, `NativeRenderPipeline`, mux/PTY truth を再利用。UI専用 VT parser を作らない。

### NUI-TERM-002 — One pane = one interactive surface

各 visible agent pane は actual PTY、scrollback、steerable input、stable pane/session ID を持つ。

### NUI-TERM-003 — Multi-pane correctness

- split/close/move/swap/rotate/zoom/equalize
- resize cell calculation
- synchronized input guard
- focus
- per-pane selection/scroll state
- no input misrouting

### NUI-TERM-004 — Input ownership

Keyboard、IME commit、clipboard paste、mouse reporting は Rust native input owner を通る。

### NUI-TERM-005 — Paste safety

- destructive signature deny
- multi-line confirm
- bracketed paste support
- normalized line endings
- audit event
- no bypass via drag/drop/context menu

### NUI-TERM-006 — Terminal visual features

- ANSI colors/attrs
- cursor shapes/blink
- selection/search
- OSC-8 links
- inline images
- wide/combining cells
- scrollback
- font fallback

Ligature/color emoji は separate gate でもよいが claim を限定する。

### NUI-TERM-007 — Live AI CLI dogfood

Codex/Claude/Gemini provider matrixで prompt、Japanese IME、output flood、interrupt、resize、detach/reattach、sleep/resume、chaosを検証する。

---

## 10. Cockpit requirements

### NUI-COCK-001 — Native mode shell

Modes:

- terminal
- agents
- workspace
- review
- git
- context
- history
- settings

Shortcut/order/helpは Rust registry authority。

### NUI-COCK-002 — Contextual inspector

Selected entity route に応じて backend projection を表示。view-local fake dataは禁止。

### NUI-COCK-003 — Command Center

- evidence
- blockers
- actions
- Now/Next/Unlocks
- provenance
- recovery
- action dispatch

### NUI-COCK-004 — Settings

- theme/material/opacity
- wallpaper
- font
- terminal profile
- keymap
- accessibility
- performance/fallback
- launch behavior

### NUI-COCK-005 — Dialogs and notifications

N4ではfile/folder picker、confirmation、error、toast、Windows notification、updater promptにTauri pluginを使わない。

---

## 11. Workspace/review requirements

### NUI-WORK-001 — Project tree

- lazy load
- file status
- worktree/ownership markers
- keyboard navigation
- large repo performance

### NUI-WORK-002 — Search

- filename/content search projection
- streaming results
- cancellation
- result virtualization
- open location

### NUI-WORK-003 — Diff/review

- unified/split diff
- syntax highlight
- hunk navigation
- ownership/evidence annotations
- review decision
- exact commit binding
- merge gate state

### NUI-WORK-004 — No unsafe direct file mutation

UI diff/editor operation は approved domain command/path containment/conflict check を通る。

---

## 12. Editor requirements

### NUI-EDIT-001 — Native read-only viewer before full editor

N3前半で source/diff review を native で完結させる。

### NUI-EDIT-002 — Core document model

- rope/piece-tree equivalent
- UTF-8 safe
- line index
- selections
- transaction log
- undo/redo
- dirty/save revision
- external change conflict

### NUI-EDIT-003 — Editing correctness

- insert/delete
- grapheme/word/line movement
- multiple selections
- auto-indent
- tabs/spaces
- find/replace
- clipboard
- IME composition

### NUI-EDIT-004 — Syntax/LSP

- incremental Tree-sitter
- diagnostics
- hover/completion
- definition/references
- code actions
- rename may be late

### NUI-EDIT-005 — Large file mode

Threshold超過時に expensive features を degradeし、freezeしない。

### NUI-EDIT-006 — Save safety

- expected revision/CAS
- atomic write
- encoding/newline preservation
- external modification conflict
- recovery journal
- no silent overwrite

### NUI-EDIT-007 — Monaco parity matrix

削除判定は feature inventory と user job acceptance で行い、「Monaco 全API実装」を要求しない。

---

## 13. Input/IME requirements

### NUI-INP-001 — Ordered input

Input event sequenceに monotonic ID。silent drop/reorder禁止。

### NUI-INP-002 — Native Japanese IME

- composition start/update/end
- candidate selection
- caret positioning
- result string exactly once
- terminal/editor both
- focus transition
- DPI correctness

### NUI-INP-003 — Mouse modes

- UI pointer
- terminal mouse reporting
- selection override modifier
- wheel/precision touchpad
- drag/drop
- capture loss handling

### NUI-INP-004 — Clipboard

- Unicode text
- file paths where supported
- ownership failures handled
- security/paste gate
- audit for mutating paste action

---

## 14. Accessibility requirements

### NUI-A11Y-001 — Semantic tree

Every focusable element has role、accessible name、state、bounds、action、stable ID。

### NUI-A11Y-002 — UI Automation

Windows UIA client が root/descendants/actions を観測できる。

### NUI-A11Y-003 — Keyboard-only core workflow

N3 core workflow を mouseなしで完了。

### NUI-A11Y-004 — Screen reader manual gate

Narratorで mode navigation、terminal、inspector/actions、dialogs、project tree、diff/editor basic navigationを確認。

### NUI-A11Y-005 — High contrast/reduced motion

OS settingsに追従し、contrast/focusを失わない。

---

## 15. Performance requirements

初回は baseline capture後に enforce。目標値は marketing claim ではない。

### NUI-PERF-001 — Input-to-present

- terminal p99 target: `< 16 ms`
- general UI p99 target: `< 24 ms`

### NUI-PERF-002 — Frame budget

- interactive scene p95 `< 8.33 ms` on 120Hz reference
- hard p99 `< 16.67 ms` under normal workload
- no continuous redraw at idle

### NUI-PERF-003 — Terminal grid

- 120x40 full-grid render target `< 1 ms`
- scroll flood 120fps-capable target
- atlas steady hit rate `>95%`

### NUI-PERF-004 — Startup

- warm first interactive frame target `< 1.5 s`
- cold target `< 3 s`
- target machine/profileをartifactに記録

### NUI-PERF-005 — Soak

24h synthetic/live mix:

- no monotonic memory leak
- RSS growth target `<10%` after warm-up
- frame degradation `<10%`
- no orphaned process
- no lost terminal session

### NUI-PERF-006 — Large workspace

- 100k files
- 10k search results
- 1M-line safe mode
- 16 pane layout
- history virtualization

---

## 16. Reliability and recovery requirements

### NUI-REL-001 — GPU device loss

Renderer rebuild without runtime restart when possible。

### NUI-REL-002 — UI crash does not kill daemon-owned sessions

Native UI process crash/restartで sessionを再adopt。

### NUI-REL-003 — Atomic UI state snapshot

Window/layout/focus/selected entity/settingsを versioned snapshotで保存。

### NUI-REL-004 — Schema migration

Native UI state/projection schema に version/migration。

### NUI-REL-005 — Error surface

Blank/quiet failure禁止。user action、diagnostic ID、recovery actionを表示。

---

## 17. Security/governance requirements

### NUI-SEC-001 — Principal and authority

Native UI actionも principal/capability/governanceを通る。local UIだから無条件grantしない。

### NUI-SEC-002 — Risk-classified commands

Shell/file/merge/approval/pasteは既存command risk/watchdogを通る。

### NUI-SEC-003 — Sensitive data

Clipboard、terminal history、proof artifacts、logsにsecretを無制限保存しない。

### NUI-SEC-004 — Updater trust

N4:

- signed manifest
- signed installer/binary
- rollback
- update failure recovery
- no Tauri updater plugin

---

## 18. Compatibility and removal requirements

### NUI-COMP-001 — Surface ownership registry

各 surfaceについて:

```text
owner: react | native | shared-compat
primary_since
fallback
parity_gate
removal_gate
```

### NUI-COMP-002 — No dual truth

同じ setting/shortcut/session stateを別々に保存しない。

### NUI-COMP-003 — Tauri removal gate

次が全部PASSした場合のみ削除:

- N3 core workflow
- native updater/installer
- native dialogs/notification
- no WebView runtime dependency
- clean machine acceptance
- accessibility/IME/visual/perf/recovery
- rollback package available

### NUI-COMP-004 — Dependency ratchet

N4 lane では:

- new React/TS feature禁止
- Tauri command追加禁止（compat bug fix除く）
- native parity済みsurfaceへのReact feature追加禁止

---

## 19. Documentation requirements

### NUI-DOC-001 — Four-layer synchronization

同じ WU で requirement、specification、design、verifier/artifact を更新。

### NUI-DOC-002 — Decision history

ADR-001を削除せずADR-014でsupersede。

### NUI-DOC-003 — Current machine truth

progress/claimは generated artifactを優先し、固定スコアをdocsに複製しない。

---

## 20. Definition of done

N4 Definition of Done:

- shipping operator UI is Rust-native
- no WebView/React/Tauri runtime dependency
- core Mission workflow native
- terminal/editor/IME/a11y/recovery/perf gates pass
- exact Control Kernel/governance path
- signed native distribution
- Tauri compatibility removal or explicit non-shipping isolation
- documentation and public claim updated only after aggregate gate
