import { beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_TELEMETRY_EVENT, type FallbackTelemetryDetail } from "../shared/lib/fallbackTelemetry";
import { sanitizeThemeOverrides, useAppStore } from "../shared/store/appStore";
import { DEFAULT_MOOD_PRESET } from "../shared/themes/moods";

function collectFallbackEvents() {
  const events: FallbackTelemetryDetail[] = [];
  const listener = (event: Event) => {
    events.push((event as CustomEvent<FallbackTelemetryDetail>).detail);
  };
  window.addEventListener(FALLBACK_TELEMETRY_EVENT, listener);
  return {
    events,
    cleanup: () => window.removeEventListener(FALLBACK_TELEMETRY_EVENT, listener),
  };
}

// Reset store between tests
beforeEach(() => {
  // Drop persisted theme overrides between tests so each block starts clean
  // — the appStore bootstraps `themeOverrides` from localStorage on load.
  try {
    localStorage.removeItem("aether:themeOverrides");
    localStorage.removeItem("aether:moodPreset");
    localStorage.removeItem("aether:moodMaterialOverrides");
    localStorage.removeItem("aether:wallpaperSettingsByMood");
    localStorage.removeItem("aether:windowOpacity");
    localStorage.removeItem("aether:workspaceProfiles");
  } catch {
    /* ignore */
  }
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
    fallbackTelemetryEvents: [],
    moodPresetId: DEFAULT_MOOD_PRESET,
    appWindowOpacity: 0.95,
    moodMaterialOverrides: {},
    wallpaperSettingsByMood: {
      "aether-sky": { imagePath: null, opacity: 0, positionX: 50, positionY: 50, scale: 100 },
      "aether-moonwater": { imagePath: null, opacity: 0, positionX: 50, positionY: 50, scale: 100 },
      "aether-crystal": { imagePath: null, opacity: 0, positionX: 50, positionY: 50, scale: 100 },
      "aether-dream": { imagePath: null, opacity: 0, positionX: 50, positionY: 50, scale: 100 },
      "aether-cute": { imagePath: null, opacity: 0, positionX: 50, positionY: 50, scale: 100 },
      "aether-sakura": { imagePath: null, opacity: 0, positionX: 50, positionY: 50, scale: 100 },
      "aether-obsidian": { imagePath: null, opacity: 0, positionX: 50, positionY: 50, scale: 100 },
      "aether-pro": { imagePath: null, opacity: 0, positionX: 50, positionY: 50, scale: 100 },
    },
    themeOverrides: {},
    workspaceProfiles: {
      version: 1,
      globalDefaults: useAppStore.getState().workspaceProfiles.globalDefaults,
      workspaceOverrides: {},
      threadRunState: {},
    },
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

describe("appStore — fallback telemetry", () => {
  it("keeps recent runtime fallback events visible and deduplicated", () => {
    const { recordFallbackTelemetry } = useAppStore.getState();

    recordFallbackTelemetry({
      source: "terminal-selection",
      operation: "write_clipboard_text",
      severity: "warning",
      message: "native clipboard denied",
      userVisible: true,
      timestamp: 10,
    });
    recordFallbackTelemetry({
      source: "terminal-selection",
      operation: "write_clipboard_text",
      severity: "warning",
      message: "native clipboard denied",
      userVisible: true,
      timestamp: 20,
    });
    recordFallbackTelemetry({
      source: "terminal-ime",
      operation: "set_ime_position",
      severity: "error",
      message: "IMM denied",
      userVisible: true,
      timestamp: 30,
    });

    expect(useAppStore.getState().fallbackTelemetryEvents).toEqual([
      expect.objectContaining({ source: "terminal-ime", operation: "set_ime_position", timestamp: 30 }),
      expect.objectContaining({ source: "terminal-selection", operation: "write_clipboard_text", timestamp: 20 }),
    ]);
  });

  it("bounds fallback telemetry history so stale fallback noise cannot dominate the rail", () => {
    const { recordFallbackTelemetry } = useAppStore.getState();
    for (let index = 0; index < 35; index += 1) {
      recordFallbackTelemetry({
        source: "pane-mux",
        operation: `local_recovery_${index}`,
        severity: "warning",
        message: `fallback ${index}`,
        userVisible: true,
        timestamp: index,
      });
    }

    const events = useAppStore.getState().fallbackTelemetryEvents;
    expect(events).toHaveLength(30);
    expect(events[0].operation).toBe("local_recovery_34");
    expect(events.at(-1)?.operation).toBe("local_recovery_5");
  });
});

describe("appStore — appearance customization", () => {
  it("keeps material overrides isolated per mood", () => {
    const { setMoodMaterialOverride, resetMoodMaterialOverrides } = useAppStore.getState();

    setMoodMaterialOverride("aether-sakura", "panelColor", "#fffafc");
    setMoodMaterialOverride("aether-pro", "panelColor", "#050d16");

    expect(useAppStore.getState().moodMaterialOverrides["aether-sakura"]?.panelColor).toBe("#fffafc");
    expect(useAppStore.getState().moodMaterialOverrides["aether-pro"]?.panelColor).toBe("#050d16");

    resetMoodMaterialOverrides("aether-sakura");

    expect(useAppStore.getState().moodMaterialOverrides["aether-sakura"]).toBeUndefined();
    expect(useAppStore.getState().moodMaterialOverrides["aether-pro"]?.panelColor).toBe("#050d16");
  });

  it("allows low opacity material overrides to make mood surfaces meaningfully translucent", () => {
    const { setMoodMaterialOverride } = useAppStore.getState();

    setMoodMaterialOverride("aether-sakura", "backdropAlpha", 0.72);
    setMoodMaterialOverride("aether-sakura", "panelAlpha", 0.18);
    setMoodMaterialOverride("aether-sakura", "chromeAlpha", 0.16);
    setMoodMaterialOverride("aether-sakura", "terminalAlpha", 0.08);

    expect(useAppStore.getState().moodMaterialOverrides["aether-sakura"]).toMatchObject({
      backdropAlpha: 0.72,
      panelAlpha: 0.18,
      chromeAlpha: 0.16,
      terminalAlpha: 0.08,
    });
  });

  it("keeps wallpaper image controls isolated per mood", () => {
    const { setMoodPresetId, setWallpaperSettingsForMood } = useAppStore.getState();

    setWallpaperSettingsForMood("aether-sakura", {
      imagePath: "C:/Users/owner/Pictures/sakura.jpg",
      opacity: 0.45,
      positionX: 20,
      positionY: 80,
      scale: 160,
    });
    setWallpaperSettingsForMood("aether-pro", {
      imagePath: "C:/Users/owner/Pictures/pro.jpg",
      opacity: 0.12,
      positionX: 60,
      positionY: 45,
      scale: 90,
    });

    setMoodPresetId("aether-sakura");
    expect(useAppStore.getState().wallpaperImagePath).toBe("C:/Users/owner/Pictures/sakura.jpg");
    expect(useAppStore.getState().wallpaperOpacity).toBe(0.45);
    expect(useAppStore.getState().wallpaperSettingsByMood["aether-sakura"].scale).toBe(160);

    setMoodPresetId("aether-pro");
    expect(useAppStore.getState().wallpaperImagePath).toBe("C:/Users/owner/Pictures/pro.jpg");
    expect(useAppStore.getState().wallpaperOpacity).toBe(0.12);
    expect(useAppStore.getState().wallpaperSettingsByMood["aether-pro"].positionX).toBe(60);
  });

  it("persists global window opacity with readable clamp bounds", () => {
    const { setAppWindowOpacity } = useAppStore.getState();

    setAppWindowOpacity(0.42);
    expect(useAppStore.getState().appWindowOpacity).toBe(0.42);
    expect(localStorage.getItem("aether:windowOpacity")).toBe("0.42");

    setAppWindowOpacity(0.1);
    expect(useAppStore.getState().appWindowOpacity).toBe(0.35);

    setAppWindowOpacity(2);
    expect(useAppStore.getState().appWindowOpacity).toBe(1);
  });
});

describe("appStore — model selection", () => {
  it("sets selectedModel", () => {
    const { setSelectedModel } = useAppStore.getState();
    setSelectedModel("claude-opus");
    expect(useAppStore.getState().selectedModel).toBe("claude-opus");
  });

  it("reports model and budget persistence failures instead of silently losing command-center policy", () => {
    const telemetry = collectFallbackEvents();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    try {
      const { addAgentCost, setAgentBudgetLimit, setContextWarnPct, setPerSessionCostCap, setSelectedModel } =
        useAppStore.getState();

      setSelectedModel("gpt-5.5");
      addAgentCost(1.25);
      setAgentBudgetLimit(42);
      setPerSessionCostCap(5);
      setContextWarnPct(90);

      expect(useAppStore.getState().selectedModel).toBe("gpt-5.5");
      expect(useAppStore.getState().agentBudget).toMatchObject({ spent: 1.25, limit: 42 });
      expect(useAppStore.getState().perSessionCostCap).toBe(5);
      expect(useAppStore.getState().contextWarnPct).toBe(90);
      expect(telemetry.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ source: "app-store", operation: "persist_selected_model", userVisible: true }),
          expect.objectContaining({ source: "app-store", operation: "persist_agent_budget_spent", userVisible: true }),
          expect.objectContaining({ source: "app-store", operation: "persist_agent_budget_limit", userVisible: true }),
          expect.objectContaining({
            source: "app-store",
            operation: "persist_per_session_cost_cap",
            userVisible: true,
          }),
          expect.objectContaining({ source: "app-store", operation: "persist_context_warn_pct", userVisible: true }),
        ]),
      );
    } finally {
      setItem.mockRestore();
      telemetry.cleanup();
    }
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

  it("reports Kanban persistence failures instead of silently losing task state", () => {
    const telemetry = collectFallbackEvents();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    try {
      const { addKanbanTask, moveKanbanTask, updateKanbanTask } = useAppStore.getState();
      addKanbanTask("Visible task");
      const taskId = useAppStore.getState().kanbanTasks[0].id;
      moveKanbanTask(taskId, "review");
      updateKanbanTask(taskId, { title: "Still visible" });

      expect(useAppStore.getState().kanbanTasks[0]).toMatchObject({ title: "Still visible", column: "review" });
      expect(telemetry.events).toContainEqual(
        expect.objectContaining({
          source: "app-store",
          operation: "persist_kanban_tasks",
          userVisible: true,
        }),
      );
    } finally {
      setItem.mockRestore();
      telemetry.cleanup();
    }
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

  it("reports editor persistence failures instead of silently losing open-file recovery", () => {
    const telemetry = collectFallbackEvents();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    try {
      const { openFile, setActiveFile } = useAppStore.getState();
      openFile("src/main.ts");
      setActiveFile(null);

      expect(useAppStore.getState().openFiles).toEqual(["src/main.ts"]);
      expect(useAppStore.getState().activeFile).toBeNull();
      expect(telemetry.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ source: "app-store", operation: "persist_open_files", userVisible: true }),
          expect.objectContaining({ source: "app-store", operation: "persist_active_file", userVisible: true }),
        ]),
      );
    } finally {
      setItem.mockRestore();
      telemetry.cleanup();
    }
  });
});

describe("appStore — panel widths", () => {
  beforeEach(() => {
    try {
      localStorage.removeItem("aether:sidebarWidth");
      localStorage.removeItem("aether:rightPanelWidth");
    } catch {
      /* ignore */
    }
    useAppStore.setState({ sidebarWidth: 240, rightPanelWidth: 320 });
  });

  it("clamps sidebarWidth to [200, 480]", () => {
    const { setSidebarWidth } = useAppStore.getState();
    setSidebarWidth(50);
    expect(useAppStore.getState().sidebarWidth).toBe(200);
    setSidebarWidth(9999);
    expect(useAppStore.getState().sidebarWidth).toBe(480);
    setSidebarWidth(300);
    expect(useAppStore.getState().sidebarWidth).toBe(300);
  });

  it("persists sidebarWidth to localStorage", () => {
    const { setSidebarWidth } = useAppStore.getState();
    setSidebarWidth(280);
    expect(localStorage.getItem("aether:sidebarWidth")).toBe("280");
  });

  it("clamps rightPanelWidth to [260, 480]", () => {
    const { setRightPanelWidth } = useAppStore.getState();
    setRightPanelWidth(100);
    expect(useAppStore.getState().rightPanelWidth).toBe(260);
    setRightPanelWidth(9999);
    expect(useAppStore.getState().rightPanelWidth).toBe(480);
    setRightPanelWidth(360);
    expect(useAppStore.getState().rightPanelWidth).toBe(360);
  });

  it("persists rightPanelWidth to localStorage", () => {
    const { setRightPanelWidth } = useAppStore.getState();
    setRightPanelWidth(400);
    expect(localStorage.getItem("aether:rightPanelWidth")).toBe("400");
  });

  it("rounds fractional widths to integers", () => {
    const { setSidebarWidth, setRightPanelWidth } = useAppStore.getState();
    setSidebarWidth(245.7);
    expect(useAppStore.getState().sidebarWidth).toBe(246);
    setRightPanelWidth(320.3);
    expect(useAppStore.getState().rightPanelWidth).toBe(320);
  });

  it("reports panel width persistence failures instead of silently losing layout preferences", () => {
    const telemetry = collectFallbackEvents();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    try {
      const { setSidebarWidth, setRightPanelWidth } = useAppStore.getState();
      setSidebarWidth(280);
      setRightPanelWidth(400);

      expect(useAppStore.getState().sidebarWidth).toBe(280);
      expect(useAppStore.getState().rightPanelWidth).toBe(400);
      expect(telemetry.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "app-store",
            operation: "persist_sidebar_width",
            userVisible: true,
          }),
          expect.objectContaining({
            source: "app-store",
            operation: "persist_right_panel_width",
            userVisible: true,
          }),
        ]),
      );
    } finally {
      setItem.mockRestore();
      telemetry.cleanup();
    }
  });
});

describe("appStore — theme overrides", () => {
  it("sets a single accent override", () => {
    const { setAccentOverride } = useAppStore.getState();
    setAccentOverride("aether-dark", "sapphire", "#aabbcc");
    expect(useAppStore.getState().themeOverrides["aether-dark"]).toEqual({
      sapphire: "#aabbcc",
    });
  });

  it("clears an override when value is undefined and removes the theme entry when empty", () => {
    const { setAccentOverride } = useAppStore.getState();
    setAccentOverride("aether-dark", "sapphire", "#112233");
    setAccentOverride("aether-dark", "sapphire", undefined);
    expect(useAppStore.getState().themeOverrides).toEqual({});
  });

  it("keeps the theme entry when other overrides remain", () => {
    const { setAccentOverride } = useAppStore.getState();
    setAccentOverride("aether-dark", "sapphire", "#112233");
    setAccentOverride("aether-dark", "mauve", "#445566");
    setAccentOverride("aether-dark", "sapphire", undefined);
    expect(useAppStore.getState().themeOverrides["aether-dark"]).toEqual({
      mauve: "#445566",
    });
  });

  it("isolates overrides per themeId", () => {
    const { setAccentOverride } = useAppStore.getState();
    setAccentOverride("aether-dark", "sapphire", "#aaaaaa");
    setAccentOverride("catppuccin-latte", "sapphire", "#bbbbbb");
    const state = useAppStore.getState().themeOverrides;
    expect(state["aether-dark"]?.sapphire).toBe("#aaaaaa");
    expect(state["catppuccin-latte"]?.sapphire).toBe("#bbbbbb");
  });

  it("resets all overrides for a theme", () => {
    const { setAccentOverride, resetThemeOverrides } = useAppStore.getState();
    setAccentOverride("aether-dark", "sapphire", "#112233");
    setAccentOverride("aether-dark", "mauve", "#445566");
    resetThemeOverrides("aether-dark");
    expect(useAppStore.getState().themeOverrides).toEqual({});
  });

  it("persists overrides to localStorage", () => {
    const { setAccentOverride } = useAppStore.getState();
    setAccentOverride("aether-dark", "sapphire", "#112233");
    const raw = localStorage.getItem("aether:themeOverrides");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw ?? "{}")).toEqual({ "aether-dark": { sapphire: "#112233" } });
  });

  it("replaces theme overrides from config hydration and sanitizes them", () => {
    const { replaceThemeOverrides } = useAppStore.getState();
    replaceThemeOverrides({
      "sakura-hub": {
        sapphire: "#74c7ec",
        red: "not-a-color",
      },
    });

    expect(useAppStore.getState().themeOverrides).toEqual({
      "sakura-hub": { sapphire: "#74c7ec" },
    });
    expect(JSON.parse(localStorage.getItem("aether:themeOverrides") ?? "{}")).toEqual({
      "sakura-hub": { sapphire: "#74c7ec" },
    });
  });

  it("sanitizes persisted overrides before applying them", () => {
    expect(
      sanitizeThemeOverrides({
        "aether-dark": {
          sapphire: "#abc",
          mauve: "not-a-color",
          unknown: "#ffffff",
          red: "url(javascript:alert(1))",
        },
        empty: { unknown: "#ffffff" },
        invalid: ["#ffffff"],
      }),
    ).toEqual({
      "aether-dark": { sapphire: "#aabbcc" },
    });
  });
});

describe("appStore — mood presets", () => {
  it("sets and persists a mood preset", () => {
    const { setMoodPresetId } = useAppStore.getState();
    setMoodPresetId("aether-dream");
    expect(useAppStore.getState().moodPresetId).toBe("aether-dream");
    expect(localStorage.getItem("aether:moodPreset")).toBe("aether-dream");
  });

  it("falls back to the default mood for unknown ids", () => {
    const { setMoodPresetId } = useAppStore.getState();
    setMoodPresetId("unknown");
    expect(useAppStore.getState().moodPresetId).toBe(DEFAULT_MOOD_PRESET);
    expect(localStorage.getItem("aether:moodPreset")).toBe(DEFAULT_MOOD_PRESET);
  });
});

describe("appStore — workspace profiles", () => {
  it("persists workspace overrides and resolves thread-specific run state", () => {
    const { setWorkspaceProfileOverride, setWorkspaceThreadRunState, resolveWorkspaceProfile } = useAppStore.getState();

    setWorkspaceProfileOverride("C:/repo/Aether", {
      preferredModel: "gpt-5.2",
      visualDensity: "dense",
      safePaths: ["C:/repo/Aether/scripts"],
    });
    setWorkspaceThreadRunState("C:/repo/Aether", "thread-a", {
      status: "active",
      activeRoadmapId: "P2-03",
    });

    const profile = resolveWorkspaceProfile("C:/repo/Aether", "thread-a");
    expect(profile.preferredModel).toBe("gpt-5.2");
    expect(profile.visualDensity).toBe("dense");
    expect(profile.safePaths).toEqual(["C:/repo/Aether", "C:/repo/Aether/scripts"]);
    expect(profile.runState.activeRoadmapId).toBe("P2-03");
    expect(JSON.parse(localStorage.getItem("aether:workspaceProfiles") ?? "{}").version).toBe(1);
  });
});
