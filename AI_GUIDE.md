# Aelyris AI Guide

Status: active AI decision knowledge router.
Purpose: help agents decide which stable knowledge to read before editing. This
is not a task checklist and not a replacement for specs.

## 0. Layer Model

Read and reason in this order:

```text
Principles -> Goal -> Decision Framework -> Delegation Framework -> Architecture -> Contracts -> Tasks -> Source inspection -> Tests
```

Four-layer shorthand for compact handoffs:

```text
Principles -> Knowledge -> Contracts -> Tasks -> Source inspection -> Tests
```

- Principles: `AGENTS.md` and `CLAUDE.md` define how agents behave.
- Goal: `GOAL.md` defines what Aelyris is trying to become and what it must not
  claim yet.
- Decision Framework: `DECISION_FRAMEWORK.md` defines what to choose.
- Delegation Framework: `DELEGATION_FRAMEWORK.md` defines who should explore,
  review, or verify.
- Architecture: `ARCHITECTURE.md` defines owner modules, dependency direction,
  and placement boundaries.
- Contracts: `contracts/README.md` points to rigid API/schema/runtime contracts.
- Tasks: `tasks/README.md` and active work orders define the current slice.
- Source inspection: If uncertain, inspect. Never infer file contents.
- Tests/verifiers: claims are true only when the matching gate is green.

Core principles repeated here because they control every decision:

- Contracts are rigid; implementations are disposable.
- Optimize for machine editability and context economy.
- If uncertain, inspect.
- Never infer file contents.
- Preserve existing architecture unless the task explicitly changes it.
- Modify only what is necessary; leave unrelated code untouched.
- Follow existing conventions before introducing new ones.

## 1. Product Goal

Aelyris is a local-first, Windows-first AI development workspace for parallel
AI coding agents. Its strongest direction is a proof-first AI-team OS:

- visible AI agents run in real PTY panes,
- agents work in isolated worktrees,
- ownership and symbol/function claims prevent collisions,
- Proofbooks turn repeated work into evidence-backed automation,
- merge readiness is governed by proof, reviewer separation, and exact commits,
- Remote Continuity lets operators inspect or attach from outside the desktop
  without making SSH the state owner.

The canonical version is `GOAL.md`.

Current claim boundary remains alpha / not release-ready while machine truth
records `releaseCandidateReady=false`. Regenerate with `pnpm verify:quality-score`
instead of quoting scores from prose, and do not promote release or
product-complete claims from this guide.

## 2. Decision Split

Use the split explicitly:

- `DECISION_FRAMEWORK.md`: what to choose. Architecture, abstraction,
  dependencies, performance, safety, placement, and stop conditions.
- `DELEGATION_FRAMEWORK.md`: who chooses or investigates. Delegate when work is
  independent, parallelizable, large-context, review-oriented, or conclusion-only.
  Strong models are not default implementers; use them for design, contracts,
  governance, audit, and rule improvement when ambiguity or blast radius is high.
- `ARCHITECTURE.md`: where the chosen change belongs.
- `DECISIONS.md`: why previous durable decisions were made.
- `STYLE.md`: how code and docs should be shaped once the decision is clear.

## 3. Decision Priorities

When tradeoffs conflict, the canonical priority stack is `DECISION_FRAMEWORK.md`
section 1. Product-level additions layered on top of that stack:

- Verifier-backed proof over prose confidence.
- Visible, inspectable agent execution over hidden background work.
- Local-first operator control and auditability.
- UX clarity, but never by faking backend state.

## 4. Placement Decision Matrix

Use this table before creating or editing files.

| Change type | Preferred owner | Avoid |
| --- | --- | --- |
| Product goal, claim policy, current truth | `GOAL.md`, `docs/requirements.md`, `docs/PUBLICATION_READINESS.md`, `README.md` | old progress docs as truth |
| AI decision rules | `DECISION_FRAMEWORK.md`, `DELEGATION_FRAMEWORK.md`, `AI_GUIDE.md` | chat-only repeated judgment |
| Architecture placement | `ARCHITECTURE.md`, owning source modules | growing unrelated owner files |
| Decision history | `DECISIONS.md` | re-litigating settled choices |
| Style and naming | `STYLE.md`, local code conventions | new style islands |
| Spec index / work-unit routing | `docs/specs/README.md` | hidden handoff-only routing |
| Visible agent runtime rules | `docs/specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md` | adding `-p` to visible pane paths |
| Differentiation / Remote Continuity plan | `docs/specs/AELYRIS_DIFFERENTIATION_*`, `docs/specs/AELYRIS_REMOTE_CONTINUITY_*` | SSH owning workspace state |
| Proofbook contract/runtime | `src-tauri/src/proofbook/*`, `docs/specs/PROOFBOOK_AUTOMATION_SPEC.md` | second runner, UI-only execution |
| MCP catalog/schema/governance adapter | `src-tauri/src/api/mcp.rs`, `docs/specs/MCP_TOOL_SURFACE_SPEC.md` | second dispatcher or catalog |
| Tauri IPC adapter | `src-tauri/src/ipc/*` | domain logic trapped in command wrappers |
| Durable persistence | `src-tauri/src/persistence/*`, `src-tauri/src/db/*` | frontend-owned durable truth |
| Terminal/mux/pane state | `src-tauri/src/pty/*`, `src-tauri/pty-server/*`, `src/features/terminal/*` | duplicate pane trees |
| React feature UI | `src/features/<domain>/*` | growing `src/App.tsx` |
| Shared frontend types/helpers | `src/shared/*` | feature-specific logic in shared code |
| Verifier / evidence artifact | `scripts/verify-*.mjs`, `.codex-auto/quality/*.json` | unchecked prose-only claims |
| Current task packet | `tasks/README.md`, root `*-instructions.md`, scoped continuation docs | stale chat-only instructions |

## 5. Architecture Rules

### State Ownership

One owner per state. UI projects backend truth; it does not own a second source
of truth.

Examples:

- Proofbook run truth lives in Rust runner/ledger state.
- MCP is an adapter over existing authority paths, not its own domain runtime.
- Remote clients read daemon-owned snapshots and acquire leases; SSH is a
  transport, not a state backend.
- Merge readiness comes from durable merge/review/proof state, not local UI
  booleans.

### Dependency Direction

- Domain/runtime code owns business rules.
- IPC, MCP, CLI, SSH, and UI are adapters.
- Verifiers read source/contracts/artifacts and fail loudly on drift.
- Specs define requirements and claim boundaries; implementation proves them.

### Large File Rule

Do not add new product logic to god files unless the task is explicitly an
extraction or the phase includes an extraction plan. In particular:

- `src/App.tsx` must not grow for new feature logic.
- `src-tauri/src/api/mcp.rs` should receive catalog/adapter changes only; move
  domain logic behind focused modules when feasible.
- `src-tauri/src/ipc/commands.rs` and other large IPC files should delegate.

## 6. Contract Discipline

Contracts are rigid; implementations are disposable.

Before changing behavior, identify the contract owner:

- API/MCP/IPC schema,
- Rust serializable type,
- DB table/migration,
- Proofbook ledger/event shape,
- pane/session lifecycle state,
- ownership/merge approval invariant,
- verifier artifact schema.

A complete contract change updates all four layers in one slice:

```text
requirement/spec -> implementation -> verifier -> public claim boundary
```

If those cannot be updated together, stop and narrow the task.

## 7. Naming Rules

- Product: Aelyris.
- Read as: Aelys / エイリス.
- CLI / short name: `aelys`.
- Feature families: Aelyris Core, Aelyris Grid, Aelyris Pane.
- Coordination engine: Qralis.
- Use `visible_pty` for human-visible implementation agent work.
- Use `headless_print` only for planner/reviewer/batch/no-webview automation.
- Use Proofbook for evidence-backed automation.
- Use Remote Continuity for remote state sync and attach features.

## 8. Do Not Break

These invariants outrank local convenience:

- Human-visible agents use visible PTY / interactive TUI / no `-p` / `--print`.
- Proofbook UI cannot mark steps passed without Rust runner state.
- MCP tools use existing schema validation, governance, and audit paths.
- Remote approval uses prompt fingerprint recheck.
- SSH attach cannot own workspace state or bypass daemon leases.
- Merge approval binds to the exact commit/object id.
- Reviewer and implementer separation is preserved where required.
- Secrets, token files, signing material, and secret-bearing transcripts are not
  persisted or sent to remote clients.
- Release-ready claims stay blocked while `releaseCandidateReady=false`.

## 9. Decision Procedure

When asked to implement a change:

1. Classify the change: UI projection, runtime behavior, contract, verifier,
   task/workflow, or product claim.
2. Read the owning contract and owner module before editing.
3. Inspect current file contents. Never infer.
4. Choose the smallest owner module that can hold the change without creating a
   second source of truth.
5. Add or update the focused verifier when the change creates a claim.
6. Run the narrow gate first, then broader gates as risk requires.
7. Report what changed, which contract owns it, and which proof passed.

## 10. When To Stop

Stop and ask or narrow scope if:

- the change needs a second runner, dispatcher, catalog, ownership model, or
  persistence authority,
- the implementation would weaken a verifier,
- the task requires remote/public exposure without a security design,
- source and contract disagree and the owner is unclear,
- a large file would grow substantially without extraction,
- a release or product-complete claim is requested but current artifacts are
  blocked.
