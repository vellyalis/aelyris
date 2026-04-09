import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
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

  it("uses correct color for error status", () => {
    const { container } = render(<StatusIcon status="error" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("fill")).toBe("#f38ba8");
  });

  it("respects size prop", () => {
    const { container } = render(<StatusIcon status="idle" size={20} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("20");
  });
});
