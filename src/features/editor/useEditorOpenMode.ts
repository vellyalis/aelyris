import { useCallback, useEffect, useState } from "react";

import {
  EDITOR_OPEN_MODE_CHANGE_EVENT,
  EDITOR_OPEN_MODE_STORAGE_KEY,
  type EditorOpenMode,
  loadEditorOpenMode,
  openGitDiffInVSCode,
  openInVSCode,
} from "../../shared/lib/externalEditor";
import { reportInvokeFailure } from "../../shared/lib/fallbackTelemetry";

interface UseEditorOpenModeOptions {
  projectPath: string;
  openFile: (path: string) => void;
  setEditorLine: (line: number | undefined) => void;
  setOpenInDiff: (open: boolean) => void;
}

export function useEditorOpenMode({ projectPath, openFile, setEditorLine, setOpenInDiff }: UseEditorOpenModeOptions) {
  const [editorOpenMode, setEditorOpenMode] = useState(loadEditorOpenMode);

  useEffect(() => {
    const onEditorModeChange = (event: Event) => {
      const next = (event as CustomEvent<EditorOpenMode>).detail;
      if (next === "vscode" || next === "builtin") {
        setEditorOpenMode(next);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === EDITOR_OPEN_MODE_STORAGE_KEY) {
        setEditorOpenMode(loadEditorOpenMode());
      }
    };
    window.addEventListener(EDITOR_OPEN_MODE_CHANGE_EVENT, onEditorModeChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EDITOR_OPEN_MODE_CHANGE_EVENT, onEditorModeChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const handleFileSelect = useCallback(
    (path: string, options: { line?: number } = {}) => {
      setOpenInDiff(false);
      if (editorOpenMode === "vscode") {
        void openInVSCode(path, { line: options.line }).catch((err) => {
          reportInvokeFailure({ source: "editor", operation: "open_in_vscode", err });
          if (options.line !== undefined) setEditorLine(options.line);
          openFile(path);
        });
        return;
      }
      if (options.line !== undefined) setEditorLine(options.line);
      openFile(path);
    },
    [editorOpenMode, openFile, setEditorLine, setOpenInDiff],
  );

  const handleOpenDiff = useCallback(
    (path: string) => {
      if (editorOpenMode === "vscode") {
        setOpenInDiff(false);
        void openGitDiffInVSCode(projectPath, path).catch((err) => {
          reportInvokeFailure({ source: "editor", operation: "open_git_file_diff_in_vscode", err });
          setOpenInDiff(true);
          openFile(path);
        });
        return;
      }
      setOpenInDiff(true);
      openFile(path);
    },
    [editorOpenMode, openFile, projectPath, setOpenInDiff],
  );

  return { editorOpenMode, handleFileSelect, handleOpenDiff };
}
