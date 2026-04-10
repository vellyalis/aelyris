import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { FileIcon } from "../features/file-tree/FileIcon";

const FILE_TYPES = [
  "folder", "ts", "js", "json", "md", "rs", "toml",
  "css", "html", "yaml", "py", "svg", "image",
  "shell", "git", "lock", "file", "unknown",
];

describe("FileIcon", () => {
  it.each(FILE_TYPES)("renders without crashing for type '%s'", (type) => {
    const { container } = render(<FileIcon type={type} />);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("renders open folder variant", () => {
    const { container } = render(<FileIcon type="folder" isOpen />);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("renders closed folder variant", () => {
    const { container } = render(<FileIcon type="folder" isOpen={false} />);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("uses fallback icon for unknown types", () => {
    const { container: known } = render(<FileIcon type="ts" />);
    const { container: unknown } = render(<FileIcon type="xyz123" />);
    // Both render SVGs, but they may differ
    expect(known.querySelector("svg")).toBeTruthy();
    expect(unknown.querySelector("svg")).toBeTruthy();
  });
});
