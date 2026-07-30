import { lazy, Suspense } from "react";
import { ErrorBoundary } from "../../shared/ui/ErrorBoundary";
import styles from "./WorkspaceEditorArea.module.css";
import type { WorkspaceEditorAreaActions, WorkspaceEditorAreaViewModel } from "./workspaceEditorAreaContract";

const EditorPanel = lazy(() => import("./EditorPanel").then((module) => ({ default: module.EditorPanel })));

export interface WorkspaceEditorAreaProps {
  viewModel: WorkspaceEditorAreaViewModel;
  actions: WorkspaceEditorAreaActions;
}

export function WorkspaceEditorArea({ viewModel, actions }: WorkspaceEditorAreaProps) {
  return (
    <div className={styles.editorArea}>
      <div className={styles.editorTabsBar}>
        {viewModel.openFiles.map((filePath) => {
          const name = filePath.split(/[\\/]/).pop() ?? filePath;
          return (
            <div
              key={filePath}
              className={styles.editorTab}
              role="tab"
              tabIndex={0}
              aria-selected={filePath === viewModel.activeFile}
              data-active={filePath === viewModel.activeFile}
              onClick={() => actions.onSelectFile(filePath)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  actions.onSelectFile(filePath);
                }
              }}
            >
              {name}
              <button
                type="button"
                className={styles.editorTabClose}
                aria-label={`Close ${name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void actions.onCloseFile(filePath);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <ErrorBoundary>
        <Suspense fallback={<div className={styles.editorLoading}>Loading editor...</div>}>
          <EditorPanel
            filePath={viewModel.activeFile}
            onClose={() => void actions.onCloseFile(viewModel.activeFile)}
            projectPath={viewModel.projectPath}
            initialLine={viewModel.initialLine}
            initialDiffMode={viewModel.initialDiffMode}
            onStartAgent={actions.onStartAgent}
          />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
