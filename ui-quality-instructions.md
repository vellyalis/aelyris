# ui-quality-instructions.md — WU-UQ-1 execution order (2026-07-05)

Implements `docs/specs/UI_PRODUCT_QUALITY_AUDIT_2026-07-05.md` (READ IT FIRST —
it carries the evidence, the verdict, the constraints, and every `file:line`
anchor; this file is only the execution order and gate discipline).
Owner intent: Aelyris must *feel* like a high-trust AI cockpit — no
fake-alive panes, no heuristic verdicts dressed as authority, ownership and
blockers visible, dangerous actions keyboard-safe, rendered UI truth gated.

**Ordering / conflicts:**
- Do NOT run concurrently with `fleet-api-instructions.md` (WU-FA-1 also
  edits `TerminalInfoBar.tsx` and the fleet snapshot). If WU-FA-1 merged
  first, rebase and keep its `%N` prefix intact.
- Independent of `ui-density-instructions.md` (already landed on main —
  never weaken its verifier `verify-terminal-density-contract.mjs`).

## 1. Requirements (numbered, from the audit)

- **UQ-1 (liveness)** Every pane header must render session lifecycle:
  live / reconnecting / exited / detached. A dead or reconnecting pane must
  be visually distinct within 1s of the state being known.
- **UQ-2 (reconnect visibility)** Sidecar stream reconnect attempts must be
  surfaced to the UI as events; silent retry with a normal-looking pane is
  forbidden.
- **UQ-3 (paste safety)** Pasting more than one line into a terminal input
  path must show a preview-confirm before execution. Single-line paste is
  unchanged. A settings opt-out exists. IME composition behavior must be
  byte-identical to today.
- **UQ-4 (ownership visible)** When populated, `owner`, `workspaceScope`,
  `writeSet` render on session/lane cards; `blockedReason`/`nextActor`
  render whenever status is blocked. Render-only-when-present; no empty
  chrome.
- **UQ-5 (keyboard approvals)** Approve/deny of a pending decision is
  possible keyboard-only, reusing the existing latch + stale-prompt guard
  exactly (no new approval path).
- **UQ-6 (evidence honesty)** No verdict chip may present inferred state as
  verified. Heuristic-derived states (`reviewQueue.ts` inference) are
  labeled `inferred` with their source; a "Blocked" badge requires a
  clickable evidence target or downgrades to `unverified`.
  `MergeQueuePanel` is the untouched gold standard.
- **UQ-7 (no unwired capability)** Dead layers are removed or wired:
  ghost `Sidebar.tsx` + `sidebarSection`; unwired
  `src-tauri/src/config/keybindings.rs`; the hand-written Settings shortcut
  list becomes generated from the real binding table.
- **UQ-8 (keyboard-complete shell)** F6/Shift+F6 region cycle; a right-rail
  toggle binding; app-level split commands in the palette;
  `productMode`/`rightRailMode` persisted per workspace (zen stays
  transient).
- **UQ-9 (machine gate)** A trust-contract verifier pins UQ-1..UQ-6 so they
  cannot silently regress, following the glass-legibility registration
  convention (script → package.json → goal:safe step → quality-score
  boolean).
- **UQ-10 (rendered truth in CI)** CI gains a Playwright job running
  `e2e/visual-qa-layout.spec.ts` (continue-on-error initially; blocking flip
  is an operator decision).

## 2. Ground rules

- Branch: `feat/wu-uq-1-trust-cockpit` off current `main`. Never push
  `main`, never force-push, no PRs. Push the branch after green gates, stop.
- One phase = one commit; explicit stage; serial pnpm/cargo (never parallel
  on Windows).
- **The gate comes first (Q0).** No trust-surface change is committed before
  the verifier that can falsify it is green in baseline mode.
- `src-tauri` edits are allowed ONLY in Q2 and ONLY as event emission —
  no PTY state machine, protocol, or renderer changes anywhere.
- **WINDOW TRANSPARENCY IS ABSOLUTE (owner law).** The per-pixel
  see-through window is the product core. Never touch: the DWM material /
  see-through path (`DWMSBT_NONE` per-pixel transparency — see-through
  requires NO material), window background alpha, glass alpha tokens, or
  any `backdrop-filter` chain. No new opaque full-bleed layers; any new
  overlay/dialog (Q3 PasteGuardDialog included) uses the existing glass
  dialog surfaces. `pnpm verify:renderer:transparency` and
  `pnpm verify:ui:glass-legibility` must stay untouched-green after every
  phase. Note: transparency CANNOT be verified via CDP/Playwright — any
  doubt is an OPERATOR GATE (OS-level visual), never a self-claim.
- FORBIDDEN: transparency/glass token values, layout geometry redesign,
  `.bento-*` revival, renderer/paint contracts, weakening ANY existing test
  or verifier (`verify-terminal-density-contract`, font-render, glass
  legibility, right-rail suites), claiming F12 go-to-definition.
- Anything requiring live eyes is an **OPERATOR GATE**: implement +
  unit-test + verifier, then list it under `## Result` — do not claim it.
- All `file:line` anchors below are point-in-time (2026-07-05, `8a3b3f0`
  era). Re-locate with Grep before editing; if an anchor moved, trust the
  search, not this file.

## 3. Phases

### Q0 — trust contract verifier FIRST (`test:`)
Build `scripts/verify-ui-trust-contract.mjs` + package.json script
`verify:ui:trust`. SOURCE contract (no CDP), following the
`verify-glass-legibility-contract.mjs` envelope (checks[], freshness mtimes,
`.codex-auto/quality/ui-trust-contract.json`, exit 1 on failure):
1. `TerminalInfoBar` receives a lifecycle prop AND renders a
   liveness element for the non-live states (Q1).
2. Sidecar reconnect path emits a stream-state event (grep the emit in
   `pty_sidecar.rs`) AND a UI consumer exists (Q2).
3. IMEInputBar paste paths route multi-line through a guard before
   `onSubmit` (Q3).
4. `SessionCard` renders owner/writeSet conditionally AND a
   blockedReason render site exists (Q4).
5. A decision approve/deny keybinding is registered (Q5).
6. `reviewQueue` verdict rendering carries a provenance/`inferred` marker
   (Q6).
7. Toast severity maps to Radix `type` (Q7).
Until phases land, run in `baseline` mode (record current values,
`status:"baseline-recorded"`, exit 0); `--enforce` flips failures to exit 1
(turned on in Q10). Mirrors the UD-1 U0 pattern exactly.
Gate: script runs, artifact written, `pnpm test`/`tsc` untouched-green.

### Q1 — pane liveness in the header (`feat:`) — SMALLEST SAFE PATCH
`paneLifecycleStates` is already computed
(`PaneTreeContainer.tsx:205,416-440`) but never passed to the header.
Thread it through `PaneTreeRenderer` into `TerminalInfoBar` and render a
liveness dot/badge: `live` (no extra chrome — absence is the signal, same
philosophy as ExitStatusDot `TerminalInfoBar.tsx:240-249`), `exited`,
`detached`, `reconnecting` (state arrives in Q2; render support now).
Keep the existing exitBanner/lifecyclePlaceholder untouched — this is the
header-level signal, not a replacement.
ADD vitest: mapping from lifecycle state → rendered badge; live renders
nothing extra.

### Q2 — sidecar reconnect events (`feat:`) — ONLY RUST PHASE
In `src-tauri/src/pty/pty_sidecar.rs` reconnect loop (`:947-984` era):
emit a `pty-stream-state` event `{terminalId, state: "reconnecting"|
"recovered"|"gone", attempt}` at attempt start, on success, and on final
failure. Also pass through real exit severity where known instead of the
flat `ExitInfo{code:None,crashed:false}` (`ipc/commands.rs:1852-1858` era)
IF the sidecar protocol already carries it — if it does not, do NOT extend
the protocol; file it in Result as a follow-up.
FE: subscribe in the pane container, feed the Q1 lifecycle prop
(`reconnecting` state + attempt count in tooltip/title).
ADD: Rust unit test for the event payload shape; vitest for the FE state
merge. Gates: `cargo test --lib`, `pnpm test`. OPERATOR GATE: staged
sidecar kill shows reconnecting → exited in the real app.

### Q3 — multi-line paste guard (`feat:`) — HIGHEST IME RISK, DO NOT RUSH
Both paste handlers in `IMEInputBar.tsx` (`:550-570` React, `:572-595`
native era) currently submit multi-line immediately. Insert a guard: if
normalized content contains >1 line, open `PasteGuardDialog` (new, Radix
Dialog like ConfirmDialog): line count, first 3 lines preview, Enter=run
Esc=cancel, "always allow" writes setting `terminal.pasteGuard=false`
(store + Settings toggle in the Terminal section).
The guard intercepts ONLY the paste event path. Composition events,
single-line paste, and the hidden-textarea path are untouched (UR-4
discipline from UD-1).
ADD vitest: multi-line → dialog, single-line → passthrough, setting-off →
passthrough, confirm → exact same submit bytes as today.
OPERATOR GATE: live Japanese IME composition after this phase.

### Q4 — ownership + blockers on cards (`feat:`)
`SessionCard.tsx` (`:127-224` era) and the Inspector Parallel lane cards
(`AgentInspector.tsx:825-851` era): add an ownership line
(`owner · workspaceScope · N files write-set`) rendered ONLY when at least
one field is populated (`agent.ts:108-113`), and a blocker line
(`blockedReason → nextActor`, `agent.ts:118-121`) rendered ONLY when
status is blocked. FleetHud attention bucket gets the reason as
tooltip/aria-label (`useFleetHud.ts:43-54` era).
ADD vitest: render/no-render conditions for both lines.

### Q5 — keyboard approvals (`feat:`)
Register (in `useKeyboardShortcuts.ts`, conflict-checked against the §audit
inventory) a binding — suggested `Ctrl+Shift+D` (verify unused) — that
opens/focuses the Decision Inbox and focuses the first pending item. Within
a focused item: `A` approve, `D` deny, arrow keys move between items. MUST
delegate to the existing handlers with the anti-duplication latch and
stale-prompt retry (`DecisionInboxPanel.tsx:168-191`,
`useDecisionInbox.ts:102-125`) — no new resolution path. Add
`aria-keyshortcuts` + palette entry.
ADD vitest: keyboard flow calls the same latched handler; latched item
ignores repeat keys.

### Q6 — evidence honesty in the review queue (`fix:`)
`reviewQueue.ts`: tag every inferred state with its source
(`inference: "log-regex" | "filename-match"`).
`ReviewQueuePanel.tsx` (`:151-155` badge era): verdict chips render an
`inferred` marker + tooltip naming the source; a `blocked`/`critical` badge
must carry a clickable evidence target (reuse the provenance-trace/command-
evidence interaction `:219-341`) or render as `unverified` style instead.
Do NOT change `MergeQueuePanel` (gold standard). Do NOT change the
underlying heuristics' behavior in this WU — only their honest labeling.
ADD vitest: labeling logic; blocked-without-evidence downgrade.

### Q7 — small-honesty batch (`fix:`)
Three independent small fixes, one commit:
1. `GhostDiffPanel.tsx` file rows (`:161-164` era): click opens the file in
   the editor via the existing `handleFileSelect` path — removes the
   documented stub (`:15-19`).
2. `SCMPanel.tsx:80` era: surface `git_status` failure (inline error state +
   toast) instead of silently rendering a clean tree.
3. `Toast.tsx:12-19` era: map severity → Radix `type` so errors announce
   assertively; error toasts get `role="alert"` semantics.
ADD vitest for each (ghost-diff click handler wired; scm error state;
toast type mapping).

### Q8 — keyboard-complete shell + owned nav state (`feat:`)
1. F6 / Shift+F6 region cycle: sidebar → center → right rail → status bar
   (skip hidden regions; zen-aware). Register in `useKeyboardShortcuts.ts`.
2. Right-rail toggle binding (suggest `Ctrl+Shift+R` if free — verify) +
   palette command.
3. Palette: app-level `Split Pane Right` / `Split Pane Down` commands
   delegating to the existing tmux-prefix actions (no new split logic).
4. Move `productMode` / `rightRailMode` / `rightRailFocusWidget` from
   `App.tsx` useState (`:491-493` era) into the Zustand store, persisted
   per workspace (follow the existing `aelyris:*` localStorage pattern +
   `reportStorageFailure`). `zenMode` stays transient. Update
   `PRODUCT_MODE_ROUTES` handling so Settings/History launcher entries do
   NOT mutate persisted productMode (fixes the stale rail highlight).
ADD vitest: region cycle order incl. hidden-region skip; store defaults +
persistence (appStore defaults have tests — update deliberately, never
delete).

### Q9 — dead-layer cleanup (`chore:`)
1. DELETE `src/features/sidebar/Sidebar.tsx` and the `sidebarSection`
   store field + interface entries (`appStore.ts:32,570,1168-1169` era).
   Confirm zero consumers with Grep first; if a consumer appeared since the
   audit, STOP and report instead.
2. `src-tauri/src/config/keybindings.rs`: it is unwired (only its own
   tests call `action_for`). DECISION RULE: delete it (and its TOML load
   path + any docs/help claims of `Ctrl+Shift+H/V` splits) rather than wire
   it — wiring a second keybinding system contradicts UQ-7. Record the
   deletion in DECISIONS.md per that file's format.
3. Replace the hand-written Settings shortcut list
   (`Settings.tsx:1218-1247` era) with a list generated from a single
   exported binding table (create `src/shared/lib/shortcutRegistry.ts`
   consumed by `useKeyboardShortcuts`, the Settings/Help list, and palette
   `aria-keyshortcuts`). No binding behavior changes in this phase.
Gates: `cargo test --lib` (if Rust deletion), `pnpm test`, `tsc`, grep
proves zero references to deleted symbols.

### Q10 — enforce + rendered-truth CI (`test:`)
1. Flip `verify:ui:trust` to `--enforce` in package.json; all Q0 checks
   green.
2. Register the verifier into the goal-safe pipeline + quality score
   following the exact 4-layer convention (audit §Phase 5.7 / verifier
   inventory): `runStep` + `STEP_FALLBACK_ARTIFACTS` + verdict function +
   `proofArtifacts` entry in `verify-final-goal-safe.mjs`; freshness boolean
   + `scores.push` entry in `score-release-quality.mjs`. Do not alter any
   existing step.
3. Add a CI Playwright job running `e2e/visual-qa-layout.spec.ts` headless
   with artifact upload, `continue-on-error: true`. Making it blocking is an
   OPERATOR decision — list in Result, do not flip yourself.
Gates: `pnpm verify:ui:trust` (enforce) green; `pnpm verify:goal:safe`
runs with the new step and classifies correctly; CI workflow YAML parses
(`node -e` or actionlint if available).

### Q11 (STRETCH) — computed contrast gate
`scripts/verify-chrome-contrast.mjs`: compute WCAG ratios for chrome-strip
text token pairs over glass backgrounds (composite alpha over the darkest
and lightest mood backdrops; reuse the math in `terminalColors.ts:78-113`).
Baseline mode only in this WU. Skip freely if any ambiguity — file notes in
Result instead.

## 4. Definition of done

- `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm exec biome lint src` green.
- `cargo test --lib` green (Q2/Q9 only phases touching Rust).
- `pnpm verify:ui:trust --enforce` green; `verify:terminal:density`,
  `verify:ui:glass-legibility`, `verify:right-rail-density`,
  `verify:terminal:font-render`, `verify:renderer:transparency` all
  untouched-green.
- `pnpm verify:goal:safe` completes with the new step registered and no new
  implementation-fixable blockers introduced by this WU.
- Branch pushed; `## Result` appended to THIS file: phases done with commit
  hashes, gate outputs, OPERATOR GATE list (IME live check, staged sidecar
  kill, populated-cockpit visual pass, CI blocking flip), skipped items with
  reasons, files touched, and any anchor drift discovered.

## Pasteable goal for a cleared codex/opus session

```text
/goal C:\Users\owner\Aether_Terminal で AGENTS.md -> docs/requirements.md -> docs/AGENT_WORKFLOWS.md -> docs/specs/README.md -> docs/specs/UI_PRODUCT_QUALITY_AUDIT_2026-07-05.md -> ui-quality-instructions.md を順に読み、ui-quality-instructions.md の Phase Q0 から Q10 を完遂しろ（Q11 は任意）。ブランチは feat/wu-uq-1-trust-cockpit を main から切る。Q0 の trust 検証器を最初に作り、それが baseline 緑になるまで trust surface の変更をコミットするな。1フェーズ=1コミット、明示 stage、各フェーズのゲート緑を確認してから次へ。pnpm と cargo は直列実行。src-tauri の編集は Q2（イベント emit のみ）と Q9（未配線 keybindings 削除）に限定し、PTY の状態機械・プロトコル・レンダラ契約には触るな。**透過ウィンドウは絶対（owner law）**: DWM material / per-pixel see-through 経路・window background alpha・glass alpha トークン・backdrop-filter に一切触るな、新規オーバーレイは既存 glass dialog surface を使え、各フェーズ後に verify:renderer:transparency と verify:ui:glass-legibility が untouched-green であることを確認しろ、透過は CDP では検証不可なので疑義があれば OPERATOR GATE に回せ。透明感・ガラスのトークン値変更禁止、レイアウト再設計禁止、既存テスト・検証器の弱体化禁止、F12 go-to-definition の claim 禁止。file:line アンカーは 2026-07-05 時点なので編集前に Grep で再特定しろ。IME 実機確認・sidecar kill 実機観察・populated cockpit 目視・CI blocking 化は OPERATOR GATE として Result に列挙し、自分で claim するな。fleet-api-instructions.md（WU-FA-1）と同一セッションで実行するな。main への push / force push / PR 作成禁止。完了したら feature branch を push して ui-quality-instructions.md 末尾に Result を追記して停止。ブロックしたら理由を報告して停止。
```
