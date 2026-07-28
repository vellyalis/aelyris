# Aelyris Native UI Migration Roadmap

Status: high-priority queued tracked proposal
Execution model: dependency-ordered Work Units
Rule: phase PASS is not program completion.

---

## 0. Portfolio insertion

`audit-remediation/A4.10` remains the only active implementation slice.

Execution order:

1. finish A4.10-A4.12 and resume the already frozen A6.2e1 frontier;
2. finish A6 owner extraction/modularity, including its existing
   `aelyris_native.rs` decomposition owner, plus A7 Core Mission/Control
   ownership;
3. run A8.0 as an explicit product-goal/architecture decision without changing
   the existing measured A8 terminal gate;
4. complete the current A8/A9 release path;
5. activate NUI-0.1 through NUI-7.8 as the priority-1 next program.

The existing A8 terminal decision is not deleted or reassigned. Its
same-condition Canvas/WebView comparison, input-to-present, IME,
accessibility, parity, soak, and rollback observations become inputs to later
NUI-0.3 baseline and NUI-F3 promotion evidence. A measured failure can still
reject native promotion without shrinking the N4 target or forcing a rewrite.

A8.0 may recommend a pre-A9 takeover only through an explicit owner decision
and a newly rebaselined execution program. This queued proposal does not itself
authorize that change.

---

## 1. Program invariants

- Goal: N4 WebView-free distribution
- Current Best remains usable throughout
- Tauri compatibility is rollback until N4
- domain/runtime truth is not rewritten
- every WU has verifier/evidence/rollback
- no new unrelated proof code is added to the monolithic native binary
- native feature claims require current artifacts
- editor is an independent dependency lane
- visual polish cannot bypass correctness/IME/a11y/recovery

---

## 2. Work Unit template

```text
ID
Goal contribution
Preconditions
Owner modules
Scope
Non-scope
API/schema changes
Implementation steps
Failure hypothesis
Acceptance
Verifier command
Evidence artifact
Rollback
Docs synchronized
Next unlock
```

---

## 3. Phase F0 — Authority, inventory, baseline

### NUI-0.1 — Ratify accepted ADR-014 for activation

- require A8.0 to have recorded ADR-014 as accepted-as-written or
  accepted-with-amendments in canonical `DECISIONS.md`; both accepted results
  enter this branch, while deferred or rejected decisions cannot enter NUI-F0
- ratify the accepted decision in the activation packet without reopening the
  architecture choice
- verify ADR-001 is marked superseded for the primary surface while preserving
  history
- verify the Terminal Core hybrid-primary decision is marked superseded
- no runtime code

Acceptance: decision conflict verifier finds one current owner。

### NUI-0.2 — Surface inventory

Machine-readable inventory for terminal、pane tree、mode rail、inspector、command center、settings、project tree、search、git/worktree、diff/review、editor、dialogs、notifications、updater。

```json
{
  "surface": "command-center",
  "reactOwner": "...",
  "nativeOwner": "...",
  "backendProjection": "...",
  "actions": [],
  "parityGate": "...",
  "removalGate": "..."
}
```

### NUI-0.3 — Baseline capture

Capture current startup、memory、terminal repaint、input echo、visual、IME、a11y、sleep/resume、native proof、Tauri core workflow。Do not change defaults。

### NUI-0.4 — Native proof decomposition map

Consume the A6.6-owned `aelyris_native.rs` decomposition and map any remaining
proof command to target crate/test/verifier. Do not create a second
decomposition owner。Set file-size/command ratchet。

### NUI-0.5 — Traceability/verifier skeleton

Add requirement→design→verifier registry and `aelyris-verify` skeleton with provenance JSON。

Exit F0: authority conflict closed, baseline current, no behavior change。

---

## 4. Phase F1 — Runtime extraction

### NUI-1.1 — Root Cargo workspace

- add workspace
- keep `src-tauri` member
- create `crates/aelyris-runtime`
- no mass move
- CI builds old/new targets

### NUI-1.2 — RuntimeServices wrapper

Wrap existing managers/Arc handles。Tauri Builder construction becomes centralized without behavior change。

### NUI-1.3 — AelyrisRuntimeBuilder

Move logging/bootstrap、DB restore、context/intent restore、startup reconciliation、LSP/event sources、Control Kernel assembly behind Tauri-neutral builder。

### NUI-1.4 — ProjectionHub

- typed projection keys/revisions
- subscription
- latest-wins/no-loss policy
- snapshot resync

### NUI-1.5 — NativeControlAdapter

- in-process typed command
- principal/correlation/idempotency
- same governance
- no loopback HTTP primary

### NUI-1.6 — Tauri compatibility adapter

Existing IPC delegates to same kernel/projection。No capability logic remains in Tauri command bodies。

### NUI-1.7 — Runtime parity verifier

Compare native and Tauri adapters for command catalog、projection schema、error、authority、audit、idempotency。

Exit F1:

- native and Tauri share composition root
- no domain code requires `AppHandle`
- rollback works

---

## 5. Phase F2 — Native UI runtime foundation

### NUI-2.1 — Native app shell

winit `ApplicationHandler`、one window、runtime attach、logging/crash recovery、process identity。

### NUI-2.2 — Windows platform crate

HWND、DPI、chrome/hit-test、theme/high contrast/reduced motion、power events、taskbar identity。

### NUI-2.3 — wgpu window renderer

adapter/device/surface、alpha capability、resize、frame scheduler、device/surface recovery、recovery screen。

### NUI-2.4 — UI tree/reconciliation

Node arena、Element、keyed diff、dirty flags、deterministic tree snapshot。

### NUI-2.5 — Style/tokens

Current visual tokensをRustへ移し、CSS parserなしでtheme switching/contrastを証明。

### NUI-2.6 — Taffy layout

Basic containers、text/image measure、DPI rounding、split primitive。

### NUI-2.7 — Event/focus/shortcut

capture/target/bubble、pointer capture、focus scopes、Rust command registry、palette/help。

### NUI-2.8 — Text system

DirectWrite shape/measure/fallback、glyph atlas、mixed-script fixtures、missing glyph diagnostics。

### NUI-2.9 — Accessibility skeleton

AccessKit tree、UIA root/actions、keyboard traversal。

### NUI-2.10 — Component gallery/visual harness

foundation widgets、OS screenshot、resize/DPI/material fixtures、deterministic scenes。

Exit F2: usable no-WebView native settings/gallery shell with input/focus/a11y/material basics。

---

## 6. Phase F3 — Native terminal primary

### NUI-3.1 — Terminal frame boundary

Extract/stabilize existing renderer-neutral frame/pipeline。Preserve schema compatibility。

### NUI-3.2 — GPU cell pass

Cell backgrounds、dirty rect upload、cursor placeholder、performance baseline。

### NUI-3.3 — DirectWrite glyph pass

Terminal runs、wide/combining、fallback、atlas、fixture。

### NUI-3.4 — Selection/search/link/cursor

Parity with current terminal surface。

### NUI-3.5 — Inline images

Reuse canonical image refs/chunk protocol behavior。

### NUI-3.6 — Native input integration

Keyboard encoder、active pane、input HWND、exact PTY write、sequence IDs。

### NUI-3.7 — Japanese IME dogfood

Preedit、candidate、exact-once commit、provider prompts、manual gate。

### NUI-3.8 — Clipboard/paste guard

Single/multiline、destructive deny、bracketed paste、context menu/shortcut parity。

### NUI-3.9 — Multi-pane layout

Canonical mux graph、split/close/move/swap/zoom/equalize、resize/focus/sync-input guard。

### NUI-3.10 — Scrollback/mouse

Wheel/touchpad、selection、mouse reporting、search、history restore。

### NUI-3.11 — Recovery

Device loss、app restart/reattach、flood、chaos、sleep/resume。

### NUI-3.12 — N1 promotion

Default launch switches only after aggregate PASS。Feature flag rollback remains。

---

## 7. Phase F4 — Native cockpit primary

### NUI-4.1 — Mode shell

Eight modes、Rust shortcut authority、selected entity route。

### NUI-4.2 — Contextual inspector

Native projection/action routing。

### NUI-4.3 — Command Center

Evidence/actions/blockers/provenance/recovery。

### NUI-4.4 — Mission header

Now/Next/Unlocks、state、capability unlocks。

### NUI-4.5 — Agent fleet

Agent cards/status/pane focus/steering/ownership。

### NUI-4.6 — Settings

Material、opacity、wallpaper、font、profiles、keymap、a11y、fallback。

### NUI-4.7 — Dialog/menu/toast

Generic component completion。

### NUI-4.8 — Windows notifications

Native path and safe action routing。

### NUI-4.9 — A11y/manual sweep

UIA、keyboard、Narrator。

### NUI-4.10 — N2 promotion

Native app becomes default cockpit; React marked compatibility-only。

---

## 8. Phase F5 — Workspace, git, review

### NUI-5.1 — VirtualList/TreeView production

100k fixture、focus/a11y/selection/lazy load。

### NUI-5.2 — Project tree

Filesystem projection、git/worktree、ownership badges、open path。

### NUI-5.3 — Search

stream/cancel/virtual results/open location。

### NUI-5.4 — Git/worktree surface

status、branches、worktrees、exact commit context。

### NUI-5.5 — Native source viewer

Editor E1 read-only surface。

### NUI-5.6 — Native diff viewer

unified/split/intraline/hunk navigation。

### NUI-5.7 — Review/evidence

review packet、proof links、decision。

### NUI-5.8 — Approval/merge

canonical command、exact commit、stale revision rejection、no bypass。

### NUI-5.9 — Core workflow replay

Mission → agent → output → diff → proof → review → merge, native except editable source。

---

## 9. Phase F6 — Native editor

### NUI-6.1 — Document model benchmark

Compare rope candidates on real fixtures; lock based on evidence。

### NUI-6.2 — Transactions/undo/selections

Property tests/random reference model。

### NUI-6.3 — Editor viewport

Virtual lines、gutter、selection、cursor、scroll。

### NUI-6.4 — Syntax

Incremental Tree-sitter and stale revision handling。

### NUI-6.5 — IME/editing

Composition/candidate/exact transaction。

### NUI-6.6 — Save/conflict/recovery

CAS/atomic write/journal/external change。

### NUI-6.7 — LSP core

Diagnostics/hover/completion/definition/references/actions。

### NUI-6.8 — Large file mode

1M-line/long-line/binary cases。

### NUI-6.9 — Editor accessibility

UIA TextPattern feasibility; custom provider if needed。

### NUI-6.10 — Monaco parity/user job matrix

Rust/TS/Markdown/config workflows。

### NUI-6.11 — N3 promotion

No core workflow requires Tauri。Legacy editor disabled by default but rollback remains。

---

## 10. Phase F7 — Native distribution/removal

### NUI-7.1 — Native dialogs/openers

Replace plugins。

### NUI-7.2 — Native updater

Signed manifest、transactional update、rollback。

### NUI-7.3 — Installer/signing

Clean machine、identity、install/uninstall/update。

### NUI-7.4 — Frontend dependency ratchet

No new React/Tauri product feature。

### NUI-7.5 — WebView-free build profile

Cargo-only product build。Node may remain as non-shipping dev tooling temporarily。

### NUI-7.6 — Remove/de-isolate legacy

Remove Tauri plugins/deps/frontend release assets or move compatibility outside shipping path。

### NUI-7.7 — Clean-machine acceptance

Install → launch → Mission → AI CLI → review/merge → update/rollback。

### NUI-7.8 — N4 aggregate

Only after PASS may public claims and README change。

---

## 11. Parallelization map

Safe after contracts freeze:

- UI core/layout
- renderer/text
- Windows platform/input
- accessibility
- terminal surface
- verifier/harness

Unsafe overlap without serialization:

- runtime composition
- Control command registry
- projection schema
- terminal frame schema
- editor position/transaction types
- decision/claim docs

Use symbol ownership and worktrees。

---

## 12. Review policy

Every WU:

- implementer ≠ reviewer for Critical contracts
- reviewer checks no second owner
- verifier artifact current
- rollback tested
- docs synchronized
- no scope creep
- no claim promotion from focused PASS

---

## 13. Program completion

Program is complete only at N4:

- no Tauri/WebView shipping dependency
- no critical UI/IME/a11y/recovery blocker
- no core workflow legacy requirement
- no control/governance bypass
- signed distribution
- current aggregate evidence
