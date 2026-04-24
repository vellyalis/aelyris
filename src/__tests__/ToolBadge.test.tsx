import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ToolName } from "../shared/types/toolBadge";
import { extractToolName } from "../shared/types/toolBadge";
import { ToolBadge } from "../shared/ui/ToolBadge";

describe("ToolBadge", () => {
  it("renders badge with tool name", () => {
    const { container } = render(<ToolBadge tool="Edit" />);
    expect(container.textContent).toBe("Edit");
  });

  it("renders for each tool name", () => {
    const tools: ToolName[] = ["Read", "Edit", "Write", "Bash", "Glob", "Grep", "Search", "Agent"];
    for (const tool of tools) {
      const { container } = render(<ToolBadge tool={tool} />);
      expect(container.textContent).toBe(tool);
    }
  });

  it("applies color style", () => {
    const { container } = render(<ToolBadge tool="Bash" />);
    const badge = container.querySelector("span");
    // Browser converts hex to rgb
    expect(badge?.style.color).toBeTruthy();
  });
});

describe("extractToolName", () => {
  it("extracts Edit from Edit(file.ts)", () => {
    expect(extractToolName("Edit(file.ts)")).toBe("Edit");
  });

  it("extracts Bash from Bash(ls -la)", () => {
    expect(extractToolName("Bash(ls -la)")).toBe("Bash");
  });

  it("extracts Read from Read(path/to/file)", () => {
    expect(extractToolName("Read(path/to/file)")).toBe("Read");
  });

  it("returns null for no tool", () => {
    expect(extractToolName("some random text")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractToolName("")).toBeNull();
  });
});
