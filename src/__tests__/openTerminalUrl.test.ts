import { describe, expect, it, vi } from "vitest";

import {
  fileUrlToPath,
  isPathInside,
  openTerminalUrlWith,
  routeTerminalUrl,
} from "../features/terminal/openTerminalUrl";

describe("fileUrlToPath", () => {
  it("decodes a Windows file:// URL with drive letter", () => {
    expect(fileUrlToPath("file:///C:/Users/x/foo.ts")).toBe("C:/Users/x/foo.ts");
  });

  it("decodes percent-encoded characters", () => {
    expect(fileUrlToPath("file:///C:/Users/x/with%20space.ts")).toBe("C:/Users/x/with space.ts");
  });

  it("decodes a POSIX file:// URL", () => {
    expect(fileUrlToPath("file:///home/x/foo.ts")).toBe("/home/x/foo.ts");
  });

  it("returns null for non-file URLs", () => {
    expect(fileUrlToPath("https://example.com/x")).toBeNull();
  });

  it("returns null for malformed URLs", () => {
    expect(fileUrlToPath("not a url")).toBeNull();
  });
});

describe("isPathInside", () => {
  it("treats equal paths as inside", () => {
    expect(isPathInside("C:/proj", "C:/proj")).toBe(true);
  });

  it("matches a clear child path", () => {
    expect(isPathInside("C:/proj/src/foo.ts", "C:/proj")).toBe(true);
  });

  it("rejects a sibling that shares a prefix", () => {
    // /foo/bar should NOT be considered inside /foo/ba.
    expect(isPathInside("/foo/bar", "/foo/ba")).toBe(false);
  });

  it("normalises Windows backslashes", () => {
    expect(isPathInside("C:\\proj\\src\\foo.ts", "C:/proj")).toBe(true);
  });

  it("is case-insensitive on Windows drive paths", () => {
    expect(isPathInside("c:/PROJ/src/foo.ts", "C:/proj")).toBe(true);
  });

  it("is case-sensitive on POSIX paths", () => {
    expect(isPathInside("/Home/x/foo", "/home/x")).toBe(false);
  });
});

describe("routeTerminalUrl", () => {
  it("routes https to external", () => {
    expect(routeTerminalUrl("https://example.com", { cwd: "C:/proj" })).toEqual({
      kind: "external",
      url: "https://example.com",
    });
  });

  it("routes mailto to external", () => {
    expect(routeTerminalUrl("mailto:x@example.com", { cwd: "C:/proj" })).toEqual({
      kind: "external",
      url: "mailto:x@example.com",
    });
  });

  it("routes in-cwd file:// to editor", () => {
    expect(routeTerminalUrl("file:///C:/proj/src/foo.ts", { cwd: "C:/proj" })).toEqual({
      kind: "editor",
      absolutePath: "C:/proj/src/foo.ts",
    });
  });

  it("routes file:// outside cwd to external", () => {
    expect(routeTerminalUrl("file:///C:/elsewhere/foo.ts", { cwd: "C:/proj" })).toEqual({
      kind: "external",
      url: "file:///C:/elsewhere/foo.ts",
    });
  });

  it("routes file:// to external when no cwd is set", () => {
    expect(routeTerminalUrl("file:///C:/proj/src/foo.ts", { cwd: null })).toEqual({
      kind: "external",
      url: "file:///C:/proj/src/foo.ts",
    });
  });

  it("routes malformed file:// to external (safe fallback)", () => {
    expect(routeTerminalUrl("file://nonsense", { cwd: "C:/proj" })).toEqual({
      kind: "external",
      url: "file://nonsense",
    });
  });
});

describe("openTerminalUrlWith", () => {
  it("calls openInEditor for in-cwd file URLs", async () => {
    const openInEditor = vi.fn();
    const openExternal = vi.fn();
    await openTerminalUrlWith("file:///C:/proj/src/foo.ts", { cwd: "C:/proj" }, { openInEditor, openExternal });
    expect(openInEditor).toHaveBeenCalledWith("C:/proj/src/foo.ts");
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("calls openExternal for https URLs", async () => {
    const openInEditor = vi.fn();
    const openExternal = vi.fn().mockResolvedValue(undefined);
    await openTerminalUrlWith("https://example.com", { cwd: "C:/proj" }, { openInEditor, openExternal });
    expect(openInEditor).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("calls openExternal for file URLs outside cwd", async () => {
    const openInEditor = vi.fn();
    const openExternal = vi.fn().mockResolvedValue(undefined);
    await openTerminalUrlWith("file:///C:/somewhere/else.ts", { cwd: "C:/proj" }, { openInEditor, openExternal });
    expect(openInEditor).not.toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith("file:///C:/somewhere/else.ts");
  });
});
