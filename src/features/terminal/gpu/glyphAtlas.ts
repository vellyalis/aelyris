export interface GlyphAtlasKey {
  text: string;
  fontFamily: string;
  fontSize: number;
  dpr: number;
  bold?: boolean;
  italic?: boolean;
}

export interface GlyphBitmap {
  width: number;
  height: number;
  advanceWidth: number;
  drawTo(surface: GlyphAtlasSurface, x: number, y: number): void;
}

export interface GlyphAtlasSurface {
  width: number;
  height: number;
}

export interface GlyphAtlasEntry {
  key: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  advanceWidth: number;
}

export interface GlyphAtlasCounters {
  hits: number;
  misses: number;
  evictions: number;
  pages: number;
  glyphs: number;
}

export interface GlyphAtlasOptions {
  pageSize?: number;
  padding?: number;
  maxPages?: number;
  rasterizeGlyph?: (key: GlyphAtlasKey) => GlyphBitmap;
  createSurface?: (size: number) => GlyphAtlasSurface;
  clearSurface?: (surface: GlyphAtlasSurface) => void;
}

interface AtlasPage {
  index: number;
  surface: GlyphAtlasSurface;
  cursorX: number;
  cursorY: number;
  rowHeight: number;
  lastUsed: number;
  entryKeys: Set<string>;
}

const DEFAULT_PAGE_SIZE = 1024;
const DEFAULT_PADDING = 1;
const DEFAULT_MAX_PAGES = 8;

export function glyphAtlasKey(key: GlyphAtlasKey): string {
  const weight = key.bold ? "bold" : "regular";
  const style = key.italic ? "italic" : "normal";
  return [key.text, key.fontFamily, key.fontSize, key.dpr, weight, style].join("\u001f");
}

export class GlyphAtlas {
  private readonly pageSize: number;
  private readonly padding: number;
  private readonly maxPages: number;
  private readonly rasterizeGlyph: (key: GlyphAtlasKey) => GlyphBitmap;
  private readonly createSurface: (size: number) => GlyphAtlasSurface;
  private readonly clearSurface: (surface: GlyphAtlasSurface) => void;
  private readonly pages: AtlasPage[] = [];
  private readonly entries = new Map<string, GlyphAtlasEntry>();
  private clock = 0;
  private counters = { hits: 0, misses: 0, evictions: 0 };

  constructor(options: GlyphAtlasOptions = {}) {
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    this.padding = options.padding ?? DEFAULT_PADDING;
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    this.rasterizeGlyph = options.rasterizeGlyph ?? rasterizeGlyphWithCanvas;
    this.createSurface = options.createSurface ?? createCanvasSurface;
    this.clearSurface = options.clearSurface ?? clearCanvasSurface;
    if (this.pageSize <= 0) throw new Error("GlyphAtlas pageSize must be positive");
    if (this.maxPages <= 0) throw new Error("GlyphAtlas maxPages must be positive");
    if (this.padding < 0) throw new Error("GlyphAtlas padding cannot be negative");
  }

  getOrInsert(key: GlyphAtlasKey): GlyphAtlasEntry {
    const stableKey = glyphAtlasKey(key);
    const existing = this.entries.get(stableKey);
    if (existing) {
      this.counters.hits += 1;
      this.touchPage(existing.pageIndex);
      return existing;
    }

    this.counters.misses += 1;
    const bitmap = this.rasterizeGlyph(key);
    const page = this.pageFor(bitmap.width, bitmap.height);
    const x = page.cursorX + this.padding;
    const y = page.cursorY + this.padding;
    bitmap.drawTo(page.surface, x, y);

    const entry: GlyphAtlasEntry = {
      key: stableKey,
      pageIndex: page.index,
      x,
      y,
      width: bitmap.width,
      height: bitmap.height,
      u0: x / this.pageSize,
      v0: y / this.pageSize,
      u1: (x + bitmap.width) / this.pageSize,
      v1: (y + bitmap.height) / this.pageSize,
      advanceWidth: bitmap.advanceWidth,
    };
    this.entries.set(stableKey, entry);
    page.entryKeys.add(stableKey);
    page.cursorX += bitmap.width + this.padding * 2;
    page.rowHeight = Math.max(page.rowHeight, bitmap.height + this.padding * 2);
    page.lastUsed = ++this.clock;
    return entry;
  }

  getCounters(): GlyphAtlasCounters {
    return {
      hits: this.counters.hits,
      misses: this.counters.misses,
      evictions: this.counters.evictions,
      pages: this.pages.length,
      glyphs: this.entries.size,
    };
  }

  resetCounters() {
    this.counters = { hits: 0, misses: 0, evictions: 0 };
  }

  clear() {
    for (const page of this.pages) {
      this.clearSurface(page.surface);
      page.cursorX = 0;
      page.cursorY = 0;
      page.rowHeight = 0;
      page.entryKeys.clear();
      page.lastUsed = ++this.clock;
    }
    this.entries.clear();
  }

  private pageFor(width: number, height: number): AtlasPage {
    const paddedWidth = width + this.padding * 2;
    const paddedHeight = height + this.padding * 2;
    if (paddedWidth > this.pageSize || paddedHeight > this.pageSize) {
      throw new Error(`glyph bitmap ${width}x${height} exceeds atlas page ${this.pageSize}`);
    }

    for (const page of this.pages) {
      if (this.canPlace(page, paddedWidth, paddedHeight)) return page;
    }

    if (this.pages.length < this.maxPages) {
      return this.createPage();
    }

    return this.evictLeastRecentlyUsedPage();
  }

  private canPlace(page: AtlasPage, paddedWidth: number, paddedHeight: number): boolean {
    if (page.cursorX + paddedWidth <= this.pageSize && page.cursorY + paddedHeight <= this.pageSize) return true;
    const nextRowY = page.cursorY + Math.max(page.rowHeight, paddedHeight);
    return paddedWidth <= this.pageSize && nextRowY + paddedHeight <= this.pageSize;
  }

  private createPage(): AtlasPage {
    const page: AtlasPage = {
      index: this.pages.length,
      surface: this.createSurface(this.pageSize),
      cursorX: 0,
      cursorY: 0,
      rowHeight: 0,
      lastUsed: ++this.clock,
      entryKeys: new Set(),
    };
    this.pages.push(page);
    return page;
  }

  private evictLeastRecentlyUsedPage(): AtlasPage {
    let page = this.pages[0];
    for (const candidate of this.pages) {
      if (candidate.lastUsed < page.lastUsed) page = candidate;
    }
    this.counters.evictions += page.entryKeys.size;
    for (const key of page.entryKeys) this.entries.delete(key);
    this.clearSurface(page.surface);
    page.cursorX = 0;
    page.cursorY = 0;
    page.rowHeight = 0;
    page.entryKeys.clear();
    page.lastUsed = ++this.clock;
    return page;
  }

  private touchPage(pageIndex: number) {
    const page = this.pages[pageIndex];
    if (page) page.lastUsed = ++this.clock;
  }
}

function rasterizeGlyphWithCanvas(key: GlyphAtlasKey): GlyphBitmap {
  if (typeof document === "undefined") {
    throw new Error("GlyphAtlas default rasterizer requires document; inject rasterizeGlyph in non-browser tests");
  }
  const dpr = Number.isFinite(key.dpr) && key.dpr > 0 ? key.dpr : 1;
  const fontSizePx = Math.max(1, key.fontSize * dpr);
  const weight = key.bold ? "bold " : "";
  const style = key.italic ? "italic " : "";
  const font = `${style}${weight}${fontSizePx}px ${key.fontFamily}`;
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("GlyphAtlas could not create a 2D measurement context");
  measure.font = font;
  measure.textBaseline = "top";
  const metrics = measure.measureText(key.text);
  const width = Math.max(1, Math.ceil(metrics.width));
  const height = Math.max(1, Math.ceil(fontSizePx * 1.35));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("GlyphAtlas could not create a 2D raster context");
  ctx.font = font;
  ctx.textBaseline = "top";
  ctx.fillStyle = "white";
  ctx.fillText(key.text, 0, 0);
  return {
    width,
    height,
    advanceWidth: metrics.width / dpr,
    drawTo(surface, x, y) {
      const target = surface as HTMLCanvasElement;
      const targetCtx = target.getContext?.("2d");
      if (!targetCtx) throw new Error("GlyphAtlas target surface is not a canvas");
      targetCtx.drawImage(canvas, x, y);
    },
  };
}

function createCanvasSurface(size: number): GlyphAtlasSurface {
  if (typeof document === "undefined") {
    throw new Error("GlyphAtlas default surface requires document; inject createSurface in non-browser tests");
  }
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function clearCanvasSurface(surface: GlyphAtlasSurface) {
  const canvas = surface as HTMLCanvasElement;
  const ctx = canvas.getContext?.("2d");
  ctx?.clearRect(0, 0, surface.width, surface.height);
}
