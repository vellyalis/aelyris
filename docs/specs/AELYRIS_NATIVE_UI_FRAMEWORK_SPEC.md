# Aelyris Native UI Framework Specification

Status: conditional retained-runtime candidate under accepted ADR-014; not selected
Internal name: **Aelyris Native UI Runtime candidate**
Crate family: `aelyris-ui-*`
Scope: internal product framework, not a public general-purpose toolkit.

---

Selection prerequisite: NUI-F0 must implement one same-vertical Slint and
Aelyris retained-runtime comparison. Select this candidate only if Slint fails
the NUI requirements or has higher total ownership/recovery cost. ADR-014
acceptance alone does not authorize a new framework dependency surface.

## 1. Design position

Aelyris needs more than `winit + wgpu` but less than a browser。

`winit` gives windows/events, `wgpu` gives GPU access。They do not provide retained identity、layout、focus、text input、accessibility、styling、scrolling、command routing、virtualization、components。

Therefore specialized terminal/editor surfaces are required, while the shell
framework remains an evidence-backed selection. The design below is the
retained-runtime candidate if it wins NUI-F0。

```text
Build:
  Aelyris-specific retained UI runtime
  reusable primitive widget set
  specialized terminal/editor surfaces

Reuse:
  Taffy
  DirectWrite
  AccessKit
  winit
  wgpu
  windows-rs

Do not build:
  CSS selector/cascade
  HTML parser
  arbitrary web layout compatibility
  plugin ABI
  imaginary cross-platform abstraction
```

---

## 2. Core data model

### 2.1 IDs

```rust
new_key_type! {
    pub struct NodeId;
    pub struct ComponentId;
    pub struct HandlerId;
    pub struct SemanticsId;
}
```

Generational ID is mandatory。Removed node ID cannot alias a later node。

### 2.2 Transient element tree

```rust
pub struct Element {
    pub key: ElementKey,
    pub kind: ElementKind,
    pub style: Style,
    pub semantics: Option<Semantics>,
    pub handlers: EventHandlers,
    pub children: SmallVec<[Element; 4]>,
}
```

`ElementKind`:

- Container
- Text
- Image
- Button
- Toggle
- TextInput
- ScrollView
- VirtualList
- TreeView
- SplitView
- TabStrip
- TerminalSurface
- EditorSurface
- Custom(ProductElementId)

### 2.3 Retained node

```rust
pub struct UiNode {
    pub id: NodeId,
    pub key: ElementKey,
    pub kind: NodeKind,
    pub parent: Option<NodeId>,
    pub children: SmallVec<[NodeId; 4]>,
    pub style: ComputedStyle,
    pub layout: LayoutBox,
    pub transform: Transform2D,
    pub clip: Option<ClipSpec>,
    pub state: NodeState,
    pub semantics: Option<Semantics>,
    pub handlers: EventHandlers,
    pub dirty: DirtyFlags,
}
```

### 2.4 Component state

```rust
pub trait Component {
    type Props: PartialEq;
    type State: Default;

    fn render(
        &self,
        cx: &mut ViewCx,
        props: &Self::Props,
        state: &mut Self::State,
    ) -> Element;
}
```

Rules:

- state mutation schedules minimal reconcile
- domain truth may not be copied into local state without revision
- async result checks component generation before apply

---

## 3. Reconciliation

### 3.1 Key rules

- siblings require unique keys for dynamic collections
- static children may use positional keys
- key collision is debug hard error and release diagnostic
- changed `kind` with same key replaces node safely
- state preserved only when key+component identity match

### 3.2 Algorithm

For each parent:

1. map old children by key
2. iterate new elements
3. reuse matching node
4. diff props/style/semantics/handlers
5. recurse children
6. remove unmatched old subtree
7. update ordering
8. mark dirty flags

Average O(n) per sibling group。

### 3.3 Dirty derivation

| Change | Dirty |
|---|---|
| children/order | TREE, LAYOUT, PAINT, A11Y, HIT_TEST |
| size/layout style | LAYOUT, PAINT, HIT_TEST, A11Y |
| color/border | PAINT |
| text content/style | LAYOUT or PAINT, A11Y |
| semantics | A11Y |
| transform/scroll | PAINT, HIT_TEST, A11Y |
| handler only | no layout/paint |

---

## 4. Style system

### 4.1 Typed style

```rust
pub struct Style {
    pub display: Display,
    pub size: SizeSpec,
    pub min_size: SizeSpec,
    pub max_size: SizeSpec,
    pub margin: Edges<Length>,
    pub padding: Edges<Length>,
    pub gap: Size<Length>,
    pub flex: FlexStyle,
    pub grid: GridStyle,
    pub position: PositionStyle,
    pub background: Background,
    pub border: Border,
    pub radius: CornerRadius,
    pub shadow: ShadowSet,
    pub opacity: f32,
    pub overflow: Overflow,
    pub cursor: CursorIcon,
    pub typography: TypographyStyle,
}
```

### 4.2 Token references

Product components use roles, not literal values。

```rust
ColorRef::Token(ColorToken::PanelBackground)
LengthRef::Token(SpacingToken::Md)
TypographyRef::Token(TypeToken::Body)
```

### 4.3 No selector engine

No `.class`, descendant selector, specificity, cascade。Composition and explicit style roles replace CSS。

### 4.4 Interaction state

```rust
pub struct InteractionStyle {
    pub normal: StylePatch,
    pub hover: StylePatch,
    pub pressed: StylePatch,
    pub focused: StylePatch,
    pub disabled: StylePatch,
    pub selected: StylePatch,
}
```

---

## 5. Layout

### 5.1 Taffy bridge

UiNode → Taffy node mapping is hidden behind `LayoutEngine`。

Measure callbacks:

- text via TextSystem
- image intrinsic
- terminal preferred/min size
- editor viewport
- custom widget

### 5.2 Coordinate spaces

```rust
LogicalPoint
PhysicalPoint
ScreenPoint
CellPoint
TextPoint
```

Conversion must be explicit。No raw tuple/f32 across platform boundaries。

### 5.3 Rounding

- layout in logical f32
- stable edge rounding to physical
- sibling edges share boundary
- terminal cell integer aligned
- text baseline derives from metrics

### 5.4 SplitView

```rust
pub struct SplitModel {
    pub axis: Axis,
    pub ratio: f32,
    pub first: PaneNode,
    pub second: PaneNode,
}
```

Features:

- min constraints
- keyboard resize
- pointer drag/capture
- double-click equalize
- preview line
- canonical mux graph sync

---

## 6. Event system

### 6.1 Event types

```rust
pub enum UiEvent {
    PointerMove(PointerEvent),
    PointerDown(PointerEvent),
    PointerUp(PointerEvent),
    Wheel(WheelEvent),
    KeyDown(KeyEvent),
    KeyUp(KeyEvent),
    TextInput(TextInputEvent),
    Ime(ImeEvent),
    Focus(FocusEvent),
    DragDrop(DragDropEvent),
    Window(WindowEvent),
    Accessibility(A11yAction),
}
```

### 6.2 Dispatch

1. hit-test target
2. capture root→parent
3. target
4. bubble parent→root
5. default action if not prevented

```rust
pub struct EventResult {
    pub handled: bool,
    pub prevent_default: bool,
    pub stop_propagation: bool,
    pub request_focus: Option<NodeId>,
    pub capture_pointer: Option<PointerId>,
    pub actions: SmallVec<[UiAction; 2]>,
}
```

### 6.3 Pointer capture

Required for splitter、selection、scrollbar、window chrome、tab reorder、editor/terminal selection。Capture loss emits cancel。

### 6.4 Shortcut arbitration

1. OS/window reserved
2. global Aelyris command
3. modal/palette
4. focused widget
5. terminal/editor command encoder

User override is conflict checked。Help text is generated from registry。

---

## 7. Focus and native text input

### 7.1 Focus manager

```rust
pub struct FocusManager {
    pub focused: Option<NodeId>,
    pub scopes: Vec<FocusScope>,
    pub last_by_scope: HashMap<FocusScopeId, NodeId>,
    pub traversal: FocusTraversalGraph,
}
```

Focus scopes:

- window
- modal
- command palette
- terminal pane
- editor
- settings

### 7.2 Text input client

```rust
pub trait TextInputClient {
    fn ime_rect(&self) -> ScreenRect;
    fn composition_update(&mut self, update: CompositionUpdate);
    fn commit_text(&mut self, text: &str);
    fn cancel_composition(&mut self);
}
```

Terminal and editor implement same contract。

### 7.3 Input HWND

- logical focus selects active client
- child/native input surface positioned at caret
- result string drains through ordered host
- focus visually remains main surface
- UIA focus remains logical widget
- no `WM_CHAR` duplicate commit

---

## 8. Scrolling and virtualization

### 8.1 ScrollView

State:

- offset/extent/viewport
- velocity
- scrollbar visibility
- anchor
- precision wheel/touchpad

Desktop default has no elastic overscroll unless deliberately designed。

### 8.2 VirtualList

```rust
pub trait VirtualDataSource {
    fn len(&self) -> usize;
    fn key(&self, index: usize) -> ItemKey;
    fn estimate_height(&self, index: usize) -> f32;
    fn build(&self, index: usize, cx: &mut ViewCx) -> Element;
}
```

- visible range + overscan
- variable height correction
- stable anchor during insertion
- reveal focused offscreen item
- a11y position/set size

### 8.3 TreeView

- flattened visible rows
- lazy children
- expansion/selection
- keyboard navigation
- 100k-node fixture

### 8.4 Specialized surfaces

Do not instantiate one UiNode per terminal cell/editor glyph/line。

---

## 9. Scene generation

```rust
pub struct PaintCx<'a> {
    pub scene: &'a mut SceneBuilder,
    pub text: &'a mut TextSystem,
    pub theme: &'a ThemeTokens,
    pub scale_factor: f64,
    pub clip_stack: ClipStack,
}
```

Paint order is depth-first with explicit stacking contexts。

Stacking context:

- opacity < 1
- transform
- clip
- elevation
- modal/overlay
- specialized surface

### 9.1 Specialized surface contract

```rust
pub trait SurfaceView {
    fn measure(&self, constraints: Constraints, cx: &MeasureCx) -> Size;
    fn input(&mut self, event: &UiEvent, cx: &mut SurfaceEventCx) -> EventResult;
    fn paint(&mut self, cx: &mut SurfacePaintCx);
    fn semantics(&self, cx: &SemanticsCx) -> SemanticsSubtree;
}
```

Terminal/editor/diff implement this。

---

## 10. Renderer primitives

Initial primitives:

- `SolidRect`
- `RoundedRect`
- `Border`
- `Shadow`
- `ImageQuad`
- `GlyphRun`
- `Line`
- `ClipRect`
- `RoundedClip`
- `SurfaceBatch`
- `DebugRect`

Not initial scope:

- arbitrary SVG DOM
- complex vector filters
- browser backdrop-filter compatibility
- 3D transform
- shader plugin API

### 10.1 Blur policy

- Mica/Acrylic: DWM owner
- SeeThrough: transparent tint/noise; no fake claim of sampled blur
- in-app blur: optional measured offscreen pass
- terminal glyph layer never blurred

---

## 11. Text and icons

### 11.1 Generic text

DirectWrite-shaped `TextLayout` caches clusters、line breaks、baselines、caret stops、hit-test、selection rects。

### 11.2 Icons

Build-time pipeline:

- validate SVG subset
- flatten/triangulate or raster at scales
- package atlas/mesh
- role-based tint

No runtime web SVG engine。

---

## 12. Components

### Foundation

- Container/Stack/Row/Column/Grid
- Spacer/Divider
- Text/Icon/Image
- Surface

### Interaction

- Button/IconButton
- Toggle/Checkbox/Radio
- Slider
- TextInput/SearchBox
- Select/ComboBox
- Menu/Tooltip/ContextMenu

### Structure

- ScrollView
- VirtualList/TreeView
- SplitView
- TabStrip/PaneHost
- Toolbar/StatusBar
- Modal/Dialog/Toast
- CommandPalette

### Aelyris product

- ModeRail
- TerminalPane
- AgentBadge
- MissionHeader
- NowNextUnlocks
- EvidenceList
- BlockerCard
- ReviewPanel
- OwnershipBadge
- WorktreeTree
- CommandCenter
- ContextualInspector
- NativeSettings

Product components consume projection DTO, not domain manager。

---

## 13. Animation

```rust
pub struct Animation {
    pub property: AnimProperty,
    pub from: AnimValue,
    pub to: AnimValue,
    pub start: Instant,
    pub duration: Duration,
    pub easing: Easing,
}
```

- redraw scheduled only while active
- reduced-motion disables nonessential motion
- terminal content never delayed
- no spring solver initially
- diagnostics count active animations

---

## 14. Accessibility

Semantics generated alongside layout, not inferred from pixels。

Required:

- role/name/value/state
- focusable/action
- bounds
- virtual list position/set size
- restrained live regions

A11y action routes through same command registry。

---

## 15. Testing

### Pure

- reconciliation/key identity
- dirty propagation
- layout rounding/constraints
- focus traversal
- event phases
- shortcut conflicts
- virtualization anchor
- semantics completeness

### Snapshot

- element/retained tree
- layout boxes
- scene primitives
- accessibility tree
- command registry/help

### GPU

- offscreen render
- alpha/clip
- glyph atlas
- pixel fixtures
- recovery

### OS

- HWND/DPI
- IME/clipboard
- UIA/Narrator
- transparency OS capture
- sleep/resume
- taskbar/chrome/snap

---

## 16. Performance invariants

- no per-frame allocation proportional to total unchanged tree
- no UiNode per terminal cell/editor glyph
- no full tree reconcile for terminal output
- no blocking command on UI thread
- batched atlas upload
- bounded visible virtual nodes
- idle event loop waits
- scene buffers reuse capacity

---

## 17. Unsafe code policy

Unsafe Windows/GPU interop only in:

- `aelyris-platform-windows`
- renderer backend boundary
- DirectWrite COM wrapper

Rules:

- small function
- documented invariants
- safe wrapper
- targeted test
- no raw pointer in general UiNode
- independent review

---

## 18. Framework extraction prohibition

Until N4:

- crate names remain `aelyris-*`
- no crates.io publish
- no semantic compatibility promise
- no third-party widget API
- no generic toolkit roadmap

After N4, extraction may be considered only after repeated independent use and demonstrated maintenance reduction。

---

## 19. Framework Definition of Done

- foundation components used by native cockpit
- terminal/editor specialized surfaces integrated
- keyboard/focus/IME/a11y correct
- deterministic scene and visual harness
- device/surface recovery
- performance targets
- no Tauri/React dependency in framework crates
- no backend truth duplication
