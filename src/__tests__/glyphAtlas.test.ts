import { describe, expect, it } from "vitest";
import { GlyphAtlas, type GlyphAtlasKey, glyphAtlasKey } from "../features/terminal/gpu/glyphAtlas";

const baseKey: GlyphAtlasKey = {
  text: "A",
  fontFamily: "Cascadia Code",
  fontSize: 14,
  dpr: 1,
};

function atlasForTests(options: { pageSize?: number; maxPages?: number; width?: number; height?: number } = {}) {
  const width = options.width ?? 8;
  const height = options.height ?? 10;
  return new GlyphAtlas({
    pageSize: options.pageSize ?? 64,
    maxPages: options.maxPages ?? 2,
    padding: 1,
    createSurface: (size) => ({ width: size, height: size }),
    clearSurface: () => {},
    rasterizeGlyph: (key) => ({
      width: Math.ceil(width * key.dpr),
      height: Math.ceil(height * key.dpr),
      advanceWidth: width,
      drawTo: () => {},
    }),
  });
}

describe("GlyphAtlas", () => {
  it("builds stable keys from glyph font identity", () => {
    expect(glyphAtlasKey(baseKey)).toBe(glyphAtlasKey({ ...baseKey }));
    expect(glyphAtlasKey({ ...baseKey, bold: true })).not.toBe(glyphAtlasKey(baseKey));
    expect(glyphAtlasKey({ ...baseKey, italic: true })).not.toBe(glyphAtlasKey(baseKey));
  });

  it("records hits and misses for repeated glyph lookup", () => {
    const atlas = atlasForTests();
    const first = atlas.getOrInsert(baseKey);
    const second = atlas.getOrInsert({ ...baseKey });
    expect(second).toBe(first);
    expect(atlas.getCounters()).toMatchObject({ hits: 1, misses: 1, glyphs: 1, pages: 1 });
  });

  it("keeps dpr variants separated", () => {
    const atlas = atlasForTests();
    const dpr1 = atlas.getOrInsert(baseKey);
    const dpr2 = atlas.getOrInsert({ ...baseKey, dpr: 2 });
    expect(dpr2.key).not.toBe(dpr1.key);
    expect(dpr2.width).toBeGreaterThan(dpr1.width);
    expect(atlas.getCounters()).toMatchObject({ hits: 0, misses: 2, glyphs: 2 });
  });

  it("wraps to a new row before a glyph would overflow the atlas page width", () => {
    const atlas = atlasForTests({ pageSize: 32, maxPages: 1, width: 12, height: 10 });
    atlas.getOrInsert({ ...baseKey, text: "A" });
    atlas.getOrInsert({ ...baseKey, text: "B" });
    const wrapped = atlas.getOrInsert({ ...baseKey, text: "C" });

    expect(wrapped.x).toBe(1);
    expect(wrapped.y).toBe(13);
    expect(wrapped.x + wrapped.width).toBeLessThanOrEqual(32);
  });

  it("evicts the least recently used page when the page budget is full", () => {
    const atlas = atlasForTests({ pageSize: 16, maxPages: 1, width: 12, height: 12 });
    const a = atlas.getOrInsert(baseKey);
    const b = atlas.getOrInsert({ ...baseKey, text: "B" });
    expect(b.key).not.toBe(a.key);
    expect(atlas.getCounters()).toMatchObject({ evictions: 1, glyphs: 1, pages: 1 });

    atlas.getOrInsert(baseKey);
    expect(atlas.getCounters()).toMatchObject({ misses: 3, evictions: 2, glyphs: 1 });
  });

  it("resets counters without dropping resident glyphs", () => {
    const atlas = atlasForTests();
    atlas.getOrInsert(baseKey);
    atlas.resetCounters();
    atlas.getOrInsert(baseKey);
    expect(atlas.getCounters()).toMatchObject({ hits: 1, misses: 0, evictions: 0, glyphs: 1 });
  });
});
