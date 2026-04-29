import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceTabs } from "../features/workspace-tabs/WorkspaceTabs";
import type { Tab } from "../shared/hooks/useTabManager";

const sources = import.meta.glob("../features/workspace-tabs/WorkspaceTabs.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const tabs: Tab[] = [
  { id: "tab-1", label: "One", shell: "powershell" },
  { id: "tab-2", label: "Two", shell: "powershell" },
];

describe("WorkspaceTabs close controls", () => {
  it("renders close controls as sibling buttons rather than role buttons inside tab triggers", () => {
    const entries = Object.entries(sources);
    expect(entries.length).toBe(1);
    const src = entries[0][1];

    expect(src).toContain("className={styles.tabWrap}");
    expect(src).toContain("data-active={effectiveActiveId === tab.id || undefined}");
    expect(src).toMatch(/<button[\s\S]*className=\{styles\.tabClose\}/);
    expect(src).not.toMatch(/role="button"/);
    expect(src).not.toMatch(/<span\s+className=\{styles\.tabClose\}/);
  });

  it("closing a tab does not select it first", () => {
    const onSelectTab = vi.fn();
    const onCloseTab = vi.fn();
    const { getByLabelText } = render(
      <WorkspaceTabs
        tabs={tabs}
        activeTabId="tab-1"
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onNewTab={() => {}}
      />,
    );

    fireEvent.click(getByLabelText("Close Two"));

    expect(onCloseTab).toHaveBeenCalledWith("tab-2");
    expect(onSelectTab).not.toHaveBeenCalled();
  });
});
