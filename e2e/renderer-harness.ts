import {
  createDenseAsciiSnapshot,
  type RendererFixture,
  rendererFixtures,
} from "../src/features/terminal/__fixtures__/rendererFixtures";
import { GlyphAtlas } from "../src/features/terminal/gpu/glyphAtlas";
import * as gpuPaint from "../src/features/terminal/gpu/terminalPaintGpu";
import { TERMINAL_FONT_FAMILY, type TerminalCellMetrics } from "../src/features/terminal/terminalMetrics";
import {
  paintCursor,
  paintGhostSuggestion,
  paintImages,
  paintLinkUnderline,
  paintRow,
  paintSearchBands,
  paintSelectionBand,
} from "../src/features/terminal/terminalPaint";
import type { GridSnapshot } from "../src/shared/types/terminal";

type RendererMode = "canvas2d" | "webgl2";

interface RendererParityResult {
  fixtureId: string;
  label: string;
  width: number;
  height: number;
  differingPixels: number;
  maxChannelDelta: number;
  withinTolerance: boolean;
  opaqueSamples: Array<{ row: number; col: number; alpha: number; passed: boolean }>;
  sampleDiffs: Array<{ x: number; y: number; canvas: number[]; gpu: number[] }>;
}

interface RendererParityReport {
  version: 1;
  status: "pending-gpu" | "pass" | "fail";
  ok: boolean;
  generatedAt: string;
  comparison: "canvas2d-vs-webgl2";
  tolerances: typeof PARITY_TOLERANCES;
  fixtures: RendererParityResult[];
}

interface RendererPerfReport {
  version: 1;
  status: "baseline-recorded";
  ok: boolean;
  generatedAt: string;
  renderer: RendererMode;
  enforced: false;
  baseline: {
    fullGridRepaint: {
      cols: number;
      rows: number;
      frames: number;
      p95Ms: number;
      averageMs: number;
    };
    scrollFlood: {
      frames: number;
      droppedFramesOver60fpsBudget: number;
      p95Ms: number;
      averageMs: number;
    };
    atlas: {
      status: "pending-gpu";
      hitRate: null;
      evictions: null;
    };
  };
}

interface RendererTransparencyReport {
  version: 1;
  status: "pass" | "fail";
  ok: boolean;
  generatedAt: string;
  comparison: "canvas2d-vs-webgl2";
  fixtureId: string;
  terminalRect: { x: 0; y: 0; width: number; height: number };
  canvasSize: { width: number; height: number };
  regions: Array<{
    id: string;
    pixels: number;
    canvasNonTransparentPixels: number;
    gpuNonTransparentPixels: number;
    alphaMismatchPixels: number;
    passed: boolean;
  }>;
  operatorSignoff: {
    required: true;
    reason: string;
  };
}

interface RendererSoakReport {
  version: 1;
  status: "pass" | "fail";
  ok: boolean;
  generatedAt: string;
  renderer: "webgl2";
  frames: number;
  grid: { cols: number; rows: number };
  timing: {
    firstWindowAverageMs: number;
    lastWindowAverageMs: number;
    decayRatio: number;
    p95Ms: number;
    maxMs: number;
  };
  atlas: {
    before: ReturnType<GlyphAtlas["getCounters"]>;
    after: ReturnType<GlyphAtlas["getCounters"]>;
    hitRate: number;
    pagesWithinLimit: boolean;
    glyphsBounded: boolean;
    evictionProbe: {
      before: ReturnType<GlyphAtlas["getCounters"]>;
      after: ReturnType<GlyphAtlas["getCounters"]>;
      observed: boolean;
    };
  };
  contextLossEvents: string[];
  frameErrors: string[];
  checks: Array<{ id: string; passed: boolean; detail: string }>;
}

const PARITY_TOLERANCES = {
  perChannel: 12,
  maxDifferingPixelRatio: 0.12,
  maxDifferingPixelsFloor: 64,
} as const;

const PERF_FRAMES = 1_000;
const SCROLL_FRAMES = 240;
const PERF_COLS = 120;
const PERF_ROWS = 40;
const TRANSPARENCY_MARGIN_PX = 32;
const SOAK_FRAMES = 10_000;
const SOAK_WINDOW_FRAMES = 1_000;
const SOAK_COLS = 12;
const SOAK_ROWS = 4;
const METRICS: TerminalCellMetrics = { width: 10, height: 18 };
const FONT_SIZE = 14;
const FONT_FAMILY = TERMINAL_FONT_FAMILY;
const DEVICE_PIXEL_RATIO = 1;

function configureText(ctx: CanvasRenderingContext2D) {
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const textCtx = ctx as CanvasRenderingContext2D & {
    fontKerning?: string;
    letterSpacing?: string;
    textRendering?: string;
    wordSpacing?: string;
  };
  textCtx.fontKerning = "none";
  textCtx.letterSpacing = "0px";
  textCtx.wordSpacing = "0px";
  textCtx.textRendering = "auto";
}

interface PaintFixtureOptions {
  marginRight?: number;
  marginBottom?: number;
  atlas?: GlyphAtlas;
}

function makeCanvas(snapshot: GridSnapshot, options: PaintFixtureOptions = {}): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = snapshot.cols * METRICS.width * DEVICE_PIXEL_RATIO + (options.marginRight ?? 0);
  canvas.height = snapshot.rows * METRICS.height * DEVICE_PIXEL_RATIO + (options.marginBottom ?? 0);
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = `${canvas.height}px`;
  return canvas;
}

async function makeImageBitmaps(fixture: RendererFixture): Promise<Map<number, ImageBitmap>> {
  const bitmaps = new Map<number, ImageBitmap>();
  for (const image of fixture.images ?? []) {
    const canvas = document.createElement("canvas");
    canvas.width = image.widthPx;
    canvas.height = image.heightPx;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable for image fixture");
    if (image.pattern === "checker") {
      for (let y = 0; y < image.heightPx; y += 4) {
        for (let x = 0; x < image.widthPx; x += 4) {
          ctx.fillStyle = (x + y) % 8 === 0 ? "#f9e2af" : "#89b4fa";
          ctx.fillRect(x, y, 4, 4);
        }
      }
    } else {
      ctx.fillStyle = "#a6e3a1";
      ctx.fillRect(0, 0, image.widthPx, image.heightPx);
      ctx.fillStyle = "#f38ba8";
      for (let x = 0; x < image.widthPx; x += 4) ctx.fillRect(x, 0, 2, image.heightPx);
    }
    bitmaps.set(image.id, await createImageBitmap(canvas));
  }
  return bitmaps;
}

async function paintFixtureToImageData(
  fixture: RendererFixture,
  mode: RendererMode,
  options: PaintFixtureOptions = {},
): Promise<ImageData> {
  if (mode === "webgl2") return paintFixtureToGpuImageData(fixture, options);
  const snapshot = fixture.snapshot;
  const canvas = makeCanvas(snapshot, options);
  const ctx = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.setTransform(DEVICE_PIXEL_RATIO, 0, 0, DEVICE_PIXEL_RATIO, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  configureText(ctx);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let row = 0; row < snapshot.rows; row++) {
    paintRow(
      ctx,
      snapshot.cells[row],
      row,
      METRICS,
      FONT_SIZE,
      FONT_FAMILY,
      DEVICE_PIXEL_RATIO,
      fixture.rasterBackground,
      "solid",
    );
    paintSearchBands(ctx, row, fixture.searchMatches, fixture.activeSearchMatch, METRICS, snapshot.rows, 0);
    const band = fixture.selectionBands?.[row];
    if (band) paintSelectionBand(ctx, row, band, METRICS);
    paintLinkUnderline(ctx, row, fixture.hoveredLink ?? null, snapshot.cols, METRICS);
  }

  if (fixture.ghostSuggestion) {
    paintGhostSuggestion(ctx, snapshot, fixture.ghostSuggestion, METRICS, FONT_SIZE, FONT_FAMILY, DEVICE_PIXEL_RATIO);
  }
  if (snapshot.cursor.visible) {
    paintCursor(ctx, snapshot, METRICS, DEVICE_PIXEL_RATIO);
  }
  if (snapshot.images?.length) {
    paintImages(ctx, snapshot.images, await makeImageBitmaps(fixture), METRICS);
  }

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function paintFixtureToGpuImageData(
  fixture: RendererFixture,
  options: PaintFixtureOptions = {},
): Promise<ImageData> {
  const snapshot = fixture.snapshot;
  const canvas = makeCanvas(snapshot, options);
  const context = gpuPaint.createTerminalGpuPaintContext(canvas, {
    devicePixelRatio: DEVICE_PIXEL_RATIO,
    atlas: options.atlas,
  });
  if (!context) throw new Error("WebGL2 unavailable for renderer parity harness");
  gpuPaint.beginGpuFrame(context);

  for (let row = 0; row < snapshot.rows; row++) {
    gpuPaint.paintRow(
      context,
      snapshot.cells[row],
      row,
      METRICS,
      FONT_SIZE,
      FONT_FAMILY,
      DEVICE_PIXEL_RATIO,
      fixture.rasterBackground,
      "solid",
    );
    gpuPaint.paintSearchBands(
      context,
      row,
      fixture.searchMatches,
      fixture.activeSearchMatch,
      METRICS,
      snapshot.rows,
      0,
    );
    const band = fixture.selectionBands?.[row];
    if (band) gpuPaint.paintSelectionBand(context, row, band, METRICS);
    gpuPaint.paintLinkUnderline(context, row, fixture.hoveredLink ?? null, snapshot.cols, METRICS);
  }

  if (fixture.ghostSuggestion) {
    gpuPaint.paintGhostSuggestion(
      context,
      snapshot,
      fixture.ghostSuggestion,
      METRICS,
      FONT_SIZE,
      FONT_FAMILY,
      DEVICE_PIXEL_RATIO,
    );
  }
  if (snapshot.cursor.visible) {
    gpuPaint.paintCursor(context, snapshot, METRICS, DEVICE_PIXEL_RATIO);
  }
  if (snapshot.images?.length) {
    gpuPaint.paintImages(context, snapshot.images, await makeImageBitmaps(fixture), METRICS);
  }

  gpuPaint.flushGpuFrame(context);
  return gpuPaint.readGpuImageData(context);
}

function compareImageData(a: ImageData, b: ImageData) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`image dimensions differ: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  let differingPixels = 0;
  let maxChannelDelta = 0;
  const sampleDiffs: Array<{ x: number; y: number; canvas: number[]; gpu: number[] }> = [];
  for (let i = 0; i < a.data.length; i += 4) {
    const dr = Math.abs(a.data[i] - b.data[i]);
    const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
    const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
    const da = Math.abs(a.data[i + 3] - b.data[i + 3]);
    const max = Math.max(dr, dg, db, da);
    maxChannelDelta = Math.max(maxChannelDelta, max);
    if (max > PARITY_TOLERANCES.perChannel) {
      differingPixels += 1;
      if (sampleDiffs.length < 8) {
        const pixel = i / 4;
        sampleDiffs.push({
          x: pixel % a.width,
          y: Math.floor(pixel / a.width),
          canvas: Array.from(a.data.slice(i, i + 4)),
          gpu: Array.from(b.data.slice(i, i + 4)),
        });
      }
    }
  }
  const maxDifferingPixels = Math.max(
    PARITY_TOLERANCES.maxDifferingPixelsFloor,
    Math.floor(a.width * a.height * PARITY_TOLERANCES.maxDifferingPixelRatio),
  );
  return {
    differingPixels,
    maxChannelDelta,
    sampleDiffs,
    withinTolerance: differingPixels <= maxDifferingPixels,
  };
}

function sampleOpaqueCells(image: ImageData, fixture: RendererFixture) {
  return (fixture.opaqueSampleCells ?? []).map(({ row, col }) => {
    const startX = Math.floor(col * METRICS.width * DEVICE_PIXEL_RATIO);
    const endX = Math.min(image.width, Math.ceil((col + 1) * METRICS.width * DEVICE_PIXEL_RATIO));
    const startY = Math.floor(row * METRICS.height * DEVICE_PIXEL_RATIO);
    const endY = Math.min(image.height, Math.ceil((row + 1) * METRICS.height * DEVICE_PIXEL_RATIO));
    let alpha = 0;
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        alpha = Math.max(alpha, image.data[(y * image.width + x) * 4 + 3] ?? 0);
      }
    }
    return { row, col, alpha, passed: alpha === 255 };
  });
}

async function runParity(): Promise<RendererParityReport> {
  const fixtures: RendererParityResult[] = [];
  for (const fixture of rendererFixtures) {
    const a = await paintFixtureToImageData(fixture, "canvas2d");
    const b = await paintFixtureToImageData(fixture, "webgl2");
    const diff = compareImageData(a, b);
    const opaqueSamples = sampleOpaqueCells(a, fixture);
    fixtures.push({
      fixtureId: fixture.id,
      label: fixture.label,
      width: a.width,
      height: a.height,
      differingPixels: diff.differingPixels,
      maxChannelDelta: diff.maxChannelDelta,
      withinTolerance: diff.withinTolerance && opaqueSamples.every((sample) => sample.passed),
      opaqueSamples,
      sampleDiffs: diff.withinTolerance ? [] : diff.sampleDiffs,
    });
  }
  const ok = fixtures.every((fixture) => fixture.withinTolerance);
  return {
    version: 1,
    status: ok ? "pass" : "fail",
    ok,
    generatedAt: new Date().toISOString(),
    comparison: "canvas2d-vs-webgl2",
    tolerances: PARITY_TOLERANCES,
    fixtures,
  };
}

function paintSnapshotOnce(snapshot: GridSnapshot) {
  const fixture: RendererFixture = {
    id: "perf",
    label: "Performance fixture",
    snapshot,
    rasterBackground: "rgba(3, 10, 22, 0.92)",
  };
  return paintFixtureToImageData(fixture, "canvas2d");
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(3));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

async function measureFrames(frames: number, makeSnapshot: (frame: number) => GridSnapshot) {
  const samples: number[] = [];
  for (let frame = 0; frame < frames; frame++) {
    const snapshot = makeSnapshot(frame);
    const startedAt = performance.now();
    await paintSnapshotOnce(snapshot);
    samples.push(performance.now() - startedAt);
    if (frame % 60 === 0) await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  return samples;
}

async function runPerf(): Promise<RendererPerfReport> {
  const fullGridSnapshot = createDenseAsciiSnapshot(PERF_COLS, PERF_ROWS);
  const fullGridSamples = await measureFrames(PERF_FRAMES, () => fullGridSnapshot);
  const scrollSamples = await measureFrames(SCROLL_FRAMES, (frame) => {
    const snapshot = createDenseAsciiSnapshot(PERF_COLS, PERF_ROWS);
    snapshot.cells.shift();
    snapshot.cells.push(
      createDenseAsciiSnapshot(PERF_COLS, 1).cells[0].map((cell) => ({ ...cell, ch: `${frame % 10}` })),
    );
    return snapshot;
  });
  const frameBudgetMs = 1_000 / 60;
  return {
    version: 1,
    status: "baseline-recorded",
    ok: true,
    generatedAt: new Date().toISOString(),
    renderer: "canvas2d",
    enforced: false,
    baseline: {
      fullGridRepaint: {
        cols: PERF_COLS,
        rows: PERF_ROWS,
        frames: PERF_FRAMES,
        p95Ms: percentile(fullGridSamples, 95),
        averageMs: average(fullGridSamples),
      },
      scrollFlood: {
        frames: SCROLL_FRAMES,
        droppedFramesOver60fpsBudget: scrollSamples.filter((sample) => sample > frameBudgetMs).length,
        p95Ms: percentile(scrollSamples, 95),
        averageMs: average(scrollSamples),
      },
      atlas: {
        status: "pending-gpu",
        hitRate: null,
        evictions: null,
      },
    },
  };
}

function inspectTransparentRegion(
  id: string,
  canvasImage: ImageData,
  gpuImage: ImageData,
  rect: { x: number; y: number; width: number; height: number },
) {
  let pixels = 0;
  let canvasNonTransparentPixels = 0;
  let gpuNonTransparentPixels = 0;
  let alphaMismatchPixels = 0;
  const x1 = Math.min(canvasImage.width, rect.x + rect.width);
  const y1 = Math.min(canvasImage.height, rect.y + rect.height);
  for (let y = Math.max(0, rect.y); y < y1; y++) {
    for (let x = Math.max(0, rect.x); x < x1; x++) {
      const index = (y * canvasImage.width + x) * 4 + 3;
      const canvasAlpha = canvasImage.data[index] ?? 0;
      const gpuAlpha = gpuImage.data[index] ?? 0;
      pixels += 1;
      if (canvasAlpha !== 0) canvasNonTransparentPixels += 1;
      if (gpuAlpha !== 0) gpuNonTransparentPixels += 1;
      if (canvasAlpha !== gpuAlpha) alphaMismatchPixels += 1;
    }
  }
  return {
    id,
    pixels,
    canvasNonTransparentPixels,
    gpuNonTransparentPixels,
    alphaMismatchPixels,
    passed:
      pixels > 0 && canvasNonTransparentPixels === 0 && gpuNonTransparentPixels === 0 && alphaMismatchPixels === 0,
  };
}

async function runTransparencyProof(): Promise<RendererTransparencyReport> {
  const fixture = rendererFixtures.find((item) => item.id === "overlays") ?? rendererFixtures[0];
  const terminalWidth = fixture.snapshot.cols * METRICS.width * DEVICE_PIXEL_RATIO;
  const terminalHeight = fixture.snapshot.rows * METRICS.height * DEVICE_PIXEL_RATIO;
  const options = { marginRight: TRANSPARENCY_MARGIN_PX, marginBottom: TRANSPARENCY_MARGIN_PX };
  const canvasImage = await paintFixtureToImageData(fixture, "canvas2d", options);
  const gpuImage = await paintFixtureToImageData(fixture, "webgl2", options);
  const regions = [
    inspectTransparentRegion("right-transparent-margin", canvasImage, gpuImage, {
      x: terminalWidth + 2,
      y: 0,
      width: TRANSPARENCY_MARGIN_PX - 2,
      height: canvasImage.height,
    }),
    inspectTransparentRegion("bottom-transparent-margin", canvasImage, gpuImage, {
      x: 0,
      y: terminalHeight + 2,
      width: canvasImage.width,
      height: TRANSPARENCY_MARGIN_PX - 2,
    }),
    inspectTransparentRegion("corner-transparent-margin", canvasImage, gpuImage, {
      x: terminalWidth + 2,
      y: terminalHeight + 2,
      width: TRANSPARENCY_MARGIN_PX - 2,
      height: TRANSPARENCY_MARGIN_PX - 2,
    }),
  ];
  const ok = regions.every((region) => region.passed);
  return {
    version: 1,
    status: ok ? "pass" : "fail",
    ok,
    generatedAt: new Date().toISOString(),
    comparison: "canvas2d-vs-webgl2",
    fixtureId: fixture.id,
    terminalRect: { x: 0, y: 0, width: terminalWidth, height: terminalHeight },
    canvasSize: { width: canvasImage.width, height: canvasImage.height },
    regions,
    operatorSignoff: {
      required: true,
      reason:
        "Chromium can prove WebGL/Canvas alpha preservation in a transparent page; final DWM/WebView2 see-through parity remains an operator screenshot sign-off.",
    },
  };
}

function mutateSoakSnapshot(snapshot: GridSnapshot, frame: number): GridSnapshot {
  const glyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+-./:<=>?[]_{}~";
  for (let row = 0; row < snapshot.rows; row++) {
    for (let col = 0; col < snapshot.cols; col++) {
      const cell = snapshot.cells[row][col];
      cell.ch = glyphs[(frame + row * snapshot.cols + col) % glyphs.length];
    }
  }
  snapshot.cursor = {
    row: frame % snapshot.rows,
    col: (frame * 7) % snapshot.cols,
    shape: frame % 2 === 0 ? "block" : "beam",
    blinking: false,
    visible: true,
  };
  return snapshot;
}

async function runSoak(): Promise<RendererSoakReport> {
  const snapshot = createDenseAsciiSnapshot(SOAK_COLS, SOAK_ROWS);
  const atlas = new GlyphAtlas({ pageSize: 128, maxPages: 4 });
  const canvas = makeCanvas(snapshot);
  const contextLossEvents: string[] = [];
  const frameErrors: string[] = [];
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    contextLossEvents.push(`lost@${performance.now().toFixed(3)}`);
  });
  const context = gpuPaint.createTerminalGpuPaintContext(canvas, { devicePixelRatio: DEVICE_PIXEL_RATIO, atlas });
  if (!context) throw new Error("WebGL2 unavailable for renderer soak harness");
  const before = context.atlas.getCounters();
  const frameTimes: number[] = [];
  const evictionProbeAtlas = new GlyphAtlas({
    pageSize: 32,
    maxPages: 1,
    padding: 1,
    createSurface: (size) => ({ width: size, height: size }),
    clearSurface: () => {},
    rasterizeGlyph: (key) => ({
      width: 14,
      height: 14,
      advanceWidth: 14,
      offsetX: key.bold ? 1 : 0,
      offsetY: key.italic ? 1 : 0,
      drawTo: () => {},
    }),
  });
  const evictionProbeBefore = evictionProbeAtlas.getCounters();
  for (let i = 0; i < 12; i++) {
    evictionProbeAtlas.getOrInsert({
      text: String.fromCharCode(65 + i),
      fontFamily: FONT_FAMILY,
      fontSize: 12,
      dpr: DEVICE_PIXEL_RATIO,
    });
  }
  const evictionProbeAfter = evictionProbeAtlas.getCounters();

  for (let frame = 0; frame < SOAK_FRAMES; frame++) {
    mutateSoakSnapshot(snapshot, frame);
    const startedAt = performance.now();
    try {
      gpuPaint.beginGpuFrame(context);
      for (let row = 0; row < snapshot.rows; row++) {
        gpuPaint.paintRow(
          context,
          snapshot.cells[row],
          row,
          METRICS,
          12,
          FONT_FAMILY,
          DEVICE_PIXEL_RATIO,
          "rgba(3, 10, 22, 0.92)",
          "solid",
        );
      }
      gpuPaint.paintCursor(context, snapshot, METRICS, DEVICE_PIXEL_RATIO);
      gpuPaint.flushGpuFrame(context);
    } catch (error) {
      frameErrors.push(error instanceof Error ? error.message : String(error));
      break;
    }
    frameTimes.push(performance.now() - startedAt);
    if (frame % 250 === 0) await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  const after = context.atlas.getCounters();
  const firstWindow = frameTimes.slice(0, SOAK_WINDOW_FRAMES);
  const lastWindow = frameTimes.slice(-SOAK_WINDOW_FRAMES);
  const firstWindowAverageMs = average(firstWindow);
  const lastWindowAverageMs = average(lastWindow);
  const decayRatio = firstWindowAverageMs > 0 ? Number((lastWindowAverageMs / firstWindowAverageMs).toFixed(3)) : 0;
  const totalLookups = after.hits + after.misses;
  const hitRate = totalLookups > 0 ? Number((after.hits / totalLookups).toFixed(4)) : 0;
  const checks = [
    {
      id: "completed-10k-frames",
      passed: frameTimes.length === SOAK_FRAMES,
      detail: `${frameTimes.length}/${SOAK_FRAMES} frames completed`,
    },
    {
      id: "no-context-loss",
      passed: contextLossEvents.length === 0,
      detail: `${contextLossEvents.length} context loss events`,
    },
    {
      id: "no-frame-errors",
      passed: frameErrors.length === 0,
      detail: frameErrors[0] ?? "no frame errors",
    },
    {
      id: "stable-frame-time",
      passed: decayRatio <= 1.1,
      detail: `last/first average frame-time ratio ${decayRatio}`,
    },
    {
      id: "bounded-atlas-pages",
      passed: after.pages <= 4 && after.glyphs <= 256,
      detail: `${after.pages} pages, ${after.glyphs} glyphs`,
    },
    {
      id: "atlas-eviction-probe",
      passed: evictionProbeAfter.evictions > evictionProbeBefore.evictions,
      detail: `${evictionProbeAfter.evictions - evictionProbeBefore.evictions} evicted glyph entries`,
    },
  ];
  const ok = checks.every((check) => check.passed);
  return {
    version: 1,
    status: ok ? "pass" : "fail",
    ok,
    generatedAt: new Date().toISOString(),
    renderer: "webgl2",
    frames: SOAK_FRAMES,
    grid: { cols: SOAK_COLS, rows: SOAK_ROWS },
    timing: {
      firstWindowAverageMs,
      lastWindowAverageMs,
      decayRatio,
      p95Ms: percentile(frameTimes, 95),
      maxMs: Number(Math.max(...frameTimes).toFixed(3)),
    },
    atlas: {
      before,
      after,
      hitRate,
      pagesWithinLimit: after.pages <= 4,
      glyphsBounded: after.glyphs <= 256,
      evictionProbe: {
        before: evictionProbeBefore,
        after: evictionProbeAfter,
        observed: evictionProbeAfter.evictions > evictionProbeBefore.evictions,
      },
    },
    contextLossEvents,
    frameErrors,
    checks,
  };
}

declare global {
  interface Window {
    __AELYRIS_RENDERER_HARNESS__: {
      runParity: typeof runParity;
      runPerf: typeof runPerf;
      runTransparencyProof: typeof runTransparencyProof;
      runSoak: typeof runSoak;
    };
  }
}

window.__AELYRIS_RENDERER_HARNESS__ = {
  runParity,
  runPerf,
  runTransparencyProof,
  runSoak,
};
