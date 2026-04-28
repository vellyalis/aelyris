import { describe, expect, it } from "vitest";

const sources = import.meta.glob("../features/terminal/NativeTerminalArea.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function getSrc(): string {
  const entries = Object.entries(sources);
  expect(entries.length).toBe(1);
  return entries[0][1];
}

describe("NativeTerminalArea initial output replay", () => {
  it("subscribes first, then replays buffered pane output into AI CLI detection", () => {
    const src = getSrc();
    const effect = src.match(/await subscribeOutput\(terminalId[\s\S]*?catch \{\s*\/\* listener unavailable/);
    expect(effect).not.toBeNull();
    const body = effect?.[0] ?? "";

    expect(body.indexOf("await subscribeOutput(terminalId")).toBeLessThan(body.indexOf('invoke<string>("capture_pane"'));
    expect(body).toMatch(/terminalId,\s*[\r\n\s]*lines:\s*80,\s*[\r\n\s]*stripAnsiCodes:\s*false/);
    expect(body.indexOf('invoke<string>("capture_pane"')).toBeLessThan(body.indexOf("aiCli.feed(replay)"));
  });
});
