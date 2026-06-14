---
name: aether-plan
description: Turn a one-line dev task for Aether into a requirements spec + a Work-Unit decomposition emitted as scripts/fleet/wu-manifest.json — the contract the aether-fleet skill dispatches. This is the planner front-half of the autonomous team-dev loop (the other half is aether-fleet). Use when the user throws a feature/task/objective at the orchestrator and wants it auto-planned into parallel work units, says "plan this"/"要件定義して分解して"/"タスクを投げる"/"これを並列で進めて", or gives a one-line goal for Aether to build.
---

# Aether planner (requirements + decomposition)

You are the **planner / orchestrator** (run on **Opus** — deep reasoning for requirements,
decomposition, and integration). You do **not** implement. You produce a spec + a Work-Unit
manifest, then hand off to the `aether-fleet` skill for parallel execution. Keep planning and
final judgment in yourself; never delegate them.

The output is the automation of what a human orchestrator does by hand — the exemplar is
`docs/specs/CODEX_HANDOFF.md` (a one-liner → audit → specs → 26 WUs + a dependency DAG).

## The four steps

1. **Understand** — read the relevant subsystems (Grep/Read; or fan out read-only investigators
   for breadth, like the cockpit audit did). Ground every later claim in real `file:line`. Check
   `git status -- src src-tauri` so you don't plan a WU already in flight.
2. **Requirements** — write a short spec under `docs/specs/<NAME>_SPEC.md`: goal, what exists vs
   what's new, constraints, acceptance criteria. File:line grounded. No code.
3. **Decompose** into Work Units. For each WU set: `title`, `slug`, `phase`, `spec` (the section
   that owns it), `files` (target paths), `deps` (other WU ids), `suggestedAgent`, `notes`
   (traps / lockstep gates / GATED markers).
4. **Self-review (adversarial)** — before handing off, attack your own plan: is each WU
   self-contained and cold-startable? Are deps correct and acyclic? Do parallel-batch WUs avoid
   file overlap? Are gates/do-not-break traps named? Fix what fails. (For deeper planning use the
   `blueprint` or `ralphinho-rfc-pipeline` skills.)

## Decomposition rules (binding)

- **Cut on independence seams** — front/back, then by domain/module. Parallelize only WUs whose
  `files` don't overlap.
- **Contract-first** — freeze shared types / IPC signatures first, **serially** (see
  `TYPE_BRIDGE_SPEC.md`). The frozen contract lets front and back proceed simultaneously (frontend
  builds against a mock). This is the key to "front も back も同時に".
- **Cap parallel batches at 3–4.** Merge/review is the bottleneck, not spawning.
- Every WU must be **independently mergeable + testable**. Right-size: not 1 god-WU, not 20 micro-WUs.
- Respect the Shared Contract and Gate model: `approval` / `merge-to-main` are GATED — never plan a
  WU that lets an agent self-grant.

## Emit the manifest (the planner ↔ fleet contract)

Append/extend `scripts/fleet/wu-manifest.json` with the new WUs in its exact schema:

```json
"X.Y": { "title": "...", "slug": "kebab-slug", "phase": N, "spec": "<SPEC>.md §x",
         "files": ["path", "..."], "deps": ["a.b"], "suggestedAgent": "claude|codex",
         "notes": "traps / lockstep / GATED" }
```

Model routing for `suggestedAgent`: **Opus** = design/UI/architecture; **Codex** = backend impl
(Codex usage-limited until 2026-07-01 → route backend to Opus until then). Validate the JSON, then
run `pwsh scripts/fleet/fleet-dispatch.ps1 list` to confirm the WUs appear.

## Hand off (do not implement)

Tell the user (or proceed, if asked) to dispatch with the **`aether-fleet`** skill:
`pwsh scripts/fleet/fleet-dispatch.ps1 dispatch <ids...> -DryRun` → then for real. The fleet skill
owns worktree creation, star-comms steering, and sequential gated merge. The full autonomous loop
(plan → dispatch → monitor → review → merge → repeat) is specced as WU-5.2 in `PLANNER_SPEC.md`.

## References
- Exemplar output: `docs/specs/CODEX_HANDOFF.md` · spec: `docs/specs/PLANNER_SPEC.md`
- Contract: `scripts/fleet/wu-manifest.json` · execution: `aether-fleet` skill
- Deeper patterns: `blueprint`, `ralphinho-rfc-pipeline`, `devfleet`
