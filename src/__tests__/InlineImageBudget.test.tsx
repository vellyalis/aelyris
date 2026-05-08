import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { formatMiB, InlineImageBudget } from "../features/statusbar/InlineImageBudget";
import type { ImageMetrics } from "../shared/types/terminal";

const MIB = 1024 * 1024;

function metrics(partial: Partial<ImageMetrics>): ImageMetrics {
  return {
    bytesUsed: 0,
    cap: 50 * MIB,
    count: 0,
    ...partial,
  };
}

describe("InlineImageBudget", () => {
  it("renders nothing when metrics are null", () => {
    const { container } = render(<InlineImageBudget metrics={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when count is zero", () => {
    const { container } = render(<InlineImageBudget metrics={metrics({ bytesUsed: 0, count: 0 })} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a status badge with bytes and count for a healthy budget", () => {
    render(<InlineImageBudget metrics={metrics({ bytesUsed: 12 * MIB + Math.floor(0.3 * MIB), count: 3 })} />);
    const badge = screen.getByRole("status");
    expect(badge.textContent).toContain("12.3 MiB");
    expect(badge.textContent).toContain("50 MiB");
    expect(badge.textContent).toContain("3");
    expect(badge.getAttribute("title")).toMatch(/3 images/);
  });

  it("escalates to the warn tier above 80 % usage", () => {
    render(<InlineImageBudget metrics={metrics({ bytesUsed: Math.floor(40.5 * MIB), count: 5 })} />);
    const badge = screen.getByRole("status");
    expect(badge.className).toMatch(/imageBudgetWarn/);
    expect(badge.className).not.toMatch(/imageBudgetDanger/);
  });

  it("escalates to the danger tier above 95 % usage", () => {
    render(<InlineImageBudget metrics={metrics({ bytesUsed: Math.floor(48 * MIB), count: 8 })} />);
    const badge = screen.getByRole("status");
    expect(badge.className).toMatch(/imageBudgetDanger/);
    expect(badge.getAttribute("title")).toMatch(/eviction imminent/i);
  });

  it("uses the singular noun when only one image is retained", () => {
    render(<InlineImageBudget metrics={metrics({ bytesUsed: 1 * MIB, count: 1 })} />);
    const badge = screen.getByRole("status");
    expect(badge.getAttribute("title")).toMatch(/1 image\b/);
    expect(badge.getAttribute("title")).not.toMatch(/1 images/);
  });

  it("survives a degenerate cap of zero without dividing by zero", () => {
    render(<InlineImageBudget metrics={metrics({ bytesUsed: 1, cap: 0, count: 1 })} />);
    // No throw, badge renders with the OK tier (ratio defaults to 0).
    const badge = screen.getByRole("status");
    expect(badge.className).not.toMatch(/imageBudgetDanger/);
    expect(badge.className).not.toMatch(/imageBudgetWarn/);
  });
});

describe("formatMiB", () => {
  it("formats sub-MiB byte counts with one decimal", () => {
    expect(formatMiB(0.5 * MIB)).toBe("0.5 MiB");
  });

  it("renders whole-MiB values without a trailing decimal", () => {
    expect(formatMiB(12 * MIB)).toBe("12 MiB");
    expect(formatMiB(50 * MIB)).toBe("50 MiB");
  });

  it("keeps one decimal for fractional MiB values", () => {
    expect(formatMiB(12.34 * MIB)).toBe("12.3 MiB");
  });

  it("rounds to whole MiB once the number reaches three digits", () => {
    expect(formatMiB(123 * MIB)).toBe("123 MiB");
  });
});
