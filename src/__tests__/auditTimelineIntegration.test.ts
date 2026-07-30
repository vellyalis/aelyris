import { describe, expect, it } from "vitest";

const sources = import.meta.glob(
  ["../App.tsx", "../features/right-rail/RightRailObserveMode.tsx", "../features/context/AuditTimelinePanel.tsx"],
  {
    query: "?raw",
    import: "default",
    eager: true,
  },
) as Record<string, string>;

function sourceFor(sources: Record<string, string>, suffix: string): string {
  const entry = Object.entries(sources).find(([path]) => path.endsWith(suffix));
  expect(entry).toBeDefined();
  return entry?.[1] ?? "";
}

describe("audit timeline integration", () => {
  it("places Audit Timeline in Observe before legacy Logs", () => {
    const app = sourceFor(sources, "App.tsx");
    const observeMode = sourceFor(sources, "features/right-rail/RightRailObserveMode.tsx");

    expect(app).toContain("<RightRailObserveMode");
    expect(observeMode).toContain('import { AuditTimelinePanel } from "../context/AuditTimelinePanel"');
    expect(observeMode).toContain('widget="audit-timeline"');
    expect(observeMode.indexOf('widget="audit-timeline"')).toBeLessThan(observeMode.indexOf('widget="logs"'));
  });

  it("keeps audit timeline in its own module with scoped CSS", () => {
    const observeMode = sourceFor(sources, "features/right-rail/RightRailObserveMode.tsx");
    const auditTimeline = sourceFor(sources, "features/context/AuditTimelinePanel.tsx");

    expect(observeMode).toContain("<AuditTimelinePanel");
    expect(observeMode).not.toContain("AuditTimelinePanel.module.css");
    expect(auditTimeline).toContain('import styles from "./AuditTimelinePanel.module.css"');
  });
});
