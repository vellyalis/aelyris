import { describe, expect, it } from "vitest";

const appSources = import.meta.glob("../App.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function sourceFor(sources: Record<string, string>, suffix: string): string {
  const entry = Object.entries(sources).find(([path]) => path.endsWith(suffix));
  expect(entry).toBeDefined();
  return entry?.[1] ?? "";
}

describe("audit timeline integration", () => {
  it("places Audit Timeline in Observe before legacy Logs", () => {
    const app = sourceFor(appSources, "App.tsx");

    expect(app).toContain('import("./features/context/AuditTimelinePanel")');
    expect(app).toContain('data-widget="audit-timeline"');
    expect(app.indexOf('data-widget="audit-timeline"')).toBeLessThan(app.indexOf('data-widget="logs"'));
  });

  it("keeps audit timeline in its own module with scoped CSS", () => {
    const app = sourceFor(appSources, "App.tsx");

    expect(app).toContain("AuditTimelinePanel");
    expect(app).not.toContain("AuditTimelinePanel.module.css");
  });
});
