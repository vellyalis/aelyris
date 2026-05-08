import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useThemeApplier } from "../shared/hooks/useTheme";
import { DEFAULT_BG } from "../shared/lib/ansiPalette";
import type { MoodPresetId } from "../shared/themes/moods";

function ThemeProbe({ themeId, moodPresetId }: { themeId: string; moodPresetId: MoodPresetId }) {
  useThemeApplier(themeId, undefined, moodPresetId);
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
    expect(document.documentElement.style.getPropertyValue("--statusbar-bg")).toContain("255, 248, 251");
    expect(document.documentElement.style.getPropertyValue("--dialog-surface")).toContain("255, 240, 247");
    expect(document.documentElement.style.getPropertyValue("--settings-card-bg")).toContain("255, 245, 250");

    rerender(<ThemeProbe themeId="sakura-hub" moodPresetId="aether-pro" />);

    await waitFor(() => {
      expect(document.documentElement.dataset.mood).toBe("aether-pro");
    });
    expect(document.documentElement.dataset.theme).toBe("sakura-hub");
    expect(document.documentElement.style.getPropertyValue("--statusbar-bg")).toContain("2, 8, 16");
    expect(document.documentElement.style.getPropertyValue("--dialog-surface")).toContain("8, 22, 34");
    expect(document.documentElement.style.getPropertyValue("--settings-card-bg")).toContain("4, 13, 23");
    expect(document.documentElement.style.getPropertyValue("--toolkit-grid-bg")).toContain("4, 13, 23");
    expect(document.documentElement.style.getPropertyValue("--chrome-frame-bg")).toContain("2, 8, 16");
    expect(document.documentElement.style.getPropertyValue("--statusbar-bg")).not.toContain("255, 248, 251");
    expect(document.documentElement.style.getPropertyValue("--dialog-surface")).not.toContain("255, 240, 247");
    expect(document.documentElement.style.getPropertyValue("--settings-card-bg")).not.toContain("255, 245, 250");

    rerender(<ThemeProbe themeId="sakura-hub" moodPresetId="aether-sky" />);

    await waitFor(() => {
      expect(document.documentElement.dataset.mood).toBe("aether-sky");
    });
    expect(document.documentElement.style.getPropertyValue("--chrome-frame-bg")).toContain("2, 8, 18");
    expect(document.documentElement.style.getPropertyValue("--statusbar-bg")).not.toContain("255, 248, 251");
  });
});
