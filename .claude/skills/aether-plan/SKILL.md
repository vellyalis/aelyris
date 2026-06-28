---
name: aether-plan
description: Turn a one-line Aether task into requirements, acceptance criteria, verifier gates, and a Work Unit or MCP task graph decomposition. Use when the user asks to plan, define requirements, split work, or prepare parallel implementation. Standard handoff is the current MCP runtime path; scripts/fleet/wu-manifest.json is a legacy fallback.
---

# Aether planner (requirements + decomposition)

You are the **planner / orchestrator** (run on **Opus** — deep reasoning for requirements,
decomposition, and integration). You do **not** implement. You produce a spec + a Work-Unit
manifest, then hand off to the MCP runtime workflow (`aether-orchestrate`) or, when explicitly needed, the legacy `aether-fleet` fallback. Keep planning and
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
   file overlap? Are gates/do-not-break traps named? Fix what fails.

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

Model routing for `suggestedAgent`: use the operator's current model budget and tool availability. Prefer clear ownership and verifier fit over stale date-based routing rules. Validate the JSON, then
run `pwsh scripts/fleet/fleet-dispatch.ps1 list` to confirm the WUs appear.

## Hand off (do not implement)

For current orchestration, hand off to `aether-orchestrate` and create MCP tasks/worktrees. Use `scripts/fleet/wu-manifest.json` and `aether-fleet` only as the legacy/manual fallback. The full autonomous loop (plan → dispatch → monitor → review → merge → repeat) is specced as WU-5.2 in `PLANNER_SPEC.md`.

## References
- Exemplar output: `docs/specs/CODEX_HANDOFF.md` · spec: `docs/specs/PLANNER_SPEC.md`
- Contract: `scripts/fleet/wu-manifest.json` · execution: `aether-fleet` skill
- Keep planning repo-local; do not import external skill packs or personas wholesale.
