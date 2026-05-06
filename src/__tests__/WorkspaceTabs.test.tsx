import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
// Vitest runs this source-contract test in Node. The app tsconfig does not
// include @types/node, so keep the Node-only imports scoped and ignored here.
// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { join } from "node:path";
import { WorkspaceTabs } from "../features/workspace-tabs/WorkspaceTabs";
import type { Tab } from "../shared/hooks/useTabManager";

const sources = import.meta.glob("../features/workspace-tabs/WorkspaceTabs.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

declare const process: { cwd(): string };

const workspaceTabsCss = readFileSync(
  join(process.cwd(), "src/features/workspace-tabs/WorkspaceTabs.module.css"),
  "utf8",
);

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
    expect(src).toContain("<Tabs.Root className={styles.root}");
    expect(src).toContain("data-active={effectiveActiveId === tab.id || undefined}");
    expect(src).toMatch(/<button[\s\S]*className=\{styles\.tabClose\}/);
    expect(src).not.toMatch(/role="button"/);
    expect(src).not.toMatch(/<span\s+className=\{styles\.tabClose\}/);
  });

  it("reserves tab metadata width so active tab switches do not jitter the footer", () => {
    const source = workspaceTabsCss;
    const rootRule = source.match(/\.root\s*{[\s\S]*?}/)?.[0] ?? "";
    const tabWrapRule = source.match(/\.tabWrap\s*{[\s\S]*?}/)?.[0] ?? "";
    const branchRule = source.match(/\.branchBadge\s*{[\s\S]*?}/)?.[0] ?? "";
    const branchActiveRule =
      source.match(/\.tabWrap:hover \.branchBadge,[\s\S]*?\.tabWrap:focus-within \.branchBadge\s*{[\s\S]*?}/)?.[0] ??
      "";

    expect(rootRule).toContain("flex: 1 1 auto");
    expect(tabWrapRule).toContain("flex: 0 1 clamp(112px, 12vw, 190px)");
    expect(tabWrapRule).toContain("width: clamp(112px, 12vw, 190px)");
    expect(branchRule).toContain("flex: 0 1 72px");
    expect(branchRule).toContain("width: 72px");
    expect(branchRule).toContain("transition: opacity");
    expect(branchActiveRule).not.toContain("max-width");
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
