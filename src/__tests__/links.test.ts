import { describe, expect, it } from "vitest";

import { linkAt, scanLinks } from "../features/terminal/links";
import { CellAttr, type CellSnapshot, ColorKind, type GridSnapshot } from "../shared/types/terminal";

function packNamed(n: number): number {
  return (ColorKind.NAMED << 24) | n;
}

function cell(ch: string, attrs = 0): CellSnapshot {
  return { ch, fg: packNamed(256), bg: packNamed(257), attrs };
}

function gridFromRows(rows: string[], opts: { wrapLastCellOfRow?: number[] } = {}): GridSnapshot {
  const cols = Math.max(...rows.map((r) => r.length));
  const cells: CellSnapshot[][] = rows.map((r, rowIdx) => {
    const padded = r.padEnd(cols, " ");
    const rowCells = Array.from(padded).map((c) => cell(c));
    if (opts.wrapLastCellOfRow?.includes(rowIdx) && rowCells.length > 0) {
      rowCells[rowCells.length - 1] = {
        ...rowCells[rowCells.length - 1],
        attrs: rowCells[rowCells.length - 1].attrs | CellAttr.WRAPLINE,
      };
    }
    return rowCells;
  });
  return {
    cols,
    rows: rows.length,
    cells,
    cursor: { row: 0, col: 0, shape: "block", blinking: false, visible: true },
  };
}

describe("scanLinks", () => {
  it("returns an empty list for null snapshot", () => {
    expect(scanLinks(null)).toEqual([]);
  });

  it("returns an empty list when no URL is present", () => {
    const grid = gridFromRows(["nothing to see here"]);
    expect(scanLinks(grid)).toEqual([]);
  });

  it("detects a plain https URL on a single row", () => {
    const grid = gridFromRows(["see https://example.com for info"]);
    const links = scanLinks(grid);
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe("https://example.com");
    expect(links[0].startRow).toBe(0);
    expect(links[0].startCol).toBe(4);
    expect(links[0].endRow).toBe(0);
    expect(links[0].endCol).toBe(22);
  });

  it("detects multiple URLs on a single row", () => {
    const grid = gridFromRows(["a http://one.test b https://two.test"]);
    const links = scanLinks(grid);
    expect(links).toHaveLength(2);
    expect(links[0].url).toBe("http://one.test");
    expect(links[1].url).toBe("https://two.test");
  });

  it("strips trailing punctuation from a URL", () => {
    const grid = gridFromRows(["see https://example.com."]);
    const links = scanLinks(grid);
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe("https://example.com");
  });

  it("strips trailing ')'", () => {
    const grid = gridFromRows(["(see https://example.com)"]);
    const links = scanLinks(grid);
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe("https://example.com");
  });

  it("accepts ftp:// and file:// schemes", () => {
    const grid = gridFromRows(["ftp://host/p file:///c/tmp/x"]);
    const urls = scanLinks(grid).map((l) => l.url);
    expect(urls).toContain("ftp://host/p");
    expect(urls).toContain("file:///c/tmp/x");
  });

  it("ignores unknown schemes like ssh://", () => {
    const grid = gridFromRows(["ssh://host/p"]);
    expect(scanLinks(grid)).toEqual([]);
  });

  it("stitches URLs across WRAPLINE rows", () => {
    // Row 0 ends with WRAPLINE (last cell carries the attr). Both rows are 16
    // wide so no padding space sits at the wrap boundary to break the URL.
    const grid = gridFromRows(["abc https://exam", "ple.com/path    "], { wrapLastCellOfRow: [0] });
    const links = scanLinks(grid);
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe("https://example.com/path");
    expect(links[0].startRow).toBe(0);
    expect(links[0].startCol).toBe(4);
    expect(links[0].endRow).toBe(1);
    expect(links[0].endCol).toBe(11);
  });
});

describe("linkAt", () => {
  it("returns the link covering a hit cell", () => {
    const grid = gridFromRows(["aa https://example.com bb"]);
    const [link] = scanLinks(grid);
    expect(linkAt([link], 0, 10)?.url).toBe("https://example.com");
  });

  it("returns null outside the link range", () => {
    const grid = gridFromRows(["aa https://example.com bb"]);
    const [link] = scanLinks(grid);
    expect(linkAt([link], 0, 0)).toBeNull();
    expect(linkAt([link], 0, 100)).toBeNull();
  });

  it("handles multi-row links", () => {
    const grid = gridFromRows(["abc https://exam", "ple.com/path    "], { wrapLastCellOfRow: [0] });
    const links = scanLinks(grid);
    expect(linkAt(links, 0, 15)?.url).toBe("https://example.com/path");
    expect(linkAt(links, 1, 5)?.url).toBe("https://example.com/path");
    expect(linkAt(links, 1, 14)).toBeNull();
  });
});
