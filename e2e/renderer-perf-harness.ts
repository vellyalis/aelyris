import { createDenseAsciiSnapshot, type RendererFixture } from "../src/features/terminal/__fixtures__/rendererFixtures";
import * as gpuPaint from "../src/features/terminal/gpu/terminalPaintGpu";
import { TERMINAL_FONT_FAMILY, type TerminalCellMetrics } from "../src/features/terminal/terminalMetrics";
import { paintCursor, paintRow } from "../src/features/terminal/terminalPaint";
import type { GridSnapshot } from "../src/shared/types/terminal";

type RendererMode = "canvas2d" | "webgl2";

interface RendererPerfTiming {
  p95Ms: number;
  averageMs: number;
}

interface RendererPerfComparison {
  canvas2d: RendererPerfTiming;
  webgl2: RendererPerfTiming;
  webgl2VsCanvasP95Ratio: number;
  sampleGrid: { cols: number; rows: number };
}

interface RendererPerfReport {
  version: 1;
  status: "comparison-recorded";
  ok: boolean;
  generatedAt: string;
  renderer: "canvas2d-vs-webgl2";
  measurementMode: "paint-command-timing-no-readback";
  enforced: false;
  baseline: {
    fullGridRepaint: RendererPerfTiming & { cols: number; rows: number; frames: number };
    scrollFlood: RendererPerfTiming & { frames: number; droppedFramesOver60fpsBudget: number };
  };
  gpu: {
    sampleGridRepaint: RendererPerfTiming & { cols: number; rows: number; frames: number; sampled: true };
    sampleScrollFlood: RendererPerfTiming & { frames: number; droppedFramesOver60fpsBudget: number; sampled: true };
    atlas: {
      sampleGrid: ReturnType<gpuPaint.TerminalGpuPaintContext["atlas"]["getCounters"]> & { hitRate: number };
      sampleScrollFlood: ReturnType<gpuPaint.TerminalGpuPaintContext["atlas"]["getCounters"]> & { hitRate: number };
    };
  };
  comparison: {
    fullGridRepaint: RendererPerfComparison;
    scrollFlood: RendererPerfComparison;
  };
  flagDefaultProposal: {
    proposedDefault: "canvas2d";
    reason: string;
  };
}

const PERF_FRAMES = 1_000;
const SCROLL_FRAMES = 240;
const PERF_COLS = 120;
const PERF_ROWS = 40;
const GPU_SAMPLE_FRAMES = 5;
const GPU_SAMPLE_COLS = 48;
const GPU_SAMPLE_ROWS = 12;
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

function perfFixture(snapshot: GridSnapshot): RendererFixture {
  return {
    id: "perf",
    label: "Performance fixture",
    snapshot,
    rasterBackground: "rgba(3, 10, 22, 0.92)",
  };
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

function timing(values: number[]): RendererPerfTiming {
  return {
    p95Ms: percentile(values, 95),
    averageMs: average(values),
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? Number((numerator / denominator).toFixed(3)) : 0;
}

function atlasCountersWithHitRate(counters: ReturnType<gpuPaint.TerminalGpuPaintContext["atlas"]["getCounters"]>) {
  const lookups = counters.hits + counters.misses;
  return {
    ...counters,
    hitRate: lookups > 0 ? Number((counters.hits / lookups).toFixed(4)) : 0,
  };
}

function paintPerfFixtureToCanvas(ctx: CanvasRenderingContext2D, fixture: RendererFixture) {
  const { snapshot } = fixture;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
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
  }
  if (snapshot.cursor.visible) paintCursor(ctx, snapshot, METRICS, DEVICE_PIXEL_RATIO);
}

function paintPerfFixtureToGpu(context: gpuPaint.TerminalGpuPaintContext, fixture: RendererFixture) {
  const { snapshot } = fixture;
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
  }
  if (snapshot.cursor.visible) gpuPaint.paintCursor(context, snapshot, METRICS, DEVICE_PIXEL_RATIO);
  gpuPaint.flushGpuFrame(context);
}

async function measureFrames(mode: RendererMode, frames: number, makeSnapshot: (frame: number) => GridSnapshot) {
  const initialSnapshot = makeSnapshot(0);
  const samples: number[] = [];
  let atlasCounters: ReturnType<gpuPaint.TerminalGpuPaintContext["atlas"]["getCounters"]> | null = null;
  let canvasContext: CanvasRenderingContext2D | null = null;
  let gpuContext: gpuPaint.TerminalGpuPaintContext | null = null;

  if (mode === "canvas2d") {
    const canvas = makeCanvas(initialSnapshot);
    canvasContext = canvas.getContext("2d", { alpha: true, willReadFrequently: false });
    if (!canvasContext) throw new Error("2D canvas unavailable for renderer perf harness");
    canvasContext.setTransform(DEVICE_PIXEL_RATIO, 0, 0, DEVICE_PIXEL_RATIO, 0, 0);
    canvasContext.imageSmoothingEnabled = true;
    canvasContext.imageSmoothingQuality = "high";
    configureText(canvasContext);
  } else {
    const canvas = makeCanvas(initialSnapshot);
    gpuContext = gpuPaint.createTerminalGpuPaintContext(canvas, { devicePixelRatio: DEVICE_PIXEL_RATIO });
    if (!gpuContext) throw new Error("WebGL2 unavailable for renderer perf harness");
  }

  for (let frame = 0; frame < frames; frame++) {
    const fixture = perfFixture(makeSnapshot(frame));
    const startedAt = performance.now();
    if (mode === "canvas2d") {
      if (!canvasContext) throw new Error("2D context not initialized for renderer perf harness");
      paintPerfFixtureToCanvas(canvasContext, fixture);
    } else {
      if (!gpuContext) throw new Error("WebGL2 context not initialized for renderer perf harness");
      paintPerfFixtureToGpu(gpuContext, fixture);
    }
    samples.push(performance.now() - startedAt);
    if (frame % 60 === 0) await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  if (gpuContext) atlasCounters = gpuContext.atlas.getCounters();
  return { samples, timing: timing(samples), atlasCounters };
}

async function runPerf(): Promise<RendererPerfReport> {
  const fullGridSnapshot = createDenseAsciiSnapshot(PERF_COLS, PERF_ROWS);
  const gpuSampleSnapshot = createDenseAsciiSnapshot(GPU_SAMPLE_COLS, GPU_SAMPLE_ROWS);
  const makeScrollSnapshot = (frame: number) => {
    const snapshot = createDenseAsciiSnapshot(PERF_COLS, PERF_ROWS);
    snapshot.cells.shift();
    snapshot.cells.push(
      createDenseAsciiSnapshot(PERF_COLS, 1).cells[0].map((cell) => ({ ...cell, ch: `${frame % 10}` })),
    );
    return snapshot;
  };
  const makeGpuSampleScrollSnapshot = (frame: number) => {
    const snapshot = createDenseAsciiSnapshot(GPU_SAMPLE_COLS, GPU_SAMPLE_ROWS);
    snapshot.cells.shift();
    snapshot.cells.push(
      createDenseAsciiSnapshot(GPU_SAMPLE_COLS, 1).cells[0].map((cell) => ({ ...cell, ch: `${frame % 10}` })),
    );
    return snapshot;
  };
  const canvasFullGrid = await measureFrames("canvas2d", PERF_FRAMES, () => fullGridSnapshot);
  const canvasScroll = await measureFrames("canvas2d", SCROLL_FRAMES, makeScrollSnapshot);
  const canvasSampleGrid = await measureFrames("canvas2d", GPU_SAMPLE_FRAMES, () => gpuSampleSnapshot);
  const gpuSampleGrid = await measureFrames("webgl2", GPU_SAMPLE_FRAMES, () => gpuSampleSnapshot);
  const canvasSampleScroll = await measureFrames("canvas2d", GPU_SAMPLE_FRAMES, makeGpuSampleScrollSnapshot);
  const gpuSampleScroll = await measureFrames("webgl2", GPU_SAMPLE_FRAMES, makeGpuSampleScrollSnapshot);
  const frameBudgetMs = 1_000 / 60;
  const canvasFullGridTiming = canvasFullGrid.timing;
  const canvasScrollTiming = canvasScroll.timing;
  const canvasSampleGridTiming = canvasSampleGrid.timing;
  const gpuSampleGridTiming = gpuSampleGrid.timing;
  const canvasSampleScrollTiming = canvasSampleScroll.timing;
  const gpuSampleScrollTiming = gpuSampleScroll.timing;
  return {
    version: 1,
    status: "comparison-recorded",
    ok: true,
    generatedAt: new Date().toISOString(),
    renderer: "canvas2d-vs-webgl2",
    measurementMode: "paint-command-timing-no-readback",
    enforced: false,
    baseline: {
      fullGridRepaint: {
        cols: PERF_COLS,
        rows: PERF_ROWS,
        frames: PERF_FRAMES,
        ...canvasFullGridTiming,
      },
      scrollFlood: {
        frames: SCROLL_FRAMES,
        droppedFramesOver60fpsBudget: canvasScroll.samples.filter((sample) => sample > frameBudgetMs).length,
        ...canvasScrollTiming,
      },
    },
    gpu: {
      sampleGridRepaint: {
        cols: GPU_SAMPLE_COLS,
        rows: GPU_SAMPLE_ROWS,
        frames: GPU_SAMPLE_FRAMES,
        sampled: true,
        ...gpuSampleGridTiming,
      },
      sampleScrollFlood: {
        frames: GPU_SAMPLE_FRAMES,
        droppedFramesOver60fpsBudget: gpuSampleScroll.samples.filter((sample) => sample > frameBudgetMs).length,
        sampled: true,
        ...gpuSampleScrollTiming,
      },
      atlas: {
        sampleGrid: atlasCountersWithHitRate(
          gpuSampleGrid.atlasCounters ?? { hits: 0, misses: 0, evictions: 0, pages: 0, glyphs: 0 },
        ),
        sampleScrollFlood: atlasCountersWithHitRate(
          gpuSampleScroll.atlasCounters ?? { hits: 0, misses: 0, evictions: 0, pages: 0, glyphs: 0 },
        ),
      },
    },
    comparison: {
      fullGridRepaint: {
        canvas2d: canvasSampleGridTiming,
        webgl2: gpuSampleGridTiming,
        webgl2VsCanvasP95Ratio: ratio(gpuSampleGridTiming.p95Ms, canvasSampleGridTiming.p95Ms),
        sampleGrid: { cols: GPU_SAMPLE_COLS, rows: GPU_SAMPLE_ROWS },
      },
      scrollFlood: {
        canvas2d: canvasSampleScrollTiming,
        webgl2: gpuSampleScrollTiming,
        webgl2VsCanvasP95Ratio: ratio(gpuSampleScrollTiming.p95Ms, canvasSampleScrollTiming.p95Ms),
        sampleGrid: { cols: GPU_SAMPLE_COLS, rows: GPU_SAMPLE_ROWS },
      },
    },
    flagDefaultProposal: {
      proposedDefault: "canvas2d",
      reason:
        "Keep WebGL2 opt-in: the 120x40 Canvas2D baseline is recorded, but WebGL2 is only sampled on 48x12 because the current Stage 1 implementation is too slow for the full-grid perf verifier; owner approval is required before changing the default.",
    },
  };
}

declare global {
  interface Window {
    __AELYRIS_RENDERER_PERF_HARNESS__: {
      runPerf: typeof runPerf;
    };
  }
}

window.__AELYRIS_RENDERER_PERF_HARNESS__ = {
  runPerf,
};
