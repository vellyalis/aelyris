import { describe, expect, it } from "vitest";

type RawCssSource = string | { default: string };

const rawCssSources = import.meta.glob("../**/*.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, RawCssSource>;

const cssSources = Object.fromEntries(
  Object.entries(rawCssSources).map(([file, source]) => [
    file,
    typeof source === "string" ? source : source.default,
  ]),
) as Record<string, string>;

describe("design token usage", () => {
  it("does not use transparent surface tokens as foreground colors", () => {
    const offenders = Object.entries(cssSources)
      .map(([file, source]) => ({
        file,
        matches: source.match(/color\s*:\s*var\(--aether-bg\)/g) ?? [],
      }))
      .filter((entry) => entry.matches.length > 0)
      .map((entry) => `${entry.file} (${entry.matches.length})`);

    expect(offenders).toEqual([]);
  });

  it("keeps terminal chrome integrated without hard horizontal separator borders", () => {
    const terminalChromeFileSuffixes = [
      "features/terminal/TerminalInfoBar.module.css",
      "features/timeline/TimelineBar.module.css",
      "features/terminal/IMEInputBar.module.css",
    ];

    const sources = terminalChromeFileSuffixes.map((suffix) => {
      const entry = Object.entries(cssSources).find(([file]) => file.includes(suffix));
      expect(entry, suffix).toBeDefined();
      return { file: entry?.[0] ?? suffix, source: entry?.[1] ?? "" };
    });

    const offenders = sources
      .map(({ file, source }) => ({
        file,
        matches: source.match(/border-(?:top|bottom)\s*:\s*1px\s+solid/g) ?? [],
      }))
      .filter((entry) => entry.matches.length > 0)
      .map((entry) => `${entry.file} (${entry.matches.length})`);

    expect(offenders).toEqual([]);
  });
});
