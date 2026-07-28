# Aelyris Native UI Verification Plan

Status: high-priority queued proposal
Principle: native/visual capability claims require runnable evidence; source presence is insufficient.

Baseline rule: use
`.codex-auto/quality/native-coverage-gap-audit.json` schema v2 only after its
owner command regenerates it. A stale pre-import snapshot and the historical v1
`98%` value are never promotion evidence; `shippingShellReady=false` remains
blocking whenever the current artifact reports it.

---

## 1. Verification architecture

### 1.1 Rust verifier CLI

Create `aelyris-verify`:

```text
aelyris-verify nui architecture
aelyris-verify nui runtime-parity
aelyris-verify nui scene
aelyris-verify nui terminal
aelyris-verify nui ime
aelyris-verify nui accessibility
aelyris-verify nui performance
aelyris-verify nui recovery
aelyris-verify nui core-workflow
aelyris-verify nui webview-free
```

Early transition may keep PNPM wrappers, but wrappers invoke Rust verifier and do not duplicate truth。

### 1.2 Artifact location

```text
.codex-auto/quality/native-ui/
  architecture-boundary.json
  runtime-parity.json
  scene-contract.json
  terminal-interactive.json
  ime-ja.json
  accessibility.json
  visual-regression.json
  performance.json
  sleep-resume.json
  gpu-recovery.json
  core-workflow.json
  webview-free-distribution.json
  aggregate.json
```

### 1.3 Provenance schema

```json
{
  "schema": "aelyris.native-ui.evidence.v1",
  "verifier": "nui:terminal-interactive",
  "status": "pass",
  "startedAt": "...",
  "completedAt": "...",
  "git": { "head": "...", "dirty": false },
  "host": {
    "os": "...",
    "build": "...",
    "gpu": "...",
    "driver": "...",
    "dpi": 1.5
  },
  "inputs": [],
  "observations": [],
  "thresholds": {},
  "blockers": [],
  "artifacts": [],
  "claimLevel": "N1"
}
```

No artifact may claim actual machine sleep or human IME candidate use unless observed and HEAD-bound。

---

## 2. Gate classes

### Static

- dependency/import boundary
- command catalog/schema
- unsafe inventory
- no WebView dependency
- no duplicate shortcut owner

### Pure deterministic

- reconciliation/layout/focus/events
- scene/text clusters
- editor transactions
- projection revisions

### Headless GPU

- offscreen frame
- alpha/clip/glyph atlas
- pixel fixtures

### Live OS automated

- HWND/DPI/UIA client
- clipboard/window resize
- terminal PTY
- process restart

### Live OS manual

- Japanese candidate UI
- Narrator
- actual see-through screenshot
- Snap Layout
- real sleep/resume
- installer/update/rollback

Manual gate requires operator packet and exact HEAD。

---

## 3. Required verifiers

### NUI-VER-001 — Architecture boundary

Checks:

- runtime/core do not depend on Tauri/winit/wgpu/UI
- UI core does not depend on domain managers
- native actions use Control Kernel
- no second command registry
- `aelyris_native.rs` size/command ratchet
- adapter-only Tauri imports

### NUI-VER-002 — Runtime parity

Execute representative command matrix through native and Tauri adapters against fixture runtime。

Compare:

- command ID
- result schema/error code
- audit event
- projection revision
- governance decision
- idempotency

### NUI-VER-003 — UI tree invariants

- stable keys
- no dangling parent/child
- no ID reuse
- dirty propagation
- focus target exists
- modal focus trap
- unnamed focusable node fail

### NUI-VER-004 — Layout

Fixtures:

- 100/125/150/200% DPI
- min/max window
- split ratios
- terminal cell alignment
- long labels/localization
- scrollbar
- no seams/negative sizes

### NUI-VER-005 — Scene/pixel

- deterministic scene hash
- offscreen golden
- OS screenshot golden
- contrast/focus/material
- resize/nonblank

Pixel thresholds distinguish exact primitives from OS text/material variance。

### NUI-VER-006 — Transparency

Must use OS capture showing content behind window。

Observe:

- DWM backdrop type
- surface alpha mode
- background pixels
- glyph opacity
- mode distinction
- fallback

App-internal screenshot is not accepted。

### NUI-VER-007 — Text shaping

Fixtures:

- Latin/Japanese
- combining/emoji/RTL
- ligature/Nerd Font
- fallback

Compare cluster map、glyph count、advances、missing glyph、hit-test。

### NUI-VER-008 — Terminal renderer

- full/partial/unchanged
- 120x40
- dirty rect
- cursor/selection/search/link/image
- wide cell
- resize/scroll flood

### NUI-VER-009 — Terminal live input

- real PTY
- key echo/Ctrl+C
- paste/mouse
- pane focus
- no misroute
- sequence ID

### NUI-VER-010 — Japanese IME

Automated boundary + manual candidate selection。

Must prove:

- preedit visible
- caret anchor
- candidate selection
- fixture committed exactly once
- PTY/editor receives exact bytes/transaction
- no `WM_CHAR` duplicate
- DPI variants

### NUI-VER-011 — Paste safety

- destructive signatures
- multiline
- CRLF normalization
- bracketed paste
- context menu/drag-drop path
- audit event

### NUI-VER-012 — Accessibility

Automated:

- UIA root
- roles/names/states
- focus/invoke
- tree/list position
- no unnamed focusable

Manual:

- Narrator core workflow
- terminal/editor announcement
- high contrast/reduced motion

### NUI-VER-013 — Performance

Metrics:

- startup
- input-to-present
- frame build/submit/present
- terminal render/atlas
- layout/reconcile
- idle CPU/memory
- large list/16 panes
- 24h soak

Baseline first; enforce after owner-approved calibration commit。

### NUI-VER-014 — Recovery

- UI crash/restart
- daemon reattach
- surface/device lost
- resize storm/display change
- real sleep/resume
- no blank window
- no duplicate agent/PTY

### NUI-VER-015 — Editor model

- randomized edits
- undo/redo
- Unicode positions
- selections/IME
- save CAS/external conflict
- recovery/large file

### NUI-VER-016 — Core workflow

```text
launch
→ open project
→ inspect Mission
→ spawn visible agent pane
→ send prompt
→ observe output
→ inspect changed file/diff
→ run evidence gate
→ review exact commit
→ approve/merge
→ restart
→ verify retained state
```

N3 variant forbids WebView。

### NUI-VER-017 — WebView-free distribution

Checks:

- dependency graph
- binary imports/process tree
- packaged files
- no frontend assets
- no WebView2 controller creation
- no Tauri/Wry runtime
- clean machine
- installer/update
- core workflow
- uninstall/rollback

---

## 4. Promotion bundles

### N1 bundle

- architecture/runtime parity
- terminal renderer/input
- IME/paste
- performance/recovery
- visual/transparency
- rollback

### N2 bundle

N1 plus UI tree/layout、mode shell、command center、settings、a11y、dialogs/notifications、native primary shell。

### N3 bundle

N2 plus project tree/search、diff/review、editor E2、core workflow no WebView、save/recovery、exact merge。

### N4 bundle

N3 plus native updater/installer/signing、dependency/package probe、clean machine、legacy removal、public claim contract。

---

## 5. Performance methodology

### 5.1 Reference profile

Record CPU、GPU、driver、RAM、refresh、resolution/DPI、power mode、build profile、git HEAD。

### 5.2 Input latency timestamps

1. OS/native input received
2. PTY/editor transaction dispatched
3. projection/frame updated
4. GPU submit
5. present callback/estimated present

Report percentiles over defined samples, not single best。

### 5.3 Soak workload

- 4 active terminal floods
- 12 idle panes
- periodic Mission/projection updates
- search/list activity
- material/theme changes
- resize
- suspend/resume checkpoint

### 5.4 Visual

- deterministic offscreen fixture
- live OS screenshot
- perceptual diff
- manual review for material/text variance
- Current Best comparison

---

## 6. Failure evidence

A failed verifier still writes artifact with actual observation、expected、logs/screenshots、reproduction、rollback、blocker class。Missing artifact is never pass。

---

## 7. Aggregate status

```json
{
  "schema": "aelyris.native-ui.aggregate.v1",
  "head": "...",
  "highestVerifiedLevel": "N1",
  "levels": {
    "N0": "pass",
    "N1": "pass",
    "N2": "blocked",
    "N3": "not_started",
    "N4": "not_started"
  },
  "criticalBlockers": [],
  "staleArtifacts": [],
  "claimAllowed": ["native terminal primary"],
  "claimForbidden": ["full-native Rust UI", "WebView-free"]
}
```

README/public docs read aggregate; they do not infer from focused proof。

---

## 8. CI and manual lanes

### Pull request

- static/pure tests
- headless GPU where stable
- scene snapshots
- unit/property
- dependency ratchet

### Windows integration

- live window/UIA
- terminal PTY/clipboard
- short performance
- recovery

### Operator/manual

- IME candidates
- Narrator
- transparency
- sleep/resume
- installer/update
- real AI CLI provider matrix

Manual artifact expires when relevant owner code changes。

---

## 9. Anti-patterns

Forbidden:

- source grep alone proves runtime behavior
- JSON `webviewUsed=false` without dependency/process probe
- native window created but blank
- synthetic power message claimed as real sleep
- injected IME result claimed as candidate dogfood
- focused PASS promoted to N-level
- stale artifact reused
- inside-window screenshot used as transparency proof
- reviewer equals implementer for Critical gate without exception
