# Aether Terminal 9.8 Operational Runbooks

Updated: 2026-05-06
Scope: P3-02 Docs and operational runbooks
Workspace: `<repo>`

This is the operator entry point for the 9.8 pass. It is intentionally compact: use it to resume a thread, identify the live dashboard, pick the right validation path, and avoid stale release or blocker claims.

## Source Of Truth

- Approved plan: [AI_WORKSTATION_98_IMPLEMENTATION_PLAN_2026-05-02.md](AI_WORKSTATION_98_IMPLEMENTATION_PLAN_2026-05-02.md)
- Progress log: [AI_WORKSTATION_98_PROGRESS.md](AI_WORKSTATION_98_PROGRESS.md)
- Roadmap state: [project-roadmap.json](../.codex-auto/project-roadmap.json)
- Current progress: [current-progress.json](../.codex-auto/current-progress.json)
- Validation evidence: [validation-ledger.json](../.codex-auto/validation-ledger.json)
- Decisions: [decision-log.json](../.codex-auto/decision-log.json)
- Risks: [risk-register.json](../.codex-auto/risk-register.json)
- Final report snapshot: [final-report.md](../.codex-auto/final-report.md)
- Handoff state: [AGENT_STATE.md](../AGENT_STATE.md)

Before acting on an old prompt, read `AGENT_STATE.md`, `project-roadmap.json`, `current-progress.json`, and `wizard-control.json`. The current control-plane truth wins over stale text copied from an earlier longrun prompt.

## AI Workstation Resume

Use this checklist at the start of a new thread:

1. Read `AGENT_STATE.md`.
2. Run `git status --short` and inspect relevant diffs before editing dirty files.
3. Read `.codex-auto/project-roadmap.json`.
4. Read `.codex-auto/validation-ledger.json`, `.codex-auto/decision-log.json`, `.codex-auto/risk-register.json`, and `.codex-auto/wizard-control.json`.
5. Confirm the active roadmap card and blocker state match `.codex-auto/current-progress.json`.
6. If a generated or decomposed task is created, include `parentRoadmapId` and `reason`.
7. Run the narrowest validation that proves the active card before broad gates.
8. Update the ledger, decision log, risk register, current progress, final report, progress doc, and `AGENT_STATE.md` before ending.

For this P3-02 runbook pass, the baseline truth before completion was `35/36` done, `0` blocked, active `P3-02`, with `P2-08` manually resolved by `p2-08-manual-signed-updater-installer-smoke-1778032175470`.

## Dashboard And Longrun

The canonical dashboard URL is recorded in `.codex-auto/current-dashboard.json`; for this workspace it should be `http://127.0.0.1:48371/` unless the file says otherwise.

Use these checks:

```powershell
node -e "fetch('http://127.0.0.1:48371/state').then(r=>r.json()).then(s=>console.log(JSON.stringify({active:s.activeCard?.id,done:s.summary?.done,blocked:s.summary?.blocked,isStaleDashboard:s.isStaleDashboard,canonicalUrl:s.canonicalUrl},null,2)))"
Get-Content -Raw .codex-auto/current-progress.json
Get-Content -Raw .codex-auto/current-dashboard.json
```

Healthy dashboard state must satisfy:

- `isStaleDashboard` is `false`.
- `canonicalUrl` matches `.codex-auto/current-dashboard.json`.
- `activeCard.id`, `summary.done`, and `summary.blocked` match the roadmap.
- No old final report is presented as active truth.
- `taskLineageMissing` is `0` when decomposition exists.

If the dashboard is dead but the workspace is otherwise healthy, it is a self-healable control-plane condition. If `.codex-auto` artifacts disagree because multiple same-workspace writers are active, stop as `code_conflict`.

## Blocker Taxonomy

Typed blocker kinds are:

- `permission`
- `external_dependency`
- `validation_failed`
- `oversized_task`
- `timeout`
- `product_decision`
- `environment_down`
- `test_flake`
- `code_conflict`
- `destructive`
- `unknown`

Operator policy:

- `permission`, `product_decision`, `destructive`, and `code_conflict`: stop with `needs_attention`.
- `external_dependency` and `environment_down`: probe first; continue only when the probe says the issue is self-healable.
- `timeout` and `oversized_task`: split into smaller tasks and preserve lineage.
- `validation_failed` and `test_flake`: retry only within the configured cap, then record the real failure.
- `not_blocked`: do not notify and do not carry stale blocker details forward.

Read `.codex-auto/blocker-analysis.json` when present, but verify it matches the active roadmap card before treating it as current.

## IME Troubleshooting

Primary script:

```powershell
pnpm.cmd verify:ime
pnpm.cmd verify:release:ime
```

Use `verify:ime` for local script and matrix checks. Use `verify:release:ime` only when a Tauri/WebView2 CDP target is running and a release handoff needs native IME evidence.

Troubleshooting order:

1. Reproduce in one active terminal pane first.
2. Check long Japanese preedit, empty `compositionend`, blur preservation, Backspace/Delete, paste takeover, resize, DPI, hidden cursor, inactive panes, and AI CLI input-row anchoring.
3. If CDP at `http://127.0.0.1:9222` is unavailable, record `external_dependency`; do not claim a live native pass.
4. Use diagnostics artifacts under `.codex-auto/a11y` or release/IME artifacts from the validation ledger when available.

Known residual: `risk-live-ime-env` remains open until a release handoff explicitly runs native IME CDP validation in the target environment.

## Process Kill Policy

Use the least destructive action that can prove recovery:

1. Prefer in-app stop, detach, or cleanup controls.
2. For a PTY, use the app IPC restart path when the test owns the terminal.
3. For dashboard or longrun helper processes, allow watchdog self-heal unless the control plane is contested.
4. For AI CLI processes, record whether the executable is valid and authenticated before claiming kill/recovery.
5. For installers or installed app processes, treat install/uninstall and kill smoke as destructive/manual unless explicitly approved.

Evidence to capture:

- target process or terminal id
- action taken
- recovery signal
- dashboard truth after recovery
- related risk id if recovery is partial

Do not kill unrelated processes to force progress. If ownership is ambiguous, stop as `permission` or `code_conflict` depending on the cause.

## Workspace Profile

Workspace profile behavior is implemented in `src/shared/lib/workspaceProfile.ts`, app store persistence, Rust config defaults, and longrun dashboard metadata.

Important fields:

- `workspaceRoot`
- `threadId`
- `dashboardPortPolicy`
- `dashboardPort`
- `notificationPolicy`
- `visualDensity`
- `paneLayout`
- `riskPolicy.safePaths`
- `monitoringScope.isolateEvents`

Operator checks:

```powershell
Get-Content -Raw .codex-auto/current-dashboard.json
Get-Content -Raw .codex-auto/current-longrun.json
pnpm.cmd exec vitest run src/__tests__/workspaceProfile.test.ts src/__tests__/appStore.test.ts --pool=threads --maxWorkers=1 --no-file-parallelism
```

If dashboard port policy and actual port disagree, prefer `.codex-auto/current-dashboard.json` for the live URL and record profile drift in the risk register.

## Release Build Playbook

Detailed release steps live in [release-build-playbook.md](release-build-playbook.md).

Current P2-08 status:

- Evidence: `p2-08-manual-signed-updater-installer-smoke-1778032175470`
- Full gate: `pnpm.cmd verify:release` passed during P2-08 manual resolution.
- Strict signing: local updater pubkey, signatures, and `latest.json` were generated and validated.
- NSIS: silent install, launch, and uninstall smoke passed.
- MSI: COM metadata smoke passed; administrative extraction timed out and remains a residual enterprise-distribution risk.

Do not rerun P2-08 unless source or distribution artifacts changed.

Before public release, resolve:

- `risk-p2-08-release-key-custody`
- `risk-p2-08-msi-admin-extract-timeout`

## Visual QA Guide

Primary matrix:

```powershell
pnpm.cmd exec playwright test e2e/visual-qa-layout.spec.ts --project=frontend
```

Use focused grep shards when one surface changed. Existing P2-05 evidence covers representative app-shell, rail, dialog, dashboard, welcome, scrollbar, screenshot review, and live Tauri/WebView2 DPI/settings smoke.

Artifacts:

- `.codex-auto/visual-qa/p2-05/manual-review.md`
- `.codex-auto/visual-qa/p2-05/*.png`
- `.codex-auto/visual-qa/p2-05/tauri-dpi-settings-smoke.json`

Visual QA should verify no horizontal overflow, no text overlap, stable right-rail widths, stable scrollbar gutters, accessible focus treatment, and responsive settings/dialog layout.

## Context Handoff

Context pack user guide: [context-pack-builder.md](context-pack-builder.md).

Minimal handoff contents:

- active roadmap id/title/status/progress
- current validation evidence id
- current blocker kind, or `not_blocked`
- exact next action
- files touched in the current turn
- residual risks
- whether P2-08 release artifacts changed

Use `AGENT_STATE.md` as the compact recoverable handoff. Keep it short enough for the next thread to read in one pass.

## Chaos Recovery Guide

Primary script:

```powershell
node scripts/verify-chaos-recovery.mjs
```

Current P2-07 evidence:

- deterministic control-plane chaos
- live WebView2 reload and localStorage deletion
- PTY force-restart recovery
- typed AI CLI `external_dependency` evidence for invalid local shim
- injected watchdog sleep/resume gap
- focused SQLite DB lock/write-failure incident test

Do not promote partial chaos evidence to a full live claim. The remaining release-handoff risks are:

- `risk-p2-07-real-ai-cli-kill-gap`
- `risk-p2-07-injected-sleep-resume-not-real-os-suspend`

Production promotion now requires mitigation evidence for accepted release risks. For the real OS suspend/resume
gap, capture a real Windows sleep/resume cycle with the release app running, then update all checks to `true`, set
`status` to `pass`, and run the verifier. The verifier also queries the Windows System event log and requires matching
suspend/resume power events, so a hand-written JSON file is not enough:

```powershell
pnpm.cmd verify:production:suspend:template
pnpm.cmd verify:production:suspend:refresh-app
pnpm.cmd verify:production:suspend:begin
# Put Windows to sleep, resume, then run:
pnpm.cmd verify:production:suspend:resume
pnpm.cmd verify:production:suspend:postcheck
pnpm.cmd verify:production:suspend:diagnose
pnpm.cmd verify:production:suspend
```

The evidence file is `.codex-auto/production-smoke/real-os-suspend-resume.json`. `verify:release:production`
will fail until this manual hardware-soak evidence exists and passes.

## P3-02 Validation Checklist

P3-02 is complete only when all of these are true:

- This runbook exists and covers AI workstation, dashboard/longrun, blocker taxonomy, IME, process kill, workspace profile, release, visual QA, context handoff, and chaos recovery.
- Markdown links and referenced local paths in this runbook resolve.
- `AGENT_STATE.md` contains current status, last validation, current failure, next step, decisions, and files touched.
- `.codex-auto/final-report.md` includes the docs delta.
- `project-roadmap.json`, `current-progress.json`, `wizard-control.json`, and the live dashboard agree on done/blocked/active truth.
- `risk-p3-02-docs-runbook-drift` is mitigated or has a concrete residual note.
