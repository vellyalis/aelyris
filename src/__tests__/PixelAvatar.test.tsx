import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PixelAvatar } from "../shared/ui/PixelAvatar";

describe("PixelAvatar", () => {
  it("renders an SVG element", () => {
    const { container } = render(<PixelAvatar seed="test" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("uses default size of 32", () => {
    const { container } = render(<PixelAvatar seed="test" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("32");
    expect(svg?.getAttribute("height")).toBe("32");
  });

  it("respects custom size", () => {
    const { container } = render(<PixelAvatar seed="test" size={48} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("48");
  });

  it("generates different avatars for different seeds", () => {
    const { container: c1 } = render(<PixelAvatar seed="project-a" />);
    const { container: c2 } = render(<PixelAvatar seed="project-b" />);
    // Different seeds should produce different SVG content
    expect(c1.innerHTML).not.toBe(c2.innerHTML);
  });

  it("generates same avatar for same seed", () => {
    const { container: c1 } = render(<PixelAvatar seed="consistent" />);
    const { container: c2 } = render(<PixelAvatar seed="consistent" />);
    expect(c1.innerHTML).toBe(c2.innerHTML);
  });
});
