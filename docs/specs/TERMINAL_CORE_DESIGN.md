# Aelyris Terminal Core Design (Pillar 1)

Status: DESIGN RECORD + staged plan. Contains no completion claims — every stage is proven only by its named gates (`docs/requirements.md` claim policy).
Authored: 2026-07-02 JST (closes the "pillar 1 has no design doc" gap — QUALITY_REMEDIATION_PLAN S1-7).
Owner surfaces: terminal rendering, VT engine, PTY plumbing, font stack.

---

## 1. Scope and problem statement

Aelyris's terminal spine (PTY daemon, VT state, snapshot/diff, detach/reattach) is production-grade; the **shipping cell renderer is Canvas2D per-cell `fillText`** — no GPU glyph atlas, no ligatures, no shaping. This is the largest measured gap versus terminal peers (Ghostty/WezTerm/Warp class). This document records the architecture as verified on 2026-07-02, the strategic decision governing where native code is used, and a two-stage renderer plan with falsification criteria and blocking gates.

## 2. Current architecture (verified path:line; re-verify anchors before editing)

### 2.1 Data flow

```
shell/agent process
  → PTY layer: in-process manager (src-tauri/src/pty/manager.rs) +
    out-of-process pty sidecar (src-tauri/pty-server/, survives app restart) +
    registry split (in-process NativeTerminalRegistry vs sidecar adoption)
  → VT engine: src-tauri/src/term/engine.rs (alacritty_terminal-based;
    ChunkAssembler for chunked OSC 1338 images ~:94-97 — ConPTY truncates OSC >~512B;
    osc_pending straddle buffering ~:80-83)
  → GridSnapshot (typed contract: src/shared/types/terminal — CellSnapshot,
    CellAttr, CursorSnapshot, ImageRef) delivered to the frontend
  → TerminalCanvas.tsx: per-row damage check (repaintDecision.ts shouldRepaintRow)
  → paint surface: src/features/terminal/terminalPaint.ts
```

### 2.2 The paint seam (this is the replacement boundary)

`terminalPaint.ts` exports a pure, renderer-agnostic surface consumed by `TerminalCanvas.tsx` (~:820):

| function | responsibility |
|---|---|
| `paintRow` (:49) | cells: background runs + glyph text (`fillText` :121,123) |
| `paintSearchBands` (:150) | search highlight bands |
| `paintLinkUnderline` (:178) | OSC-8 / scanned link underlines |
| `paintSelectionBand` (:204) | selection overlay |
| `paintGhostSuggestion` (:221) | inline ghost text |
| `paintImages` (:271) | image cells (`drawImage` :284, chunked-OSC 1338 protocol) |
| `paintCursor` (:288) | cursor shapes |

Everything above this seam (GridSnapshot, damage tracking, selection/search/link scanning, IME overlay, input) is renderer-independent and MUST NOT change when the renderer changes.

### 2.3 Standing contracts and platform constraints

- **Render contract gate**: terminal text is painted with fully opaque colors / solid clarity (`src/features/terminal/terminalColors.ts` `forceOpaqueCssColor`; `verify-terminal-font-render-contract.mjs`; `terminalColors.test.ts`). Any new renderer must keep this gate green.
- **See-through window**: transparency requires NO DWM backdrop material (root-cause fix `807322c`); wallpaper/mood/glass hierarchy live in CSS with a single-blur rule. CDP cannot verify transparency — screenshot-based proof only.
- **ConPTY limits** (reference-verified): OSC ~512B truncation (hence the chunked image protocol), APC stripped, cell width must be measured not assumed.
- **WebView2 long-session degradation** is a known risk for 24/7 fleet operation; the persistence design (SQLite = truth, UI = reloadable projection) is the standing mitigation.
- **Native proof assets**: `src-tauri/src/bin/aelyris_native.rs` (~8.8k lines, unshipped spike) carries `DirectWriteTextShaper` (:15) and capture/render subcommands — groundwork for Stage 2, not shipped product.
- **Font stack risk**: proof path uses `fontdue → ttf-parser 0.21` (unmaintained; stack-risk gate classifies it release-blocking). See §7.

## 3. Decision record — where native code is used

**Decision (reaffirmed 2026-07-02, supersedes the informal 2026-04-17 wording):**

> Rust owns all truth (state, persistence, governance). Native rendering is used where frame-time dominates (terminal cell grid). Web (Tauri/React) is used where feature velocity and design-system quality dominate (cockpit, editor, inspector). The UI is a disposable, reloadable projection.

Rationale:
1. Differentiation (audit/handoff/ownership/MCP/deterministic merge) is 100% backend; renderer work buys quality, not moat.
2. Monaco is a structural anchor — no native equivalent exists; a WebView remains regardless, so "full native" was never the real choice set.
3. Solo-owner + AI-fleet development: React/TS is where coding agents are most productive; a custom wgpu UI is where unreviewable garbage code is most likely.
4. The SQLite-truth/restore architecture already makes the web UI cheap to recycle, structurally hedging WebView2 degradation.

Alternatives rejected: **full native UI rewrite** (Warp/Zed path — requires multi-year framework investment and forfeits Monaco, the glass design system, and the existing test estate); **Electron** (strictly worse than Tauri here); **status quo forever** (fails the Ghostty-class bar on latency/throughput/ligatures).

**Falsification criteria — reopen this decision if ANY of these is observed:**
- F1: after Stage 1 ships, measured input latency / scroll throughput / 24h soak still fail the §8 targets;
- F2: WebView2 long-session degradation proves unabsorbable by the reload/recycle strategy (documented soak evidence);
- F3: the product drops the editor pillar (Monaco), removing the structural WebView anchor.

**UI no-regression constraint (hard):** no stage may ship if it visually regresses the shipped glass/transparency/mood system. Aesthetic parity is a blocking gate, not a nice-to-have.

## 4. Stage 0 — Canvas2D (shipping today)

Kept permanently as the fallback renderer: lowest-common-denominator correctness, used on GPU context loss, driver denylist, or flag-off. Stage 0 receives no feature investment beyond bug fixes.

## 5. Stage 1 — GPU glyph-atlas renderer inside the WebView (WebGL2)

Goal: replace per-cell `fillText` with an atlas-based GPU path **behind the existing paint seam**, keeping compositor, transparency, IME, and design system untouched.

Design:
- **API-compatible module** `terminalPaintGpu.ts` implementing the same 7-function surface (§2.2) so `TerminalCanvas.tsx` switches implementations behind a feature flag; `shouldRepaintRow` damage logic is reused unchanged (full-frame GPU redraw is cheap, but damage info still gates work).
- **Glyph atlas**: single texture array/page set keyed by (glyph, font, size, weight, style, dpr); rasterize glyphs via offscreen Canvas2D `fillText` into the atlas (reuses the browser's font rasterizer — identical glyph shapes to Stage 0, which makes pixel-parity testing tractable); LRU eviction; DPR-aware.
- **Draw model**: instanced quads — one pass for background run rects, one for glyphs, then overlay passes (selection/search/link/ghost/cursor) preserving today's z-order; images keep `drawImage` semantics via textures.
- **Technology choice**: WebGL2 first (universally available in WebView2, context-loss semantics well understood). WebGPU is a permitted later swap behind the same seam; do not block Stage 1 on it.
- **Transparency**: premultiplied-alpha canvas context; transparent clear color where the app background shows through; **glyph pixels stay fully opaque** (render contract). The see-through feature must be pixel-identical outside the terminal region.
- **Fallback**: `webglcontextlost`/creation failure → automatic, logged switch to Stage 0 within the same session; a user-visible-but-quiet degradation note in diagnostics, never a blank pane.
- **Ligatures/shaping are NOT Stage 1 scope** (browser `fillText` per-cluster cannot shape across cells): Stage 1 buys latency/throughput/scroll smoothness; shaping arrives with Stage 2's DirectWrite path. Do not fake ligatures in Stage 1.

Gates (all must exist before the flag defaults on — see §8): pixel-parity harness vs Stage 0 on fixture grids; perf harness with recorded baseline; render-contract gate extended to the GPU path; transparency screenshot parity; soak/context-loss recovery test.

## 6. Stage 2 — native wgpu surface (opt-in "performance mode")

Goal: Ghostty-class ceiling — native wgpu child surface for the terminal region, DirectWrite shaping (real ligatures), zero WebView2 involvement in the hot path.

Sketch (to be expanded into its own implementation order when entry criteria fire):
- wgpu surface on a DirectComposition visual with premultiplied alpha (per-pixel transparency), composed BENEATH the transparent WebView2 so DOM glass panels layer above the terminal (airspace design is the main risk and the first spike).
- DirectWrite shaping/rasterization replaces `fontdue`/`ttf-parser` (§7); glyph atlas in wgpu; grid pipeline reuses the same `GridSnapshot` (no VT engine change).
- Input/IME: reuse the existing native input HWND host work (`native-terminal-input-host` proof) and the established IME overlay contract.

**Entry criteria** (do not start otherwise): Stage 1 shipped AND a §8 target measurably missed (F1), OR ligature/shaping demand is promoted to a product requirement.
**Blocking promotion gates**: (a) **see-through parity** — screenshot comparison proving transparency/wallpaper/glass layering identical to the web path; (b) IME parity on the native surface; (c) input routing with no focus traps; (d) UI no-regression constraint (§3). If (a) cannot be met, Stage 2 does not ship and Stage 1 remains the product path.

## 7. Font stack decision (resolves remediation-plan S2-7)

- Windows shaping/rasterization authority for Stage 2: **DirectWrite** (already proofed in `aelyris_native.rs`). `fontdue`/`ttf-parser` are retired from any release-blocking path; they may remain only in the unshipped spike until Stage 2 work begins, classified accordingly in the stack-risk gate.
- Cross-platform future (if/when non-Windows targets matter): `skrifa` + `harfrust`-class stack is the candidate; decision deferred until a second OS target is real.
- Stage 1 deliberately rides the browser's font rasterizer (no new font dependency at all).

## 8. Measurement gates (initial targets — calibrate against the R1/R6 baseline before enforcing)

| metric | how measured | Stage 0 baseline | Stage 1 target | Stage 2 target |
|---|---|---|---|---|
| full-grid repaint time (120x40, all-dirty) | perf harness, p95 over 1k frames | R6 Canvas2D: 27.1 ms p95 / 21.949 ms avg (`.codex-auto/quality/renderer-perf.json`, 2026-07-02T14:56:35Z) | < 4 ms (not enforced until recalibrated) | < 1 ms |
| scroll flood throughput (large-file `cat` fixture replay) | frames painted / source frames dropped | R6 Canvas2D: 229/240 frames over 60fps budget; 24.9 ms p95 / 20.478 ms avg | no dropped rows at 60fps | 120fps-capable |
| key-echo paint latency (keydown → cell painted) | dev harness `performance.now()` bracketing | pending live input harness | p99 < 33 ms | p99 < 16 ms |
| soak (24h synthetic agent output) | RSS/heap growth + fps decay | R5 WebGL2 short soak: 10,000 frames, decayRatio 0.746, no context loss/errors; 24h soak pending | < 10% decay, no leak trend | same |
| atlas behavior | hit-rate + eviction churn counters | n/a; R6 WebGL2 sampled hit-rate 0.98 / 0.9786; R5 soak hit-rate 0.9996 | > 95% steady-state hit rate | same |

Gate wiring: `pnpm verify:renderer:parity` (pixel-diff fixtures), `pnpm verify:renderer:perf` (emits `.codex-auto/quality/renderer-perf.json`; targets enforced only after baseline calibration commit), `pnpm verify:renderer:transparency`, `pnpm verify:renderer:soak`, and `pnpm verify:terminal:font-render`. Numbers above are engineering targets, not marketing claims — claim policy applies.

R6 decision note: Stage 1 remains opt-in. The current WebGL2 path passes parity/contract/transparency/short-soak gates, but the performance artifact records only a 48x12 sampled WebGL2 comparison because the current full-grid WebGL2 path does not complete inside the verifier budget. The artifact therefore proposes `canvas2d` as the default until a later optimization run produces owner-approved evidence to flip it.

## 9. Work-unit map

| WU | content | work order |
|---|---|---|
| WU-TC-1a | parity + perf harness FIRST (fixtures, pixel-diff, baseline artifact) | `renderer-instructions.md` R1 |
| WU-TC-1b | glyph atlas module (pure TS, unit-tested) | R2 |
| WU-TC-1c | WebGL2 renderer implementing the paint surface, feature-flagged | R3 |
| WU-TC-1d | TerminalCanvas wiring + context-loss fallback | R4 |
| WU-TC-1e | transparency parity + render-contract extension + soak | R5 |
| WU-TC-1f | perf report vs targets; owner decides flag default | R6 complete; artifact proposes `canvas2d` default |
| WU-TC-2x | Stage 2 spike: DComp visual + transparent-WebView2 layering proof | separate work order after entry criteria |

Four-layer sync: this document is the design layer; `docs/specs/README.md` gains an index row and the traceability map gains the gate names in the same commit that lands the harness (R1).
