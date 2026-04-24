import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SplitPane } from "../shared/ui/SplitPane";

describe("SplitPane", () => {
  it("renders first and second children", () => {
    render(
      <SplitPane
        direction="horizontal"
        first={<div data-testid="first">A</div>}
        second={<div data-testid="second">B</div>}
      />,
    );
    expect(screen.getByTestId("first")).toBeDefined();
    expect(screen.getByTestId("second")).toBeDefined();
  });

  it("renders horizontal direction as row", () => {
    const { container } = render(<SplitPane direction="horizontal" first={<div>A</div>} second={<div>B</div>} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.flexDirection).toBe("row");
  });

  it("renders vertical direction as column", () => {
    const { container } = render(<SplitPane direction="vertical" first={<div>A</div>} second={<div>B</div>} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.flexDirection).toBe("column");
  });

  it("applies defaultRatio to first pane width", () => {
    const { container } = render(
      <SplitPane direction="horizontal" defaultRatio={0.3} first={<div>A</div>} second={<div>B</div>} />,
    );
    const panes = container.querySelectorAll("[class*='pane']");
    // First pane should be 30%
    const firstPane = panes[0] as HTMLElement;
    expect(firstPane.style.width).toBe("30%");
  });

  it("renders a drag handle between panes", () => {
    const { container } = render(<SplitPane direction="horizontal" first={<div>A</div>} second={<div>B</div>} />);
    const handles = container.querySelectorAll("[class*='handle']");
    expect(handles.length).toBeGreaterThanOrEqual(1);
  });
});
