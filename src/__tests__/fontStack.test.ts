import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getMonoFontStack } from "../shared/lib/fontStack";

const FALLBACK = "'IBM Plex Mono', 'Cascadia Code', monospace";

describe("getMonoFontStack", () => {
  let originalValue: string | null = null;

  beforeEach(() => {
    // Snapshot whatever is on :root so we can restore it after each case.
    originalValue = document.documentElement.style.getPropertyValue("--font-mono") || null;
  });

  afterEach(() => {
    if (originalValue) {
      document.documentElement.style.setProperty("--font-mono", originalValue);
    } else {
      document.documentElement.style.removeProperty("--font-mono");
    }
  });

  it("resolves --font-mono from the document root when set", () => {
    document.documentElement.style.setProperty("--font-mono", "'JetBrains Mono', monospace");
    expect(getMonoFontStack()).toBe("'JetBrains Mono', monospace");
  });

  it("falls back to the hardcoded stack when --font-mono is unset", () => {
    document.documentElement.style.removeProperty("--font-mono");
    expect(getMonoFontStack()).toBe(FALLBACK);
  });

  it("trims whitespace from the resolved value", () => {
    document.documentElement.style.setProperty("--font-mono", "  'Fira Code', monospace  ");
    expect(getMonoFontStack()).toBe("'Fira Code', monospace");
  });
});
