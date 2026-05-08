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
});
