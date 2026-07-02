# Quality Remediation Plan — 2026-07-02

Status: ACTIVE PLAN (forward-looking; contains no completion claims — completion is proven by the named gates, never by editing this file)
Owner: repository operator (non-engineer) + Claude/codex implementation sessions
Sources: five-track audit run on 2026-07-02 against branch `feat/wu-rt-1-context-lifecycle` (doc scoring x 17 documents, tech-stack review, debt-map refresh). Key artifacts referenced below were verified at audit time; re-verify before acting.

## 0. Ground rules

1. **This document plans; gates prove.** No task below may be marked "done" in prose. A task is complete when its Acceptance command exits green. (Repo policy: hand-written status rots — see `docs/requirements.md` claim policy.)
2. **WU-RT-1 coexistence.** While `feat/wu-rt-1-context-lifecycle` work is in flight, do NOT touch these files (dirty in that work's tree): `src-tauri/src/ipc/interactive_commands.rs`, `src-tauri/src/api/mod.rs`, `src-tauri/src/api/mux.rs`, `src-tauri/src/lib.rs`, `docs/specs/CONTEXT_SESSION_LIFECYCLE_*.md`, `docs/specs/README.md`, `package.json`. Tasks flagged `[BLOCKED-BY-RT1]` wait for that branch to land.
3. **One sprint = one branch = one PR.** Follow `AGENTS.md` for gates. On Windows never run `cargo test` and `pnpm test` in parallel.
4. Standard gate set (referred to as **GATES** below): `pnpm exec tsc --noEmit` && `pnpm test` && `cargo test --manifest-path src-tauri/Cargo.toml --lib` && `pnpm exec biome lint <touched files>`.

---

## Sprint 0 — Close the open approval-safety gap (CX-4)  [smallest, do first]

**Problem.** `resolve_interactive_approval` (`src-tauri/src/ipc/send_keys_commands.rs:103-151` at audit time) writes the approval keystroke (Enter/Esc) to a PTY without re-verifying that the target session is *still* in `waiting_approval` and *still* showing the same prompt that the operator saw. A stale click can approve a different, newer prompt. This was a declared pre-commit gate (CX-4 in `docs/specs/CONTEXT_SESSION_LIFECYCLE_IMPLEMENTATION.md` §1) and is currently not implemented.

**Tasks.**
| id | task | detail |
|---|---|---|
| S0-1 | Add re-verification before write | In `resolve_interactive_approval`: (a) look up the session in `InteractiveSessionManager`; reject unless current run status == `waiting_approval`. (b) Accept an `expected_prompt` (or prompt fingerprint, e.g. the `stableTextKey` already used for inbox item ids) from the caller and reject if it does not match the session's current `approval_prompt`. Return a typed error (`stale_approval`) the FE can surface. |
| S0-2 | FE passes the fingerprint | `handleDecideDecision` in `src/App.tsx` passes the inbox item's prompt/fingerprint through the invoke call. On `stale_approval`, show a toast and refresh the inbox item instead of writing. |
| S0-3 | Regression tests | Rust: stale-status and prompt-mismatch cases rejected, matching case flushes. FE: decision handler passes fingerprint (source-scan assert consistent with `src/__tests__/AppSilentBugs.test.ts` conventions). |

⚠ `send_keys_commands.rs` is not in the WU-RT-1 dirty set, but `interactive_commands.rs`/`App.tsx` proximity means: coordinate, or fold S0 into the WU-RT-1 branch itself as its declared follow-up gate.

**Acceptance.** GATES green + new tests present; `docs/specs/CONTEXT_SESSION_LIFECYCLE_IMPLEMENTATION.md` CX-4 row updated with evidence pointer in the same PR.
**Effort.** ~half a day.

---

## Sprint 1 — Documentation truth restoration

**Problem.** Docs are accurate at write time but rot afterward, in both directions: optimistic lies (a spec asserting "no MCP tool can merge" while `aelyris.review.approve` → `perform_merge_bound` performs a real gated merge) and pessimistic lies (traceability doc baked with score 35/100 grade D while the 2026-07-01 artifact reports 78/100 grade C).

**Tasks.**
| id | doc | action |
|---|---|---|
| S1-1 | `docs/specs/MCP_TOOL_SURFACE_SPEC.md` | Rewrite §4.4 to the shipped bounded-autonomy model (durable merge intent, reviewer≠implementer, OID CAS, gates digest; cite `src-tauri/src/control/merge.rs`). Fix §3.2 `spawn_agent` (headless `start_headless`, real params). Fix stale "no merge command exists" (§ around :175). Regenerate the verb catalog from `/mcp/tools/list` output (~55 verbs, not ~13); prefer a generated table over prose. |
| S1-2 | `docs/specs/AELYRIS_REQUIREMENTS_SPEC_DESIGN_TRACEABILITY_2026-06-27.md` | Remove ALL hand-baked numbers (35/100, 124/351, fixable counts) — replace with "run `pnpm verify:quality-score`; read `.codex-auto/quality/release-quality-score.json`". Delete the dangling `FULL_NATIVE_RUST_FINAL_GOAL.md` reference; fix nonexistent verifier names (`verify:mux-tmux-grade-contract` → `verify:mux-durability-contract`; `verify:native-daily-driver-terminal` → `verify:native-operator-primary-terminal`); fix dead `requirements.md` anchors. |
| S1-3 | Shipped-work banners (cheap, honest) | Add a dated "SHIPPED — historical; do not use as a task list" banner + pointer to the current owner doc, to: `docs/specs/PHASE_0_1_ARCHITECTURE_SPEC.md`, `docs/specs/COCKPIT_UX_SPEC.md`, `docs/specs/UI_TOKEN_DIAL_SPEC.md` (header currently says "PROPOSED / NOT applied" — everything is applied), `docs/specs/AELYRIS_COCKPIT_REQUIREMENTS_2026-06-13.md` (also reconcile its full-auto wording to the bounded model), `docs/hardening/*` (fix `00_README.md` phase-map cell that still says P1 not-started while its own tracker shows P1-5a PASS; stamp `03_IMPLEMENTATION_PLAN.md`). |
| S1-4 | `docs/specs/PLANNER_SPEC.md` | Remove the nonexistent `aelyris-plan`/`aelyris-fleet` skill instructions; document the implemented `aelyris.orchestrator.plan/step` verbs instead. |
| S1-5 | `[BLOCKED-BY-RT1]` WU-RT-1 doc consolidation | After the branch lands: fold `WU_RT_1_CONTINUATION.md` away (it is a hand-written status file, which repo policy forbids); keep SPEC (contract) + IMPLEMENTATION (procedure + gate-status column with evidence pointers). Update stale gate rows (SEC-1 is fixed with tests — say so; RT-1a0 descope note). |
| S1-6 | Roadmap generated view (the recurrence fix) | Implement the already-agreed design: hand-written `docs/roadmap/work-units.json` (topology only: id/dependsOn/specRefs/gateIds; banned words: done/ready/green/%), generator+verifier `scripts/verify-project-roadmap.mjs` reading `.codex-auto/quality/*` → emits `project-roadmap-status.{json,md}`; nodes without a dedicated gate render as `unverified`, stale gates demote to `stale-proof`. Wire `pnpm verify:project-roadmap` into `verify:goal:safe` `[BLOCKED-BY-RT1: package.json]` — until then expose it as a standalone script. Add the one-line "read the generated roadmap first" pointer to `AGENTS.md`/`CLAUDE.md` when those files are clean. |
| S1-7 | Terminal-core design doc | New `docs/specs/TERMINAL_CORE_DESIGN.md`: PTY/sidecar/registry-split, VT engine (alacritty_terminal), snapshot/diff pipeline, Canvas2D shipping renderer + wgpu promotion criteria. This closes the "pillar 1 has no design doc" gap and becomes the anchor for Sprint 4 renderer work. |

**Acceptance.** `pnpm verify:requirements-spec-design-traceability` green; a grep gate that fails on the two known lie-patterns (hand-baked score digits in the traceability doc; "No merge-to-main command exists"); `verify:project-roadmap` runs green.
**Effort.** 1–2 sessions. S1-1..S1-4 and S1-7 are safe now (files not in the WU-RT-1 dirty set — re-check `git status` first).

---

## Sprint 2 — CI + supply-chain / stack hardening  [release-blocking]

**Problem.** 100+ local verifiers but no automated executor; supply-chain quality is not yet at the bar required for a robust terminal/runtime product. The latest local checks still show no known npm or RustSec vulnerability findings, but that is not enough: RustSec informational warnings currently include direct or runtime-adjacent `unsound` / `unmaintained` dependencies, and the plan must treat those as release blockers until classified or removed.

**Current audit evidence (2026-07-02 JST; refresh before acting).**

- `pnpm audit --json`: 0 known vulnerabilities across the npm dependency graph.
- `cargo audit --file src-tauri/Cargo.lock --json`: 0 vulnerability findings, but informational warnings include `git2 0.20.4` unsound advisories, unmaintained `ttf-parser 0.21.1` via `fontdue`, and target-all GTK/GLib warnings through Tauri's Linux/WebKitGTK graph.
- `cargo audit --file src-tauri/pty-server/Cargo.lock --json`: 0 vulnerability findings, but informational warnings include unsound / unmaintained transitive crates that must be classified for the sidecar lockfile too.
- `cargo tree --manifest-path src-tauri/Cargo.toml -i git2`: `git2 v0.20.4` is a direct Aelyris dependency; crates.io current is `0.21.0`.
- `cargo tree --manifest-path src-tauri/Cargo.toml -i serde_yaml`: `serde_yaml v0.9.34+deprecated` is a direct Aelyris dependency.
- `cargo tree --manifest-path src-tauri/Cargo.toml -i portable-pty`: `portable-pty v0.8.1` is direct and vendored from `src-tauri/vendor/portable-pty-0.8.1`; crates.io current is `0.9.0`.
- `cargo tree --manifest-path src-tauri/Cargo.toml -i ttf-parser`: `ttf-parser v0.21.1` enters through `fontdue v0.9.3`, which is on the native renderer proof path.

**Policy.** A release candidate may not rely on an unclassified `unsound`, `unmaintained`, deprecated, or provenance-unknown dependency in the terminal runtime, persistence, security, update, or distribution path. If a warning is target-only or build-only, the repo must say that with `cargo tree` evidence and a gate that keeps the classification fresh.

**Tasks.**
| id | task | detail |
|---|---|---|
| S2-1 | GitHub Actions CI | `.github/workflows/ci.yml` (added alongside this plan). v1 blocking jobs: frontend (tsc + vitest, windows-latest — `pnpm test` uses cmd `set` syntax and vitest flakes under threads pool on loaded machines, so CI pins `--pool=forks`), rust (`cargo test --lib`, windows-latest, cached). Informational (non-blocking) steps: biome lint (repo-wide CRLF drift), cargo fmt/clippy, `cargo audit`, `pnpm audit --prod`. CI activates once this file reaches GitHub (push/PR). |
| S2-2 | Tighten CI | Promote clippy `-D warnings` and biome to blocking once the repo passes them on a clean branch; add `pnpm verify:release:hygiene` job for PRs to main. |
| S2-3 | Make stack-risk classification a gate | Add a deterministic verifier that reads both Rust lockfiles plus npm audit output and fails on any unclassified `unsound`, `unmaintained`, deprecated, or provenance-unknown dependency in release paths. Classification must include source path, target/platform relevance, owner decision, and replacement plan. |
| S2-4 | Upgrade `git2` | Move direct `git2` to `>=0.21.0` to clear RustSec unsound advisories; regenerate both relevant lockfiles if the pty sidecar resolves it too; include a smoke test around the local git operations actually used by Aelyris. |
| S2-5 | Replace `serde_yaml` (deprecated upstream) | `src-tauri/Cargo.toml:99`, used by workflow definitions. Preferred first move: `serde_yaml_ng` if it is drop-in enough; fallback: migrate workflow files to TOML (`toml` already a dependency). Include round-trip tests for existing workflow files and prove `cargo tree -i serde_yaml` is empty. |
| S2-6 | Vendored `portable-pty` provenance / update decision | Diff `src-tauri/vendor/portable-pty-0.8.1` against upstream 0.8.1; write `src-tauri/vendor/README.md` stating whether it is pristine-pinned or patched (and why). Evaluate `portable-pty 0.9.0` against ConPTY/job-object behavior before deciding to keep the vendor fork. |
| S2-7 | Native font stack decision | `fontdue -> ttf-parser` now carries an unmaintained warning. Decide whether the renderer proof path should move to DirectWrite-backed rasterization / `skrifa` / another maintained font path. Until then, do not treat the current font proof as final production renderer proof. |
| S2-8 | Dependency automation | Add `renovate.json` (or enable Dependabot) grouping patch updates; requires operator to install the GitHub app — flagged as operator step. |
| S2-9 | Crash visibility (design first) | Decide: minimal Rust panic hook writing minidump/log locally (no network) vs opt-in reporting. Local-only capture is compatible with the privacy posture; spec it before coding. |

**Acceptance.** CI runs green on a PR; `pnpm audit --json` reports 0 vulnerabilities; both Rust lockfiles have no vulnerability findings and no unclassified `unsound` warnings; `cargo tree -i git2` shows `>=0.21.0`; `cargo tree -i serde_yaml` is empty; `src-tauri/vendor/README.md` exists; the native font stack has either a maintained implementation or an explicit blocker artifact.
**Effort.** S2-1 is partially delivered; S2-3..S2-7 should be treated as a release-blocking sprint, not a background cleanup.

---

## Sprint 3 — Debt paydown wave 1 (safe during WU-RT-1)

**Problem.** `src/App.tsx` 4,640 → 7,273 lines since June; dead modules; unwired-IPC and unvalidated-invoke counts grew ~60%.

**Tasks (in order — each its own commit, GATES between).**
| id | task | detail |
|---|---|---|
| S3-1 | Extract App.tsx pure-function block (~1,860 lines) | Lines ~443–2,306 (right-rail edge feedback/score universe: persistence helpers, `deriveRightRailEdge*`, fixture builders, `RightRailDestinationPromptCard`) are module-level pure code with no hook coupling. Pure-move to `src/features/right-rail/` modules. ⚠ `src/__tests__/AppSilentBugs.test.ts` contains source-substring gates — update the scan paths in the SAME commit (known trap C-27). |
| S3-2 | Delete `src-tauri/src/agent/parser.rs` (258 lines, zero references) | Confirm zero refs (`grep -rn "agent::parser\|agent/parser"`), delete, remove `mod` decl. |
| S3-3 | Retire dead watchdog | `src-tauri/src/agent/watchdog.rs` (388 lines) is never instantiated; the live one is `src-tauri/src/watchdog/`. Rename the log-string literal at its `commands.rs` call-site first, then delete. If any PERMISSION_PATTERNS constants are still referenced, move them to the live module. |
| S3-4 | IPC ledger (read-only, then decide) | Script that diffs `lib.rs` `generate_handler` (~217 handlers) vs FE `invoke("...")` literals (~141) vs MCP/HTTP-served vs verifier-driven; emits a classified ledger artifact. Only after classification, propose deletions. Do NOT delete blind — several "unwired" handlers are API-face or WU-RT-1-pending by design. |
| S3-5 | Extract `useOrchestraDispatch` + `useDecisionInbox` hooks from App() | After S3-1; App() body is still ~4,900 lines. Same substring-gate caution. |
| S3-6 | Theme single-source check | Build-time test asserting `moods/surfaces.ts` and `global.css :root[data-mood]` values agree (or a generator emitting the CSS block), closing the documented dual-source trap. |

**Acceptance.** GATES green after each commit; App.tsx < 5,000 lines after S3-1, < 4,200 after S3-5; `git grep` proves S3-2/S3-3 modules gone.
**Effort.** 1–2 sessions.

---

## Sprint 4 — `[BLOCKED-BY-RT1]` Foundation work after the branch lands

| id | task | detail |
|---|---|---|
| S4-1 | SQLite schema versioning | Introduce `PRAGMA user_version`-based numbered migrations wrapping the current 32 `CREATE TABLE IF NOT EXISTS` bootstrap as v1 (WU-RT-1's new tables become v2). Never edit shipped migrations; forward-only. |
| S4-2 | Split `api/mcp.rs` (3,502) and `api/mod.rs` (3,055) | First slice: move the tools-listing JSON blob out of dispatch. Then per-domain verb modules. Guard: the `catalog_and_schemas_list_exactly_the_same_verbs` drift test must keep passing. |
| S4-3 | MCP schema enforcement | Dispatcher currently does not enforce declared input schemas (advisory-only, noted at `mcp.rs:1354` area). Add validation at `tools_call`. |
| S4-4 | invoke<T> contract tests | 58 FE files call `invoke` unvalidated. Start with contract tests for the hand-mirrored `AgentSession`/`InteractiveSession` shapes; evaluate `tauri-specta` codegen as the durable fix (`docs/specs/TYPE_BRIDGE_SPEC.md` is the anchor — refresh it first). |
| S4-5 | Watch `interactive_commands.rs` (2,228 lines) | WU-RT-1's host file is becoming the next god-file; split session-lifecycle IPC out once the branch lands. |

## Sprint 5 — Strategic investment (sequenced after the above)

1. **wgpu renderer productization** (largest technical gap vs. terminal peers; entry criteria and design in S1-7's terminal-core doc).
2. Live cost/token telemetry via grid snapshot + BR7 cap binding; agent-signaled done-marker completion (top items of the 2026-07-01 backend audit).
3. RBAC E2 (API-key → Principal), audit-journal hash chaining.

## Appendix — audit scorecard (2026-07-02, /50 per doc)

requirements.md 43 · CONTEXT_SESSION_LIFECYCLE_SPEC 43 · docs/README.md 41 · CSL_IMPLEMENTATION 38 · WU_RT_1_CONTINUATION 38 · AGENT_MESSAGE_BUS 34 · UI_TOKEN_DIAL 34 · COCKPIT_UX 32 · TYPE_BRIDGE 32 · hardening/ 31-32 · specs/README 30 · VISIBLE_AGENT_PANE 29 · PLANNER 26 · COCKPIT_REQUIREMENTS 24 · TRACEABILITY 24 · PHASE_0_1 23 · MCP_TOOL_SURFACE 16.
Tech stack: not release-sound yet. Current audit evidence shows 0 known vulnerability findings, but that is weaker than the product bar: direct `git2 0.20.4` has RustSec unsound advisories, direct `serde_yaml` is deprecated, direct vendored `portable-pty 0.8.1` lacks recorded provenance/update decision, and `fontdue -> ttf-parser` is unmaintained on the native renderer proof path. Debt trend: growing; largest safe code-shape win = S3-1, but largest release-safety win = S2-3..S2-7.
