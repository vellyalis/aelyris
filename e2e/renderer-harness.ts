import {
  createDenseAsciiSnapshot,
  type RendererFixture,
  rendererFixtures,
} from "../src/features/terminal/__fixtures__/rendererFixtures";
import type { GridSnapshot } from "../src/shared/types/terminal";
import {
  paintCursor,
  paintGhostSuggestion,
  paintImages,
  paintLinkUnderline,
  paintRow,
  paintSearchBands,
  paintSelectionBand,
} from "../src/features/terminal/terminalPaint";
import { TERMINAL_FONT_FAMILY, type TerminalCellMetrics } from "../src/features/terminal/terminalMetrics";

type RendererMode = "canvas2d";

interface RendererParityResult {
  fixtureId: string;
  label: string;
  width: number;
  height: number;
  differingPixels: number;
  maxChannelDelta: number;
  withinTolerance: boolean;
  opaqueSamples: Array<{ row: number; col: number; alpha: number; passed: boolean }>;
}

interface RendererParityReport {
  version: 1;
  status: "pending-gpu" | "pass" | "fail";
  ok: boolean;
  generatedAt: string;
  comparison: "canvas2d-self";
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

const PARITY_TOLERANCES = {
  perChannel: 0,
  maxDifferingPixels: 0,
} as const;

const PERF_FRAMES = 1_000;
const SCROLL_FRAMES = 240;
const PERF_COLS = 120;
const PERF_ROWS = 40;
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

function makeCanvas(snapshot: GridSnapshot): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = snapshot.cols * METRICS.width * DEVICE_PIXEL_RATIO;
  canvas.height = snapshot.rows * METRICS.height * DEVICE_PIXEL_RATIO;
  canvas.style.width = `${snapshot.cols * METRICS.width}px`;
  canvas.style.height = `${snapshot.rows * METRICS.height}px`;
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

async function paintFixtureToImageData(fixture: RendererFixture, mode: RendererMode): Promise<ImageData> {
  if (mode !== "canvas2d") throw new Error(`unsupported renderer mode: ${mode}`);
  const snapshot = fixture.snapshot;
  const canvas = makeCanvas(snapshot);
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

function compareImageData(a: ImageData, b: ImageData) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`image dimensions differ: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  let differingPixels = 0;
  let maxChannelDelta = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const dr = Math.abs(a.data[i] - b.data[i]);
    const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
    const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
    const da = Math.abs(a.data[i + 3] - b.data[i + 3]);
    const max = Math.max(dr, dg, db, da);
    maxChannelDelta = Math.max(maxChannelDelta, max);
    if (max > PARITY_TOLERANCES.perChannel) differingPixels += 1;
  }
  return {
    differingPixels,
    maxChannelDelta,
    withinTolerance:
      maxChannelDelta <= PARITY_TOLERANCES.perChannel &&
      differingPixels <= PARITY_TOLERANCES.maxDifferingPixels,
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
    const b = await paintFixtureToImageData(fixture, "canvas2d");
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
    });
  }
  const ok = fixtures.every((fixture) => fixture.withinTolerance);
  return {
    version: 1,
    status: ok ? "pending-gpu" : "fail",
    ok,
    generatedAt: new Date().toISOString(),
    comparison: "canvas2d-self",
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
    snapshot.cells.push(createDenseAsciiSnapshot(PERF_COLS, 1).cells[0].map((cell) => ({ ...cell, ch: `${frame % 10}` })));
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

declare global {
  interface Window {
    __AELYRIS_RENDERER_HARNESS__: {
      runParity: typeof runParity;
      runPerf: typeof runPerf;
    };
  }
}

window.__AELYRIS_RENDERER_HARNESS__ = {
  runParity,
  runPerf,
};
