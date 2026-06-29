---
name: codex-guided-implementation
description: Implement a substantial, drift-prone feature to completion using Codex (the `codex exec` CLI) as an independent senior reviewer — consult Codex to fix the goal/scope/boundaries up front, then implement in gated increments with a Codex review between each so the work never drifts from the agreed goal. Use when the user says "codexと相談して決めて", "codexのレビューを挟みながら", "道がそれないように", "implement to completion with codex review", "codex-guided", hands you a large multi-increment task that must stay on-scope, or wants a second (different-model) reviewer gating each step. NOT for trivial single-file edits.
---

# Codex-guided implementation (goal-locked, review-gated)

You stay the **implementer and final judge**. Codex is an **independent senior reviewer on a
different model** — its value is catching YOUR blind spots and scope drift, not doing the work.
Aelyris claim-safety note: Codex review is advisory. It cannot prove release readiness, world-class status, or token-spending AI prompt success. Public claims still require Aelyris verifier gates and explicit operator consent where applicable.

**Scrutinize every Codex output; never rubber-stamp it.** Refute findings you can prove wrong (in
code), fix-forward the real ones. The loop's whole point: the goal is set once, written down, and
every increment is checked back against it.

## Prerequisites
- `codex` CLI on PATH (`codex --version`; this repo used `codex-cli 0.141.0`). Verify before relying on it.
- Run Codex **read-only** for consult + review: `codex exec --sandbox read-only`. It reads the repo, never writes.
- Codex output is **large** (full session transcript). Pipe to a scratch file and read the TAIL:
  `cat prompt.md | codex exec --sandbox read-only > out.txt 2>&1` then read the last ~30 KB of `out.txt`.
- One Codex session at a time. Launch long runs in the background and continue other non-overlapping work.

## Step 1 — GOAL: consult Codex, lock scope + boundaries (do this FIRST)
Write a consult prompt with three parts and pipe it to `codex exec --sandbox read-only`:
1. **Verified current state** — what exists, grounded in real `file:line` (tell Codex to verify, not trust you).
2. **The crux decision(s)** — the forks you can't resolve alone (dep weight, architecture constraint you discovered, "how far is done").
3. **Ask for a COMMITMENT**: a concrete scope, an **ordered increment list** (each: what / files / acceptance test / gate), and **3–5 HARD BOUNDARIES** (non-negotiables a reviewer can check).

**Capture the hard boundaries verbatim** — they are the drift fence for every later step. If Codex's
ruling is wrong or under-scoped, push back (another round) before implementing. Do not start coding
until the goal is locked.

## Step 2 — LOOP: one gated, Codex-reviewed increment at a time
For each increment in the agreed order:
1. **Implement** it (read before you edit; match surrounding style).
2. **Gate green FIRST** — all of: `cargo test` (full, not `--lib` only) / `cargo clippy --all-targets -- -D warnings` / `cargo fmt` / `tsc` / `vitest` / the relevant `scripts/verify-*.mjs`, as the change touches. A dead-code clippy error means the increment has **infra without wiring** — fold its consumer into the SAME increment, don't commit dead code or `#[allow(dead_code)]`.
3. **Stage explicitly** (`git add <your files>`, never `git add -A` — untracked audit docs / unrelated edits must not ride along).
4. **Codex review** — pipe a focused review prompt to `codex exec --sandbox read-only` that: points at `git --no-pager diff --cached`, names the increment, and **lists the hard boundaries to check**. Ask for findings by severity + a one-line verdict.
5. **Scrutinize, then fix-forward** — verify each finding against the code. Refute the wrong ones in your reply; fix the real ones (CRITICAL/HIGH always, MEDIUM when cheap). Re-gate.
6. **Commit** the increment (conventional message; record which reviewer(s) ran and what was fixed).

Run a Claude reviewer agent (`rust-reviewer` etc.) too when useful — it's complementary, but the
**Codex review is the boundary gate the user asked for**; don't skip it on the new/risky increments.

## Step 3 — Hold the line (every increment)
Each review explicitly re-checks: (a) the hard boundaries still hold, (b) scope did **not** leak past
the agreed goal (no bundling deferred work), (c) nothing was masked/weakened. **Stop at the agreed
goal.** Deferred items become their own follow-up WU, named in the docs — not silently absorbed.

## Step 4 — FINAL review + land
After the last increment, run one **whole-feature** Codex review (the full diff vs the base), fix-forward,
then merge (`--no-ff` to a trunk for a local-only repo; or open the PR). Update the plan/spec doc to mark
the goal complete and list any explicit follow-up WUs.

## Anti-patterns (do not)
- Start implementing before the goal/boundaries are locked with Codex.
- Rubber-stamp a Codex finding (or dismiss one) without checking the code.
- Skip the boundary re-check, or let scope creep past the agreed goal "while I'm here".
- Bundle multiple unreviewed increments into one commit.
- `git add -A` (drags in untracked/unrelated files). Stage explicitly.
- Treat green gates as release-readiness — they are not (track release gates separately).

## Command cheat-sheet
```bash
# Goal consult / review (read-only, output to a file, read the tail):
cat scratch/codex-prompt.md | codex exec --sandbox read-only > scratch/codex-out.txt 2>&1
# Built-in review subcommand (reviews the repo diff):
codex exec review
# Gate (Rust example): cargo test  &&  cargo clippy --all-targets -- -D warnings  &&  cargo fmt --check
```

## References
- Pairs with `aelyris-plan` (decompose) / `aelyris-fleet` (dispatch) when the increments are parallelizable.
- Worked example in this repo: the symbol-extractor A4 work (Codex set the non-LSP scope + tree-sitter
  ruling + 5 hard boundaries; each A4.x increment was gated then Codex-reviewed before commit).
