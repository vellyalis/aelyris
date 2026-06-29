# Type Bridge Spec — Rust ⇄ TS contract as single source of truth (WU-0.7)

Status: Draft (docs only). Enables **simultaneous frontend/backend development**.
Owns: how the Rust↔TS IPC contract stops drifting so front and back can be built in parallel.

## 0. Problem (grounded)

- Aelyris calls the backend via **raw `invoke`** (`@tauri-apps/api` 2.11.0, `package.json:128`) and keeps **hand-written TS types** in `src/shared/types/` (15 files) that mirror Rust structs. There is **no** `specta` / `ts-rs` / `typeshare` (verified: `src-tauri/Cargo.toml`).
- Drift is **silent**: a Rust serde rename or a changed field does not fail any test — it breaks at runtime. The cockpit audit flagged "status vocabularies inconsistent across layers."
- **Live drift surface right now:** WU-0.1 is hand-writing BOTH `src-tauri/src/agent/status.rs` (Rust) and `src/shared/types/agentStatus.ts` (TS) — two copies of one contract, kept in sync by hope.
- This is the single thing blocking **simultaneous front/back**: the frontend cannot trust the contract is stable, so it waits for the backend.

## 1. Goal

Make the Rust↔TS contract a **single source of truth** so frontend and backend implement against it in parallel without drift. Two tiers — **adopt Tier 1 now, defer Tier 2.**

## 2. Tier 1 — Contract tests (adopt NOW, zero new dependency)

For each type that crosses IPC — start with `AgentRunStatus` and `AgentSession` (WU-0.1/0.2) — add a test that **fails on drift**, both sides reading one shared fixture:

| Piece | What | Where |
|---|---|---|
| Shared fixture | One canonical JSON instance per contract type (fully populated) = the frozen contract | `src-tauri/tests/contract/<type>.json` |
| Rust test | `serde_json::to_value` of a fully-built instance must equal the fixture (round-trip + shape snapshot) | `src-tauri/tests/contract_<type>.rs` |
| TS test | Import the TS type; assert the fixture parses/conforms (zod schema derived from the type, or a typed assertion) | `src/__tests__/contract_<type>.test.ts` |
| Convention | Shared IPC types carry a comment `// CONTRACT: mirror of <other side> — change both + the fixture` | each side's type file |

Result: change the Rust shape → the Rust test regenerates/fails; diverge the TS → the TS test fails. The fixture is the wall both sides meet at.

### 2.1 Frontend mock (the part that actually enables "simultaneous")

Add a thin, contract-typed `invoke` wrapper with a **swappable mock backend** that returns canned data conforming to the fixture:

- `src/shared/lib/ipc.ts` — typed `call<T>(cmd, args)` over `@tauri-apps/api` `invoke`.
- A mock mode (env/flag) returns fixture-shaped `AgentSession[]` etc. so `useAgentFleet().sessions` resolves **before the Rust command exists**.
- Frontend WUs (rail/inbox/grid) build fully against the mock; swap to real `invoke` when the backend lands. No waiting.

## 3. Tier 2 — Codegen (optional upgrade, LATER — not mid-flight)

Adopt **`tauri-specta` + `specta`** (or `ts-rs`) to generate TS types + typed invoke wrappers from Rust:

- Annotate shared Rust types with `#[derive(specta::Type)]`; emit `bindings.ts` at build.
- Replaces hand-mirroring entirely → drift becomes **structurally impossible** (TS is generated). Also closes the audit's "type vocab drift" debt.
- Migration: incremental — generate alongside the hand-written types, swap consumers module-by-module, delete the hand-written mirror, keep the Tier-1 contract tests as a safety net during transition.
- ⚠ **Do NOT introduce mid-flight.** The parallel session is actively hand-writing `status.rs` / `agentStatus.ts`; adding codegen now churns in-progress files. Adopt after Phase 0/1 land.

## 4. Why this enables simultaneous front/back

```
契約    [0.1/0.2 の型を 0.7 の contract test で凍結]   ← ここだけ直列
            │
   ┌────────┴─────────┐
backend (Codex/Rust)   real command 実装 ───────────────┐
frontend (Opus/React)  fixture mock 相手に UI 実装 ──────┤→ [統合: mock→real invoke]
            （互いの完成を待たない・別ファイル）
```

The contract is the firewall; the mock removes the wait. Front and back meet only at the frozen fixture.

## 5. Acceptance criteria

- **Tier 1:** a contract test exists for `AgentRunStatus` + `AgentSession`. Intentionally drifting either side turns a test **red**. The frontend mock returns fixture-conforming data and the rail/inbox/grid render with the real backend **absent**.
- **Tier 2 (if/when adopted):** generated bindings compile; the hand-written mirror is deleted for migrated types; contract tests still pass.

## 6. Dependencies & sequencing

- Depends on **WU-0.1** (`AgentRunStatus`) and **WU-0.2** (`AgentSession`) — the types must exist to bridge.
- Slots as **WU-0.7** in Phase 0, right after 0.2; do it **before** the Phase 2 front/back fan-out so the cockpit surfaces are built against a test-frozen contract.
- Tier 2 is deferred to after Phase 0/1 (see docs/specs/README.md).
