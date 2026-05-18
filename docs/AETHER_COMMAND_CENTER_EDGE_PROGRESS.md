# Aether Command Center Edge Progress

Date: 2026-05-15
Scope: Sequential execution toward the command-center edge plan.

## Phase 1 - Rail Clarity Pass

Goal: make the right rail understandable and action-oriented before deeper topology/workflow work.

### Phase 1.1 - Action Engine Contract

Status: done

Implemented:

- Every ranked right-rail action now carries an execution contract:
  - `ready`, `guided`, or `blocked` status;
  - visible action label;
  - expected result;
  - audit event kind;
  - recovery step;
  - optional disabled reason.
- Right-rail action cards now show the execution label and expected outcome, not only a dashboard hint.
- Blocked execution contracts render as disabled actions instead of silently pretending they are clickable.
- Clicking a right-rail action appends a Tauri audit journal event when running in the native app.
- Advisor tests now require every ranked action to include why/next-step/execution/audit/recovery metadata.

Validation:

- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vitest run src\__tests__\rightRailAdvisor.test.ts --reporter=dot`
- `pnpm exec vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\WorkstationPulse.test.tsx src\__tests__\ContextPanel.test.tsx src\__tests__\RunGraphPanel.test.tsx --reporter=dot`
- `pnpm exec vitest run src\__tests__\rightRailAdvisor.test.ts src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm build` passed after increasing the command timeout; Vite still reports existing static/dynamic Tauri API chunk warnings.
- `git diff --check`
- `pnpm exec playwright test e2e/visual-qa-layout.spec.ts --project=frontend --grep "right rail" --retries=0` passed after starting the local Vite server.

Residual:

- The current action contracts are still mostly guided navigation, not end-to-end executable operations.
- Phase 1.2 should convert the most important actions into direct operations where safe:
  - approve/deny workflow gate;
  - focus owner pane;
  - open owner diff;
  - copy/export context pack;
  - collect final report;
  - retry/stop blocked session through existing process controls.

### Phase 1.2 - Direct Action Wiring

Status: done

Implemented:

- Added explicit action operations to the right-rail execution contract:
  - `copy-context-pack`;
  - `open-primary-diff`;
  - `focus-session`;
  - `focus-pane`;
  - `focus-widget`.
- High-context handoff now copies a generated context pack to the clipboard and opens the Context rail.
- Review actions now open the highest-priority changed file in diff mode when a target file is known.
- Approval actions now select the first pending owner session when available.
- Blocked/run tracking actions select the target session or pane while still focusing the relevant rail widget.
- Right-rail action audit entries now include operation status, expected result, mode transition, and target role.

Validation:

- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vitest run src\__tests__\rightRailAdvisor.test.ts src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec vitest run src\__tests__\designTokenUsage.test.ts src\__tests__\WorkstationPulse.test.tsx src\__tests__\ContextPanel.test.tsx src\__tests__\ReviewQueuePanel.test.tsx src\__tests__\RunGraphPanel.test.tsx --reporter=dot`
- `pnpm build` passed; Vite still reports existing static/dynamic Tauri API chunk warnings.
- `pnpm exec playwright test e2e/visual-qa-layout.spec.ts --project=frontend --grep "right rail" --retries=0`
- `git diff --check`

Residual:

- Approve/deny workflow gates are still deliberately guided, not direct, because those actions can mutate workflow state and need explicit button-level confirmation.
- Stop/retry process actions are still guided through Health/Process Manager for the same reason.
- Phase 1.3 should add a command-center "Action Result" feedback strip so users can see exactly what the previous rail action did.

### Phase 1.3 - Action Result Feedback

Status: done

Implemented:

- Added a right-rail `Last action` result strip with `role="status"` and `aria-live="polite"`.
- Result states remain visible for 6.5 seconds and are cleared on unmount.
- Success, warning, and error tones are represented with distinct rail styling.
- Direct diff, handoff copy, blocked, pane-target-missing, and guided navigation paths now mirror their result into the rail instead of relying on toast-only feedback.
- Result text is compact and ellipsized so narrow rails do not grow or overflow.

Validation:

- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\designTokenUsage.test.ts src\__tests__\rightRailAdvisor.test.ts --reporter=dot`
- `pnpm build` passed; Vite still reports existing static/dynamic Tauri API chunk warnings.
- `git diff --check`
- `pnpm exec playwright test e2e/visual-qa-layout.spec.ts --project=frontend --grep "right rail" --retries=0`
- In-app browser QA confirmed the Command rail renders, the action button is present, clicking it shows the `Last action` result strip, and no console errors were reported.

Residual:

- The strip currently reports one last action only. Phase 1.4 should add a tiny action history drawer or audit-linked detail affordance only if it proves useful; avoid turning the rail back into a noisy dashboard.

### Phase 1.4 - Rail Action Audit Detail

Status: done

Implemented:

- Right-rail action audit writes now return the backend-issued audit journal record instead of discarding it.
- The `Last action` result carries audit event id, correlation id, kind, and timestamp when running in the native Tauri runtime.
- Audit-linked action results expose a compact `Audit` button that moves the rail to Observe, scrolls the Audit Timeline widget into view, selects the event, and applies the trace filter.
- The audit jump is read-only: it does not approve, stop, retry, or mutate workflow/process state.
- The result strip remains compact with a third grid column for the audit affordance.

Validation:

- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\designTokenUsage.test.ts src\__tests__\rightRailAdvisor.test.ts --reporter=dot`
- `pnpm build` passed; Vite still reports existing static/dynamic Tauri API chunk warnings.
- `git diff --check`
- `pnpm exec playwright test e2e/visual-qa-layout.spec.ts --project=frontend --grep "right rail" --retries=0`
- In-app browser QA confirmed the Command rail renders, action results remain visible, and no console errors were reported. The audit button is native-only because the Vite preview has no `append_audit_event` IPC.

Residual:

- The audit affordance depends on native IPC returning an audit journal record, so a Tauri/WebView smoke should verify the actual `Audit` button path before release.

### Phase 1.5 - Native Audit Jump Smoke

Status: done

Implemented:

- Added `scripts/verify-right-rail-audit-jump.mjs`, a focused live Tauri/WebView2 CDP smoke for the right-rail `Last action` -> `Audit` -> Audit Timeline path.
- Added `pnpm verify:right-rail-audit` as the repeatable command.
- The smoke clears stale visual-QA dashboard storage, attaches to `http://127.0.0.1:9222`, verifies `__TAURI_INTERNALS__.invoke`, clicks the top enabled rail action, waits for the native-only `Audit` button, clicks it, and verifies Observe mode plus a selected Audit Timeline row.
- The smoke writes `.codex-auto/production-smoke/right-rail-audit-jump.json` as evidence.

Validation:

- `node --check scripts\verify-right-rail-audit-jump.mjs`
- `pnpm.cmd verify:right-rail-audit`
- Native evidence artifact: `.codex-auto/production-smoke/right-rail-audit-jump.json`

Residual:

- The `Last action` strip still expires after 6.5 seconds. A future action history drawer would make audit lookup durable after the transient result disappears.

### Phase 1.6 - Durable Rail Action History

Status: done

Implemented:

- The last several right-rail actions remain available after the transient result strip expires.
- Each history item can open its audit context when the native audit record exists.
- The history affordance stays compact and does not turn the command rail into a noisy dashboard.

Validation:

- `pnpm exec biome check src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\rightRailAdvisor.test.ts src\__tests__\designTokenUsage.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Native audit jump durability still depends on the existing `append_audit_event` IPC path; keep `pnpm verify:right-rail-audit` in the release smoke set.

### Phase 1.7 - Guardrail Override and Tool Envelope

Status: done

Implemented:

- Added a compact Guardrail profile selector in the Agent workforce card: `Auto`, `Conservative`, `Release`, `Builder`, and `Research`.
- Manual selection now overrides the automatic profile used by right-rail action guardrail labels and agent start allow-tool wiring.
- The workforce card now shows the effective tool envelope so users can see why an action is guided, ready, or gated.
- Exported the stable guardrail profile list from the workforce model so UI and tests share the same profile ordering.
- Persisted the guardrail selection in local storage so a manual override survives reloads.

Validation:

- `pnpm exec biome check src\App.tsx src\styles\global.css src\shared\lib\rightRailWorkforce.ts src\__tests__\AppSilentBugs.test.ts src\__tests__\rightRailWorkforce.test.ts`
- `pnpm vitest run src\__tests__\guardrailPolicy.test.ts src\__tests__\rightRailWorkforce.test.ts src\__tests__\rightRailAdvisor.test.ts src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- In-app browser QA confirmed that switching to `Builder` updates the tool envelope and action guardrail, then remains selected after reload.

Residual:

- This is persisted in browser storage only. A native config-backed preference can be added later if this needs to sync across app profiles.

### Phase 1.8 - Command Rail Recoverability State

Status: done

Implemented:

- Right-rail actions should show when a target is stale, missing, or already resolved instead of silently doing nothing.
- Recovery copy should point to the exact next place to inspect: Health, Audit Timeline, Review Queue, or Toolkit.
- Focus/session/diff action failures should produce a durable history entry and an audit event when native IPC is available.

Validation:

- `pnpm exec biome check src\App.tsx src\__tests__\AppSilentBugs.test.ts src\styles\global.css src\shared\lib\rightRailWorkforce.ts src\__tests__\rightRailWorkforce.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\rightRailAdvisor.test.ts src\__tests__\rightRailWorkforce.test.ts src\__tests__\guardrailPolicy.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- In-app browser QA on `http://localhost:1420/?aetherVisualQa=1...` confirmed the guardrail select renders, switching to `Builder` updates the tool envelope and action guardrail, and running an action creates a durable Recent actions entry.

Residual:

- Native outcome audit rows are covered by code path and type checks; release smoke should add a live negative-path scenario for stale pane/diff targets.

### Phase 1.9 - Right Rail Decision Copy and Empty-State Polish

Status: done

Implemented:

- The right rail should explain what each section does without adding noisy tutorial copy.
- Empty states should offer a clear next action, not a passive placeholder.
- Labels should use product language consistently: Run, Changes, Health, Guardrail, Recent actions, Audit.

Validation:

- `pnpm exec biome check --write src\features\decision-inbox\DecisionInboxPanel.tsx src\features\toolkit\ToolkitPanel.tsx src\features\toolkit\ToolkitPanel.module.css src\features\workflow\WorkflowPanel.tsx src\features\agent-inspector\AgentInspector.tsx src\features\context\ContextPanel.tsx src\features\context\LivePanesPanel.tsx src\features\process-manager\ProcessManagerPanel.tsx src\__tests__\DecisionInboxPanel.test.tsx src\__tests__\ContextPanel.test.tsx src\__tests__\toolkit-placeholder.test.ts src\__tests__\WorkflowPanelRace.test.tsx src\__tests__\AgentInspectorTabRouting.test.tsx`
- `pnpm vitest run src\__tests__\DecisionInboxPanel.test.tsx src\__tests__\ContextPanel.test.tsx src\__tests__\toolkit-placeholder.test.ts src\__tests__\WorkflowPanelRace.test.tsx src\__tests__\AgentInspectorTabRouting.test.tsx src\__tests__\LivePanesPanel.test.tsx src\__tests__\ProcessManagerPanel.test.tsx --pool=threads --maxWorkers=1 --no-file-parallelism --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- In-app browser QA confirmed Run rail copy (`Decisions`, `human gates`, `No human decisions`, `saved commands`, `multi-step runs`, `handoff state`) and Health rail copy (`Processes/live shells`, `Live Panes/focus/recover`) render after lazy panels load.

Residual:

- Copy is now clearer, but the right rail still lacks a persisted per-user layout preference for which widgets are expanded or hidden.

### Phase 1.10 - Rail Layout Preference and Widget Priority

Status: done

Implemented:

- Users can keep noisy secondary widgets collapsed without losing the core Run, Changes, and Health flows.
- The rail should remember high-value widget visibility choices across reloads.
- The default layout should keep action, guardrail, decisions, sessions, and health recovery above low-frequency diagnostics.

Validation:

- `pnpm exec biome check src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\designTokenUsage.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- In-app browser QA confirmed default priority order, collapsed secondary frames, click-to-open behavior, and reload persistence for the Workflow widget.

Residual:

- Widget preferences are local to browser storage. A future native config sync pass can make these layout choices portable across machines/profiles.

### Phase 1.11 - Native Negative-Path Rail Smoke

Status: done

Implemented:

- Added `scripts/verify-right-rail-negative-path.mjs`, a focused live Tauri/WebView2 CDP smoke for recoverable right-rail failure paths.
- Added `pnpm verify:right-rail-negative` as the repeatable command.
- The smoke exercises both deterministic dev-QA negative cases:
  - missing changed-file diff target;
  - stale operational pane target.
- Each case verifies the rail warning result, durable Recent actions row, fresh native outcome audit row, and Audit Timeline jump.
- The smoke attaches to the running dev WebView over CDP and does not invoke the installer or release build.

Validation:

- `node --check scripts\verify-right-rail-negative-path.mjs`
- `pnpm exec biome check src\features\context\AuditTimelinePanel.tsx src\__tests__\AuditTimelinePanel.test.tsx src\App.tsx src\__tests__\AppSilentBugs.test.ts scripts\verify-right-rail-negative-path.mjs package.json`
- `pnpm vitest run src\__tests__\AuditTimelinePanel.test.tsx src\__tests__\AppSilentBugs.test.ts src\__tests__\rightRailAdvisor.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:right-rail-negative`

Residual:

- This smoke still requires a running native dev app with CDP enabled (`pnpm tauri:dev`). It is intentionally kept separate from heavy release packaging.

### Phase 1.12 - Native Config Sync for Rail Preferences

Status: done

Implemented:

- Right-rail widget collapse preferences now hydrate from native `config.toml` through `workspace_profile.global_defaults.pane_layout.right_rail_widgets`.
- Widget clicks still update local storage immediately for responsive UI, then persist to native config in the background.
- Native config hydration emits a rail-widget sync event so already-mounted widgets follow config changes after startup.
- Rust config now round-trips the `right_rail_widgets` map without dropping unknown widget preferences.
- Force-opened action targets persist their expanded state so Audit/Context/Run Graph jumps do not collapse immediately after focus.

Validation:

- `pnpm exec biome check src\App.tsx src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `cargo test --manifest-path src-tauri\Cargo.toml config::settings::tests --lib`
- `pnpm exec tsc --noEmit --pretty false`
- Native WebView2/CDP smoke confirmed clicking Workflow updates UI, local storage, and `config.toml`; the test restored the original config afterward.

Residual:

- Right-rail mode itself is still primarily workspace-profile driven, not exposed as a first-class Settings control. Add it only if users ask for startup rail selection.

### Phase 1.13 - Guardrail Profile Native Sync

Status: done

Implemented:

- Right-rail Guardrail profile selection now persists to native `config.toml` through `workspace_profile.global_defaults.pane_layout.right_rail_guardrail_profile`.
- `Auto` remains the default without forcing a native config write on a fresh profile.
- Existing browser storage is still used for first-paint speed and migration of non-default selections.
- Native config hydration emits a guardrail sync event so already-mounted rail controls update without a full app restart.
- Manual profile changes keep immediate UI feedback while the native save runs in the background.

Validation:

- `pnpm exec biome check src\App.tsx src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `cargo test --manifest-path src-tauri\Cargo.toml config::settings::tests --lib`
- `pnpm exec tsc --noEmit --pretty false`
- Native WebView2/CDP smoke confirmed selecting `Builder` updates UI, local storage, native config, reload restoration, and the effective tool envelope; the test restored the original config afterward.

Residual:

- Guardrail selection is now portable, but the release gate should run a single repeatable preference smoke instead of relying on ad hoc browser checks.

### Phase 1.14 - Native Preference Sync Smoke

Status: done

Implemented:

- Added `scripts/verify-right-rail-preferences.mjs`, a repeatable live Tauri/WebView2 CDP smoke for native right-rail preference persistence.
- Added `pnpm verify:right-rail-preferences` as the release-friendly command.
- The smoke validates:
  - Guardrail profile UI -> local storage -> native config;
  - secondary widget open/closed UI -> local storage -> native config;
  - reload restoration for the selected Guardrail profile;
  - no runtime console/page errors.
- The smoke backs up and restores both native config and relevant browser storage so it does not leave user preferences dirty.

Validation:

- `node --check scripts\verify-right-rail-preferences.mjs`
- `pnpm exec biome check src\App.tsx src\__tests__\AppSilentBugs.test.ts scripts\verify-right-rail-preferences.mjs package.json`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:right-rail-preferences`

Residual:

- Native preference persistence now has release smoke coverage. The next right-rail pass should focus on action explainability and reducing rail cognitive load under live multi-agent runs.

### Phase 1.15 - Live Run Cognitive Load Pass

Status: done

Implemented:

- Added a persistent Decision focus card directly below the right-rail purpose line so human gates are always separated from telemetry, workforce status, and action history.
- The Decision focus card routes to the Command rail and opens the Decision Inbox instead of forcing users to scan the lower rail.
- Added source-contract coverage that keeps the Decision focus above Now, Workforce, and Action Stack blocks.
- Added Sakura-specific right-rail styling for the Decision card, its warning state, and its chips so the white-peach surface does not fall back to low-contrast gray glass.
- Added design-token coverage that locks the Sakura Decision surface, warning state, chips, and detail text into the Sakura rail contract.

Validation:

- `pnpm exec biome check src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\designTokenUsage.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- Live WebView2 QA at `http://localhost:1420/?aetherVisualQa=1&projectPath=C%3A%2FUsers%2Fowner%2FAether_Terminal&rail=command&state=blocked&v=decision-load-pass` confirmed the Decision focus renders above telemetry/action sections and does not overflow at right-rail width.

Residual:

- Decision visibility is now protected in normal and Sakura rails. The next pass should seed a pending decision in the native visual QA path and verify the warning state plus click-to-inbox behavior end to end.

### Phase 1.16 - Live Decision Inbox Smoke

Status: done

Implemented:

- Fixed the blocked visual-QA fixture so `nextActor` is `human`, matching the Decision Inbox contract instead of silently rendering a blocked run as "No decisions waiting".
- Added `scripts/verify-right-rail-decisions.mjs`, a live Tauri/WebView2 smoke for human-decision prominence.
- Added `pnpm verify:right-rail-decisions` as the release-friendly command.
- The smoke validates:
  - blocked visual-QA state produces a warning Decision focus;
  - the card carries `data-has-decision="true"` and visible "Needs your decision" copy;
  - the Decision focus remains above Now, Workforce, and Action Stack telemetry;
  - clicking Decision routes to the Command rail and reveals the Decision Inbox;
  - no runtime console/page errors are emitted during the flow.

Validation:

- `node --check scripts\verify-right-rail-decisions.mjs`
- `pnpm exec biome check src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts src\__tests__\designTokenUsage.test.ts scripts\verify-right-rail-decisions.mjs package.json`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\designTokenUsage.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:right-rail-decisions`

Residual:

- The human-decision rail path now has live smoke coverage. The next pass should move from visibility to action quality: every Decision Inbox item should offer a clear recommended action, risk, evidence, and handoff path.

### Phase 1.17 - Decision Action Quality Pass

Status: done

Implemented:

- Promoted the recommended action into a first-class `Action` line on every non-compact Decision Inbox row.
- Promoted evidence from footer-only chips into the row body as `Evidence`, keeping the footer as a compact trail.
- Added an explicit handoff label (`Focus session`, `Workflow gate`, or `Audit trail`) so the user can tell where the decision will lead.
- Upgraded the blocked visual-QA fixture to a destructive file-system approval request so the native smoke covers a critical/high-risk decision instead of only a generic permission gate.
- Strengthened the live right-rail decision smoke so it verifies `Critical`, `Action`, `Evidence`, `Focus session`, and `Destructive Operation` are all visible after opening the Decision Inbox.
- Updated component coverage to require action, evidence, consequence, timeout, risk, and focus path on pending decisions.

Validation:

- `node --check scripts\verify-right-rail-decisions.mjs`
- `pnpm exec biome check src\App.tsx src\features\decision-inbox\DecisionInboxPanel.tsx src\features\decision-inbox\DecisionInboxPanel.module.css src\__tests__\DecisionInboxPanel.test.tsx src\__tests__\AppSilentBugs.test.ts scripts\verify-right-rail-decisions.mjs`
- `pnpm vitest run src\__tests__\DecisionInboxPanel.test.tsx src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:right-rail-decisions`

Residual:

- Decision item readability is now covered. The next pass should reduce action ambiguity by wiring Decision Inbox rows to concrete remediation affordances where available: select session, open related workflow, open audit evidence, and jump to the affected file/pane.

### Phase 1.18 - Decision Remediation Routing

Status: done

Implemented:

- Decision rows now render the strongest available remediation button instead of only passive handoff labels.
- Session-backed decisions keep the existing `Focus` route and call `onSelectSession`.
- Workflow-backed decisions now render `Open workflow`, and the App routes to the Command rail with the Workflows widget focused.
- Audit-backed decisions now render `Open audit`, parse the source audit event id, and the App routes to the Observe rail with Audit Timeline focused and the event selected.
- Route buttons are constrained and ellipsized so long labels do not widen or break the right rail.
- Component tests now cover session, workflow, and audit remediation paths.

Validation:

- `pnpm exec biome check --write src\App.tsx src\features\decision-inbox\DecisionInboxPanel.tsx src\features\decision-inbox\DecisionInboxPanel.module.css src\__tests__\DecisionInboxPanel.test.tsx src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\DecisionInboxPanel.test.tsx src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec biome check src\App.tsx src\features\decision-inbox\DecisionInboxPanel.tsx src\features\decision-inbox\DecisionInboxPanel.module.css src\__tests__\DecisionInboxPanel.test.tsx src\__tests__\AppSilentBugs.test.ts scripts\verify-right-rail-decisions.mjs package.json`
- `pnpm verify:right-rail-decisions`

Residual:

- Decision rows now have concrete remediation routes. The next pass should make these routes more context-rich by preserving selected workflow/audit context across rail transitions and adding visual focus confirmation for the routed target.

### Phase 1.19 - Routed Target Focus Confirmation

Status: done

Implemented:

- Added route confirmation state for right-rail decision navigation, separate from the short-lived scroll focus flag.
- `Open workflow` now force-opens the Workflows widget and shows a temporary confirmation banner with the workflow id.
- `Open audit` now force-opens Audit Timeline, selects the audit event, preserves the event correlation trace when available, and shows a temporary evidence confirmation banner.
- Added a shared `right-panel-widget-focus-confirmation` surface with Sakura-specific styling so routed confirmation stays readable across presets.
- Added source-contract coverage for route confirmation state, workflow force-open, audit trace preservation, and confirmation rendering.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts src\features\decision-inbox\DecisionInboxPanel.tsx src\features\decision-inbox\DecisionInboxPanel.module.css src\__tests__\DecisionInboxPanel.test.tsx`
- `pnpm vitest run src\__tests__\DecisionInboxPanel.test.tsx src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec biome check src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts src\features\decision-inbox\DecisionInboxPanel.tsx src\features\decision-inbox\DecisionInboxPanel.module.css src\__tests__\DecisionInboxPanel.test.tsx scripts\verify-right-rail-decisions.mjs package.json`
- `pnpm verify:right-rail-decisions`

Residual:

- Routed target focus is now visible and trace-aware. The next pass should make workflow/audit decisions actionable from the destination: approve/reject workflow gates where supported, and expose recovery controls for audit evidence without making users return to the Decision Inbox.

### Phase 1.20 - Destination Action Affordances

Status: done

Implemented:

- Workflow waiting-gate phases now render a visible `Gate decision` action panel with the decision kind, reason, and text `Approve` / `Reject` actions in addition to the compact icon controls.
- Audit Timeline now renders a selected recovery action strip when a routed/selected event is recoverable.
- Selected audit recovery exposes the recovery label, event summary, recovery detail, and direct `Focus pane` / `Restart pane` actions when a live pane target is available.
- The selected audit restart path reuses the existing confirmation dialog and stale-pane revalidation before invoking restart.
- Added regression coverage so workflow gates and selected audit recoveries cannot silently become read-only destinations again.

Validation:

- `pnpm exec biome check --write src\features\workflow\WorkflowPanel.tsx src\features\workflow\WorkflowPanel.module.css src\features\context\AuditTimelinePanel.tsx src\features\context\AuditTimelinePanel.module.css src\__tests__\WorkflowPanelRace.test.tsx src\__tests__\AuditTimelinePanel.test.tsx`
- `pnpm vitest run src\__tests__\WorkflowPanelRace.test.tsx src\__tests__\AuditTimelinePanel.test.tsx --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec biome check src\features\workflow\WorkflowPanel.tsx src\features\workflow\WorkflowPanel.module.css src\features\context\AuditTimelinePanel.tsx src\features\context\AuditTimelinePanel.module.css src\__tests__\WorkflowPanelRace.test.tsx src\__tests__\AuditTimelinePanel.test.tsx`
- `pnpm verify:right-rail-decisions`

Residual:

- Destination actions are now visible for workflow gates and selected audit evidence. The next pass should connect destination actions back into the right-rail outcome/audit history, so users can see whether a gate approval, gate rejection, focus, or recovery action succeeded without scanning toasts.

### Phase 1.21 - Destination Outcome Ledger

Status: done

Implemented:

- Added a destination outcome result path that feeds workflow/audit destination actions into the existing right-rail `Last action` and action-history ledger.
- Workflow gate approval, completion, rejection, and approval/rejection failures now emit visible destination outcomes with workflow context.
- Audit selected-event focus and restart recovery now emit visible destination outcomes with audit event id, correlation id, and pane target context.
- App wiring passes destination outcomes from WorkflowPanel and AuditTimelinePanel to the shared right-rail outcome ledger.
- Added source/component coverage so destination actions cannot silently fall back to toast-only feedback.

Validation:

- `pnpm exec biome check --write src\App.tsx src\features\workflow\WorkflowPanel.tsx src\features\context\AuditTimelinePanel.tsx src\__tests__\WorkflowPanelRace.test.tsx src\__tests__\AuditTimelinePanel.test.tsx src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\WorkflowPanelRace.test.tsx src\__tests__\AuditTimelinePanel.test.tsx src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec biome check src\App.tsx src\features\workflow\WorkflowPanel.tsx src\features\workflow\WorkflowPanel.module.css src\features\context\AuditTimelinePanel.tsx src\features\context\AuditTimelinePanel.module.css src\__tests__\WorkflowPanelRace.test.tsx src\__tests__\AuditTimelinePanel.test.tsx src\__tests__\AppSilentBugs.test.ts scripts\verify-right-rail-decisions.mjs package.json`
- `pnpm verify:right-rail-decisions`

Residual:

- Destination actions now leave visible outcome history. The next pass should make that history filterable/actionable, so users can jump back from an outcome record to the workflow, audit event, or pane target that produced it.

### Phase 1.22 - Outcome Replay Routing

Status: done

Implemented:

- Added source routing metadata to right-rail action outcomes, including workflow/audit route labels and destination details.
- Right-rail `Last action` and recent action history now expose an `Audit`/`Workflow` source button that reopens the source panel instead of leaving the record as passive log text.
- Audit-source outcomes select the matching audit event/trace and show a destination confirmation in Audit Timeline.
- Workflow-source outcomes force-open the Workflow panel with a route confirmation for the originating workflow id.
- Workflow gate and Audit Timeline destination actions now emit route metadata with their outcome ledger records.
- Added contract coverage so outcome history keeps source routing affordances and explicit source labels.

Validation:

- `pnpm exec biome check --write src\App.tsx src\features\workflow\WorkflowPanel.tsx src\features\context\AuditTimelinePanel.tsx src\__tests__\WorkflowPanelRace.test.tsx src\__tests__\AuditTimelinePanel.test.tsx src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\WorkflowPanelRace.test.tsx src\__tests__\AuditTimelinePanel.test.tsx src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Outcome routing is now actionable. The next pass should add a command-center scoring layer that grades whether the rail has enough concrete evidence, decisions, live state, and recovery affordances to be a sellable edge rather than just a grouped sidebar.

### Phase 1.23 - Command Center Edge Scoring

Status: done

Implemented:

- Added a first-class right-rail `Edge score` card that grades command-center readiness across Decision, Evidence, Recovery, and Live axes.
- The score derives from real rail inputs: pending owner gates, live runs, changed files, audit evidence, graph risks, recommended actions, and recovery-capable actions.
- The card exposes grade, total score, weakest axis, and a compact four-axis breakdown so the rail's product edge is measurable during daily use.
- Sakura styling was included so the new score card does not fall back to dark/gray material when that preset is active.
- Added source-contract coverage so the score layer remains visible and evidence-based.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\WorkflowPanelRace.test.tsx src\__tests__\AuditTimelinePanel.test.tsx src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- The score is now visible, but its weakest-axis output should become actionable. The next pass should let a user click a weak score axis and jump straight to the exact widget/action that improves it.

### Phase 1.24 - Edge Score Remediation Actions

Status: done

Implemented:

- Edge score axes are now actionable controls instead of passive metrics.
- Decision routes to Decision Inbox, Evidence routes to Review Queue/Audit Timeline/Reliability depending on available signals, Recovery routes to Reliability, and Live routes to Live Panes or Process Health.
- Axis buttons expose visible action labels and accessible labels, then set the right-rail mode and focused widget so the destination scrolls into view.
- Native right-rail widgets also receive the existing route-confirmation banner when the destination supports it.
- Added source-contract coverage to prevent Edge score axes from regressing into static text.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- Browser smoke: created a Score loop entry, clicked `Clear`, confirmed the section disappeared, confirmed `edgeLoop` fallback was removed from the URL, and confirmed reload did not restore stale feedback.

Residual:

- Edge score actions now route to the right area. The next pass should make each destination expose the exact missing evidence/action inline, so the score closes the loop instead of only moving the user to the right widget.

### Phase 1.25 - Destination Gap Closure Prompts

Status: done

Implemented:

- Edge score items now carry destination remediation copy: prompt title, concrete prompt detail, and the visible action label.
- Clicking Decision, Evidence, Recovery, or Live stores a destination prompt alongside the mode/widget route.
- Decision Inbox, Review Queue, Audit Timeline, Reliability, Live Panes, and Process Health render the prompt inline at the destination before the main widget content.
- The prompt card uses accessible labels and visible text, so the score-to-action loop is not hidden behind hover-only UI.
- Sakura styling is covered by the shared prompt card so destination copy does not fall back to gray/dark material.
- Added source-contract coverage so routed score axes remain connected to destination-side remediation prompts.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Score prompts now close the loop at the destination. The next pass should turn repeated score/prompt interactions into lightweight telemetry so we can see which axis users use, which prompts are ignored, and whether the score improves afterward.

### Phase 1.26 - Edge Score Interaction Telemetry

Status: done

Implemented:

- Added privacy-safe audit telemetry for Edge score interactions.
- Edge score clicks now emit `right_rail.edge_score.clicked` with axis id/label/status, axis score/max, total Edge score, grade, from/to mode, target widget, and visible action label.
- Destination focus now emits `right_rail.edge_score.destination-reached` once per prompt route when the target widget is found and focused.
- Telemetry deliberately excludes command text, prompt text, file paths, and user input; this is enforced by source-contract tests.
- Destination-reached events use the same click-time score/grade snapshot, so later score recalculation cannot corrupt the interaction trail.

Validation:

- `pnpm exec biome check --write src\App.tsx src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Edge score interactions are now observable. The next pass should summarize recent score interactions inside the rail so users can see whether repeated actions are actually improving the command-center score.

### Phase 1.27 - Edge Score Feedback Loop

Status: done

Implemented:

- Added a compact `Score loop` section under Edge score, capped at four recent interactions.
- Each score interaction records axis, target widget, score, grade, previous score, delta, and trend.
- Repeated axis clicks now show `Baseline`, positive deltas, flat `0`, or negative deltas directly in the right rail.
- Feedback entries remain compact and do not display command text, prompt text, file paths, or user input.
- Added source-contract coverage for the feedback entry shape, history cap, trend rendering, and privacy guardrails.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Score loop history is visible. The next pass should make history entries actionable so users can replay a previous axis action without hunting for the original score card.

### Phase 1.28 - Edge Feedback Replay

Status: done

Implemented:

- Score loop feedback entries are now buttons, not passive rows.
- Clicking a feedback entry replays the matching current Edge score axis action and routes back to the destination widget.
- Replay entries reuse the same prompt, routing, telemetry, and feedback path as primary Edge score clicks.
- Entries are disabled only if the axis no longer exists in the current score model.
- Added source-contract coverage so the feedback loop cannot regress into static text.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Feedback replay is actionable. The next pass should add a small outcome summary that groups the last few score-loop interactions by axis so repeated weak areas become obvious.

### Phase 1.29 - Edge Axis Pattern Summary

Status: done

Implemented:

- Added a compact repeated-axis summary inside the `Score loop` block.
- The summary groups recent feedback entries and surfaces the most repeated Edge score axis, interaction count, and latest trend.
- The summary stays inside the right rail and does not require opening Audit Timeline.
- Sakura styling is included through the shared score-loop selectors.
- Added source-contract coverage for the summary helper, UI selector, count, axis label, and compact privacy-safe placement.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- The score loop now shows repeated-axis patterns. The next pass should connect the repeated axis to a specific recommended next action, so the user gets one prioritized move instead of just a pattern.

### Phase 1.30 - Edge Loop Next Best Action

Status: done

Implemented:

- Added a `Next best action` button directly under Edge score.
- The action prioritizes the repeated score-loop axis when one exists, otherwise falls back to the weakest current Edge score axis.
- Clicking the action reuses the existing score-axis routing, destination prompt, feedback history, and audit telemetry path.
- The card stays compact and privacy-safe, showing only action label, reason, and axis.
- Added source-contract coverage for the next-action helper, UI, reason, and route reuse.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- The score loop now recommends one move. The next pass should make the recommendation outcome-aware by marking whether the recommended action actually led to a destination prompt or score-loop entry.

### Phase 1.31 - Edge Recommendation Outcome State

Status: done

Implemented:

- Added compact outcome state to the `Next best action` card.
- Outcome is derived from existing destination prompt and score-loop feedback, not a new passive log.
- The card now reports `Destination reached`, `Action replayed`, or `Recommendation changed` when applicable.
- Destination focus stamps the active prompt with `reachedAt`, allowing the outcome to show reached state without recording command text or user input.
- Added source-contract coverage for outcome derivation, reached/replayed/stale labels, and compact UI placement.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- The Edge loop is now outcome-aware. The next pass should persist the compact score-loop state across reloads so the right rail does not forget recent product-quality guidance during local dev refreshes.

### Phase 1.32 - Edge Loop Session Persistence

Status: done

Implemented:

- Added workspace-local score-loop persistence for the right-rail Edge feedback history.
- Storage keys hash the normalized workspace path, so raw project paths are not written into the WebView storage key.
- Persisted entries are sanitized into a bounded allowlist: axis id/label, action label, target widget, score, grade, previous score, delta, trend, and timestamp only.
- Prompt text, command text, file paths, and user input are excluded from the persisted shape.
- Added `history.state` and bounded URL fallback persistence for constrained validation WebViews where Web Storage APIs are unavailable; the fallback still stores only the hashed workspace key and sanitized score-loop metadata.
- Hydration now skips the first save pass for a workspace key, preventing stale history from overwriting loaded history during project switches or reloads.
- Added source-contract coverage for persistence helpers, hashed workspace keys, sanitized bounded fields, and the no-raw-history JSON path.

Validation:

- `pnpm exec biome check --write src\App.tsx src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- Browser smoke: clicked `Next best action`, reloaded the same workspace URL, and confirmed `Score loop` rehydrated with the Evidence action history.

Residual:

- The score-loop state now survives reloads. The next pass should add an intentional reset control so users can clear stale guidance per workspace without opening developer tools.

### Phase 1.33 - Edge Loop Reset Control

Status: done

Implemented:

- Added a compact `Clear` action inside the right-rail `Score loop` header.
- Reset clears the visible feedback history immediately and removes only the current workspace's hashed Edge feedback storage entry.
- Reset also removes the bounded `history.state` and `edgeLoop` URL fallback payloads without touching audit history, pane state, workspace tabs, presets, theme customization, or pane persistence.
- Added focused styling for the reset control so it stays discoverable without dominating the right rail.
- Added source-contract coverage for the reset helper, visible clear action, hashed storage removal, state cleanup, URL fallback cleanup, and state clearing.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Score-loop reset is now safe and workspace-local. The next pass should add explicit reset feedback so users can tell the clear action completed without relying on the section disappearing.

### Phase 1.34 - Edge Loop Reset Confirmation

Status: done

Implemented:

- Added a transient, non-modal `Score loop cleared` confirmation in the right rail after reset.
- Confirmation uses `role="status"` and `aria-live="polite"` so the clear action has accessible completion feedback.
- Confirmation is state-only and never writes a new persisted score-loop entry.
- Added a cleanup timer so the notice clears automatically and does not leave stale UI.
- Sakura-specific styling includes the reset confirmation in the same pale material family as the other right-rail Edge cards.
- Added source-contract coverage for the notice state, timer cleanup, status region, privacy-safe copy, and reset path.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Reset now has completion feedback. The next pass should make the Edge loop resilient to score-model label changes by replaying entries via stable axis id instead of display label.

### Phase 1.35 - Edge Feedback Stable Replay IDs

Status: done

Implemented:

- Added `axisId` to score-loop feedback entries and summaries.
- New feedback entries persist the stable Edge score axis id alongside the human-readable label.
- Legacy persisted entries without `axisId` are still sanitized through the existing `id` prefix, keeping reload compatibility.
- Replay now resolves entries by `axisId` first and uses the label only as a backward-compatible fallback.
- Repeated-axis recommendation now resolves by stable id, making it resilient to label copy changes and localization.
- Added `data-axis-id` attributes to the summary and replay rows for QA and future automated checks.
- Added source-contract coverage for axis id persistence, summary id use, and stable replay matching.

Validation:

- `pnpm exec biome check --write src\App.tsx src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Replay is now id-stable. The next pass should add a compact stale-entry state so a removed axis or incompatible old entry explains why it is disabled instead of silently becoming unavailable.

### Phase 1.36 - Edge Feedback Stale Entry State

Status: done

Implemented:

- Added a compact stale reason for unresolved Score loop feedback rows.
- Rows that cannot resolve to a current Edge score axis remain disabled and now display `Stale axis: ... is no longer in the current score model.`
- Stale rows get `data-stale="true"` for visual QA and regression checks.
- The stale explanation is derived only from the privacy-safe axis label and does not include prompt text, command text, file paths, or user input.
- Added styling for stale rows and Sakura tone compatibility.
- Added source-contract coverage for stale reason derivation, disabled unresolved rows, `data-stale`, and the visible stale message.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Stale rows now explain themselves. The next pass should add a lightweight privacy-safe telemetry event when a stale row is encountered so repeated stale-loop issues can be audited without recording user content.

### Phase 1.37 - Edge Feedback Stale Telemetry

Status: done

Implemented:

- Added privacy-safe audit telemetry for stale Score loop rows.
- Stale feedback entries are derived from the current score model and emitted through `right_rail.edge_feedback.stale`.
- Telemetry is deduplicated per workspace/session view with an in-memory key, so re-renders do not spam audit history.
- Payload is limited to axis id, axis label, score, grade, stale reason, and the existing privacy marker.
- The telemetry excludes action labels, target widgets, prompt text, command text, file paths, and user input.
- Moved the project-empty return below the stale telemetry hook so React hook order remains stable.
- Added source-contract coverage for stale telemetry derivation, deduplication, payload shape, and privacy exclusions.

Validation:

- `pnpm exec biome check --write src\App.tsx src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Stale rows now emit safe telemetry. The next pass should add a small stale-count summary to the Score loop header so unresolved history is obvious before scanning individual rows.

### Phase 1.38 - Edge Feedback Stale Count Summary

Status: done

Implemented:

- Added a compact `Stale n` badge to the Score loop header.
- The badge appears only when `rightRailEdgeFeedbackStaleEntries.length > 0`.
- Count is derived from the same current score-model resolution used by stale row disabling and stale telemetry.
- Added styling for the badge, including Sakura tone compatibility.
- Added source-contract coverage for the badge selector and count expression.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Stale count is now visible in the header. The next pass should add a small filter/toggle so users can isolate stale entries when the loop contains mixed healthy and stale rows.

### Phase 1.39 - Edge Feedback Stale Filter

Status: done

Implemented:

- Added a local `Stale only` / `All` toggle in the Score loop header.
- The toggle appears only when stale entries exist.
- Stale-only mode filters the rendered list through `rightRailEdgeFeedbackVisibleHistory` without modifying persisted feedback history.
- The filter automatically resets to `All` when no stale entries remain.
- Added styling for the filter control, active state, and Sakura tone compatibility.
- Added source-contract coverage for local state, visible-history filtering, reset behavior, toggle rendering, and non-persistence of the filter.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Stale-only filtering is now local and non-destructive. The next pass should add a compact per-axis stale grouping so repeated stale entries from the same removed axis collapse into one readable cluster.

### Phase 1.40 - Edge Feedback Stale Grouping

Status: done

Implemented:

- Added per-axis stale grouping for repeated stale Score loop entries.
- Groups appear only when `Stale only` mode is active and at least two stale entries share the same removed axis.
- Grouping is derived from in-memory visible state and does not mutate persisted feedback history.
- Replay behavior remains row-level; stale rows stay disabled and explanatory.
- Memoized stale-entry, stale-id, visible-history, and stale-group derivation to reduce right-rail churn during rerenders.
- Added source-contract coverage for the group type, helper, stale-only gate, group container, axis ids, counts, reasons, and memoized derivation.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- Stale groups are now readable in stale-only mode. The next pass should tighten accessibility for Score loop controls so count, filter, grouping, and reset feedback are consistently announced.

### Phase 1.41 - Edge Feedback Control Accessibility

Status: done

Implemented:

- Added a screen-reader-only stale count label while keeping the compact visual badge.
- Added explicit filter button labels for `All` and `Stale only` states, including the stale entry count.
- Added grouped stale summary labels that announce the number of repeated stale axes.
- Changed stale groups to semantic `fieldset` / `legend` markup instead of generic `div` labeling.
- Added source-contract coverage for stale count labels, filter labels, grouped summary labels, semantic group markup, and count text.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`

Residual:

- Score loop controls now have stronger accessibility semantics. The next pass should add keyboard flow coverage around filter/reset interactions so this does not regress when the right rail is refactored.

### Phase 1.42 - Edge Feedback Keyboard Flow Coverage

Status: done

Implemented:

- Added stable ids for the Score loop history list and stale-count description.
- Connected `Stale only` / `All` to the controlled list with `aria-controls`.
- Connected the stale filter to the hidden stale-count description with `aria-describedby`.
- Connected `Clear` to the same controlled history list.
- Kept stale replay rows disabled when unresolved, so keyboard focus naturally skips non-actionable stale rows.
- Added source-contract coverage for the ids, `aria-controls`, `aria-describedby`, and keyboard-addressable button semantics.

Validation:

- `pnpm exec biome check --write src\App.tsx src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`

Residual:

- Score loop keyboard semantics are now stronger at source-contract level. The next pass should add a focused runtime smoke for the Score loop once a CDP-capable Tauri/WebView2 session is available.

### Phase 1.43 - Right Rail Scroll Restoration

Status: done

Implemented:

- Restored vertical scrolling on the full right rail content surface.
- Changed `.right-panel-content` from clipped overflow to `overflow-y: auto` with stable scrollbar gutter and contained overscroll.
- Changed `.right-panel-stack` from an internal scroll trap to a visible auto-height section so wheel input anywhere in the rail can move the rail.
- Added regression coverage that the whole right rail owns vertical scrolling and that the nested stack no longer steals it.

Validation:

- `pnpm exec biome check --write src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- Browser verification on `http://localhost:1420/?aetherVisualQa=1&projectPath=C%3A%2FUsers%2Fowner%2FAether_Terminal&rail=command&v=right-rail-scroll-fix`
- Browser metrics: `.right-panel-content` computed `overflowY=auto`, `scrollHeight > clientHeight`, wheel scroll moved `scrollTop` from `0` to `420`.

Residual:

- Right rail scroll is restored. The next pass should turn this manual browser check into a reusable smoke script so future rail layout changes fail automatically.

### Phase 1.44 - Edge Feedback Runtime Smoke Harness

Status: done

Implemented:

- Added `scripts/verify-right-rail-edge-feedback.mjs`, a repeatable localhost browser smoke for the right-rail Edge score loop.
- Added `pnpm verify:right-rail-edge` so the smoke can run without a release build or WebView2 CDP.
- The smoke seeds a privacy-safe `edgeLoop` payload with current and legacy axes, then verifies stale count, stale-only filtering, stale group rendering, disabled stale replay rows, clear/reset behavior, URL cleanup, localStorage cleanup, and rail scrolling.
- Fixed the underlying stale-history compatibility gap: unknown but safe legacy axis ids are now preserved instead of being discarded by sanitize, while labels are bounded and cleaned.
- Added source-contract coverage for the smoke script, package command, unknown-axis preservation, and legacy-axis label sanitization.

Validation:

- `node --check scripts\verify-right-rail-edge-feedback.mjs`
- `pnpm exec biome check --write src\App.tsx src\__tests__\AppSilentBugs.test.ts scripts\verify-right-rail-edge-feedback.mjs package.json`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:right-rail-edge`
- Evidence artifact: `.codex-auto/production-smoke/right-rail-edge-feedback.json`

Residual:

- Edge feedback now has repeatable runtime coverage. The next larger pass should consolidate all right-rail smokes into a single fast command so release gating does not depend on remembering separate scripts.

### Phase 1.45 - Right Rail Smoke Suite Aggregator

Status: done

Implemented:

- Added `scripts/verify-right-rail-suite.mjs`, a fast right-rail smoke-suite aggregator.
- Added `pnpm verify:right-rail` as the single command for right-rail smoke evidence.
- The suite always runs the localhost Edge feedback smoke.
- The suite probes the configured WebView2 CDP endpoint and runs the CDP-dependent decision, preference, negative-path, and audit-jump smokes only when reachable.
- When CDP is unavailable, the suite records those checks as explicit `skipped` entries with the endpoint/probe reason instead of failing with an ambiguous connection error.
- Added source-contract coverage for the suite command, localhost smoke, CDP smoke list, and explicit skip behavior.

Validation:

- `node --check scripts\verify-right-rail-suite.mjs`
- `pnpm exec biome check --write scripts\verify-right-rail-suite.mjs src\__tests__\AppSilentBugs.test.ts package.json`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:right-rail`
- Evidence artifact: `.codex-auto/production-smoke/right-rail-suite.json`

Residual:

- Right-rail smoke evidence is now consolidated. The next larger pass should connect this suite into the release quality scorer so right-rail evidence affects the product readiness score automatically.

### Phase 1.46 - Right Rail Quality Score Integration

Status: done

Implemented:

- Included `.codex-auto/production-smoke/right-rail-suite.json` in `scripts/score-release-quality.mjs`.
- Added a dedicated `right-rail-smoke` score item.
- Awarded full right-rail smoke credit when the localhost Edge feedback smoke passes and no right-rail smoke fails.
- Reported CDP-dependent checks as skipped in the score detail when CDP is unavailable.
- Added blocker output for missing or failing right-rail smoke-suite evidence.
- Added source-contract coverage that the quality scorer consumes the right-rail suite artifact and reports the smoke item.

Validation:

- `node --check scripts\score-release-quality.mjs`
- `pnpm exec biome check --write scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:quality-score`

Current Score Snapshot:

- Score: `81 / 106`
- Grade: `C`
- Right rail smoke: `6 / 6`
- Right rail action clarity: `8 / 8`
- Remaining blockers: accepted real-OS suspend/resume risk and missing real OS sleep/resume evidence.

Residual:

- Right-rail quality now contributes to readiness scoring. The next pass should attack the remaining release blockers outside the right rail, starting with real OS sleep/resume evidence or accepted risk closure.

### Phase 1.47 - Real OS Suspend Evidence Diagnostic Gate

Status: done

Implemented:

- Kept the real Windows sleep/resume release gate strict: the pass command still requires manual evidence, all post-resume checks, and Windows System power events.
- Added a diagnostic mode for the evidence file so the release blocker can be investigated without faking pass status.
- Added `pnpm verify:production:suspend:template` for safe template creation and `pnpm verify:production:suspend:diagnose` for repeatable missing-field and Windows-event diagnostics.
- The diagnostic writes `.codex-auto/production-smoke/real-os-suspend-resume.diagnostic.json` with missing fields, matched power events when timestamps exist, and concrete next steps.
- Source-contract coverage now verifies that diagnostic mode exists and that normal verification still requires `status: "pass"`.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs src\__tests__\AppSilentBugs.test.ts package.json`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:production:suspend:diagnose`

Residual:

- This does not claim real OS sleep/resume success. The remaining blocker requires one real Windows sleep/resume cycle, filling the evidence checks, and then running `pnpm verify:production:suspend`.

### Phase 1.48 - Real OS Suspend Score Diagnostics

Status: done

Implemented:

- Connected `.codex-auto/production-smoke/real-os-suspend-resume.diagnostic.json` into `scripts/score-release-quality.mjs`.
- The quality score now reports the real sleep/resume diagnostic status, missing-field count, and whether Windows power events were queried/found.
- The real OS sleep/resume score still awards zero points until the strict pass evidence is present.
- Blocker output now includes the first missing fields from the diagnostic, making the release gap actionable instead of a generic `missing`.

Validation:

- `pnpm exec biome check --write scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:quality-score`

Current Score Snapshot:

- Score: `81 / 106`
- Grade: `C`
- Real OS soak detail: `incomplete; 8 missing; power events not queried`

Residual:

- The score is intentionally unchanged until a real Windows sleep/resume cycle has been captured and validated.

### Phase 1.49 - Risk Closure Suspend Diagnostics

Status: done

Implemented:

- Connected the real OS suspend diagnostic into `scripts/close-production-risks.mjs`.
- If strict suspend verification fails during production risk closure, the closure script now runs diagnostic mode and records the diagnostic artifact path, diagnostic status, and missing fields in `production-risk-acceptance.json`.
- The accepted sleep/resume risk still remains blocked unless injected chaos and real OS suspend evidence both pass.
- Added source-contract coverage so this diagnostic path cannot silently disappear from the release risk closure script.

Validation:

- `pnpm exec biome check --write scripts\close-production-risks.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`

Residual:

- Risk closure remains correctly blocked until real Windows sleep/resume evidence is captured.

### Phase 1.50 - Real OS Suspend Capture Session

Status: done

Implemented:

- Added a two-step real OS suspend capture flow:
  - `pnpm verify:production:suspend:begin`
  - put Windows to sleep and resume manually
  - `pnpm verify:production:suspend:resume`
- The begin step writes `.codex-auto/production-smoke/real-os-suspend-session.json` and creates the evidence template if it is missing.
- The resume step fills `suspendedAt`, `resumedAt`, duration, and host machine metadata into `.codex-auto/production-smoke/real-os-suspend-resume.json`, then runs diagnostic mode.
- The resume step still leaves checks and pass status under strict verification control, so timestamps are captured without falsely approving the release gate.
- Added source-contract coverage for the begin/resume package scripts and capture-session implementation.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs src\__tests__\AppSilentBugs.test.ts package.json`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`

Residual:

- The host still needs one real Windows sleep/resume cycle to produce passing event-log evidence.

### Phase 1.51 - Suspend Evidence Version Freshness Gate

Status: done

Implemented:

- The real OS suspend evidence template now reads the app version from `package.json` instead of carrying a hard-coded version.
- Strict verification now fails if `evidence.app.version` does not match the current package version.
- Diagnostic mode reports the version mismatch as a missing field, so stale evidence cannot silently satisfy a newer release.
- Added source-contract coverage for package-version loading and the version freshness gate.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`

Residual:

- The gate now prevents stale-version evidence, but it still needs a real OS sleep/resume run for pass status.

### Phase 1.52 - Production Gate Suspend Fail-Fast

Status: done

Implemented:

- Added real OS sleep/resume diagnostic and strict evidence verification directly into `scripts/verify-production-release-gate.mjs` before production risk closure.
- Production release validation now fails early on missing real OS suspend evidence instead of waiting until the later risk-closure phase.
- Updated the operational runbook to use the new `template`, `begin`, `resume`, `diagnose`, and strict verification flow.
- Added source-contract coverage that the production gate runs suspend diagnostic and strict evidence before production risk closure.

Validation:

- `node --check scripts\verify-production-release-gate.mjs`
- `pnpm exec biome check --write scripts\verify-production-release-gate.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`

Residual:

- The production gate is now stricter and faster to fail, but pass still requires the real Windows sleep/resume event-log evidence.

### Phase 1.53 - Suspend Evidence Binary Identity Gate

Status: done

Implemented:

- The real OS suspend evidence template now resolves `src-tauri/target/release/Aether.exe` from the current repository root instead of hard-coding a user-specific absolute path.
- Evidence now records the release executable identity: path, byte size, modified timestamp, and SHA-256.
- Resume capture refreshes the executable identity so the evidence reflects the binary that was actually present for the soak run.
- Strict verification now fails when the executable is missing, too small to be a release build, or when `app.sha256` does not match the current executable.
- Diagnostic output includes `validation.appExecutable`, so quality scoring and release triage can see whether the soak was tied to a real release binary.
- The quality score detail now includes whether the suspend diagnostic saw a release executable.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:production:suspend:diagnose`
- `pnpm verify:quality-score`

Residual:

- Binary identity is now gated, but the remaining pass blocker is still the real Windows sleep/resume cycle and post-resume checks.

### Phase 1.54 - Suspend Evidence Binary Refresh Command

Status: done

Implemented:

- Added `pnpm verify:production:suspend:refresh-app` for updating only the release executable identity in the suspend evidence.
- The refresh command stamps the current package version, executable path, size, modified timestamp, and SHA-256, then runs diagnostic mode.
- If an already-passing evidence file is refreshed against a changed binary, the command resets status back to `pending` so stale pass evidence cannot survive a binary change.
- Updated the operational runbook to include the refresh step before the sleep/resume capture.
- Added source-contract coverage for the package script and refresh implementation.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs src\__tests__\AppSilentBugs.test.ts package.json docs\AI_WORKSTATION_98_OPERATIONAL_RUNBOOKS.md`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`

Residual:

- Refresh fixes binary identity drift; real Windows sleep/resume evidence is still required for pass.

### Phase 1.55 - Suspend Evidence Pass Invalidation

Status: done

Implemented:

- Tightened pass-state invalidation for real OS suspend evidence.
- `refresh-app` now preserves `pass` only when package version, executable hash, size, and modified timestamp are unchanged.
- `refresh-app` resets evidence to `pending` when the release binary identity changed.
- `resume` capture now always resets evidence to `pending` because new sleep/resume timestamps require fresh strict verification.
- `resume` capture clears prior Windows power-event validation so old event-log matches cannot survive a new soak window.
- Added source-contract coverage for binary identity change detection and pass invalidation.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:production:suspend:refresh-app`

Residual:

- Pass invalidation is stricter now; final release still needs the real Windows sleep/resume run.

### Phase 1.56 - Suspend Diagnostic Freshness Scoring

Status: done

Implemented:

- The release quality scorer now tracks the suspend evidence path and diagnostic path separately.
- Real OS suspend score detail now marks the diagnostic as `fresh` or `stale`.
- The diagnostic is considered fresh only when it is newer than both the suspend evidence and the current release executable.
- A stale diagnostic now becomes an explicit `real-os-soak` blocker telling the operator to rerun `pnpm verify:production:suspend:diagnose`.
- Added source-contract coverage for diagnostic freshness scoring and stale diagnostic blocker text.

Validation:

- `node --check scripts\score-release-quality.mjs`
- `pnpm exec biome check --write scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:quality-score`

Residual:

- Score reporting is now freshness-aware; pass still requires real Windows sleep/resume evidence.

### Phase 1.57 - Suspend Post-Resume Probe Capture

Status: done

Implemented:

- Added `pnpm verify:production:suspend:postcheck` for capturing non-mutating post-resume probes into the suspend evidence.
- The postcheck records current release executable identity, matching `Aether.exe` process presence, and PTY API `/health` reachability.
- Postcheck evidence is stored under `validation.postResumeProbes` and mirrored into diagnostic output.
- The command deliberately does not set strict checks to `true`; it only reduces triage ambiguity before the operator confirms app responsiveness, terminal responsiveness, SQLite write, and pane preservation.
- Running postcheck resets a previously passing evidence file back to `pending`, preventing a new probe from accidentally preserving old release approval.
- Updated the operational runbook with the postcheck step.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs src\__tests__\AppSilentBugs.test.ts package.json docs\AI_WORKSTATION_98_OPERATIONAL_RUNBOOKS.md`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`

Residual:

- Postcheck is supportive evidence, not final release proof. The strict pass still requires real sleep/resume timestamps, Windows power events, and confirmed post-resume checks.

### Phase 1.58 - Suspend Postcheck Score Visibility

Status: done

Implemented:

- Added post-resume probe status to the release quality score detail.
- Real OS soak detail now reports whether the matching Aether process and PTY API health probe are up or down.
- Missing or failing postcheck probes now appear as explicit `real-os-soak` blockers.
- Diagnostic next steps now tell the operator to run postcheck, launch the release app, or restore PTY API health when those probes are missing or failing.
- Added source-contract coverage for postcheck score detail, probe blockers, and diagnostic next-step copy.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:production:suspend:diagnose`
- `pnpm verify:quality-score`

Residual:

- The score now exposes failing app/API probes, but final pass still requires a real Windows sleep/resume cycle with all strict checks confirmed.

### Phase 1.59 - Suspend Terminal Roundtrip Postcheck

Status: done

Implemented:

- Extended `pnpm verify:production:suspend:postcheck` with an actual PTY terminal roundtrip through the release `aetherctl.exe`.
- Postcheck now creates a temporary PowerShell session, sends a unique `AETHER_POST_RESUME_TERMINAL_OK_*` marker, captures output, checks for the marker, and closes the session.
- Postcheck now machine-verifies and writes `checks.appResponsive` when the matching Aether process and PTY API health probe are both up.
- Postcheck now machine-verifies and writes `checks.terminalResponsive` when the terminal roundtrip succeeds.
- SQLite write and pane preservation remain strict/manual because the current probe cannot prove them without mutating or inspecting app-specific state more deeply.
- Quality score detail now includes terminal probe state, and failing terminal roundtrip is reported as an explicit blocker.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:production:suspend:postcheck`
- `pnpm verify:quality-score`

Residual:

- App and terminal responsiveness can now be machine-verified. Remaining strict checks are real Windows sleep/resume power events, SQLite write confirmation, and pane-state preservation.

### Phase 1.60 - Modern Standby Power Event Support

Status: done

Implemented:

- Expanded real OS suspend evidence validation beyond classic S3 event IDs.
- The verifier now queries Windows System event IDs `1`, `42`, `107`, `187`, `506`, and `507`.
- Strict suspend evidence accepts classic suspend event `42` or Modern Standby enter event `506`.
- Strict resume evidence accepts `1`, `107`, or Modern Standby exit event `507`.
- Event `187` is recorded as an attempted suspend signal but does not satisfy pass criteria by itself.
- Added source-contract coverage for the Modern Standby event query and classification.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:production:suspend:diagnose`

Observed Host State:

- `powercfg /a` reports S0 Modern Standby only; S1/S2/S3 hibernate paths are unavailable.
- Programmatic suspend attempts emitted Kernel-Power event `187`, but no `42/506` enter event and no `1/107/507` resume event, so strict real sleep/resume evidence remains incomplete.

Residual:

- A real user-initiated Modern Standby cycle is still required for event-log proof.

### Phase 1.61 - Suspend SQLite Pane Layout Postcheck

Status: done

Implemented:

- Added an `aetherctl db-smoke` command that writes, reads, compares, and deletes a pane-tree layout row in the production SQLite database.
- Extended `pnpm verify:production:suspend:postcheck` to run the SQLite pane-layout smoke after resume.
- Postcheck now machine-verifies `checks.sqliteWritable` and `checks.paneStatePreserved` when the DB roundtrip preserves the layout JSON exactly.
- The postcheck falls back to `cargo run --bin aetherctl -- db-smoke` when the release `aetherctl.exe` is older than the current source, so local validation is not blocked by a heavy distribution build.
- Release quality scoring now reports DB probe state and adds a dedicated blocker when pane-layout persistence is failing.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `node --check scripts\score-release-quality.mjs`
- `cargo run --manifest-path src-tauri\Cargo.toml --bin aetherctl -- db-smoke`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:production:suspend:postcheck`
- `pnpm verify:production:suspend:diagnose`
- `pnpm verify:quality-score`

Residual:

- App, terminal, SQLite, and pane-layout recovery can now be machine-verified after resume. The remaining release blocker is real Windows sleep/resume event-log proof on this S0 Modern Standby host.

### Phase 1.62 - Sleep Capability Diagnostic Evidence

Status: done

Implemented:

- Real OS suspend diagnostics now capture `powercfg /a` and `powercfg /requests` output.
- Diagnostic evidence now records available sleep states, whether S0 Modern Standby is available, whether S3 appears available, and whether active power requests may block sleep.
- If only Kernel-Power attempted-suspend event `187` is present on an S0 host, diagnostics now explain that a user-initiated Windows Sleep cycle is still required.
- Release quality score detail now includes the detected sleep capability state alongside the post-resume probe state.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:production:suspend:diagnose`
- `pnpm verify:quality-score`

Residual:

- Diagnostics now explain the host sleep mode and blockers, but strict pass still requires actual Windows sleep/resume events `42/506` and `1/107/507`.

### Phase 1.63 - Release Aetherctl Postcheck Proof

Status: done

Implemented:

- Rebuilt the release `aetherctl.exe` binary only, without running the heavy installer/distribution build.
- Re-ran post-resume evidence capture so SQLite pane-layout smoke now runs through `release-aetherctl db-smoke` instead of the source fallback.
- Release quality score detail now shows which tool executed the DB/pane probe, making source fallback versus release-binary proof visible.

Validation:

- `cargo build --manifest-path src-tauri\Cargo.toml --release --bin aetherctl`
- `pnpm verify:production:suspend:postcheck`
- `pnpm verify:production:suspend:diagnose`
- `pnpm verify:quality-score`

Residual:

- Release postcheck proof is stronger now. The remaining release blocker is still the missing real Windows sleep/resume event-log proof.

### Phase 1.64 - Right Rail Smoke Strictness

Status: done

Implemented:

- Added strict right-rail smoke mode via `pnpm verify:right-rail:strict`.
- `verify-right-rail-suite` can now fail CDP/WebView2-dependent checks when `AETHER_RIGHT_RAIL_REQUIRE_CDP=1` instead of quietly marking them skipped.
- Release quality scoring no longer grants full right-rail smoke points when CDP/WebView2 checks are skipped.
- Skipped right-rail CDP checks are now explicit score blockers, so the right rail cannot look fully verified without live native WebView2 evidence.

Validation:

- `node --check scripts\verify-right-rail-suite.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm exec biome check --write scripts\verify-right-rail-suite.mjs scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts package.json`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:quality-score`
- `AETHER_RIGHT_RAIL_SUITE_OUT=.codex-auto/production-smoke/right-rail-suite-strict-dryrun.json pnpm verify:right-rail:strict` expectedly fails without CDP

Residual:

- Full right-rail smoke score now requires running the live Tauri/WebView2 CDP harness instead of relying on skipped checks.

### Phase 1.65 - Terminal Empty Paste Guard

Status: done

Implemented:

- The canvas terminal input path now swallows empty or non-text paste events before they can reach an AI CLI.
- The guard records an IME/input diagnostic event with `reason: empty-or-non-text-paste-ignored` instead of silently falling through.
- This keeps image attachment handling scoped to the lower IME input bar while preventing no-op clipboard events from leaking into Codex/Claude/Gemini CLI input handling.
- Removed a redundant IME positioning hook dependency caught by Biome during the pass.

Validation:

- `pnpm exec biome check --write src\features\terminal\hooks\useCanvasIME.ts src\__tests__\useCanvasIME.test.ts`
- `pnpm vitest run src\__tests__\useCanvasIME.test.ts src\__tests__\TerminalCanvasInput.test.tsx src\__tests__\NativeTerminalArea.test.tsx src\__tests__\IMEInputBar.test.tsx --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- The screenshot text is emitted by the AI CLI, not by Aether. This guard reduces Aether-originated leakage, but a CLI-native image-paste keybinding can still print its own error when triggered inside the CLI.

### Phase 1.66 - Terminal Core Edge Readiness Scoring

Status: done

Implemented:

- Added a dedicated `terminal-core-edge` score axis to the release quality scorer.
- The scorer now checks for native terminal-engine signals: no xterm dependency, `alacritty_terminal`, `NativeTerminalRegistry`, `TerminalCanvas`, empty/non-text paste guard, native IME positioning IPC, scrollback evidence, IME evidence, and terminal roundtrip evidence.
- The scorer now exposes remaining terminal-core boundary risks instead of hiding them inside the generic IME score.
- Current explicit blockers include the WebView hidden-textarea IME bridge, WebView clipboard image ingestion, and incomplete native WebView2/CDP evidence.

Validation:

- `node --check scripts\score-release-quality.mjs`
- `pnpm exec biome check --write scripts\score-release-quality.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:quality-score`

Residual:

- The score now makes the terminal-core risk honest. Reaching edge-level quality still means removing the WebView hidden-textarea and navigator clipboard bridges from the terminal input core.

### Phase 1.67 - Native Clipboard Image Intake

Status: done

Implemented:

- Added `save_clipboard_image` Tauri IPC on Windows, reading `CF_DIBV5` / `CF_DIB` directly from Win32 clipboard and writing a temp BMP attachment.
- The explicit clipboard-image button in the terminal IME bar now uses the native IPC path instead of WebView `navigator.clipboard.read`.
- Kept paste-event image handling for browser-delivered `DataTransfer` files, but removed the button path's async Web Clipboard dependency.
- Added DIB-to-BMP unit coverage for standard, palette, and bitfield offsets.
- Release quality scoring now recognizes the native clipboard command and no longer lists WebView clipboard image ingestion as a terminal-core blocker.

Validation:

- `cargo check --manifest-path src-tauri\Cargo.toml`
- `cargo test --manifest-path src-tauri\Cargo.toml --lib clipboard_dib -- --nocapture`
- `pnpm vitest run src\__tests__\IMEInputBar.test.tsx src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:quality-score`

Residual:

- Terminal core score improved to 77/116 overall and 6/10 for `terminal-core-edge`.
- Remaining terminal boundary risks are the WebView hidden-textarea IME bridge and incomplete live native WebView2/CDP evidence.

### Phase 1.68 - IME Diagnostics Overlay Control

Status: done

Implemented:

- Added an in-overlay close button for the opt-in input diagnostics panel so debug UI cannot remain stuck over split panes.
- Closing the panel clears the overlay localStorage flag and immediately unmounts the overlay.
- Restored pointer-event handling only on the diagnostics panel, not on decorative terminal layers.

Validation:

- `pnpm exec biome check --write src\features\terminal\NativeTerminalArea.tsx src\features\terminal\TerminalArea.module.css src\__tests__\NativeTerminalArea.test.tsx`
- `pnpm vitest run src\__tests__\NativeTerminalArea.test.tsx --reporter=dot`

Residual:

- This removes the visible debug-panel UX footgun. It does not replace the remaining WebView IME proxy; that still needs the full native terminal input surface milestone.

### Phase 1.69 - Terminal Bell And Cursor Calm-Down

Status: done

Implemented:

- Stopped the canvas terminal cursor from blinking. It now renders solid to avoid the bright prompt-row strobe seen in AI CLI sessions.
- Changed the native terminal cursor color from Catppuccin mauve to a neutral foreground tint, removing the obvious pink flash.
- Fixed terminal bell detection so OSC control-sequence terminators such as `ESC ] 133 ; ... BEL` do not emit user-facing `terminal:bell` events.
- The bell filter tracks OSC state across split PTY chunks, so prompt marks split over multiple reads do not create fake bell notifications.
- Native OS terminal bell notifications are now opt-in via `localStorage["aether:terminalBellNotifications"]`, with a 30s per-terminal throttle when enabled.

Validation:

- `pnpm vitest run src\__tests__\TerminalCanvas.test.tsx src\__tests__\TerminalCanvasInput.test.tsx src\__tests__\NativeTerminalArea.test.tsx --reporter=dot`
- `cargo test --manifest-path src-tauri\Cargo.toml --lib bell_filter -- --nocapture`
- `cargo check --manifest-path src-tauri\Cargo.toml`

Residual:

- This removes the visible flicker and the most likely source of repeated PowerShell/Aether bottom-right bell popups. The remaining deeper risk is still the WebView-backed IME input bridge.

### Phase 1.70 - Native Terminal Clipboard Text

Status: done

Implemented:

- Added `read_clipboard_text` and `write_clipboard_text` Tauri IPC commands using Win32 `CF_UNICODETEXT`.
- Terminal selection copy now prefers native clipboard IPC and only falls back to browser clipboard APIs if native IPC is unavailable.
- Selection-aware `Ctrl+C` now copies selected terminal text; without a selection it still sends `^C` to the PTY.
- `Ctrl+V`, `Ctrl+Shift+V`, and `Shift+Insert` now read native clipboard text and paste normalized terminal input instead of sending literal `^V`.
- Existing paste risk guards still run for clipboard-shortcut pastes.

Validation:

- `cargo check --manifest-path src-tauri\Cargo.toml`
- `pnpm vitest run src\__tests__\TerminalCanvasInput.test.tsx src\__tests__\useTerminalSelection.test.tsx src\__tests__\NativeTerminalArea.test.tsx --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:quality-score`

Residual:

- Text copy/paste no longer depends on WebView clipboard permissions for the primary path. The remaining terminal risk is still the hidden textarea IME bridge.

### Phase 1.71 - Terminal Context Clipboard

Status: done

Implemented:

- Added terminal canvas context-menu handling for the clipboard path.
- Right-click with a terminal selection copies the selected range through the same native-first clipboard writer as `Ctrl+C`.
- Right-click without a selection reads native clipboard text and pastes through the guarded terminal paste pipeline.
- The context-menu paste path reuses the existing paste risk checks and line-ending normalization.

Validation:

- `pnpm exec biome check --write src\features\terminal\TerminalCanvas.tsx src\features\terminal\hooks\useCanvasIME.ts src\__tests__\TerminalCanvasInput.test.tsx src\__tests__\useTerminalSelection.test.tsx`
- `pnpm vitest run src\__tests__\TerminalCanvasInput.test.tsx src\__tests__\useTerminalSelection.test.tsx --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- This closes the obvious terminal right-click copy/paste UX gap. It still does not remove the WebView hidden-textarea IME boundary; that remains the largest terminal-core risk.

### Phase 1.72 - Right Rail Strict WebView2 Smoke Evidence

Status: done

Implemented:

- Started the Tauri app with WebView2 remote debugging on `127.0.0.1:9222` using hidden process launch so no foreground console window is shown.
- Ran the consolidated right-rail smoke suite in strict mode, where unavailable CDP/WebView2 evidence fails instead of being recorded as skipped.
- Confirmed all right-rail runtime smokes passed:
  - Edge feedback
  - Decisions
  - Preferences
  - Negative path
  - Audit jump
- Refreshed the release quality score after the strict smoke evidence.

Validation:

- `pnpm verify:right-rail:strict`
- `pnpm verify:quality-score`

Score impact:

- Overall score moved from `77/116` to `81/116`.
- `terminal-core-edge` moved from `6/10` to `8/10` because native WebView2/CDP evidence is no longer incomplete.
- `right-rail-smoke` moved from `3/6` to `6/6`; no right-rail smoke checks are skipped.

Residual:

- The score still is not release-candidate ready. Remaining blockers are the WebView hidden-textarea IME boundary and the missing real Windows sleep/resume power-event proof.

### Phase 1.73 - Real OS Sleep/Resume Evidence Hardening

Status: done

Implemented:

- Tightened real Windows sleep/resume evidence validation so `System` log event IDs are no longer trusted without their expected provider.
- Suspend proof now only accepts:
  - `Microsoft-Windows-Kernel-Power` event `42`
  - `Microsoft-Windows-Kernel-Power` Modern Standby event `506`
- Resume proof now only accepts:
  - `Microsoft-Windows-Power-Troubleshooter` event `1`
  - `Microsoft-Windows-Kernel-Power` event `107`
  - `Microsoft-Windows-Kernel-Power` Modern Standby event `507`
- Attempted suspend is still tracked as `Microsoft-Windows-Kernel-Power` event `187`, but it cannot satisfy strict pass.
- Diagnostic output now records `rawEventCount` separately from provider-matched power events, preventing unrelated driver/service `Id=1` or `Id=107` rows from creating false release confidence.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:production:suspend:diagnose`

Residual:

- This improves evidence integrity but does not create the missing real sleep/resume proof. Current diagnostic still reports `pending` status and no matching `42/506` plus `1/107/507` events inside the captured evidence window.

### Phase 1.74 - IME Candidate Immediate Composition Reanchor

Status: done

Implemented:

- Reduced a likely Codex/Claude IME candidate lag source by re-anchoring the native IMM candidate position directly from the `compositionupdate` event payload.
- The previous path could wait for React composition state to rerender before `set_ime_position` received the current preedit width.
- The terminal now computes the live composition cell span immediately in the hook and pushes the updated candidate coordinates in the same event tick.
- `input` events that are still composing use the same immediate offset path.

Validation:

- `pnpm exec biome check --write src\features\terminal\hooks\useCanvasIME.ts src\__tests__\useCanvasIME.test.ts`
- `pnpm vitest run src\__tests__\useCanvasIME.test.ts --reporter=dot`
- `pnpm vitest run src\__tests__\TerminalCanvasInput.test.tsx src\__tests__\NativeTerminalArea.test.tsx --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- This narrows the visible IME position drift window, but it still does not eliminate the WebView hidden-textarea architecture boundary. Full removal still requires the native terminal input surface milestone.

### Phase 1.75 - WebView2 Focus HWND IME Fix

Status: done

Implemented:

- Fixed the native `set_ime_position` command to query GUI focus from the Tauri/WebView window's UI thread instead of using `GetGUIThreadInfo(0)`.
- This matters because IMM coordinates are relative to the focused child HWND. WebView2 keeps text focus on a child window; resolving focus from the wrong thread can fall back to the top-level Tauri HWND and shift Japanese candidate windows under DPI/custom-chrome layouts.
- The command now calls `GetWindowThreadProcessId(hwnd, None)` and passes that thread id into `GetGUIThreadInfo`.
- The safety fallback remains: if the focused HWND is not the main window or its child, Aether still uses the top-level HWND.

Validation:

- `cargo check --manifest-path src-tauri\Cargo.toml`
- `cargo test --manifest-path src-tauri\Cargo.toml --lib ime_ -- --nocapture`

Residual:

- This improves native IME anchoring inside the current WebView2 architecture. It still does not remove the hidden textarea dependency; that is the next large native-input milestone.

### Phase 1.76 - Live IME Evidence After HWND Fix

Status: done

Implemented:

- Re-ran the native WebView2/CDP IME smoke after the `GetWindowThreadProcessId` focus-HWND fix.
- First Tauri dev launch hit a transient Windows linker lock (`LNK1114`) on the debug import library; Aether dev processes were stopped, the stale import library was removed, and the app was relaunched successfully.
- Refreshed `.codex-auto/production-smoke/verify-ime.json` with current live evidence.

Validation:

- `pnpm verify:ime`

Live checks passed:

- IMEInputBar DOM and composition lifecycle.
- Bar submit to PTY.
- Canvas overlay composition.
- Geometry, DPI, and resize containment.
- Long Japanese preedit regression.
- Blur, delete, and paste while composing.
- Direct overlay paste with LF converted to terminal Enter.

Residual:

- Current WebView2 IME behavior is live-verified after the native HWND fix. The architectural blocker remains: IME still depends on the WebView hidden textarea bridge instead of a fully native terminal input surface.

### Phase 1.77 - AI CLI IME Anchor Lock

Status: done

Implemented:

- Reduced the Codex/Claude-specific Japanese IME drift risk where an AI CLI status repaint can move the terminal cursor while composition is still active.
- Terminal composition now captures the IME cursor at composition start and keeps using that anchor until the composition commits, cancels, or resets.
- The hidden textarea, native IMM candidate position, and visible composition overlay now share the locked composition cursor instead of following prompt/status cursor churn mid-preedit.
- Added regression coverage for an AI CLI-style status repaint that moves the terminal cursor to another row while Japanese composition is active.

Validation:

- `pnpm exec biome check --write src\features\terminal\hooks\useCanvasIME.ts src\features\terminal\TerminalCanvas.tsx src\__tests__\TerminalCanvasInput.test.tsx`
- `pnpm vitest run src\__tests__\TerminalCanvasInput.test.tsx --reporter=dot`
- `pnpm vitest run src\__tests__\useCanvasIME.test.ts src\__tests__\NativeTerminalArea.test.tsx --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`

Residual:

- This removes another WebView/AI-CLI race inside the current architecture. It is still a mitigation, not the final full-native terminal input surface.

### Phase 1.78 - Right Rail Scroll Constraint Hardening

Status: done

Implemented:

- Hardened the right rail layout so the scrollable content owns a real constrained height in Tauri/WebView flex layout.
- `.right-panel` is now a column flex container with `min-height: 0`; `.right-panel-content` is `flex: 1 1 auto` with `min-height: 0` and keeps `overflow-y: auto`.
- This removes the parent/child height ambiguity that could make the right rail appear stuck even though the child had `overflow-y: auto`.
- Expanded the static regression contract so future CSS changes must preserve the scroll parent and child constraints.

Validation:

- `pnpm exec biome check --write src\styles\global.css src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\TerminalCanvasInput.test.tsx --reporter=dot`
- In-app browser/Vite visual check on `http://localhost:1420/?aetherVisualQa=1&projectPath=C%3A%2FUsers%2Fowner%2FAether_Terminal&rail=observe&state=blocked&v=rail-scroll-contract`

Browser metrics:

- `.right-panel-content`: `overflow-y: auto`, `flex: 1 1 auto`, `min-height: 0px`.
- `.right-panel`: `display: flex`, `flex-direction: column`, `min-height: 0px`.
- Scroll surface measured `clientHeight=598`, `scrollHeight=2259`, and moved from `scrollTop=0` to `scrollTop=720`.

Residual:

- The right rail scroll bug is covered by static and live browser evidence. The release score still stays blocked by native terminal input architecture and real OS suspend evidence.

### Phase 1.79 - Guarded Real OS Sleep Cycle Gate

Status: done

Implemented:

- Added `pnpm verify:production:suspend:cycle` for a single guarded Windows sleep/resume evidence flow.
- Wired the production release gate so `--sleep-cycle` or `AETHER_RELEASE_SLEEP_CYCLE=1` uses that guarded cycle instead of the older split diagnose/evidence pair.
- The cycle refreshes the release app identity, records begin time, invokes Windows sleep, records resume time, runs post-resume process/API/terminal/SQLite probes, then promotes the evidence to `pass` only if strict Windows power events are present.
- The command refuses to sleep unless `AETHER_ALLOW_OS_SLEEP=1` is set, and that guard now runs before any evidence/session file is touched.
- Programmatic attempted-suspend-only evidence still cannot pass; the strict validator still requires provider-matched suspend and resume events.

Validation:

- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `node --check scripts\verify-production-release-gate.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs package.json src\__tests__\AppSilentBugs.test.ts`
- `pnpm exec biome check --write scripts\verify-production-release-gate.mjs src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:production:suspend:cycle` without `AETHER_ALLOW_OS_SLEEP=1` exited `1` and left both evidence and session timestamps unchanged.

Residual:

- This removes operator-step ambiguity and prevents accidental false evidence. It does not itself create the missing real Windows sleep/resume proof; the host must actually enter and resume from a Windows sleep state with `AETHER_ALLOW_OS_SLEEP=1` for the score blocker to clear.

### Phase 1.80 - Real OS Sleep Cycle Noise Reduction

Status: done

Implemented:

- Ran the guarded production sleep/resume cycle against the release `Aether.exe`.
- Confirmed the host still records only `Microsoft-Windows-Kernel-Power:187` attempted-suspend events for the programmatic `SetSuspendState` path.
- Increased the guarded cycle default post-wake settle from 5s to 12s so the strict `>=10s` evidence bracket does not add a noisy duration failure on fast Modern Standby returns.

Validation:

- `Start-Process C:\Users\owner\Aether_Terminal\src-tauri\target\release\Aether.exe`
- `pnpm verify:production:suspend:refresh-app`
- `AETHER_ALLOW_OS_SLEEP=1 pnpm verify:production:suspend:cycle`
- `node --check scripts\verify-real-os-suspend-evidence.mjs`
- `pnpm exec biome check --write scripts\verify-real-os-suspend-evidence.mjs`

Residual:

- The real blocker is now isolated: this host's programmatic sleep path records attempted-suspend event `187` but not the required suspend `42/506` and resume `1/107/507` events. A user-initiated Windows Sleep cycle is still required to close `real-os-soak`.

### Phase 1.81 - Rust-Owned Terminal Input Commit Path

Status: done

Implemented:

- Added `NativeTerminalInputHost` as a managed Rust state object for the terminal input migration.
- Added `native_terminal_input_commit` and `native_terminal_input_status` IPC commands.
- `useCanvasIME` now routes committed terminal bytes through `native_terminal_input_commit` with source `webview-ime-bridge`, so committed input has a distinct Rust-owned control-plane path while the remaining WebView composition bridge is still honestly exposed.
- The host status explicitly reports `webview_composition_bridge_required: true` and `native_composition_surface_ready: false`, preventing a false claim that the hidden textarea architecture is gone.
- Added static and Rust regression coverage for the native input host contract.

Validation:

- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml default_status_is_honest_about_remaining_webview_bridge --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml record_commit_updates_active_terminal_and_count --lib`
- `pnpm vitest run src\__tests__\useCanvasIME.test.ts src\__tests__\TerminalCanvasInput.test.tsx --reporter=dot`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm verify:quality-score`

Residual:

- This is a migration step, not the final native IME surface. The release score correctly remains blocked until the WebView hidden textarea bridge is replaced by a real native composition/input surface and real Windows sleep/resume evidence passes.

### Phase 1.82 - Native Input Host Evidence Gate

Status: done

Implemented:

- Added `pnpm verify:terminal:native-input`.
- The verifier writes `.codex-auto/production-smoke/native-terminal-input-host.json` with separate checks for the Rust host, commit IPC, status IPC, frontend commit routing, and final native composition ownership.
- The check intentionally returns `blocked` while `TerminalCanvas` still owns `data-testid="terminal-ime-textarea"`, so the release score cannot be made green by renaming or hiding the remaining WebView composition bridge.
- `score-release-quality.mjs` now consumes the native input host evidence and keeps the terminal-core blocker tied to the failed composition-surface check.

Validation:

- `node --check scripts\verify-native-terminal-input-host.mjs`
- `node --check scripts\score-release-quality.mjs`
- `pnpm exec biome check --write scripts\verify-native-terminal-input-host.mjs scripts\score-release-quality.mjs package.json src\__tests__\AppSilentBugs.test.ts`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts --reporter=dot`
- `pnpm verify:terminal:native-input` returned `blocked` as expected with only `composition-surface` failing.
- `pnpm verify:quality-score`

Residual:

- The evidence gate is now stricter and clearer, but the product blocker remains: implement the native composition/input surface and remove the WebView hidden textarea from the terminal core path.

### Phase 1.83 - Native HWND Input Surface Scaffold

Status: done

Implemented:

- Extended the Rust native input host from a commit-only control path into a Windows HWND-backed input surface scaffold.
- Added `native_terminal_input_focus` and `native_terminal_input_drain` IPC commands.
- The Windows implementation creates an `EDIT` child HWND, positions it at the terminal caret, focuses it, tracks `WM_IME_STARTCOMPOSITION` / `WM_IME_ENDCOMPOSITION`, and drains committed text only when composition is not active.
- The native surface now intercepts non-composition `WM_KEYDOWN` terminal control keys before text draining, covering Enter, Backspace, Tab, Escape, arrows, Delete, Home, and End without routing those keys through the WebView textarea.
- Made the native HWND surface the default input owner in the Tauri runtime while keeping the WebView textarea as a conditional non-Tauri / emergency opt-out fallback.
- Updated `verify:terminal:native-input` so it now proves Rust host, commit IPC, status IPC, surface focus/drain IPC, native surface key routing, frontend native-default ownership, frontend commit routing, and frontend native-surface opt-in separately.

Validation:

- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml default_status_is_honest_about_remaining_webview_bridge --lib`
- `cargo test --manifest-path src-tauri/Cargo.toml record_commit_updates_active_terminal_and_count --lib`
- `pnpm exec tsc --noEmit --pretty false`
- `pnpm vitest run src\__tests__\AppSilentBugs.test.ts src\__tests__\useCanvasIME.test.ts src\__tests__\TerminalCanvasInput.test.tsx --reporter=dot`
- `pnpm verify:terminal:native-input`

Residual:

- The native HWND surface is now the Tauri default. The remaining release blocker moves to live dogfood evidence: Codex/Claude/Gemini Japanese input must be proven on the native surface before the old WebView fallback can be deleted rather than merely disabled by default.
