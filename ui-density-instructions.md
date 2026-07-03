# ui-density-instructions.md — WU-UD-1 execution order (2026-07-03)

Implements `docs/specs/UI_DENSITY_AUDIT_2026-07-03.md` (READ IT FIRST — it
carries the measurements, the design targets, and the D1-D10 table with every
file:line; this file is only the execution order and the gate discipline).
Owner intent: "the UI leans web-app; the terminal is cramped, especially
split" — target: 2×2 split ≥80% of the center panel is grid (today 64.6%).

**Ordering:** independent of `fleet-api-instructions.md` (disjoint files);
do not run both in one session.

## 1. Requirements (numbered, from the audit)

- **UR-1** No chrome strip may render when it carries no live information
  (empty TimelineBar, unfocused IMEInputBar).
- **UR-2** Per-pane fixed vertical chrome ≤ 40px in dense mode (today 114px).
- **UR-3** The existing `data-density` modes must govern ALL terminal chrome
  (heights, gutters, gaps), not only `--space-*` tokens.
- **UR-4** IME composition must keep working EXACTLY as today (two composition
  paths: hidden textarea + IMEInputBar). Collapsing is visual only; no change
  to composition event handling or focus routing.
- **UR-5** The PTY grid math must stay in sync with visual gutters
  (`CANVAS_GUTTER` mirrors CSS padding) — no drift, no clipped glyphs.
- **UR-6** A machine gate must pin the density contract so it cannot silently
  regress (same philosophy as the terminal font-render contract).
- **UR-7** No renderer/paint contract changes; no design-token *values*
  outside the density blocks are altered (this is layout, not theme).

## 2. Ground rules

- Branch: `feat/wu-ud-1-terminal-density` off current `main`. Never push
  `main`, never force-push, no PRs. Push the branch after green gates, stop.
- One phase = one commit; explicit stage; serial pnpm/cargo.
- Rust side is OUT OF SCOPE entirely (no `src-tauri` edits in this WU).
- Never weaken `verify-terminal-font-render-contract.mjs`, `terminalColors`
  tests, or any visual QA gate.
- **The gate comes first (U0).** No density change may be committed before
  the verifier that can falsify it is green — the renderer WU's
  harness-first rule, same reason.
- Anything requiring live eyes (IME, real wallpaper contrast) is an
  **OPERATOR GATE**: implement + unit-test + verifier, then list it in the
  Result section for the owner's visual pass. Do not claim it yourself.

## 3. Phases

### U0 — density contract verifier FIRST (`test:`)
Build `scripts/verify-terminal-density-contract.mjs` + package.json script
`verify:terminal:density`. It is a SOURCE contract (no CDP dependency):
1. Parses the CSS modules + tsx anchors from the audit table and asserts,
   per density mode, the budget: TerminalInfoBar height token, TimelineBar
   conditional-render expression present (`NativeTerminalArea.tsx` must gate
   the mount, not just style it), IMEInputBar collapsed-state rule,
   `terminalViewport` padding == `CANVAS_GUTTER` constant (parse both files
   and compare numbers — this pins UR-5), per-pane gap/padding sums ≤ the
   UR-2 budget in dense mode.
2. Until U1-U5 land, the verifier runs in `baseline` mode: it records
   current values into `.codex-auto/quality/terminal-density-contract.json`
   with `status:"baseline-recorded"` and exits 0; a `--enforce` flag (turned
   on in U5) makes budget violations exit 1. This mirrors the renderer
   parity harness's `pending-gpu` pattern.
Gate: script runs, artifact written, `pnpm test`/`tsc` untouched-green.

### U1 — D1 IMEInputBar auto-hide (`feat:`) — HIGHEST RISK, DO SECOND NOT LAST
Per audit D1: collapsed (height 0, visually hidden, but MOUNTED — UR-4) unless
(a) the pane is focused, or (b) composition is active, or (c) the user opened
it via its keybinding. Files: `NativeTerminalArea.tsx:1507` area,
`IMEInputBar.module.css:17`.
- ADD vitest: collapsed by default, expands on focus prop, expands while
  composing regardless of focus, textarea remains mounted when collapsed.
- OPERATOR GATE: live Japanese IME composition in the running app (owner).
  List it in Result; do not claim.

### U2 — D2 TimelineBar conditional (`feat:`)
Mount `null` when no snapshots AND no active overlay (`NativeTerminalArea.tsx:1339`);
Mark action moves to the pane header overflow (keep keybinding). ADD vitest
for the mount condition. Empty-rail 18px reservation dies with this.

### U3 — D3+D4 gutter & padding consolidation (`refactor:`)
`terminalViewport` padding 10→4 AND `CANVAS_GUTTER` 10→4 in the same commit
(`TerminalArea.module.css:70`, `NativeTerminalArea.tsx:97`); collapse
`terminalMount`/`terminalArea` paddings per audit D4 keeping the 1px focus
ring. The U0 verifier's padding==constant assertion is the drift lock.

### U4 — D5 pane header slim + one-strip (`feat:`)
22→18px; hide on lone/maximized pane (title in StatusBar). Header becomes
the single strip: state dot · title · role badge · overflow. (If WU-FA-1
already landed `%N`, include the `%N ·` prefix; otherwise leave the hook.)
ADD vitest for the lone-pane hide condition.

### U5 — D6 `--terminal-chrome-density` tokens + ENFORCE (`feat:`)
Wire every value above into the `data-density` blocks (`global.css:897-943`):
compact = header 18 / timeline 0-or-18 / input 0-on-blur / gutter 4 / gaps 0.
Flip the U0 verifier to `--enforce` in package.json. Gate: verifier enforces
and passes in all three density modes.

### U6 — D7-D9 rails (`feat:`)
Right panel collapsible + default 320→280 (`global.css:1250`,
`appStore.ts:1214`); left panel auto-collapse reuse (`global.css:1169`);
mode-rail 64→48 icon-only (`global.css:976`); app-main gaps in dense
(`global.css:928-951`). ADD tests where a store default changes
(`appStore` defaults have tests — update them deliberately, never delete).

### U7 — D10 Zen mode (`feat:`)
One keybinding toggles both side rails + header chrome off (status bar
stays). Reuse existing collapse plumbing; register through the keybinding
engine (conflict-checked). ADD vitest for the toggle state.

### U8 (STRETCH) — §4 polish
Strip typography tokens (11px mono-labels), strip contrast ≥4.5:1 over
wallpaper (extend the measured-contrast approach), 120ms max transitions.
Skip freely if any ambiguity — file notes in Result instead.

## 4. Definition of done

- `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm exec biome lint src` green.
- `pnpm verify:terminal:density --enforce` green in focus/balanced/dense.
- `pnpm verify:terminal:font-render` untouched-green.
- Re-measure and record: sum of visible canvas rects / window area for
  single-pane and 2×2 at 1440×900 (the audit documents the method); write
  both numbers into the Result section next to the audit's baseline
  (37.6% / 29.7%). Target: ≥50% / ≥42% of window; ≥90% / ≥80% of center.
- Branch pushed; `## Result` appended to this file: phases done, gate
  outputs, the two utilization numbers, OPERATOR GATE list (IME live check,
  wallpaper contrast pass), skipped items with reasons.

## Pasteable goal for a cleared codex session

```text
/goal C:\Users\owner\Aether_Terminal で AGENTS.md -> docs/requirements.md -> docs/AGENT_WORKFLOWS.md -> docs/specs/README.md -> docs/specs/UI_DENSITY_AUDIT_2026-07-03.md -> ui-density-instructions.md を順に読み、ui-density-instructions.md の Phase U0 から U7 を完遂しろ（U8 は任意）。ブランチは feat/wu-ud-1-terminal-density を main から切る。U0 の density 検証器を最初に作り、それが緑になるまで密度変更をコミットするな。1フェーズ=1コミット、明示 stage、ゲート緑を確認してから次へ。IME の実機確認と壁紙コントラストは OPERATOR GATE として Result に列挙し、自分で claim するな。src-tauri は編集禁止。既存テスト・検証器の弱体化禁止。main への push / force push / PR 作成禁止、完了したら feature branch を push して ui-density-instructions.md 末尾に Result を追記して停止。ブロックしたら理由を報告して停止。
```
