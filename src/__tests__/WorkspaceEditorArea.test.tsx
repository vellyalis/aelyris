import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceEditorArea } from "../features/editor/WorkspaceEditorArea";
import type {
  WorkspaceEditorAreaActions,
  WorkspaceEditorAreaViewModel,
} from "../features/editor/workspaceEditorAreaContract";

vi.mock("../features/editor/EditorPanel", () => ({
  EditorPanel: ({
    filePath,
    projectPath,
    initialLine,
    initialDiffMode,
    onClose,
    onStartAgent,
  }: {
    filePath: string;
    projectPath: string;
    initialLine?: number;
    initialDiffMode?: boolean;
    onClose: () => void;
    onStartAgent: (prompt: string) => void;
  }) => (
    <section
      aria-label="editor projection"
      data-file-path={filePath}
      data-project-path={projectPath}
      data-initial-line={initialLine}
      data-initial-diff-mode={String(initialDiffMode)}
    >
      <button type="button" onClick={onClose}>
        close active editor
      </button>
      <button type="button" onClick={() => onStartAgent("review active file")}>
        start editor agent
      </button>
    </section>
  ),
}));

afterEach(() => {
  cleanup();
});

const viewModel: WorkspaceEditorAreaViewModel = {
  activeFile: "C:\\repo\\src\\active.ts",
  openFiles: ["C:\\repo\\src\\active.ts", "C:\\repo\\src\\other.ts"],
  projectPath: "C:\\repo",
  initialLine: 42,
  initialDiffMode: true,
};

function createActions(): WorkspaceEditorAreaActions {
  return {
    onSelectFile: vi.fn(),
    onCloseFile: vi.fn(),
    onStartAgent: vi.fn(),
  };
}

describe("WorkspaceEditorArea", () => {
  it("projects file tabs and the editor from one typed view model", async () => {
    const actions = createActions();
    render(<WorkspaceEditorArea viewModel={viewModel} actions={actions} />);

    expect(screen.getByRole("tab", { name: /active\.ts/i }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /other\.ts/i }).getAttribute("aria-selected")).toBe("false");
    const editor = await screen.findByLabelText("editor projection");
    expect(editor.getAttribute("data-file-path")).toBe(viewModel.activeFile);
    expect(editor.getAttribute("data-project-path")).toBe(viewModel.projectPath);
    expect(editor.getAttribute("data-initial-line")).toBe("42");
    expect(editor.getAttribute("data-initial-diff-mode")).toBe("true");
  });

  it("routes tab, close, and agent intents through the action contract", async () => {
    const actions = createActions();
    render(<WorkspaceEditorArea viewModel={viewModel} actions={actions} />);

    fireEvent.click(screen.getByRole("tab", { name: /other\.ts/i }));
    fireEvent.keyDown(screen.getByRole("tab", { name: /active\.ts/i }), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Close other.ts" }));
    fireEvent.click(await screen.findByRole("button", { name: "close active editor" }));
    fireEvent.click(await screen.findByRole("button", { name: "start editor agent" }));

    expect(actions.onSelectFile).toHaveBeenNthCalledWith(1, "C:\\repo\\src\\other.ts");
    expect(actions.onSelectFile).toHaveBeenNthCalledWith(2, "C:\\repo\\src\\active.ts");
    expect(actions.onCloseFile).toHaveBeenNthCalledWith(1, "C:\\repo\\src\\other.ts");
    expect(actions.onCloseFile).toHaveBeenNthCalledWith(2, "C:\\repo\\src\\active.ts");
    expect(actions.onStartAgent).toHaveBeenCalledWith("review active file");
  });
});
