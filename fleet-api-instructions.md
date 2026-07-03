# fleet-api-instructions.md — WU-FA-1 execution order (2026-07-03)

Implements `docs/specs/FLEET_API_HARDENING_SPEC.md` (READ IT FIRST — it is
the contract; this file is only the execution order). Parent decision record:
`docs/specs/PRODUCT_DIRECTION_PROPOSALS_2026-07-03.md` §1/§2. Claim policy
applies: completion is proven by gates, never prose.

**Ordering relative to other work orders:** independent of
`ui-density-instructions.md` (disjoint files) — either may run first, but do
NOT run them concurrently in one session (shared `package.json`, `App.tsx`
adjacency risk).

## 1. Ground rules

- Branch: `feat/wu-fa-1-fleet-api` off current `main`. Never push `main`,
  never force-push, never open/merge PRs — push the feature branch after
  green gates and stop.
- First action: `git status --short` — if dirty, stop and report.
- Baseline (record in the phase-0 commit message or a note): current counts
  of `pnpm test`, `cargo test --manifest-path src-tauri/Cargo.toml --lib`,
  `pnpm exec tsc --noEmit` exit, `git log --oneline -3`.
- One phase = one commit; stage explicit paths only. Serial `pnpm test` /
  `cargo test` (never parallel on Windows).
- NEVER weaken an existing test/verifier to make something pass. If a
  contract blocks you, stop and report.
- No new dependencies (Rust or npm) without stop-and-ask. Expected: zero.
- Delegation rule (SPEC §3.1/NFR-1) is non-negotiable: new verbs call the
  extracted `*_core` functions; if you find yourself re-implementing any
  cockpit behavior, stop — you are off-spec.

## 2. Phases

### F0 — read + baseline (`chore:`)
Read SPEC §1-§5, then the anchors:
`src-tauri/src/ipc/send_keys_commands.rs` (whole file),
`src-tauri/src/ipc/interactive_commands.rs:40-130`,
`src-tauri/src/control/pane_fleet.rs:26-360`,
`src-tauri/src/control/loop_ports.rs:460-520`,
`src-tauri/src/api/mcp.rs:19-90,1290-1360,1679-1710`,
`src-tauri/src/pty/registry.rs`, `src-tauri/src/pty/manager.rs:180-290`,
`src-tauri/src/bin/aelys.rs`, `scripts/verify-runtime-core-preconditions.mjs`.
Record baseline. Commit only if something needed tracking.

### F1 — C2 marker collision (`fix:`)
1. Single path-builder fn (SPEC §3.4) used by BOTH `pane_fleet.rs` poller and
   `loop_ports.rs` prompt injection; filename `<sanitized-task>-<terminal_id>.done`.
2. Update existing marker tests; ADD: two tasks with colliding sanitized ids
   in one worktree do NOT satisfy each other's markers.
3. Gates: `cargo test --lib` green; prompt-contract test
   (`visible_dispatch_prompt_includes_backend_built_done_marker_contract`)
   updated to the new path shape, not deleted.

### F2 — C1 broadcast stale-approval guard (`fix:`)
1. Implement SPEC §3.2 exactly (skip+report on fan-out, typed error on
   targeted `send_keys`, audit event per skipped pane).
2. ADD Rust tests: (a) broadcast skips a `waiting_approval` pane and reports
   it; (b) targeted send returns `blocked_waiting_approval`; (c) plain shell
   pane unaffected.
3. Extend `scripts/verify-runtime-core-preconditions.mjs` with the source
   checks from SPEC §5.4a. Gate: the verifier passes; `cargo test --lib`.

### F3 — C3 catalog memoization (`perf:`)
SPEC §3.5. Gates: `cargo test --lib` (drift test proves identity), plus a
new unit test asserting `input_schema_for_tool` returns the same schema
object for repeated calls without rebuilding (e.g. pointer/deep-equality on
the memoized map).

### F4 — A1 `aelyris.approval.resolve` (`feat:`)
1. Extract `resolve_interactive_approval_core` (SPEC §3.1 extraction rule);
   IPC wrapper delegates; existing tests pass UNMODIFIED.
2. Add verb to catalog + schemas + dispatch (GATED). Params per SPEC §2.1.
3. ADD tests: happy path delegation, stale fingerprint ⇒ `ok:false` with
   `stale_approval` in the tool error, missing `expectedPromptKey` ⇒ schema
   violation (required field).
4. Extend preconditions verifier per SPEC §5.4b.

### F5 — A2 `aelyris.agent.spawn_visible` (`feat:`)
Verb → `spawn_interactive_agent_internal` (SPEC §2.1 defaults/limits in the
schema). ADD test: schema bounds enforced; cost-cap denial passes through as
tool error. NOTE: do not spawn real CLIs in tests — test at the
validation/dispatch layer like existing MCP tests do.

### F6 — A3b short pane ids `%N` (`feat:`)
1. Registry `short_id` + `resolve_terminal_ref` (SPEC §3.3), assignment in
   `PtyManager` spawn/adopt.
2. Wire resolution into the four new MCP verbs' `terminalId` param.
3. Surface: `list_panes_info`, fleet snapshot (`AgentSession.short_id`,
   remember `src/shared/lib/agentFleet.ts` mapping + its test — the
   approval_prompt omission bug is the cautionary precedent), TerminalInfoBar
   `%N ·` prefix.
4. ADD tests: resolver (`%N` hit, `%N` miss ⇒ typed error, UUID passthrough),
   snapshot carries short_id (Rust + FE mapping test).
5. Gates: `cargo test --lib`, `pnpm test`, `tsc`.

### F7 — A4 `aelys` bridge + self-target + report (`feat:`)
1. `aelys mcp <verb> [json]` per SPEC §2.2 (exit-code contract!).
2. Optional-target defaulting to `$AELYRIS_TERMINAL_ID` for send/capture.
3. `aelyris.pane.rename` / `aelyris.pane.set_role` verbs (extract cores),
   then `aelys report --title` as sugar.
4. ADD tests per SPEC §5.6. Gates: `cargo build --bin aelys`,
   `cargo test --lib`, drift test (now 4 new verbs total from F4-F7... —
   verify count), preconditions verifier, `pnpm verify:release:hygiene`.

### F8 (STRETCH — only if F1-F7 are green and committed) — A4.4 notify-on-exit
REST route + EventBus publish + toast per SPEC FR-9. If any design question
arises, SKIP and file it in the phase report instead — this phase is
explicitly optional.

## 3. Definition of done (whole WU)

All SPEC §5 gates green; branch pushed; final phase report appended to the
end of THIS file under `## Result` (phases done, gates run with results,
skipped items with reasons, files touched). Do not update README or make any
product claim — the owner reviews and merges.

## Pasteable goal for a cleared codex session

```text
/goal C:\Users\owner\Aether_Terminal で AGENTS.md -> docs/requirements.md -> docs/AGENT_WORKFLOWS.md -> docs/specs/README.md -> docs/specs/PRODUCT_DIRECTION_PROPOSALS_2026-07-03.md -> docs/specs/FLEET_API_HARDENING_SPEC.md -> fleet-api-instructions.md を順に読み、fleet-api-instructions.md の Phase F0 から F7 を完遂しろ（F8 は任意）。ブランチは feat/wu-fa-1-fleet-api を main から切る。1フェーズ=1コミット、明示 stage、各フェーズのゲート緑を確認してから次へ。SPEC §3.1 の委譲ルール厳守（cockpit 内部関数の再実装禁止）。既存テスト・検証器の弱体化禁止。main への push / force push / PR 作成禁止、完了したら feature branch を push して fleet-api-instructions.md 末尾に Result を追記して停止。ブロックしたら理由を報告して停止。
```

## Result

Date: 2026-07-03 JST
Branch: `feat/wu-fa-1-fleet-api`
Base: `main` at `131782c`
Push scope: feature branch only; no main push, no force push, no PR.

Phases completed:

- F0 baseline: `654d04b chore: record fleet api baseline`
- F1 C2 marker collision: `78a8f88 fix: make visible done markers collision-proof`
- F2 C1 broadcast stale-approval guard: `513bcc3 fix: guard fleet writes at approval gates`
- F3 C3 catalog memoization: `08ce72e perf: memoize mcp tool schemas`
- F4 A1 `aelyris.approval.resolve`: `b3a8a57 feat: expose approval resolve over mcp`
- F5 A2 `aelyris.agent.spawn_visible`: `505f492 feat: expose visible agent spawn over mcp`
- F6 A3b short pane ids `%N`: `26316e3 feat: add short pane ids`
- F7 A4 `aelys` bridge + self-target + report: `25fa3ee feat: add aelys mcp pane bridge`
- F8 notify-on-exit: skipped; optional stretch phase and not required for F0-F7 completion.

Final gates run after F7:

- `cargo build --manifest-path src-tauri\Cargo.toml --bin aelys`: PASS
- `cargo test --manifest-path src-tauri\Cargo.toml --bin aelys`: PASS, 7 tests
- `cargo test --manifest-path src-tauri\Cargo.toml --lib`: PASS, 1155 tests
- `pnpm exec tsc --noEmit`: PASS
- `pnpm test`: PASS, 200 files / 1907 tests
- `node scripts\verify-runtime-core-preconditions.mjs`: PASS, `pass-runtime-core-preconditions`
- `pnpm verify:release:hygiene`: PASS, `pass-current-release-hygiene-contract`

Files touched:

- Rust API/MCP/CLI/core: `src-tauri/src/api/mcp.rs`, `src-tauri/src/api/mod.rs`, `src-tauri/src/bin/aelys.rs`, `src-tauri/src/ipc/send_keys_commands.rs`, `src-tauri/src/ipc/interactive_commands.rs`, `src-tauri/src/ipc/commands.rs`, `src-tauri/src/pty/registry.rs`, `src-tauri/src/pty/manager.rs`, `src-tauri/src/control/pane_fleet.rs`, `src-tauri/src/control/loop_ports.rs`, `src-tauri/src/agent/session.rs`, `src-tauri/src/shared_brain.rs`
- Frontend contracts/UI/tests: `src/shared/types/agent.ts`, `src/shared/types/interactiveAgent.ts`, `src/shared/types/pane.ts`, `src/shared/lib/agentFleet.ts`, `src/shared/hooks/useLivePanes.ts`, `src/features/context/LivePanesPanel.tsx`, `src/features/app/useAppMenus.ts`, `src/features/workflow/WorkflowPanel.tsx`, `src/features/terminal/TerminalInfoBar.tsx`, `src/features/terminal/TerminalInfoBar.module.css`, `src/features/terminal/pane-tree/types.ts`, `src/features/terminal/pane-tree/PaneTreeContainer.tsx`, `src/features/terminal/pane-tree/PaneTreeRenderer.tsx`, `src/App.tsx`
- Verifiers/tests/report: `scripts/verify-runtime-core-preconditions.mjs`, `src/__tests__/WorkflowPanelRace.test.tsx`, `src/__tests__/TerminalInfoBarExitDot.test.tsx`, `src/__tests__/agentFleet.test.ts`, `fleet-api-instructions.md`
