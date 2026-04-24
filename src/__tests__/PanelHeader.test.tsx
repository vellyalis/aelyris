import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PanelHeader } from "../shared/ui/PanelHeader";

describe("PanelHeader", () => {
  it("renders the title in a plain div when not collapsible", () => {
    const { container } = render(<PanelHeader title="Tasks" />);
    expect(container.textContent).toContain("Tasks");
    // Plain div, not a button — there's nothing to toggle.
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders subtitle + count as separate elements", () => {
    const { container } = render(<PanelHeader title="Toolkit" subtitle="aether-terminal" count={7} />);
    expect(container.textContent).toContain("Toolkit");
    expect(container.textContent).toContain("aether-terminal");
    expect(container.textContent).toContain("7");
  });

  it("omits the count slot when count is not provided", () => {
    const { container } = render(<PanelHeader title="Tasks" />);
    // The count badge is the only element outside of title/leading/actions
    // that carries numeric text — verify we didn't accidentally render "0".
    expect(container.textContent).toBe("Tasks");
  });

  it("renders leading icon + actions slot", () => {
    const { container } = render(
      <PanelHeader
        title="Diffs"
        leadingIcon={<span data-testid="leading">icon</span>}
        actions={
          <button type="button" data-testid="act">
            Do
          </button>
        }
      />,
    );
    expect(container.querySelector("[data-testid='leading']")).not.toBeNull();
    expect(container.querySelector("[data-testid='act']")).not.toBeNull();
  });

  describe("collapsible mode", () => {
    it("renders as a button with aria-expanded when collapsible", () => {
      const { container } = render(<PanelHeader title="Workflows" collapsible collapsed={false} />);
      const btn = container.querySelector("button");
      expect(btn).not.toBeNull();
      expect(btn?.getAttribute("aria-expanded")).toBe("true");
    });

    it("aria-expanded is false when collapsed", () => {
      const { container } = render(<PanelHeader title="Workflows" collapsible collapsed={true} />);
      const btn = container.querySelector("button");
      expect(btn?.getAttribute("aria-expanded")).toBe("false");
    });

    it("fires onToggle when the header button is clicked", () => {
      const onToggle = vi.fn();
      const { container } = render(<PanelHeader title="Workflows" collapsible onToggle={onToggle} />);
      fireEvent.click(container.querySelector("button")!);
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it("clicking inside the actions slot does not bubble up to the toggle", () => {
      const onToggle = vi.fn();
      const onAction = vi.fn();
      const { container } = render(
        <PanelHeader
          title="Workflows"
          collapsible
          onToggle={onToggle}
          actions={
            <button type="button" data-testid="act" onClick={onAction}>
              Go
            </button>
          }
        />,
      );
      fireEvent.click(container.querySelector("[data-testid='act']")!);
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onToggle).not.toHaveBeenCalled();
    });
  });
});
