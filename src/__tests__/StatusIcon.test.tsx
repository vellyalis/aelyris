import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusIcon } from "../shared/ui/StatusIcon";

describe("StatusIcon", () => {
  it("renders SVG for idle status", () => {
    const { container } = render(<StatusIcon status="idle" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("renders SVG for each status", () => {
    const statuses = ["idle", "thinking", "coding", "waiting", "error", "done", "generating"] as const;
    for (const status of statuses) {
      const { container } = render(<StatusIcon status={status} />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      const path = svg?.querySelector("path");
      expect(path).not.toBeNull();
    }
  });

  it("applies the error color through style.fill so CSS var() resolves", () => {
    // Presentation attribute `fill="var(--...)"` is invalid — the SVG
    // must apply the palette via the style path for CSS custom properties
    // to take effect. Assert the wiring, not the resolved color (JSDOM
    // does not resolve var() at query time).
    const { container } = render(<StatusIcon status="error" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("fill")).toBeNull();
    expect(svg?.getAttribute("style") ?? "").toContain("var(--ctp-red)");
  });

  it("respects size prop", () => {
    const { container } = render(<StatusIcon status="idle" size={20} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("20");
  });
});
