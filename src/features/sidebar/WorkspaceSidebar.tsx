import { type KeyboardEvent, type PointerEvent, type ReactNode, Suspense } from "react";

import { CollapsibleSection } from "../../shared/ui/CollapsibleSection";
import { ErrorBoundary } from "../../shared/ui/ErrorBoundary";
import type { WorkspaceSidebarActions, WorkspaceSidebarViewModel } from "./workspaceSidebarContract";

export interface WorkspaceSidebarContent {
  readonly files: ReactNode;
  readonly tasks: ReactNode;
  readonly sourceControl: ReactNode;
  readonly search: ReactNode;
}

export interface WorkspaceSidebarProps {
  readonly viewModel: WorkspaceSidebarViewModel;
  readonly actions: WorkspaceSidebarActions;
  readonly content: WorkspaceSidebarContent;
}

export function WorkspaceSidebar({ viewModel, actions, content }: WorkspaceSidebarProps) {
  const { hidden, width } = viewModel;

  const handlePointerDown = (event: PointerEvent<HTMLHRElement>) => {
    const startX = event.clientX;
    const startWidth = width;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      actions.onWidthChange(startWidth + (moveEvent.clientX - startX));
    };
    const handleUp = () => {
      document.body.style.cursor = "";
      handle.releasePointerCapture(event.pointerId);
      handle.removeEventListener("pointermove", handleMove);
      handle.removeEventListener("pointerup", handleUp);
    };
    handle.addEventListener("pointermove", handleMove);
    handle.addEventListener("pointerup", handleUp);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLHRElement>) => {
    const step = event.shiftKey ? 64 : 16;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      actions.onWidthChange(width - step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      actions.onWidthChange(width + step);
    }
  };

  return (
    <nav
      className={`left-panel${hidden ? " left-panel-collapsed" : ""}`}
      aria-label="Project sidebar"
      aria-hidden={hidden ? "true" : undefined}
      data-workspace-region="sidebar"
      tabIndex={-1}
      data-collapsed={hidden}
      style={hidden ? undefined : { width: `${width}px` }}
    >
      <CollapsibleSection storageKey="files" title="Files" defaultOpen>
        <ErrorBoundary>{content.files}</ErrorBoundary>
      </CollapsibleSection>
      <CollapsibleSection storageKey="tasks" title="Tasks" defaultOpen={false}>
        <ErrorBoundary>
          <Suspense fallback={null}>{content.tasks}</Suspense>
        </ErrorBoundary>
      </CollapsibleSection>
      <CollapsibleSection storageKey="source-control" title="Source Control" defaultOpen={false}>
        <ErrorBoundary>
          <Suspense fallback={null}>{content.sourceControl}</Suspense>
        </ErrorBoundary>
      </CollapsibleSection>
      {content.search && (
        <Suspense fallback={null}>
          <ErrorBoundary>{content.search}</ErrorBoundary>
        </Suspense>
      )}
      <hr
        className="left-panel-resize-handle"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuemin={200}
        aria-valuemax={480}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
      />
    </nav>
  );
}
