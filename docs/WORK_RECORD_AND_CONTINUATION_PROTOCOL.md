# Work Record and Continuation Protocol

Status: active operational contract.  
Owner: repository workflow.  
Applies to: implementation, review, audit remediation, and session clear.

## Purpose

Long-running work must be restartable from current machine truth without replaying
the entire repository history or trusting stale narrative notes. Every active program
uses three separate records with one owner each:

1. **Tracked execution contract**: stable scope, dependency order, file ownership,
   acceptance gates, and forbidden work.
2. **Ignored worklog**: append-only evidence of what a session actually did.
3. **Local-only resume pointer**: one current packet that says exactly where the next
   session starts.

The tracked contract is durable team knowledge. The worklog is evidence. The resume
pointer is routing guidance. None of them replaces fresh Git or verifier truth.

## Canonical Paths

Each active program must declare these paths in its root work order:

```yaml
continuation_contract:
  tracked_plan: docs/specs/<PROGRAM_PLAN>.md
  root_work_order: <program>-instructions.md
  worklog_dir: .codex-auto/worklogs/<program>/
  local_handoff: .claude/agent-memory-local/CODEX_MUST_READ_NEXT_SESSION_<PROGRAM>_LOCAL_ONLY.md
  verifier: pnpm verify:<program>:continuation
```

Rules:

- `.codex-auto/worklogs/*` is local generated evidence and must not be committed.
- `.claude/agent-memory-local/*` is local-only and must not be committed or copied
  into tracked docs.
- Keep exactly one canonical local handoff per active program. Replace it at each
  closeout instead of creating competing "latest" files.
- Create a new worklog per session. Do not rewrite earlier worklogs.
- Stable decisions and completed phase status belong in the tracked plan/work order,
  not only in local notes.

## Worklog Minimum

Before a session is called complete, write a worklog containing:

```yaml
work_record:
  program: <program id>
  session_date_jst: <date and time>
  branch: <branch>
  head_at_start: <sha>
  head_at_close: <sha>
  worktree_at_start: <git status summary>
  worktree_at_close: <git status summary>
  active_phase: <phase id>
  active_slice: <exact slice id worked in this record>
  completed_slice: <exact last completed slice id>
  next_implementation_slice: <exact next slice id>
  objective: <one bounded objective>
  files_read: []
  files_changed: []
  commands:
    - command: <exact command>
      result: PASS | REVIEW | BLOCK | NOT_RUN
      artifact: <path or null>
  decisions: []
  commit: <short sha and subject, or null for a recorded dirty checkpoint>
  blockers:
    implementation: []
    stale_evidence: []
    policy: []
    external: []
  residual_risk: []
  next_exact_action: <one action>
```

Do not record secrets, token values, signing material, `.env` contents, or
secret-bearing transcripts.

The continuation verifier schema-checks only the current worklog path explicitly
selected by the canonical handoff. It must reject absolute paths, `..`, nested paths,
non-Markdown files, missing files, and files outside the declared program worklog
directory. Historical append-only worklogs are not selected by mtime and are not
retroactively required to adopt a newer schema.

## Local Handoff Minimum

The canonical local handoff is concise. It must include:

1. `LOCAL ONLY. DO NOT COMMIT.`
2. Program, active phase, active slice, last completed slice, next implementation
   slice, and work-order status.
3. Last verified branch, HEAD, and full `git status --short --branch` result.
4. Tracked modifications and untracked files that must be preserved.
5. Exact read order.
6. Current artifact paths and refresh commands.
7. Commands already run with PASS/REVIEW/BLOCK.
8. The last completed atomic step.
9. One exact next action with owner files and forbidden scope.
10. Known implementation, stale-evidence, policy, and external blockers separated.
11. A pasteable `/goal` packet.
12. The worklog path for the session being closed.

Machine identity fields in the handoff and pasteable `/goal` must match the root
work order case-sensitively. The handoff also records `tracked_paths` as an exact
machine-readable array equal to current `git status` paths; narrative path mentions
do not satisfy dirty-tree preservation.

The handoff must not claim that an old score or artifact is current. It points to
the commands that regenerate current truth.

## Mandatory Session Close

Session close is an explicit workflow, not an informal final message.

1. Stop at an atomic boundary. Do not leave a partially applied migration, schema,
   or shared-file phase if it can be completed safely in the current session.
2. Capture current Git truth:

   ```powershell
   git status --short --branch
   git diff --stat
   git diff --check
   git log --oneline -5
   ```

3. Run the focused verifier for the active phase and record its exact result.
4. Update the tracked work order only when phase status, scope, or a durable decision
   changed. Do not copy volatile command logs into tracked docs.
5. Write a new ignored worklog using the minimum schema above.
6. Replace the canonical local handoff with current Git truth and one next action.
7. Run the program continuation verifier in session-close mode.
8. Re-run `git status --short --branch` and confirm local evidence remains ignored.
9. Report whether the branch is clean, dirty-but-recorded, ahead/behind, and whether
   commit or push was performed. Never imply either happened when it did not.

A session is **clear-safe** only when steps 2-8 are complete. Product/release gates
may still be BLOCK; clear-safe means continuation evidence is complete, not that the
product is finished.

## Mandatory Restart From `続き`

When a program is active and the owner says `続き`:

1. Read `AGENTS.md` current status and active work-order routing.
2. Run `git status --short --branch` and `git log --oneline -5` before trusting the
   handoff.
3. Read the root work order.
4. Read the canonical local handoff.
5. Read only the selected phase in the tracked plan and its owner source files.
6. Refresh the focused machine-truth artifacts named by the handoff.
7. Compare Git/artifact truth with the handoff. If they disagree, update the handoff
   before implementation.
8. Continue from `next_exact_action`; do not reopen completed phases without a current
   regression.

This order avoids broad repository re-reading while preserving mandatory safety and
claim boundaries.

## Status and Commit Discipline

- One active phase at a time.
- One phase equals one commit. The owner has granted standing authorization to
  create a focused phase/Work Unit commit after its required gates pass; do not
  pause for per-commit approval.
- A phase can be `planned`, `active`, `blocked`, `ready-to-commit`, or `complete`.
- `complete` requires its acceptance commands and artifacts, not narrative confidence.
- `ready-to-commit` is not `complete` when the work order requires a phase commit.
- Standing commit authorization does not include push, PR, merge, rebase,
  reset, amend, history rewrite, force push, or Git ACL mutation; those still
  require explicit authorization.
- A dirty tree is acceptable across session clear only when every intended path and
  exact next action are recorded in the canonical handoff.

## Conflict and Staleness Rules

Authority order:

1. Fresh command output and current generated artifacts.
2. `AGENTS.md` safety and claim policy.
3. Active root work order.
4. Tracked plan/spec.
5. Local handoff.
6. Worklog and historical notes.

If the handoff conflicts with Git or artifacts, Git/artifacts win. If the work order
conflicts with `AGENTS.md`, stop and repair the tracked contract. Never repair a conflict
by weakening a verifier, editing generated JSON by hand, or hiding a blocker.

## Efficiency Constraints

- The handoff is a pointer, not a repository summary.
- The worklog is append-only evidence, not a second specification.
- The tracked plan contains decisions once; local files reference them.
- Read only the active phase and owner files after mandatory preflight.
- Record exact commands and artifact paths so the next session can rerun rather than
  rediscover them.
- Archive or supersede stale handoffs explicitly; do not leave multiple plausible
  "next session" files for the same active program.
