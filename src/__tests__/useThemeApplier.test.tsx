import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThemeApplier } from "../shared/hooks/useTheme";
import { DEFAULT_BG } from "../shared/lib/ansiPalette";
import { FALLBACK_TELEMETRY_EVENT, type FallbackTelemetryDetail } from "../shared/lib/fallbackTelemetry";
import type { MoodMaterialOverrides, MoodPresetId } from "../shared/themes/moods";

function ThemeProbe({
  themeId,
  moodPresetId,
  materialOverrides,
  wallpaper,
  windowOpacity,
  terminalSurfaceOpacity,
}: {
  themeId: string;
  moodPresetId: MoodPresetId;
  materialOverrides?: MoodMaterialOverrides;
  wallpaper?: {
    imagePath?: string | null;
    opacity?: number;
    positionX?: number;
    positionY?: number;
    scale?: number;
  };
  windowOpacity?: number;
  terminalSurfaceOpacity?: number;
}) {
  useThemeApplier(
    themeId,
    undefined,
    moodPresetId,
    materialOverrides,
    wallpaper,
    windowOpacity,
    terminalSurfaceOpacity,
  );
  return null;
}

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

describe("useThemeApplier", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-mood");
    document.documentElement.removeAttribute("style");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("applies mood variables after palette variables and persists both ids", async () => {
    render(<ThemeProbe themeId="catppuccin-latte" moodPresetId="aether-sky" />);

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("catppuccin-latte");
      expect(document.documentElement.dataset.mood).toBe("aether-sky");
    });

    const style = document.documentElement.style;
    expect(style.getPropertyValue("--terminal-canvas-bg").trim()).toBe(DEFAULT_BG);
    expect(style.getPropertyValue("--gold").trim()).toBe("#f0cf7a");
    expect(localStorage.getItem("aether:theme")).toBe("catppuccin-latte");
    expect(localStorage.getItem("aether:moodPreset")).toBe("aether-sky");
  });

  it("replaces the previous mood variable set on rerender", async () => {
    const { rerender } = render(<ThemeProbe themeId="aether-dark" moodPresetId="aether-dream" />);

    await waitFor(() => {
      expect(document.documentElement.dataset.mood).toBe("aether-dream");
    });
    expect(document.documentElement.style.getPropertyValue("--terminal-canvas-bg").trim()).toBe(DEFAULT_BG);

    rerender(<ThemeProbe themeId="aether-dark" moodPresetId="aether-pro" />);

    await waitFor(() => {
      expect(document.documentElement.dataset.mood).toBe("aether-pro");
    });
    expect(document.documentElement.style.getPropertyValue("--terminal-canvas-bg").trim()).toBe(DEFAULT_BG);
    expect(document.documentElement.style.getPropertyValue("--terminal-watermark-opacity").trim()).toBe("0.045");
  });

  it("replaces Sakura surface tokens when switching to darker moods", async () => {
    const { rerender } = render(<ThemeProbe themeId="sakura-hub" moodPresetId="aether-sakura" />);

    await waitFor(() => {
      expect(document.documentElement.dataset.mood).toBe("aether-sakura");
    });
    expect(document.documentElement.dataset.theme).toBe("sakura-hub");
    expect(document.documentElement.classList.contains("light-theme")).toBe(true);
    expect(document.documentElement.classList.contains("dark-theme")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--statusbar-bg")).toContain("255, 238, 247");
    expect(document.documentElement.style.getPropertyValue("--dialog-surface")).toContain("255, 248, 252");
    expect(document.documentElement.style.getPropertyValue("--settings-card-bg")).toContain("255, 246, 250");

    rerender(<ThemeProbe themeId="sakura-hub" moodPresetId="aether-pro" />);

    await waitFor(() => {
      expect(document.documentElement.dataset.mood).toBe("aether-pro");
    });
    expect(document.documentElement.dataset.theme).toBe("sakura-hub");
    expect(document.documentElement.classList.contains("dark-theme")).toBe(true);
    expect(document.documentElement.classList.contains("light-theme")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--statusbar-bg")).toContain("2, 8, 16");
    expect(document.documentElement.style.getPropertyValue("--dialog-surface")).toContain("8, 22, 34");
    expect(document.documentElement.style.getPropertyValue("--settings-card-bg")).toContain("4, 13, 23");
    expect(document.documentElement.style.getPropertyValue("--toolkit-grid-bg")).toContain("4, 13, 23");
    expect(document.documentElement.style.getPropertyValue("--chrome-frame-bg")).toContain("2, 8, 16");
    expect(document.documentElement.style.getPropertyValue("--statusbar-bg")).not.toContain("255, 238, 247");
    expect(document.documentElement.style.getPropertyValue("--dialog-surface")).not.toContain("255, 248, 252");
    expect(document.documentElement.style.getPropertyValue("--settings-card-bg")).not.toContain("255, 246, 250");

    rerender(<ThemeProbe themeId="sakura-hub" moodPresetId="aether-sky" />);

    await waitFor(() => {
      expect(document.documentElement.dataset.mood).toBe("aether-sky");
    });
    expect(document.documentElement.style.getPropertyValue("--chrome-frame-bg")).toContain("2, 8, 18");
    expect(document.documentElement.style.getPropertyValue("--statusbar-bg")).not.toContain("255, 238, 247");
  });

  it("uses the mood material brightness for light/dark classes instead of the palette id", async () => {
    const { rerender } = render(<ThemeProbe themeId="aether-dark" moodPresetId="aether-sakura" />);

    await waitFor(() => {
      expect(document.documentElement.classList.contains("light-theme")).toBe(true);
    });
    expect(document.documentElement.classList.contains("dark-theme")).toBe(false);

    rerender(<ThemeProbe themeId="catppuccin-latte" moodPresetId="aether-pro" />);

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark-theme")).toBe(true);
    });
    expect(document.documentElement.classList.contains("light-theme")).toBe(false);
  });

  it("applies material overrides to the active mood only", async () => {
    const { rerender } = render(
      <ThemeProbe
        themeId="sakura-hub"
        moodPresetId="aether-sakura"
        materialOverrides={{ panelColor: "#fffafc", panelAlpha: 0.94, terminalAlpha: 0.48 }}
      />,
    );

    await waitFor(() => {
      expect(document.documentElement.dataset.mood).toBe("aether-sakura");
    });

    expect(document.documentElement.style.getPropertyValue("--mood-left-panel-bg")).toContain("255, 250, 252");
    expect(document.documentElement.style.getPropertyValue("--mood-left-panel-bg")).toContain("0.94");
    expect(document.documentElement.style.getPropertyValue("--terminal-canvas-bg")).toContain("0.48");

    rerender(<ThemeProbe themeId="sakura-hub" moodPresetId="aether-pro" />);

    await waitFor(() => {
      expect(document.documentElement.dataset.mood).toBe("aether-pro");
    });
    expect(document.documentElement.style.getPropertyValue("--mood-left-panel-bg")).not.toContain("255, 250, 252");
  });

  it("applies low opacity material overrides without snapping surfaces back to gray slabs", async () => {
    render(
      <ThemeProbe
        themeId="sakura-hub"
        moodPresetId="aether-sakura"
        materialOverrides={{
          backdropColor: "#fff8fb",
          panelColor: "#fff0f6",
          chromeColor: "#fff6fa",
          terminalColor: "#5f1638",
          backdropAlpha: 0.72,
          panelAlpha: 0.18,
          chromeAlpha: 0.16,
          terminalAlpha: 0.08,
        }}
      />,
    );

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--sakura-root-alpha").trim()).toBe("0.72");
    });

    const style = document.documentElement.style;
    expect(style.getPropertyValue("--mood-left-panel-bg")).toContain("0.18");
    expect(style.getPropertyValue("--statusbar-bg")).toContain("0.16");
    expect(style.getPropertyValue("--terminal-canvas-bg")).toContain("0.08");
    expect(style.getPropertyValue("--terminal-raster-bg")).toContain("0.3");
    expect(style.getPropertyValue("--glass-dense")).not.toContain("0.72");
  });

  it("applies wallpaper placement variables", async () => {
    render(
      <ThemeProbe
        themeId="sakura-hub"
        moodPresetId="aether-sakura"
        wallpaper={{
          imagePath: "C:/Users/example/Pictures/background.jpg",
          opacity: 0.32,
          positionX: 20,
          positionY: 75,
          scale: 135,
        }}
      />,
    );

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--aether-wallpaper-opacity").trim()).toBe("0.32");
    });
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--aether-wallpaper-image")).toContain("background.jpg");
    expect(style.getPropertyValue("--aether-wallpaper-position-x").trim()).toBe("20%");
    expect(style.getPropertyValue("--aether-wallpaper-position-y").trim()).toBe("75%");
    expect(style.getPropertyValue("--aether-wallpaper-size").trim()).toBe("135% auto");
  });

  it("applies global window opacity as backdrop strength variables without dimming text nodes", async () => {
    render(<ThemeProbe themeId="sakura-hub" moodPresetId="aether-sakura" windowOpacity={0.62} />);

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--aether-window-opacity").trim()).toBe("0.62");
    });

    expect(document.documentElement.style.getPropertyValue("--aether-window-veil-opacity").trim()).toBe("0.046");
    expect(document.documentElement.style.opacity).toBe("");
  });

  it("applies terminal surface opacity as material strength without dimming text nodes", async () => {
    render(<ThemeProbe themeId="aether-dark" moodPresetId="aether-sky" terminalSurfaceOpacity={0.26} />);

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--terminal-surface-opacity").trim()).toBe("0.26");
    });

    expect(document.documentElement.style.opacity).toBe("");
  });

  it("keeps dark mood glyph colors solid while pane material stays translucent", async () => {
    render(<ThemeProbe themeId="aether-dark" moodPresetId="aether-sky" />);

    await waitFor(() => {
      expect(document.documentElement.dataset.mood).toBe("aether-sky");
    });

    const style = document.documentElement.style;
    expect(style.getPropertyValue("--text-primary").trim()).toBe("#f6fbff");
    expect(style.getPropertyValue("--text-secondary").trim()).toBe("#cfe4f3");
    expect(style.getPropertyValue("--text-muted").trim()).toBe("#9fb8cb");
    // Pane material must stay translucent (not an opaque slab). Assert the intent
    // robustly via the resolved alpha rather than pinning a floor-dependent literal,
    // since the glass-tier floor is user-tunable (transparency slider).
    const glassAlpha = (token: string): number =>
      Number(style.getPropertyValue(token).trim().match(/([\d.]+)\)\s*$/)?.[1] ?? "1");
    expect(glassAlpha("--glass-standard")).toBeGreaterThan(0);
    expect(glassAlpha("--glass-standard")).toBeLessThan(0.5);
    expect(glassAlpha("--glass-dense")).toBeGreaterThan(0);
    expect(glassAlpha("--glass-dense")).toBeLessThan(0.5);
  });

  it("reports theme preference persistence failures instead of silently losing customization", async () => {
    const telemetry = collectFallbackEvents();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage locked");
    });

    try {
      render(<ThemeProbe themeId="sakura-hub" moodPresetId="aether-sakura" windowOpacity={0.72} />);

      await waitFor(() => {
        expect(document.documentElement.dataset.theme).toBe("sakura-hub");
        expect(document.documentElement.dataset.mood).toBe("aether-sakura");
      });
      expect(document.documentElement.style.getPropertyValue("--aether-window-opacity").trim()).toBe("0.72");
      expect(telemetry.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "theme-customization",
            operation: "persist_theme_preferences",
            userVisible: true,
          }),
        ]),
      );
    } finally {
      telemetry.cleanup();
    }
  });
});
