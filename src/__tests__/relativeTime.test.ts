import { afterEach, describe, expect, it, vi } from "vitest";
import { formatRelativeAge } from "../shared/lib/relativeTime";

describe("formatRelativeAge", () => {
  afterEach(() => vi.restoreAllMocks());

  it("formats recent / minute / hour / day ages with an 'ago' suffix", () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    expect(formatRelativeAge(now - 30_000)).toBe("now");
    expect(formatRelativeAge(now - 5 * 60_000)).toBe("5m ago");
    expect(formatRelativeAge(now - 3 * 3_600_000)).toBe("3h ago");
    expect(formatRelativeAge(now - 2 * 86_400_000)).toBe("2d ago");
  });

  it("treats sub-minute and future timestamps as 'now'", () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    expect(formatRelativeAge(now)).toBe("now");
    expect(formatRelativeAge(now + 10_000)).toBe("now");
  });
});
