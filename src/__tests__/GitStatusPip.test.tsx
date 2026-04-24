import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GitStatusPip } from "../shared/ui/GitStatusPip";

describe("GitStatusPip", () => {
  describe("letter variant (default)", () => {
    it("renders the M glyph with an aria-label for modified", () => {
      const { container } = render(<GitStatusPip status="modified" />);
      const pip = container.firstElementChild as HTMLElement;
      expect(pip.textContent).toBe("M");
      expect(pip.getAttribute("aria-label")).toBe("Modified");
      expect(pip.getAttribute("data-status")).toBe("modified");
    });

    it("maps each known status to its canonical glyph", () => {
      const cases: Array<[string, string, string]> = [
        ["added", "A", "Added"],
        ["deleted", "D", "Deleted"],
        ["renamed", "R", "Renamed"],
        ["untracked", "?", "Untracked"],
        ["conflicted", "!", "Conflicted"],
      ];
      for (const [status, glyph, label] of cases) {
        const { container } = render(<GitStatusPip status={status} />);
        const pip = container.firstElementChild as HTMLElement;
        expect(pip.textContent).toBe(glyph);
        expect(pip.getAttribute("aria-label")).toBe(label);
      }
    });

    it("falls back to the modified meta when status is unknown", () => {
      // Unknown status should not throw and should render *something* so
      // new backend statuses degrade gracefully instead of blanking the row.
      const { container } = render(<GitStatusPip status="some-future-status" />);
      const pip = container.firstElementChild as HTMLElement;
      expect(pip.textContent).toBe("M");
      expect(pip.getAttribute("aria-label")).toBe("Modified");
    });
  });

  describe("dot variant", () => {
    it("renders an empty element with role=img + aria-label", () => {
      const { container } = render(<GitStatusPip status="added" variant="dot" />);
      const pip = container.firstElementChild as HTMLElement;
      // Dot has no text content — colour + shape carry the meaning.
      expect(pip.textContent).toBe("");
      expect(pip.getAttribute("role")).toBe("img");
      expect(pip.getAttribute("aria-label")).toBe("Added");
    });
  });

  it("forwards className onto the root so callers can dock the pip", () => {
    const { container } = render(<GitStatusPip status="modified" className="row-right" />);
    const pip = container.firstElementChild as HTMLElement;
    expect(pip.className).toContain("row-right");
  });
});
