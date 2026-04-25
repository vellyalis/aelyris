import { describe, expect, it } from "vitest";
import {
  ACCENT_KEYS,
  type AccentKey,
  type AccentOverrides,
  accentLabel,
  applyAccentOverrides,
  getPalette,
  isValidHex,
  normalizeHex,
} from "../shared/themes/catppuccin";

describe("themes/catppuccin — hex helpers", () => {
  it("validates 6-digit hex", () => {
    expect(isValidHex("#aabbcc")).toBe(true);
    expect(isValidHex("#AABBCC")).toBe(true);
  });

  it("validates 3-digit shorthand", () => {
    expect(isValidHex("#abc")).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(isValidHex("aabbcc")).toBe(false); // missing leading #
    expect(isValidHex("#abcd")).toBe(false); // 4 digits
    expect(isValidHex("#xyzxyz")).toBe(false); // non-hex chars
    expect(isValidHex("#")).toBe(false);
    expect(isValidHex("")).toBe(false);
  });

  it("normalizes shorthand to 6 digits", () => {
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("#FFF")).toBe("#ffffff");
  });

  it("lowercases 6-digit input", () => {
    expect(normalizeHex("#AABBCC")).toBe("#aabbcc");
  });

  it("passes through invalid input unchanged", () => {
    expect(normalizeHex("not a color")).toBe("not a color");
  });
});

describe("themes/catppuccin — accent metadata", () => {
  it("ACCENT_KEYS contains every expected accent", () => {
    const expected: AccentKey[] = [
      "red",
      "green",
      "yellow",
      "blue",
      "magenta",
      "cyan",
      "peach",
      "mauve",
      "pink",
      "teal",
      "sky",
      "lavender",
      "flamingo",
      "rosewater",
      "sapphire",
      "maroon",
    ];
    expect([...ACCENT_KEYS].sort()).toEqual([...expected].sort());
  });

  it("accentLabel capitalises", () => {
    expect(accentLabel("sapphire")).toBe("Sapphire");
    expect(accentLabel("rosewater")).toBe("Rosewater");
  });
});

describe("themes/catppuccin — applyAccentOverrides", () => {
  const base = getPalette("aether-dark");

  it("returns the same reference when overrides is undefined", () => {
    expect(applyAccentOverrides(base, undefined)).toBe(base);
  });

  it("returns the same reference when overrides is empty", () => {
    expect(applyAccentOverrides(base, {})).toBe(base);
  });

  it("returns a new palette with the override applied", () => {
    const overrides: AccentOverrides = { sapphire: "#abcdef" };
    const result = applyAccentOverrides(base, overrides);
    expect(result).not.toBe(base);
    expect(result.sapphire).toBe("#abcdef");
    // Other accents stay intact
    expect(result.mauve).toBe(base.mauve);
    expect(result.red).toBe(base.red);
  });

  it("normalises hex values (lowercases, expands shorthand)", () => {
    const result = applyAccentOverrides(base, { sapphire: "#ABC" });
    expect(result.sapphire).toBe("#aabbcc");
  });

  it("ignores invalid hex values", () => {
    const result = applyAccentOverrides(base, { sapphire: "not-a-hex" });
    expect(result.sapphire).toBe(base.sapphire);
  });

  it("ignores keys outside the accent set", () => {
    // Casting through unknown to attempt smuggling a non-accent key.
    const result = applyAccentOverrides(
      base,
      { text: "#ffffff", sapphire: "#aabbcc" } as unknown as AccentOverrides,
    );
    expect(result.sapphire).toBe("#aabbcc");
    // text should not be touched — applyAccentOverrides only writes accents.
    expect(result.text).toBe(base.text);
  });

  it("does not mutate the input palette", () => {
    const snapshot = { ...base };
    applyAccentOverrides(base, { sapphire: "#000000" });
    expect(base).toEqual(snapshot);
  });
});
