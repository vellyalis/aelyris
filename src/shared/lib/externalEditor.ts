import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "./tauriRuntime";

export type EditorOpenMode = "vscode" | "builtin";

export const EDITOR_OPEN_MODE_STORAGE_KEY = "aether:editorOpenMode";
export const EDITOR_OPEN_MODE_CHANGE_EVENT = "aether:editor-open-mode-change";

export interface ExternalEditorTarget {
  line?: number;
  column?: number;
}

export function loadEditorOpenMode(): EditorOpenMode {
  if (typeof window === "undefined") return "vscode";
  try {
    return window.localStorage.getItem(EDITOR_OPEN_MODE_STORAGE_KEY) === "builtin" ? "builtin" : "vscode";
  } catch {
    return "vscode";
  }
}

export function saveEditorOpenMode(mode: EditorOpenMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EDITOR_OPEN_MODE_STORAGE_KEY, mode);
  } catch {
    /* localStorage can be disabled; the in-memory event still updates this window. */
  }
  window.dispatchEvent(new CustomEvent<EditorOpenMode>(EDITOR_OPEN_MODE_CHANGE_EVENT, { detail: mode }));
}

export async function openInVSCode(path: string, target: ExternalEditorTarget = {}): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("VS Code opener is available only inside the Tauri app");
  }
  await invoke("open_in_vscode", {
    path,
    line: target.line ?? null,
    column: target.column ?? null,
  });
}

export async function openGitDiffInVSCode(repoPath: string, filePath: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("VS Code diff opener is available only inside the Tauri app");
  }
  await invoke("open_git_file_diff_in_vscode", {
    repoPath,
    filePath,
  });
}
