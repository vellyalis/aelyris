import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useThemeApplier } from "../shared/hooks/useTheme";
import { DEFAULT_BG } from "../shared/lib/ansiPalette";
import type { MoodMaterialOverrides, MoodPresetId } from "../shared/themes/moods";

function ThemeProbe({
  themeId,
  moodPresetId,
  materialOverrides,
  wallpaper,
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
}) {
  useThemeApplier(themeId, undefined, moodPresetId, materialOverrides, wallpaper);
  return null;
}

describe("useThemeApplier", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-mood");
    document.documentElement.removeAttribute("style");
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

    rerender(
      <ThemeProbe themeId="sakura-hub" moodPresetId="aether-pro" />,
    );

    await waitFor(() => {
      expect(document.documentElement.dataset.mood).toBe("aether-pro");
    });
    expect(document.documentElement.style.getPropertyValue("--mood-left-panel-bg")).not.toContain("255, 250, 252");
  });

  it("applies wallpaper placement variables", async () => {
    render(
      <ThemeProbe
        themeId="sakura-hub"
        moodPresetId="aether-sakura"
        wallpaper={{
          imagePath: "C:/Users/owner/Pictures/background.jpg",
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
});
