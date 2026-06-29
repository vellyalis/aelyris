import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemePaletteEditor } from "../features/settings/ThemePaletteEditor";
import { useAppStore } from "../shared/store/appStore";
import { getPalette } from "../shared/themes/catppuccin";

beforeEach(() => {
  try {
    localStorage.removeItem("aelyris:themeOverrides");
  } catch {
    /* ignore */
  }
  useAppStore.setState({ themeOverrides: {} });
});

afterEach(() => cleanup());

describe("ThemePaletteEditor", () => {
  it("renders one row per accent and the reset button starts disabled", () => {
    render(<ThemePaletteEditor themeId="aelyris-dark" />);
    // 16 accents in ACCENT_KEYS
    expect(screen.getAllByRole("listitem")).toHaveLength(16);

    const resetBtn = screen.getByRole("button", { name: /reset all accents/i });
    expect(resetBtn).toHaveProperty("disabled", true);
    expect(resetBtn.textContent).toContain("Defaults");
  });

  it("commits a hex edit through the input on Enter and writes to the store", () => {
    const onDirty = vi.fn();
    render(<ThemePaletteEditor themeId="aelyris-dark" onDirty={onDirty} />);
    const input = screen.getByLabelText(/sapphire hex value/i) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "#abcdef" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useAppStore.getState().themeOverrides["aelyris-dark"]).toEqual({
      sapphire: "#abcdef",
    });
    expect(onDirty).toHaveBeenCalled();
  });

  it("normalises 3-digit shorthand on commit", () => {
    render(<ThemePaletteEditor themeId="aelyris-dark" />);
    const input = screen.getByLabelText(/sapphire hex value/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "#abc" } });
    fireEvent.blur(input);
    expect(useAppStore.getState().themeOverrides["aelyris-dark"]?.sapphire).toBe("#aabbcc");
  });

  it("flags invalid hex with aria-invalid and does not write", () => {
    render(<ThemePaletteEditor themeId="aelyris-dark" />);
    const input = screen.getByLabelText(/sapphire hex value/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "not-a-hex" } });
    fireEvent.blur(input);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(useAppStore.getState().themeOverrides).toEqual({});
  });

  it("clears override when committed value matches base palette", () => {
    const base = getPalette("aelyris-dark");
    // Seed an override first
    useAppStore.getState().setAccentOverride("aelyris-dark", "sapphire", "#111111");
    render(<ThemePaletteEditor themeId="aelyris-dark" />);
    const input = screen.getByLabelText(/sapphire hex value/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: base.sapphire } });
    fireEvent.blur(input);
    expect(useAppStore.getState().themeOverrides).toEqual({});
  });

  it("global Reset button drops every override and reflects the count", () => {
    const onDirty = vi.fn();
    useAppStore.getState().setAccentOverride("aelyris-dark", "sapphire", "#111111");
    useAppStore.getState().setAccentOverride("aelyris-dark", "mauve", "#222222");
    render(<ThemePaletteEditor themeId="aelyris-dark" onDirty={onDirty} />);

    const resetBtn = screen.getByRole("button", { name: /reset all accents/i });
    expect(resetBtn.textContent).toContain("Reset (2)");
    fireEvent.click(resetBtn);
    expect(useAppStore.getState().themeOverrides).toEqual({});
    expect(onDirty).toHaveBeenCalled();
  });

  it("shows a per-accent reset button only for overridden accents", () => {
    useAppStore.getState().setAccentOverride("aelyris-dark", "sapphire", "#111111");
    render(<ThemePaletteEditor themeId="aelyris-dark" />);

    const sapphireReset = screen.getByRole("button", { name: /reset sapphire to default/i });
    expect(sapphireReset).toHaveProperty("disabled", false);

    const mauveReset = screen.getByRole("button", { name: /reset mauve to default/i });
    expect(mauveReset).toHaveProperty("disabled", true);

    fireEvent.click(sapphireReset);
    expect(useAppStore.getState().themeOverrides).toEqual({});
  });

  it("isolates overrides per themeId when prop changes", () => {
    useAppStore.getState().setAccentOverride("aelyris-dark", "sapphire", "#aaaaaa");
    useAppStore.getState().setAccentOverride("catppuccin-latte", "sapphire", "#bbbbbb");

    const { rerender } = render(<ThemePaletteEditor themeId="aelyris-dark" />);
    let input = screen.getByLabelText(/sapphire hex value/i) as HTMLInputElement;
    expect(input.value).toBe("#aaaaaa");

    rerender(<ThemePaletteEditor themeId="catppuccin-latte" />);
    input = screen.getByLabelText(/sapphire hex value/i) as HTMLInputElement;
    expect(input.value).toBe("#bbbbbb");
  });
});
