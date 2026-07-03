# renderer-instructions.md — Stage 1 GPU Renderer (WU-TC-1a..1f)

Generated: 2026-07-02. Implements Stage 1 of `docs/specs/TERMINAL_CORE_DESIGN.md` (READ IT FIRST — it is the contract; this file is only the execution order). Claim policy applies: completion is proven by gates, never prose.

**Execution order relative to other work orders**: run AFTER `refactor-instructions.md` and `hardening-instructions.md` are complete or their reports are filed. Do not run concurrently with them (shared files: `package.json`, `scripts/`, `src/features/terminal/`).

---

## 1. Objective

Replace the Canvas2D per-cell `fillText` renderer with a WebGL2 glyph-atlas renderer **behind the existing paint seam**, feature-flagged, with automatic fallback — proven by a parity+perf harness built FIRST. Zero change to: GridSnapshot contract, damage logic, IME, transparency, design system, VT engine, PTY layer.

## 2. Ground rules

- First action: `git status --short` — if `src/features/terminal/**`, `package.json`, or `scripts/verify-terminal-font-render-contract.mjs` are dirty, stop and report.
- Baseline (record before any edit): `pnpm exec tsc --noEmit`, `pnpm test` (pass count), `cargo test --manifest-path src-tauri/Cargo.toml --lib` (count; serial with pnpm test, never parallel on Windows), `git log --oneline -3`.
- One phase = one commit; stage files explicitly; push of the feature branch after green gates is allowed; never push main / never force / never open-merge PRs.
- **The harness comes first (R1).** No renderer code may be committed before the harness that can falsify it is green. This ordering is non-negotiable — it is the anti-garbage-code mechanism.
- Never weaken `verify-terminal-font-render-contract.mjs` or `terminalColors` tests to make GPU output pass. If the GPU path cannot satisfy a contract, stop and report.
- No new dependencies without a stop-and-ask (goal: zero — WebGL2 is a browser API; the atlas uses offscreen Canvas2D rasterization).
- Rust side is OUT OF SCOPE entirely (no `src-tauri` edits in this work order).

## 3. Phases

### R0 — Read + baseline (`chore:` if anything to commit)
Read `docs/specs/TERMINAL_CORE_DESIGN.md` §2/§5/§8, then `src/features/terminal/terminalPaint.ts`, `TerminalCanvas.tsx` (paint call sites ~:807-830), `repaintDecision.ts`, `src/shared/types/terminal.ts`, `terminalColors.ts`, `scripts/verify-terminal-font-render-contract.mjs`. Record baseline. **First commit must include `docs/specs/TERMINAL_CORE_DESIGN.md` (already authored, untracked) + a one-row addition to the spec table in `docs/specs/README.md`** (four-layer sync; the row: TERMINAL_CORE_DESIGN.md | pillar 1 | terminal core decision record + staged GPU renderer plan).

### R1 — Parity + perf harness (WU-TC-1a, `test:`) — THE GATE, BUILT FIRST
1. **Fixture grids**: build deterministic `GridSnapshot` fixtures under `src/features/terminal/__fixtures__/`: (a) dense ASCII grid, (b) CJK + wide cells, (c) heavy SGR attrs (bold/underline/reverse/truecolor runs), (d) cursor variants + selection + search bands + link underlines + ghost text, (e) an image-cell grid. Reuse existing snapshot builders if present (`NativeTerminalArea.tsx:188 buildPreviewTerminalSnapshot` is a starting pattern); do not hand-write raw cell arrays where a builder exists.
2. **Pixel-parity runner** `scripts/verify-renderer-parity.mjs` + a vitest/browser-mode or jsdom-canvas strategy will NOT work for real pixels — use a small Playwright-driven page (there is Playwright infra in `e2e/`) that renders each fixture twice (Canvas2D path and, later, GPU path) into offscreen canvases and compares. Until the GPU path exists, the runner compares Canvas2D against itself (self-parity = harness sanity) and exits with a `pending-gpu` status artifact. Emit `.codex-auto/quality/renderer-parity.json`.
   - Parity metric: per-pixel diff with a small tolerance budget (antialiasing noise) — define tolerances as named constants; text pixels must remain fully opaque (assert alpha==255 on glyph-covered sample points, tying into the render contract).
3. **Perf harness** `scripts/verify-renderer-perf.mjs` (same Playwright page): measures the §8 metrics that are measurable offline — full-grid repaint p95, scroll-flood replay throughput, atlas counters (once GPU exists) — and writes `.codex-auto/quality/renderer-perf.json` with a `baseline` block recorded from the Canvas2D path. **This phase only RECORDS the baseline; it enforces nothing yet.**
4. `package.json`: add `verify:renderer:parity` / `verify:renderer:perf`.
Verification: both scripts run green (self-parity + baseline recorded); full GATES green.

### R2 — Glyph atlas module (WU-TC-1b, `feat:`)
1. `src/features/terminal/gpu/glyphAtlas.ts`: pure TS class — key (char/cluster, fontKey, dpr, style bits) → atlas page + uv rect; rasterizes via offscreen Canvas2D `fillText` (same font stack as today = shape-identical glyphs); LRU eviction with counters (hits/misses/evictions exposed for the perf artifact).
2. Unit tests (vitest, no GPU needed): key stability, eviction order, dpr separation, counter correctness.
Verification: full GATES.

### R3 — WebGL2 renderer behind the seam (WU-TC-1c, `feat:`)
1. `src/features/terminal/gpu/terminalPaintGpu.ts` implementing the SAME exported function surface as `terminalPaint.ts` (paintRow/paintSearchBands/paintLinkUnderline/paintSelectionBand/paintGhostSuggestion/paintImages/paintCursor — identical signatures) over a WebGL2 context: background-run quads pass, glyph quads pass (atlas), overlay passes preserving current z-order, image textures for `paintImages`.
2. Premultiplied-alpha context; transparent clear; glyph pixels opaque (contract). No ligature faking.
3. Extend the R1 parity runner to render fixtures through the GPU path and compare against Canvas2D. **Parity gate must pass here** (tolerance constants may be tuned ONLY with justification in the commit message; never per-fixture exceptions).
Verification: `pnpm verify:renderer:parity` green with real GPU-vs-Canvas comparison; full GATES.

### R4 — TerminalCanvas wiring + fallback (WU-TC-1d, `feat:`)
1. Feature flag (settings-backed, default OFF; follow the existing settings pattern in the repo — grep how other experimental flags are stored) selecting the paint implementation in `TerminalCanvas.tsx`. The damage logic (`shouldRepaintRow`) is reused unchanged.
2. Fallback: WebGL context creation failure or `webglcontextlost` → automatic switch to Canvas2D within the session + diagnostic log entry; a regression test simulating context loss.
3. Update `src/__tests__/AppSilentBugs.test.ts`-style source scans if any assert paint call sites (same-commit rule).
Verification: full GATES; `pnpm build`; flag OFF = byte-identical behavior to before (parity runner Canvas-vs-Canvas still green).

### R5 — Transparency parity + contract extension + soak (WU-TC-1e, `test:`/`fix:`)
1. Extend `verify-terminal-font-render-contract.mjs` to cover the GPU module (same assertions: opaque text colors, solid clarity) — extension, not weakening.
2. Transparency screenshot proof: Playwright page over a transparent background rendering both paths; assert the app-transparent region alpha is preserved identically. Record as artifact. (True DWM see-through cannot be CDP-verified — note in the report that final visual sign-off is an operator step, per repo convention.)
3. Short soak in the harness (10k-frame replay loop): assert no unbounded atlas growth (eviction working), stable frame time (no >10% decay), no detached-context errors.
Verification: contract verifier green for both paths; parity+perf artifacts fresh; full GATES.

### R6 — Perf report + flag-default proposal (WU-TC-1f, `chore:`, decision is OWNER's)
1. Re-run `verify:renderer:perf`; write the comparison table (baseline vs GPU) into the report and into `.codex-auto/quality/renderer-perf.json`.
2. Propose (do NOT flip) the flag default based on §8 targets; enforcement thresholds in the perf verifier may be enabled in this commit ONLY for metrics that already pass with margin.
3. Update `docs/specs/TERMINAL_CORE_DESIGN.md` §8 baseline column and the traceability/gate rows (four-layer sync).

## 4. Stop-and-ask conditions

1. The 7-function seam turns out to be leaky (TerminalCanvas paints outside `terminalPaint.ts` exports, or paint functions mutate shared state) — report the exact call sites; do not widen the seam silently.
2. Pixel parity is unreachable within reasonable tolerance for a fixture class (likely candidates: subpixel AA differences, image scaling) — report with diff images; do not raise tolerances beyond the named constants without approval.
3. Any need for a new npm dependency (including pixel-diff libs — prefer hand-rolled diff or existing devDeps; check `pnpm ls pixelmatch` first).
4. WebView2's WebGL2 behaves unexpectedly (context limits, DPR issues) in the Playwright environment vs the Tauri runtime — report the divergence; do not paper over with environment-specific branches.
5. Anything requiring Rust-side changes.

## 5. Reporting format

Per phase, same format as the other work orders (Status/Commit/Diffstat/Gates/Notes), ending with: baseline-vs-GPU perf table, parity tolerances used, all stop-and-ask questions, and `git log --oneline` of your commits.
