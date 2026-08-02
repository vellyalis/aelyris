# Aelyris Native UI Architecture

Status: accepted-with-amendments direction / queued post-A9 architecture
Owner: native UI migration program
Depends on: `AELYRIS_NATIVE_UI_REQUIREMENTS.md`

---

## 0. Repository adaptation boundary

Type and crate names in this document are target contracts, not implemented
owners. Before NUI-F1:

- `AelyrisRuntimeBuilder` must be an extraction around the current
  `src-tauri/src/lib.rs` service graph, not a cloned runtime;
- `ProjectionHub` must be a read-model/subscription adapter over the existing
  EventBus, repositories, and DB; it cannot become a second durable event stream;
- `MissionRuntime` means the existing TaskManager/Mission owners after A7, not a
  parallel Mission engine;
- editor recovery and UI snapshots must use existing persistence/migration
  owners rather than new free-standing journals;
- native updater, installer, signing, and rollback extend A9's single trust
  owner and evidence DAG.

A8.0 accepted N4 but did not select the shell framework. NUI-F0 must compare
Slint and the proposed retained runtime under the same representative vertical
and requirements. Until that record exists, retained-runtime-specific sections
below are a candidate contract, not an authorized dependency.

Windows 11 x64 is primary. Windows 10 compatibility is measured separately and
must not be inferred from a single identical setting.

## 1. Architecture goals

1. Tauri/React を primary surface から段階的に外す。
2. Aelyris Core、Mission、Control API、mux、PTY、proof、persistence を再実装しない。
3. Windows-native の低遅延、透過、IME、UIA、DPI、power lifecycle を Rust から直接扱う。
4. Terminal/editor の高頻度描画を generic UI tree の更新コストから分離する。
5. Tauri を安全な rollback/compatibility face として N4 まで残す。
6. verifier-first の移行を維持する。

---

## 2. Bounded contexts

### 2.1 Domain/runtime context

Existing owner:

- Mission
- TaskGraph
- agent lifecycle
- pane/mux
- PTY
- worktree
- ownership
- proof/evidence
- review/merge
- governance
- persistence

Native UI must not absorb these.

### 2.2 Projection context

Responsibility:

- backend domain state → stable UI projection
- revision/correlation
- pagination/virtualization
- no-loss vs latest-wins policy
- native/Tauri/MCP face parity

### 2.3 Native UI context

Responsibility:

- windows
- input/focus
- UI tree
- layout
- scene
- rendering
- accessibility
- native dialogs/material
- product component composition

### 2.4 Platform Windows context

Responsibility:

- HWND/DWM/DPI
- input/IME/clipboard/OLE
- UIA
- notifications/taskbar/app identity
- power/suspend
- installer/updater integration

### 2.5 Specialized surface context

- terminal
- editor
- diff
- large tree/list

These own high-throughput viewport state but not domain truth.

---

## 3. Composition root extraction

### 3.1 Problem

Current Tauri `run()` assembles logging、PTY、sidecar、agent managers、mux、workflow/proofbook/LSP、terminal registry/input、snapshot、watchdog、task/context/event/cost/ownership/intent/knowledge graph、DB restore and event bridges。Native process needs most services, but must not depend on `tauri::AppHandle` or Tauri managed state.

### 3.2 Target

```rust
pub struct RuntimeConfig {
    pub data_dir: PathBuf,
    pub log: LoggingConfig,
    pub daemon: DaemonConfig,
    pub database: DatabaseConfig,
    pub feature_flags: FeatureFlags,
}

pub struct AelyrisRuntimeBuilder {
    config: RuntimeConfig,
    platform: Arc<dyn PlatformServices>,
}

impl AelyrisRuntimeBuilder {
    pub async fn build(self) -> Result<Arc<AelyrisRuntime>, RuntimeBuildError>;
}

pub struct AelyrisRuntime {
    control: Arc<ControlKernel>,
    projection_hub: Arc<ProjectionHub>,
    terminal_runtime: Arc<TerminalRuntime>,
    mission_runtime: Arc<MissionRuntime>,
    lifecycle: Arc<LifecycleCoordinator>,
    services: RuntimeServices,
}
```

### 3.3 Extraction order

1. Introduce `RuntimeServices` wrapper around existing managed values without moving modules.
2. Replace Tauri `.manage(X)` creation with `.manage(runtime.services.X.clone())`.
3. Move restore/reconciliation behind `AelyrisRuntimeBuilder`.
4. Move event source from `AppHandle.emit` to `ProjectionHub`.
5. Tauri adapter subscribes and emits compatibility events.
6. Native shell subscribes directly.
7. Once no domain owner needs `AppHandle`, enforce import boundary.

### 3.4 Dependency rule

```text
domain/runtime  ─X→ tauri
domain/runtime  ─X→ winit
domain/runtime  ─X→ wgpu
domain/runtime  ─X→ UI types

adapters may depend on runtime + transport/UI
```

---

## 4. Process and thread model

```text
Aelyris Native UI process
├─ UI main thread
│  ├─ winit/Win32 message loop
│  ├─ HWND/window registry
│  ├─ focus/input/IME coordinator
│  ├─ UiTree/layout
│  └─ GPU present
│
├─ Tokio runtime threads
│  ├─ Control Kernel async commands
│  ├─ projections/subscriptions
│  ├─ LSP
│  ├─ search/index
│  └─ updater/network
│
├─ optional worker pool
│  ├─ scene preparation
│  ├─ font raster requests
│  └─ syntax parsing
│
└─ child/sidecar processes
   ├─ mux/PTY daemon
   ├─ agent CLIs
   └─ verifier processes
```

### 4.1 UI thread ownership

UI thread exclusively owns:

- winit EventLoop
- HWND-sensitive lifecycle
- focus
- IME surface placement
- UiTree mutation
- surface configure/present
- UIA dispatch requiring window context

No blocking filesystem/network/process wait on UI thread.

### 4.2 Wake mechanism

```rust
pub enum UiWake {
    Projection(ProjectionKey, Revision),
    TerminalFrame(PaneId),
    OperationCompleted(OperationId),
    WindowCommand(WindowCommand),
    Shutdown(ShutdownReason),
}
```

Use `EventLoopProxy<UiWake>` or equivalent。Payload itself is kept in mailbox/projection store, avoiding large copy through event loop.

### 4.3 Channel policies

- `ProjectionMailbox`: latest revision, overwrite allowed
- `TerminalFrameMailbox`: bounded diff queue; overflow requests full snapshot
- `AuditStream`: durable DB/event stream, cursor based
- `UiActionQueue`: ordered bounded; no silent drop
- `Telemetry`: sampled

---

## 5. Native application state

```rust
pub struct NativeApp {
    runtime: Arc<AelyrisRuntime>,
    windows: WindowRegistry,
    ui: UiRuntime,
    render: RenderRuntime,
    text: TextRuntime,
    platform: WindowsPlatform,
    projections: ProjectionStore,
    commands: UiCommandRegistry,
    diagnostics: NativeDiagnostics,
}
```

### 5.1 Window registry

Supports primary cockpit、detached terminal、settings/dialog、diagnostic/recovery、future multi-workspace。

```rust
pub struct NativeWindowState {
    pub id: WindowKey,
    pub scale_factor: f64,
    pub viewport_px: PhysicalSize<u32>,
    pub material: MaterialMode,
    pub root_node: NodeId,
    pub focused_node: Option<NodeId>,
    pub renderer: WindowRenderer,
    pub a11y: WindowAccessibility,
}
```

Raw HWND/COM pointers are hidden inside platform crate, not general node state.

---

## 6. Projection store

```rust
pub struct ProjectionStore {
    mission: Versioned<Arc<MissionProjection>>,
    fleet: Versioned<Arc<FleetProjection>>,
    workspace: Versioned<Arc<WorkspaceProjection>>,
    review: Versioned<Arc<ReviewProjection>>,
    command_center: Versioned<Arc<CommandCenterProjection>>,
    settings: Versioned<Arc<SettingsProjection>>,
}
```

Rules:

- local UI state is only ephemeral interaction state
- domain state requires revision
- stale revision cannot overwrite newer
- optimistic action is marked pending and reconciled from backend
- backend rejection restores state and shows structured error

Allowed local state:

- hover
- scroll offset
- open menu
- search draft
- animation progress
- editor unsaved transaction buffer with recovery journal

Not allowed local truth:

- merge ready
- proof valid
- agent done
- Mission complete
- ownership granted

---

## 7. Command architecture

### 7.1 UI registry

```rust
pub struct UiCommandDescriptor {
    pub id: UiCommandId,
    pub title: &'static str,
    pub category: CommandCategory,
    pub default_shortcuts: &'static [Shortcut],
    pub availability: fn(&UiContext) -> Availability,
    pub action: UiCommandAction,
}
```

Action classes:

- local UI action
- canonical Control command
- window/platform command

### 7.2 Execution

```text
Shortcut/menu/button
      ↓ UiCommandId
Command registry
      ↓ UiAction
NativeControlAdapter
      ↓ CommandEnvelope
ControlKernel
      ↓ domain owner
      ↓ event/projection
UI reconciliation
```

No raw string dispatch in product code。Command ID/type/schema authority is one place.

---

## 8. Layout architecture

### 8.1 General layout

Taffy bridge:

```rust
pub struct LayoutEngine {
    tree: taffy::TaffyTree<LayoutContext>,
    node_map: HashMap<NodeId, taffy::NodeId>,
}
```

Measure owner:

- text
- image
- terminal surface
- editor viewport
- custom control

### 8.2 Coordinate types

Do not mix:

- logical DIPs
- physical pixels
- screen pixels
- terminal cells
- text clusters

```rust
LogicalPoint
PhysicalPoint
ScreenPoint
CellPoint
```

### 8.3 Custom split layout

Existing mux split tree is canonical。Visual SplitView projects it and supports min constraints、keyboard resize、drag preview、equalize、cell-aligned terminal sizing。

### 8.4 Rounding

- layout in logical f32
- stable physical edge rounding
- siblings share rounded boundary
- terminal cell rect integer aligned
- text baseline from actual metrics

### 8.5 Invalidation

| Change | Required work |
|---|---|
| text measure/content | node + ancestors layout/paint |
| color/border | paint only |
| scroll | transform/paint/hit-test |
| terminal frame | terminal surface paint only |
| resize | root layout |
| DPI | text atlas + full layout/paint |

---

## 9. Rendering architecture

```rust
pub struct RenderRuntime {
    instance: wgpu::Instance,
    adapter: wgpu::Adapter,
    device: wgpu::Device,
    queue: wgpu::Queue,
    windows: HashMap<WindowKey, WindowRenderer>,
    pipelines: PipelineCache,
    textures: TextureCache,
    glyphs: GlyphAtlas,
}
```

### 9.1 Scene

```rust
pub struct Scene {
    pub primitives: Vec<Primitive>,
    pub clips: Vec<ClipNode>,
    pub layers: Vec<Layer>,
    pub damage: DamageRegion,
}
```

Primitive set:

- solid/rounded rect
- border/shadow
- image
- glyph run
- line
- terminal/editor surface reference
- debug overlay

No arbitrary vector filter/path engine in first release。Icons are validated build-time assets.

### 9.2 Passes

1. clear/material
2. background/image
3. panel rectangles/borders
4. shadows
5. specialized surfaces
6. images/icons
7. generic text
8. overlays/focus/IME
9. debug optional

### 9.3 Batching

Batch by pipeline、texture/atlas page、blend、clip、material、z layer。Dynamic buffers reuse ring allocation.

### 9.4 Damage

- generic node dirty region
- terminal dirty rects from `NativeRenderFrameDiff`
- editor dirty line ranges
- animation region
- full repaint on resize/DPI/material/device recovery

### 9.5 Surface alpha

At window creation:

1. enumerate alpha modes
2. prefer `PreMultiplied`
3. validate OS screenshot fixture
4. unsupported target falls back to Opaque or guarded compositor alternative
5. never claim SeeThrough from config alone

### 9.6 Device recovery

```text
Ready → SurfaceLost → Reconfigure → Ready
Ready → DeviceLost → StopPresent → Recreate → Rebuild caches → Full scene → Ready
failure → SafeFallback / RecoveryScreen
```

Domain runtime and PTY remain alive.

---

## 10. Text architecture

### 10.1 Separation

- shaping: text → glyph IDs/positions/clusters
- rasterization: glyph ID → bitmap/coverage/color
- atlas: bitmap → GPU location
- layout: shaped metrics
- paint: glyph instances

### 10.2 Windows implementation

`DirectWriteTextSystem` owns factory、font collection/fallback、analysis、glyph run/raster、metrics。

COM rules:

- initialize per worker/thread as required
- do not move non-agile COM interfaces across threads
- cache stable IDs rather than unsafe pointers in UI tree

### 10.3 Cache keys

```text
FontFaceId
TextStyleKey
ShapeCacheKey(text_hash, style, locale, direction, features)
GlyphKey(face, glyph, px, scale, render_mode, subpixel)
```

Caches have memory budget、generation、LRU、diagnostics、DPI invalidation。

### 10.4 Terminal run model

```rust
pub struct TerminalTextRun {
    pub row: u16,
    pub start_col: u16,
    pub end_col: u16,
    pub style: TerminalTextStyle,
    pub text: String,
    pub clusters: Vec<CellCluster>,
}
```

`NativeRenderFrame v1` remains compatible; v2 may add shaped runs without breaking old client.

---

## 11. Terminal surface

```rust
pub struct TerminalView {
    pane_id: PaneId,
    viewport: TerminalViewport,
    frame_mailbox: Arc<TerminalFrameMailbox>,
    render_pipeline: NativeRenderPipeline,
    selection: SelectionState,
    search: SearchState,
    links: LinkState,
    input: TerminalInputBinding,
}
```

Fast path:

```text
PTY/daemon
→ TermEngine
→ GridSnapshot
→ NativeRenderPipeline commit
→ mailbox revision
→ UiWake::TerminalFrame
→ upload dirty ranges
→ present
```

No full Mission/cockpit rebuild。

Pane resize:

- split layout computes physical rect
- cell metrics produce cols/rows
- final resize sent to canonical pane owner
- generation protects stale resize/output

Input:

- focused terminal binds native input surface
- key event → UI shortcut or terminal encoder
- IME result → guarded PTY write
- mouse → selection or terminal mouse protocol
- paste → confirmation/guard/bracketed paste

---

## 12. Accessibility architecture

UiTree node emits optional semantics:

```rust
pub struct Semantics {
    pub role: Role,
    pub name: Option<Arc<str>>,
    pub description: Option<Arc<str>>,
    pub value: Option<Arc<str>>,
    pub state: SemanticState,
    pub actions: SmallVec<[Action; 4]>,
    pub bounds: Rect,
}
```

- `A11yId` stable across reconciliation
- AccessKit tree per dirty semantics
- action maps to `UiCommandId` or local focus
- terminal/editor initial summary semantics
- advanced custom UIA TextPattern/TextRange if required

---

## 13. Editor architecture

```text
DocumentStore (rope + revisions)
   ├─ SelectionSet
   ├─ Transaction/Undo
   ├─ LineIndex
   ├─ SyntaxSnapshot
   ├─ LspProjection
   └─ RecoveryJournal

EditorView
   ├─ viewport/virtual lines
   ├─ gutter
   ├─ text layout cache
   ├─ cursor/selection
   ├─ IME
   ├─ diagnostics
   └─ diff/review overlays
```

Editor save goes through canonical file/control owner, not direct widget file write.

---

## 14. Settings and theme

```rust
pub struct ThemeTokens {
    pub colors: ColorTokens,
    pub typography: TypographyTokens,
    pub spacing: SpacingTokens,
    pub radius: RadiusTokens,
    pub elevation: ElevationTokens,
    pub motion: MotionTokens,
    pub density: DensityTokens,
}
```

- existing Rust config owner
- schema version/validation
- live apply
- rollback invalid GPU/material/font setting
- theme config changes tokens, not arbitrary selectors/layout code

---

## 15. Distribution replacement

| Tauri capability | Native owner |
|---|---|
| window | winit/windows-rs |
| opener | ShellExecute/platform service |
| notification | Windows native notification path |
| dialog | IFileDialog |
| process | existing Rust process owner |
| updater | signed native updater |
| bundle | WiX/MSIX/custom gate |
| app identity | windows-rs |
| asset protocol | removed |

Updater must be transactional/recoverable and support rollback.

---

## 16. Crate dependency rules

```text
aelyris-core
   ↑
aelyris-control / runtime / projection
   ↑
aelyris-native-components
   ↑
aelyris-native-shell

aelyris-ui-core ← ui-layout / ui-text / ui-render / ui-accessibility
terminal-view → term model + ui/render/text
editor-view   → editor-core + ui/render/text
platform-windows → windows-rs/winit
```

Forbidden:

- `aelyris-core -> UI`
- `aelyris-control -> winit/wgpu`
- `aelyris-ui-core -> domain managers`
- `terminal-view -> Tauri`
- `native-shell -> direct DB mutations`
- `tauri adapter -> native widget internals`

---

## 17. Error model

Typed errors:

- `RuntimeBuildError`
- `ControlError`
- `ProjectionError`
- `PlatformError`
- `RenderError`
- `TextError`
- `UiInvariantError`
- `EditorError`
- `RecoveryError`

```rust
pub struct UserFacingError {
    pub code: ErrorCode,
    pub summary: String,
    pub detail: String,
    pub recovery: Vec<RecoveryAction>,
    pub correlation_id: CorrelationId,
}
```

No `String`-only error across core boundaries.

---

## 18. Observability

Trace spans:

- window/input sequence
- UI/control command
- projection revision
- reconcile/layout/scene
- render submit/present
- terminal frame
- IME
- editor transaction
- recovery
- accessibility action

Correlation ID links user action → command → domain event → projection → rendered state。

---

## 19. Compatibility architecture

```rust
pub enum SurfaceOwner {
    Native,
    ReactCompatibility,
    DualCompare,
}
```

DualCompare:

- same projection
- native and React render
- action is dispatched by one owner only
- screenshot/state/perf compare
- no double mutation

Surface moves to Native only after functional、keyboard/a11y、visual、performance、recovery、no-bypass、rollback gates pass。

---

## 20. Architecture acceptance

- ADR approved
- runtime extraction spike compiles
- Tauri/native use same runtime shape
- dependency verifier passes
- UI framework API is internal and narrow
- terminal hot path reuses existing contracts
- editor is staged separately
- N0–N4 and rollback are encoded
