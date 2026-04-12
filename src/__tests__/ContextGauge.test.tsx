import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ContextGauge } from "../shared/ui/ContextGauge";

describe("ContextGauge", () => {
  it("renders with percentage text", () => {
    const { container } = render(<ContextGauge percent={42} />);
    expect(container.textContent).toContain("42%");
  });

  it("shows green for low usage (<40%)", () => {
    const { container } = render(<ContextGauge percent={20} />);
    const bar = container.querySelector("[class*='bar']") as HTMLElement;
    expect(bar?.style.background).toBe("rgb(166, 227, 161)"); // #a6e3a1
  });

  it("shows orange for high usage (80-94%)", () => {
    const { container } = render(<ContextGauge percent={85} />);
    const bar = container.querySelector("[class*='bar']") as HTMLElement;
    expect(bar?.style.background).toBe("rgb(250, 179, 135)"); // #fab387 warning orange
  });

  it("shows red for critical usage (>=95%)", () => {
    const { container } = render(<ContextGauge percent={97} />);
    const bar = container.querySelector("[class*='bar']") as HTMLElement;
    expect(bar?.style.background).toBe("rgb(243, 139, 168)"); // #f38ba8 critical red
  });

  it("clamps at 100%", () => {
    const { container } = render(<ContextGauge percent={150} />);
    const bar = container.querySelector("[class*='bar']") as HTMLElement;
    expect(bar?.style.width).toBe("100%");
  });

  it("shows 0% correctly", () => {
    const { container } = render(<ContextGauge percent={0} />);
    expect(container.textContent).toContain("0%");
    const bar = container.querySelector("[class*='bar']") as HTMLElement;
    expect(bar?.style.width).toBe("0%");
  });
});
