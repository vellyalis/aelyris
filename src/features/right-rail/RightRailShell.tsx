import type { KeyboardEvent, ReactNode } from "react";

import { getNextRightRailMode, RIGHT_RAIL_MODES } from "./rightRailModel";
import type { RightRailShellActions, RightRailShellViewModel } from "./rightRailShellContract";

export interface RightRailShellProps {
  readonly viewModel: RightRailShellViewModel;
  readonly actions: RightRailShellActions;
  readonly children: ReactNode;
}

export function RightRailShell({ viewModel, actions, children }: RightRailShellProps) {
  const { hidden, width, activeMode, modeBadges } = viewModel;

  // Do not leave the inspector mounted behind a `hidden` attribute. The
  // `.right-panel { display: flex }` author rule can override the browser's
  // user-agent `[hidden]` rule, which made the rail remain visible even though
  // the terminal-first state was persisted correctly.
  if (hidden) return null;

  const handleModeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const nextMode = getNextRightRailMode(activeMode, event.key);
    if (!nextMode) return;
    event.preventDefault();
    actions.onModeChange(nextMode);
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-right-rail-mode="${nextMode}"]`)?.focus();
    });
  };

  return (
    <aside
      className="right-panel"
      aria-label="Contextual inspector"
      data-workspace-region="right-rail"
      tabIndex={-1}
      style={{ flexBasis: `${width}px`, width: `${width}px` }}
    >
      <hr
        className="right-panel-resize-handle"
        aria-orientation="vertical"
        aria-label="Resize agent inspector panel"
        aria-valuemin={260}
        aria-valuemax={480}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={(event) => {
          const startX = event.clientX;
          const startWidth = width;
          const handle = event.currentTarget;
          handle.setPointerCapture(event.pointerId);
          document.body.style.cursor = "col-resize";
          const handleMove = (moveEvent: PointerEvent) => {
            actions.onWidthChange(startWidth - (moveEvent.clientX - startX));
          };
          const handleUp = () => {
            document.body.style.cursor = "";
            handle.releasePointerCapture(event.pointerId);
            handle.removeEventListener("pointermove", handleMove);
            handle.removeEventListener("pointerup", handleUp);
          };
          handle.addEventListener("pointermove", handleMove);
          handle.addEventListener("pointerup", handleUp);
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 64 : 16;
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            actions.onWidthChange(width + step);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            actions.onWidthChange(width - step);
          }
        }}
      />
      <div className="right-panel-content">
        <div className="right-panel-mode-switch" role="tablist" aria-label="Inspector mode">
          {RIGHT_RAIL_MODES.map((mode) => {
            const Icon = mode.icon;
            const badge = modeBadges[mode.id];
            return (
              <button
                key={mode.id}
                type="button"
                role="tab"
                id={`right-rail-tab-${mode.id}`}
                className="right-panel-mode-tab"
                data-active={activeMode === mode.id}
                data-has-badge={badge > 0 ? "true" : undefined}
                data-right-rail-mode={mode.id}
                aria-selected={activeMode === mode.id}
                aria-controls="right-rail-panel"
                aria-label={`${mode.label}: ${mode.description}`}
                tabIndex={activeMode === mode.id ? 0 : -1}
                title={`${mode.title}. ${mode.description}`}
                onClick={() => actions.onModeChange(mode.id)}
                onKeyDown={handleModeKeyDown}
              >
                <Icon size={12} strokeWidth={1.8} aria-hidden="true" />
                <span>{mode.label}</span>
                {badge > 0 && <span className="right-panel-mode-badge">{badge}</span>}
              </button>
            );
          })}
        </div>
        {children}
      </div>
    </aside>
  );
}
