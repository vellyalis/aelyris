import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  EDITOR_OPEN_MODE_CHANGE_EVENT,
  EDITOR_OPEN_MODE_STORAGE_KEY,
  loadEditorOpenMode,
  openGitDiffInVSCode,
  openInVSCode,
  saveEditorOpenMode,
} from "../shared/lib/externalEditor";

describe("external editor integration", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    window.localStorage.clear();
  });

  it("defaults to VS Code so internal Monaco is not the product path", () => {
    expect(loadEditorOpenMode()).toBe("vscode");
    window.localStorage.setItem(EDITOR_OPEN_MODE_STORAGE_KEY, "builtin");
    expect(loadEditorOpenMode()).toBe("builtin");
  });

  it("persists editor mode and notifies the running window", () => {
    const listener = vi.fn();
    window.addEventListener(EDITOR_OPEN_MODE_CHANGE_EVENT, listener);
    saveEditorOpenMode("builtin");
    expect(window.localStorage.getItem(EDITOR_OPEN_MODE_STORAGE_KEY)).toBe("builtin");
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toBe("builtin");
    window.removeEventListener(EDITOR_OPEN_MODE_CHANGE_EVENT, listener);
  });

  it("invokes the native VS Code opener with optional line and column", async () => {
    await openInVSCode("C:/repo/project/src/main.ts", { line: 42, column: 7 });
    expect(invokeMock).toHaveBeenCalledWith("open_in_vscode", {
      path: "C:/repo/project/src/main.ts",
      line: 42,
      column: 7,
    });
  });

  it("invokes the native VS Code git diff opener", async () => {
    await openGitDiffInVSCode("C:/repo/project", "src/main.ts");
    expect(invokeMock).toHaveBeenCalledWith("open_git_file_diff_in_vscode", {
      repoPath: "C:/repo/project",
      filePath: "src/main.ts",
    });
  });
});
