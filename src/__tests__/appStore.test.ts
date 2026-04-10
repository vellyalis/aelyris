import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "../shared/store/appStore";

// Reset store between tests
beforeEach(() => {
  useAppStore.setState({
    rootProjectPath: null,
    paletteVisible: false,
    settingsVisible: false,
    watchdogVisible: false,
    searchVisible: false,
    aboutVisible: false,
    webInspectorVisible: false,
    prInspectorVisible: false,
    selectedModel: "claude-sonnet",
    kanbanTasks: [],
    openFiles: [],
    activeFile: null,
  });
});

describe("appStore — project", () => {
  it("sets and clears rootProjectPath", () => {
    const { setRootProjectPath } = useAppStore.getState();
    setRootProjectPath("C:/projects/test");
    expect(useAppStore.getState().rootProjectPath).toBe("C:/projects/test");

    setRootProjectPath(null);
    expect(useAppStore.getState().rootProjectPath).toBeNull();
  });
});

describe("appStore — UI visibility", () => {
  it("toggles paletteVisible with boolean", () => {
    const { setPaletteVisible } = useAppStore.getState();
    setPaletteVisible(true);
    expect(useAppStore.getState().paletteVisible).toBe(true);
    setPaletteVisible(false);
    expect(useAppStore.getState().paletteVisible).toBe(false);
  });

  it("toggles paletteVisible with function", () => {
    const { setPaletteVisible } = useAppStore.getState();
    setPaletteVisible((prev) => !prev);
    expect(useAppStore.getState().paletteVisible).toBe(true);
    setPaletteVisible((prev) => !prev);
    expect(useAppStore.getState().paletteVisible).toBe(false);
  });

  it("toggles settingsVisible independently", () => {
    const { setSettingsVisible, setPaletteVisible } = useAppStore.getState();
    setPaletteVisible(true);
    setSettingsVisible(true);
    expect(useAppStore.getState().paletteVisible).toBe(true);
    expect(useAppStore.getState().settingsVisible).toBe(true);
  });
});

describe("appStore — model selection", () => {
  it("sets selectedModel", () => {
    const { setSelectedModel } = useAppStore.getState();
    setSelectedModel("claude-opus");
    expect(useAppStore.getState().selectedModel).toBe("claude-opus");
  });
});

describe("appStore — kanban", () => {
  it("adds a task", () => {
    const { addKanbanTask } = useAppStore.getState();
    addKanbanTask("Test task");
    const tasks = useAppStore.getState().kanbanTasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Test task");
    expect(tasks[0].column).toBe("todo");
  });

  it("moves a task", () => {
    const { addKanbanTask } = useAppStore.getState();
    addKanbanTask("Move me");
    const taskId = useAppStore.getState().kanbanTasks[0].id;

    const { moveKanbanTask } = useAppStore.getState();
    moveKanbanTask(taskId, "in_progress");
    expect(useAppStore.getState().kanbanTasks[0].column).toBe("in_progress");
  });

  it("deletes a task", () => {
    const { addKanbanTask } = useAppStore.getState();
    addKanbanTask("Delete me");
    const taskId = useAppStore.getState().kanbanTasks[0].id;

    const { deleteKanbanTask } = useAppStore.getState();
    deleteKanbanTask(taskId);
    expect(useAppStore.getState().kanbanTasks).toHaveLength(0);
  });

  it("updates a task", () => {
    const { addKanbanTask } = useAppStore.getState();
    addKanbanTask("Update me");
    const taskId = useAppStore.getState().kanbanTasks[0].id;

    const { updateKanbanTask } = useAppStore.getState();
    updateKanbanTask(taskId, { title: "Updated title", branch: "feat/test" });

    const task = useAppStore.getState().kanbanTasks[0];
    expect(task.title).toBe("Updated title");
    expect(task.branch).toBe("feat/test");
  });

  it("preserves other tasks when moving one", async () => {
    const { addKanbanTask } = useAppStore.getState();
    addKanbanTask("Task 1");
    // Small delay to ensure different Date.now() IDs
    await new Promise((r) => setTimeout(r, 5));
    useAppStore.getState().addKanbanTask("Task 2");
    const tasks = useAppStore.getState().kanbanTasks;
    expect(tasks).toHaveLength(2);

    const { moveKanbanTask } = useAppStore.getState();
    moveKanbanTask(tasks[0].id, "done");

    const updated = useAppStore.getState().kanbanTasks;
    expect(updated[0].column).toBe("done");
    expect(updated[1].column).toBe("todo");
  });
});

describe("appStore — editor files", () => {
  it("opens a file and sets active", () => {
    const { openFile } = useAppStore.getState();
    openFile("src/main.ts");
    expect(useAppStore.getState().openFiles).toEqual(["src/main.ts"]);
    expect(useAppStore.getState().activeFile).toBe("src/main.ts");
  });

  it("does not duplicate open files", () => {
    const { openFile } = useAppStore.getState();
    openFile("src/main.ts");
    openFile("src/main.ts");
    expect(useAppStore.getState().openFiles).toEqual(["src/main.ts"]);
  });

  it("opens multiple files", () => {
    const { openFile } = useAppStore.getState();
    openFile("a.ts");
    openFile("b.ts");
    expect(useAppStore.getState().openFiles).toEqual(["a.ts", "b.ts"]);
    expect(useAppStore.getState().activeFile).toBe("b.ts");
  });

  it("closes a file and updates active to last", () => {
    const { openFile } = useAppStore.getState();
    openFile("a.ts");
    openFile("b.ts");
    openFile("c.ts");

    const { closeFile } = useAppStore.getState();
    closeFile("c.ts");
    expect(useAppStore.getState().openFiles).toEqual(["a.ts", "b.ts"]);
    expect(useAppStore.getState().activeFile).toBe("b.ts");
  });

  it("closes last file and sets active to null", () => {
    const { openFile } = useAppStore.getState();
    openFile("a.ts");

    const { closeFile } = useAppStore.getState();
    closeFile("a.ts");
    expect(useAppStore.getState().openFiles).toEqual([]);
    expect(useAppStore.getState().activeFile).toBeNull();
  });

  it("clearFiles resets everything", () => {
    const { openFile } = useAppStore.getState();
    openFile("a.ts");
    openFile("b.ts");

    const { clearFiles } = useAppStore.getState();
    clearFiles();
    expect(useAppStore.getState().openFiles).toEqual([]);
    expect(useAppStore.getState().activeFile).toBeNull();
  });
});
