# Clauge-Inspired UI Refresh Final Goal

Date: 2026-05-26

## Final Goal

Aelyris's visible product shell must match the native-first hybrid product direction:

```text
Left Mode Rail -> Center Work Surface -> Right Contextual Inspector
```

This is not a request to copy Clauge's visual skin or broaden Aelyris into a REST/SQL/NoSQL/S3 super-app. The useful reference is the information architecture: one project window, explicit modes, workflow-specific AI surfaces, local-first state, MCP-ready workspace data, and a right inspector that explains the selected work instead of becoming a noisy dashboard.

The source-informed Clauge audit is tracked in:

- `docs/history/CLAUGE_SOURCE_AUDIT_GOOD_PARTS_2026-05-27.md`

That audit was written against a local clone of `ansxuman/Clauge` at commit
`1aceff9f014eb997ba5b21eabf93f23c0da2b71c`. The implementation target is
upper compatibility inside Aelyris's terminal-first domain, not code copying or
feature sprawl into every Clauge mode.

The UI refresh is complete only when a first-time user can answer these questions without documentation:

1. Which product mode am I in?
2. What is the active work surface?
3. What selected thing does the right side explain?
4. What is the next safe action?
5. Which data is Rust/native product truth and which surface is only compatibility UI?

## Non-Negotiable Boundaries

- Keep native-first hybrid as the release goal.
- Rust remains the product truth for terminal, PTY/mux/session, scrollback, command history, recovery/provenance, AI CLI orchestration, settings data, Command Center data, and terminal hot paths.
- React/Tauri may render non-hot-path UI only when it is contract-backed and does not own hidden terminal truth.
- Do not reintroduce "Mission Control" as product copy.
- Do not weaken IME, clipboard, pane split, shell launch, paste guard, or terminal performance while refreshing UI.
- Every visible action in the inspector must have a reason, target, expected outcome, and guardrail state.

## Phase 1: Visible Shell Recomposition

Goal: make the Clauge-style information architecture visible in the current Tauri/React shell without destabilizing terminal hot paths.

Implemented in this slice:

- Added an 8-mode left rail:
  - Terminal
  - Agents
  - Workspace
  - Review
  - Git
  - Context
  - History
  - Settings
- Added Alt+1 through Alt+8 mode shortcuts.
- Routed modes to the current right inspector, sidebar, history dialog, or settings dialog.
- Renamed the right side to `Contextual inspector` / `Inspector` in visible and accessible copy.
- Added Sakura-specific mode-rail styling so the shell does not inherit muddy gray treatment.

Exit criteria:

- `.mode-rail` is present in the app shell.
- All 8 product modes are visible and keyboard addressable.
- Right-side copy says Inspector, not Project tools or Mission Control.
- Mode routing is explicit in source and does not mutate terminal truth.

## Phase 2: Inspector Simplification

Goal: turn the right rail from "many panels" into a task-focused inspector.

Implemented in this slice:

- Add an inspector header with selected mode, selected target, owner, and primary action.
- Show proof status and the current route target before the run loop.
- Keep Sakura inspector surfaces white-peach instead of gray.

Remaining work:

- Reduce duplicated "Now", "Edge score", "Final goal", "Workforce", and action stack density into a clearer hierarchy.
- Keep advanced diagnostics collapsible and out of the default first-minute path.
- Ensure the whole rail scrolls, keyboard focus remains inside the visible target, and action results remain visible in-rail.

Exit criteria:

- The top 320px of the inspector answers: what is selected, why it matters, next safe action, and proof status.
- Every mode route lands on a visible target widget.
- No debug-only diagnostics appear unless visual QA/dev diagnostics are enabled.

## Phase 3: Theme And Customization QA

Goal: make every preset, especially Sakura, feel intentional and readable.

Planned work:

- Verify theme/preset switching clears old mood tokens.
- Verify Sakura surfaces are white-peach, not gray, where the user asked for less transparency.
- Keep terminal well readable while allowing high-transparency wallpaper/backdrop.
- Ensure settings exposes per-mood material color, opacity, wallpaper picker/path, wallpaper opacity, scale, and placement.
- Add visual QA for the mode rail, inspector, settings, status bars, and terminal chrome.

Exit criteria:

- Sakura does not bleed into other presets.
- Status bars and right inspector update on preset switch.
- Text contrast passes source-contract and browser checks across all presets.

## Phase 4: Terminal Trust Preservation

Goal: prove UI refresh did not regress the terminal, AI CLI, IME, or pane UX.

Required checks:

- `pnpm verify:terminal:native-input`
- `pnpm verify:terminal:native-boundary`
- `pnpm verify:native-first:audit`
- pane split/close smoke
- authenticated AI CLI prompt smoke when token-spend consent exists
- browser visual smoke for mode rail and inspector

Exit criteria:

- No command window flash is introduced by UI routing.
- Japanese IME positioning and AI CLI prompt row evidence remain current.
- Clipboard/paste guard remains native-first.

## Phase 5: Product Edge Upgrade

Goal: make Aelyris's edge stronger than "terminal plus panels."

Planned work:

- Purpose-pinned agent sessions with visible worktree/context/guardrail.
- Context pack previews from selected pane/session/file.
- Review queue that explains risk, evidence, changed files, and safe next action.
- Git/worktree actions tied to selected session and terminal provenance.
- History mode that searches command/session/action evidence.
- MCP-ready workspace actions remain Rust-owned.

Exit criteria:

- The inspector is useful in the first minute.
- Agents, review, Git, context, and history are connected to the running terminal state.
- The user can move from terminal command to agent run to review to handoff without guessing which panel matters.

## Confidence Definition

"100% confidence" is not a vague claim. For this UI refresh it means:

- all source-contract checks pass;
- TypeScript build passes;
- targeted frontend tests pass;
- native-first audit passes;
- browser visual QA proves the mode rail, inspector, settings, theme controls, and terminal remain visible and operable;
- any unperformed human-gated check, such as real Windows sleep/resume or authenticated token spend, is explicitly marked as a gated residual, not hidden as done.

## Current Status

- Phase 1 is implemented in the React/Tauri compatibility shell.
- Phase 2 has the inspector summary/header and right-rail preference sync implemented; old Mission Control wording remains out of the product copy.
- Phase 3 is implementation-complete for native-first confidence: theme customization, Sakura isolation, material opacity, wallpaper controls, and preset switching are covered by the current guard.
- Phase 4 is implementation-complete for native-first confidence: native client, native input, native HWND paste, AI CLI prompt-row dogfood, native boundary, and native-first audit are green.
- Phase 5 is implementation-complete for native-first confidence through the Rust/native Command Center, mode shell, inspector, right-rail demotion, and product-loop proofs.
- Native-first hybrid remains the release goal.
- Full-native Rust remains an optional stretch goal, not a release requirement.

Current implementation gate:

- `pnpm verify:native-first:audit`
- `pnpm verify:clauge-ui-refresh`
- `100/100`
- grade `S`
- `nativeFirstHybridReady=true`

Remaining release-operation gates, not UI-refresh implementation blockers:

- signed distribution artifacts and installer;
- actual Windows sleep/resume dogfood with explicit opt-in;
- clean-shutdown runtime hygiene after dev/CDP processes are closed;
- old release self-reference loop for `verify:final-goal-audit` and `verify:right-rail-goal-track-tauri`.
