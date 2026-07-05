# Aelyris Decision Framework

Status: active decision engine.
Purpose: define how agents choose. This file is about what to choose, not who
should do the work.

## 0. What To Choose

Decision Framework answers:

- which owner should hold a change,
- which contract must be preserved or updated,
- which tradeoff wins when two approaches are possible,
- when to split, defer, or stop.

Delegation Framework answers who should explore or review a decision. Keep the
two questions separate.

## 1. Priority Stack

When priorities conflict, choose in this order:

1. Contract and safety correctness.
2. Existing architecture and state ownership.
3. Maintainability over short-term implementation speed.
4. Machine editability and context economy.
5. Verifier-backed proof.
6. Measured performance.
7. UX polish and speed of delivery.

## 2. Architecture Decisions

- Maintainability over short-term implementation speed.
- Prefer existing design and owner modules before adding a new path.
- Responsibility separation wins over convenience wiring.
- Contracts first: identify API, type, schema, DB, ledger, or lifecycle state
  before editing implementation.
- UI projects backend truth. It must not become a second source of truth.
- IPC, MCP, CLI, SSH, and UI are adapters. Domain/runtime owners hold rules.
- If a change needs a second runner, dispatcher, catalog, or state authority,
  stop and redesign.

## 3. Abstraction Decisions

- Duplication is acceptable until the pattern is real.
- As a default, allow up to 3 similar call sites before extracting a generic
  abstraction.
- Extract earlier only when the owner boundary is already clear or the split
  prevents a large file from growing.
- Do not hide domain rules behind premature generic helpers.
- Prefer small explicit modules over broad frameworks.
- Implementations are disposable; contracts and ownership boundaries are not.

## 4. Dependency Decisions

- Standard library and existing dependencies first.
- New libraries are the last resort.
- A new dependency needs a reason, owner, risk, update surface, and verifier
  impact.
- Do not add dependencies for simple parsing, formatting, or state handling
  that the current platform can handle safely.
- Prefer libraries that reduce contract risk, not just code length.

## 5. Performance Decisions

- Do not optimize from guesswork.
- Measure before optimizing.
- Keep correctness and readability ahead of hypothetical speed.
- Performance claims need artifacts.
- A targeted optimization must name the measured bottleneck, affected contract,
  and regression gate.

## 6. Safety Decisions

- Type safety first.
- Explicit fail-closed code beats implicit success.
- If uncertain, inspect.
- Never infer file contents.
- Do not weaken verifiers to pass a change.
- Do not persist secrets, token files, signing material, or secret-bearing
  transcripts.
- Remote control requires principal, lease, risk policy, audit, and replay
  proof. Remote read-only state can ship earlier.

## 7. Placement Algorithm

Before editing:

1. Classify the change: contract, runtime behavior, adapter, UI projection,
   verifier, docs claim, or task packet.
2. Find the owner in `ARCHITECTURE.md` and `contracts/README.md`.
3. Inspect the current owner source. Never infer file contents.
4. Preserve existing architecture unless the selected task explicitly changes
   it.
5. Choose the smallest module that can own the behavior without duplicate
   truth.
6. Add or update a verifier when the change creates a claim.
7. Report the contract owner and proof command.

## 8. Tie Breakers

- Existing owner beats new file.
- Explicit contract beats convenient UI state.
- Narrow focused edit beats broad rewrite.
- Current verifier artifact beats historical prose.
- Readable explicit code beats clever compact code.
- A stopped/narrowed scope beats a hidden architectural fork.
