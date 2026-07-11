import { beforeEach, describe, expect, it } from "vitest";
import { cycleWorkspaceRegion } from "../shared/lib/workspaceRegionFocus";

describe("workspace region focus", () => {
  beforeEach(() => {
    document.body.innerHTML = ["sidebar", "center", "right-rail", "status-bar"]
      .map((region) => `<section data-workspace-region="${region}" tabindex="-1"></section>`)
      .join("");
    for (const element of document.querySelectorAll<HTMLElement>("[data-workspace-region]")) {
      element.getClientRects = () => [{ width: 1 } as DOMRect] as unknown as DOMRectList;
    }
  });

  it("cycles forward and backward in shell order", () => {
    expect(cycleWorkspaceRegion()?.dataset.workspaceRegion).toBe("sidebar");
    expect(cycleWorkspaceRegion()?.dataset.workspaceRegion).toBe("center");
    expect(cycleWorkspaceRegion(true)?.dataset.workspaceRegion).toBe("sidebar");
  });

  it("skips hidden regions", () => {
    const sidebar = document.querySelector<HTMLElement>('[data-workspace-region="sidebar"]');
    if (sidebar) sidebar.hidden = true;
    document.querySelector<HTMLElement>('[data-workspace-region="right-rail"]')?.setAttribute("aria-hidden", "true");
    expect(cycleWorkspaceRegion()?.dataset.workspaceRegion).toBe("center");
    expect(cycleWorkspaceRegion()?.dataset.workspaceRegion).toBe("status-bar");
  });
});
