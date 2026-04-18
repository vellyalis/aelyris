import { describe, expect, it, vi } from "vitest";

import { formatExecutedAt } from "../shared/types/history";

describe("formatExecutedAt", () => {
  it("returns 'just now' for very recent timestamps", () => {
    const fixed = new Date("2026-04-18T12:00:00Z");
    vi.setSystemTime(fixed);
    expect(formatExecutedAt("2026-04-18 11:59:30")).toBe("just now");
    vi.useRealTimers();
  });

  it("formats minute-scale ages", () => {
    vi.setSystemTime(new Date("2026-04-18T12:00:00Z"));
    expect(formatExecutedAt("2026-04-18 11:55:00")).toBe("5m ago");
    vi.useRealTimers();
  });

  it("formats hour-scale ages", () => {
    vi.setSystemTime(new Date("2026-04-18T12:00:00Z"));
    expect(formatExecutedAt("2026-04-18 09:00:00")).toBe("3h ago");
    vi.useRealTimers();
  });

  it("formats day-scale ages", () => {
    vi.setSystemTime(new Date("2026-04-18T12:00:00Z"));
    expect(formatExecutedAt("2026-04-16 12:00:00")).toBe("2d ago");
    vi.useRealTimers();
  });

  it("falls back to locale date for older entries", () => {
    vi.setSystemTime(new Date("2026-04-18T12:00:00Z"));
    const out = formatExecutedAt("2026-03-01 12:00:00");
    // Shape assertion: not a relative string, contains digits + separator.
    expect(out).not.toMatch(/ago$/);
    expect(out).toMatch(/\d/);
    vi.useRealTimers();
  });

  it("returns the raw string on parse failure", () => {
    expect(formatExecutedAt("not-a-date")).toBe("not-a-date");
  });
});
