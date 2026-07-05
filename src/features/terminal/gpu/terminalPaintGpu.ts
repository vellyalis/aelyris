import {
  CURSOR_COLOR,
  CURSOR_TEXT_BG,
  DEFAULT_FG,
  isDefaultBg,
  LINK_HOVER_FG,
  resolveColor,
  SEARCH_ACTIVE_BG,
  SEARCH_MATCH_BG,
  SELECTION_BG,
} from "../../../shared/lib/ansiPalette";
import type { TerminalTextClarity } from "../../../shared/store/appStore";
import { CellAttr, type CellSnapshot, type GridSnapshot, hasAttr, type ImageRef } from "../../../shared/types/terminal";
import { isVisibleCursor, shouldClampGlyphToCell } from "../aiInputAnchor";
import type { LinkSpan } from "../links";
import { type AnyMatch, viewportRowOf } from "../search";
import { snapCanvasTextCoord } from "../terminalCanvasGeometry";
import { dimAlphaForTextClarity, enhanceTerminalTextColor, parseCssRgbColor } from "../terminalColors";
import type { TerminalCellMetrics } from "../terminalMetrics";
import { matchAnchor } from "../terminalRowDirty";
import { GlyphAtlas, type GlyphAtlasEntry } from "./glyphAtlas";

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface GlProgram {
  program: WebGLProgram;
  attributes: Record<string, number>;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

type DrawCommand =
  | { kind: "rect"; vertices: number[] }
  | { kind: "texture"; texture: WebGLTexture; vertices: number[]; mask: boolean };

export interface TerminalGpuPaintContext {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  atlas: GlyphAtlas;
  rectProgram: GlProgram;
  textureProgram: GlProgram;
  commands: DrawCommand[];
  atlasTextures: Map<number, WebGLTexture>;
  /** Atlas page generation last uploaded to the GPU, keyed by page index.
   * Skips the (expensive) full-page texImage2D when the page raster is
   * unchanged since the previous upload. */
  atlasTextureGenerations: Map<number, number>;
  imageTextures: WeakMap<ImageBitmap, WebGLTexture>;
  width: number;
  height: number;
  devicePixelRatio: number;
  currentFontSize: number;
  currentFontFamily: string;
}

const UNDERLINE_INSET_FROM_BOTTOM = 2;

export function createTerminalGpuPaintContext(
  canvas: HTMLCanvasElement,
  options: { devicePixelRatio?: number; atlas?: GlyphAtlas } = {},
): TerminalGpuPaintContext | null {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  });
  if (!gl) return null;
  const context: TerminalGpuPaintContext = {
    canvas,
    gl,
    atlas: options.atlas ?? new GlyphAtlas(),
    rectProgram: createRectProgram(gl),
    textureProgram: createTextureProgram(gl),
    commands: [],
    atlasTextures: new Map(),
    atlasTextureGenerations: new Map(),
    imageTextures: new WeakMap(),
    width: canvas.width,
    height: canvas.height,
    devicePixelRatio: options.devicePixelRatio ?? 1,
    currentFontSize: 14,
    currentFontFamily: "monospace",
  };
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  return context;
}

export function beginGpuFrame(context: TerminalGpuPaintContext) {
  const { gl, canvas } = context;
  context.width = canvas.width;
  context.height = canvas.height;
  context.commands = [];
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

export function flushGpuFrame(context: TerminalGpuPaintContext) {
  drawCommands(context);
  context.gl.flush();
}

export function readGpuImageData(context: TerminalGpuPaintContext): ImageData {
  const { gl, width, height } = context;
  const raw = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
  const flipped = new Uint8ClampedArray(raw.length);
  const stride = width * 4;
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * stride;
    const dst = y * stride;
    for (let x = 0; x < stride; x += 4) {
      const alpha = raw[src + x + 3];
      flipped[dst + x + 3] = alpha;
      if (alpha > 0 && alpha < 255) {
        flipped[dst + x] = Math.min(255, Math.round((raw[src + x] * 255) / alpha));
        flipped[dst + x + 1] = Math.min(255, Math.round((raw[src + x + 1] * 255) / alpha));
        flipped[dst + x + 2] = Math.min(255, Math.round((raw[src + x + 2] * 255) / alpha));
      } else {
        flipped[dst + x] = raw[src + x];
        flipped[dst + x + 1] = raw[src + x + 1];
        flipped[dst + x + 2] = raw[src + x + 2];
      }
    }
  }
  return new ImageData(flipped, width, height);
}

export function paintRow(
  context: TerminalGpuPaintContext,
  cells: CellSnapshot[],
  row: number,
  metrics: TerminalCellMetrics,
  fontSize: number,
  fontFamily: string,
  devicePixelRatio: number,
  rasterBackground: string,
  textClarity: TerminalTextClarity,
) {
  const { width, height } = metrics;
  const y = row * height;
  context.currentFontSize = fontSize;
  context.currentFontFamily = fontFamily;
  queueRect(context, 0, y, cells.length * width, height, colorToRgba(rasterBackground));

  for (let col = 0; col < cells.length; col++) {
    const cell = cells[col];
    if (hasAttr(cell, CellAttr.WIDE_CHAR_SPACER)) continue;

    const inverse = hasAttr(cell, CellAttr.INVERSE);
    const hidden = hasAttr(cell, CellAttr.HIDDEN);
    const dim = hasAttr(cell, CellAttr.DIM);

    let fgCss = resolveColor(cell.fg, true);
    let bgCss = resolveColor(cell.bg, false);
    if (inverse) {
      const tmp = fgCss;
      fgCss = bgCss;
      bgCss = tmp;
    }

    const wide = hasAttr(cell, CellAttr.WIDE_CHAR);
    const cellW = wide ? width * 2 : width;
    const hasCustomBg = inverse || !isDefaultBg(cell.bg);
    if (hasCustomBg) {
      queueRect(context, col * width, y, cellW, height, colorToRgba(bgCss));
    }

    if (hidden) continue;
    const ch = cell.ch;
    const x = col * width;
    if (ch === " " || ch === "\0") {
      drawDecorations(context, cell, x, y, cellW, height, fgCss, dim, textClarity);
      continue;
    }

    const contrastBackground = hasCustomBg ? bgCss : rasterBackground;
    const readableFgCss = enhanceTerminalTextColor(fgCss, contrastBackground, textClarity);
    const alpha = dim ? dimAlphaForTextClarity(textClarity) : 1;
    const glyphX = snapCanvasTextCoord(x, devicePixelRatio);
    const glyphY = snapCanvasTextCoord(y + 1, devicePixelRatio);
    queueGlyph(context, cell, ch, glyphX, glyphY, cellW, fontSize, fontFamily, devicePixelRatio, readableFgCss, alpha);
    drawDecorations(context, cell, x, y, cellW, height, readableFgCss, dim, textClarity);
  }
}

function drawDecorations(
  context: TerminalGpuPaintContext,
  cell: CellSnapshot,
  x: number,
  y: number,
  cellW: number,
  cellH: number,
  fgCss: string,
  dim: boolean,
  textClarity: TerminalTextClarity,
) {
  const underline = hasAttr(cell, CellAttr.UNDERLINE);
  const strike = hasAttr(cell, CellAttr.STRIKEOUT);
  if (!underline && !strike) return;
  const color = colorToRgba(fgCss, dim ? dimAlphaForTextClarity(textClarity) : 1);
  if (underline) queueRect(context, x, y + cellH - UNDERLINE_INSET_FROM_BOTTOM, cellW, 1, color);
  if (strike) queueRect(context, x, y + Math.round(cellH / 2), cellW, 1, color);
}

export function paintSearchBands(
  context: TerminalGpuPaintContext,
  row: number,
  matches: readonly AnyMatch[] | undefined,
  active: AnyMatch | null | undefined,
  metrics: TerminalCellMetrics,
  totalRows: number,
  scrollOffset: number,
) {
  if (!matches || matches.length === 0) return;
  const activeKey = active ? matchAnchor(active) : null;
  for (const m of matches) {
    const vr = viewportRowOf(m, totalRows, scrollOffset);
    if (vr !== row) continue;
    const isActive = activeKey !== null && matchAnchor(m) === activeKey;
    const { width, height } = metrics;
    const x = m.startCol * width;
    const y = vr * height;
    const w = (m.endCol - m.startCol + 1) * width;
    if (w <= 0) continue;
    queueRect(
      context,
      x,
      y,
      w,
      height,
      colorToRgba(isActive ? SEARCH_ACTIVE_BG : SEARCH_MATCH_BG, isActive ? 0.65 : 0.4),
    );
  }
}

export function paintLinkUnderline(
  context: TerminalGpuPaintContext,
  row: number,
  link: LinkSpan | null,
  totalCols: number,
  metrics: TerminalCellMetrics,
) {
  if (!link) return;
  if (row < link.startRow || row > link.endRow) return;
  const startCol = row === link.startRow ? link.startCol : 0;
  const endColExclusive = row === link.endRow ? link.endCol + 1 : totalCols;
  const { width, height } = metrics;
  const x = startCol * width;
  const y = row * height;
  const w = (endColExclusive - startCol) * width;
  if (w <= 0) return;
  queueRect(context, x, y + height - UNDERLINE_INSET_FROM_BOTTOM, w, 1, colorToRgba(LINK_HOVER_FG));
}

export function paintSelectionBand(
  context: TerminalGpuPaintContext,
  row: number,
  band: { startCol: number; endColExclusive: number },
  { width, height }: TerminalCellMetrics,
) {
  const x = band.startCol * width;
  const y = row * height;
  const w = (band.endColExclusive - band.startCol) * width;
  if (w <= 0) return;
  queueRect(context, x, y, w, height, colorToRgba(SELECTION_BG, 0.45));
}

export function paintGhostSuggestion(
  context: TerminalGpuPaintContext,
  snapshot: GridSnapshot,
  text: string,
  { width, height }: TerminalCellMetrics,
  fontSize: number,
  fontFamily: string,
  devicePixelRatio: number,
) {
  context.currentFontSize = fontSize;
  context.currentFontFamily = fontFamily;
  const { row, col } = snapshot.cursor;
  const y = row * height;
  let x = col * width;
  const glyphY = snapCanvasTextCoord(y + 1, devicePixelRatio);
  for (const ch of text) {
    if (x >= snapshot.cols * width) break;
    const synthetic: CellSnapshot = { ch, fg: 0, bg: 0, attrs: 0 };
    queueGlyph(
      context,
      synthetic,
      ch,
      snapCanvasTextCoord(x, devicePixelRatio),
      glyphY,
      width,
      fontSize,
      fontFamily,
      devicePixelRatio,
      DEFAULT_FG,
      0.45,
    );
    x += width;
  }
}

export function paintImages(
  context: TerminalGpuPaintContext,
  images: readonly ImageRef[],
  bitmaps: ReadonlyMap<number, ImageBitmap>,
  { width, height }: TerminalCellMetrics,
) {
  for (const ref of images) {
    const bmp = bitmaps.get(ref.id);
    if (!bmp) continue;
    const cellW = ref.cellW ?? Math.max(1, Math.ceil(ref.widthPx / width));
    const cellH = ref.cellH ?? Math.max(1, Math.ceil(ref.heightPx / height));
    queueTextureQuad(
      context,
      textureForImage(context, bmp),
      ref.cellCol * width,
      ref.cellRow * height,
      cellW * width,
      cellH * height,
      0,
      0,
      1,
      1,
      { r: 1, g: 1, b: 1, a: 1 },
    );
  }
}

export function paintCursor(
  context: TerminalGpuPaintContext,
  snapshot: GridSnapshot,
  { width, height }: TerminalCellMetrics,
  devicePixelRatio: number,
) {
  if (!isVisibleCursor(snapshot.cursor)) return;
  const { row, col, shape } = snapshot.cursor;
  const x = col * width;
  const y = row * height;
  switch (shape) {
    case "block": {
      queueRect(context, x, y, width, height, colorToRgba(CURSOR_COLOR));
      const cell = snapshot.cells[row]?.[col];
      if (cell && cell.ch !== " ") {
        const wide = hasAttr(cell, CellAttr.WIDE_CHAR);
        const glyphX = snapCanvasTextCoord(x, devicePixelRatio);
        const glyphY = snapCanvasTextCoord(y + 1, devicePixelRatio);
        queueGlyph(
          context,
          cell,
          cell.ch,
          glyphX,
          glyphY,
          wide ? width * 2 : width,
          context.currentFontSize,
          context.currentFontFamily,
          devicePixelRatio,
          CURSOR_TEXT_BG,
          1,
        );
      }
      return;
    }
    case "hollowBlock":
      queueRect(context, x, y, width, 1, colorToRgba(CURSOR_COLOR));
      queueRect(context, x, y + height - 1, width, 1, colorToRgba(CURSOR_COLOR));
      queueRect(context, x, y, 1, height, colorToRgba(CURSOR_COLOR));
      queueRect(context, x + width - 1, y, 1, height, colorToRgba(CURSOR_COLOR));
      return;
    case "underline":
      queueRect(
        context,
        x,
        y + height - UNDERLINE_INSET_FROM_BOTTOM,
        width,
        UNDERLINE_INSET_FROM_BOTTOM,
        colorToRgba(CURSOR_COLOR),
      );
      return;
    case "beam":
      queueRect(context, x, y, 2, height, colorToRgba(CURSOR_COLOR));
      return;
  }
}

function queueGlyph(
  context: TerminalGpuPaintContext,
  cell: CellSnapshot,
  text: string,
  x: number,
  y: number,
  cellWidth: number,
  fontSize: number,
  fontFamily: string,
  devicePixelRatio: number,
  cssColor: string,
  alpha: number,
) {
  const entry = context.atlas.getOrInsert({
    text,
    fontFamily,
    fontSize,
    dpr: devicePixelRatio,
    bold: hasAttr(cell, CellAttr.BOLD),
    italic: hasAttr(cell, CellAttr.ITALIC),
  });
  const destWidth = shouldClampGlyphToCell(cell, text)
    ? cellWidth
    : Math.max(1, Math.min(cellWidth * 2, entry.width / devicePixelRatio));
  const destHeight = entry.height / devicePixelRatio;
  const texture = textureForAtlasEntry(context, entry);
  queueTextureQuad(
    context,
    texture,
    x - entry.offsetX / devicePixelRatio,
    y - entry.offsetY / devicePixelRatio,
    destWidth,
    destHeight,
    entry.u0,
    entry.v0,
    entry.u1,
    entry.v1,
    colorToRgba(cssColor, alpha),
    true,
  );
}

function queueRect(context: TerminalGpuPaintContext, x: number, y: number, width: number, height: number, color: Rgba) {
  const r = color.r;
  const g = color.g;
  const b = color.b;
  const a = color.a;
  const vertices: number[] = [];
  pushColoredQuad(vertices, x, y, width, height, r, g, b, a);
  context.commands.push({ kind: "rect", vertices });
}

function queueTextureQuad(
  context: TerminalGpuPaintContext,
  texture: WebGLTexture,
  x: number,
  y: number,
  width: number,
  height: number,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  color: Rgba,
  mask = false,
) {
  const vertices = [
    x,
    y,
    u0,
    v0,
    color.r,
    color.g,
    color.b,
    color.a,
    x + width,
    y,
    u1,
    v0,
    color.r,
    color.g,
    color.b,
    color.a,
    x,
    y + height,
    u0,
    v1,
    color.r,
    color.g,
    color.b,
    color.a,
    x,
    y + height,
    u0,
    v1,
    color.r,
    color.g,
    color.b,
    color.a,
    x + width,
    y,
    u1,
    v0,
    color.r,
    color.g,
    color.b,
    color.a,
    x + width,
    y + height,
    u1,
    v1,
    color.r,
    color.g,
    color.b,
    color.a,
  ];
  context.commands.push({ kind: "texture", texture, vertices, mask });
}

function pushColoredQuad(
  vertices: number[],
  x: number,
  y: number,
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a: number,
) {
  vertices.push(
    x,
    y,
    r,
    g,
    b,
    a,
    x + width,
    y,
    r,
    g,
    b,
    a,
    x,
    y + height,
    r,
    g,
    b,
    a,
    x,
    y + height,
    r,
    g,
    b,
    a,
    x + width,
    y,
    r,
    g,
    b,
    a,
    x + width,
    y + height,
    r,
    g,
    b,
    a,
  );
}

function drawCommands(context: TerminalGpuPaintContext) {
  if (context.commands.length === 0) return;
  const { gl, rectProgram } = context;
  const rectBuffer = gl.createBuffer();
  const textureBuffer = gl.createBuffer();
  if (!rectBuffer || !textureBuffer) throw new Error("WebGL2 buffer allocation failed");

  // Merge ADJACENT commands that share GL state (rects together; glyphs with
  // the same texture+mask together) into one buffer upload + one draw call.
  // Only adjacent commands merge, so queue order — and therefore z-order — is
  // preserved exactly. Without this, every glyph is its own draw call and a
  // full-grid repaint issues thousands of bufferData/drawArrays round trips.
  const batched: DrawCommand[] = [];
  for (const command of context.commands) {
    const last = batched[batched.length - 1];
    const mergeable =
      last &&
      last.kind === command.kind &&
      (command.kind === "rect" ||
        (last.kind === "texture" && last.texture === command.texture && last.mask === command.mask));
    if (mergeable) {
      for (const v of command.vertices) last.vertices.push(v);
      continue;
    }
    batched.push(
      command.kind === "rect"
        ? { kind: "rect", vertices: command.vertices.slice() }
        : { kind: "texture", texture: command.texture, mask: command.mask, vertices: command.vertices.slice() },
    );
  }

  const { textureProgram } = context;
  const bindProgram = gl.useProgram.bind(gl);
  for (const command of batched) {
    if (command.kind === "rect") {
      bindProgram(rectProgram.program);
      gl.uniform2f(rectProgram.uniforms.u_resolution, context.width, context.height);
      gl.bindBuffer(gl.ARRAY_BUFFER, rectBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(command.vertices), gl.STREAM_DRAW);
      const rectStride = 6 * Float32Array.BYTES_PER_ELEMENT;
      gl.enableVertexAttribArray(rectProgram.attributes.a_position);
      gl.vertexAttribPointer(rectProgram.attributes.a_position, 2, gl.FLOAT, false, rectStride, 0);
      gl.enableVertexAttribArray(rectProgram.attributes.a_color);
      gl.vertexAttribPointer(
        rectProgram.attributes.a_color,
        4,
        gl.FLOAT,
        false,
        rectStride,
        2 * Float32Array.BYTES_PER_ELEMENT,
      );
      gl.drawArrays(gl.TRIANGLES, 0, command.vertices.length / 6);
      continue;
    }
    bindProgram(textureProgram.program);
    gl.uniform2f(textureProgram.uniforms.u_resolution, context.width, context.height);
    gl.uniform1i(textureProgram.uniforms.u_texture, 0);
    gl.uniform1i(textureProgram.uniforms.u_mask, command.mask ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, command.texture);
    gl.bindBuffer(gl.ARRAY_BUFFER, textureBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(command.vertices), gl.STREAM_DRAW);
    const textureStride = 8 * Float32Array.BYTES_PER_ELEMENT;
    gl.enableVertexAttribArray(textureProgram.attributes.a_position);
    gl.vertexAttribPointer(textureProgram.attributes.a_position, 2, gl.FLOAT, false, textureStride, 0);
    gl.enableVertexAttribArray(textureProgram.attributes.a_texCoord);
    gl.vertexAttribPointer(
      textureProgram.attributes.a_texCoord,
      2,
      gl.FLOAT,
      false,
      textureStride,
      2 * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.enableVertexAttribArray(textureProgram.attributes.a_color);
    gl.vertexAttribPointer(
      textureProgram.attributes.a_color,
      4,
      gl.FLOAT,
      false,
      textureStride,
      4 * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.drawArrays(gl.TRIANGLES, 0, command.vertices.length / 8);
  }
  gl.deleteBuffer(rectBuffer);
  gl.deleteBuffer(textureBuffer);
}

function textureForAtlasEntry(context: TerminalGpuPaintContext, entry: GlyphAtlasEntry): WebGLTexture {
  let texture = context.atlasTextures.get(entry.pageIndex);
  if (!texture) {
    texture = createTexture(context.gl);
    context.atlasTextures.set(entry.pageIndex, texture);
    context.atlasTextureGenerations.delete(entry.pageIndex);
  }
  const generation = context.atlas.getPageGeneration(entry.pageIndex);
  if (context.atlasTextureGenerations.get(entry.pageIndex) !== generation) {
    const surface = context.atlas.getPageSurface(entry.pageIndex);
    if (!surface) throw new Error(`missing glyph atlas page ${entry.pageIndex}`);
    uploadTexture(context.gl, texture, surface as TexImageSource);
    context.atlasTextureGenerations.set(entry.pageIndex, generation);
  }
  return texture;
}

function textureForImage(context: TerminalGpuPaintContext, bitmap: ImageBitmap): WebGLTexture {
  let texture = context.imageTextures.get(bitmap);
  if (!texture) {
    texture = createTexture(context.gl);
    context.imageTextures.set(bitmap, texture);
    uploadTexture(context.gl, texture, bitmap);
  }
  return texture;
}

function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error("WebGL2 texture allocation failed");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function uploadTexture(gl: WebGL2RenderingContext, texture: WebGLTexture, source: TexImageSource) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
}

function colorToRgba(color: string, alphaMultiplier = 1): Rgba {
  const parsed = parseCssRgbColor(color);
  if (!parsed) return { r: 1, g: 1, b: 1, a: alphaMultiplier };
  return {
    r: parsed.r / 255,
    g: parsed.g / 255,
    b: parsed.b / 255,
    a: parsed.a * alphaMultiplier,
  };
}

function createRectProgram(gl: WebGL2RenderingContext): GlProgram {
  return createProgram(gl, RECT_VERTEX_SHADER, RECT_FRAGMENT_SHADER, ["a_position", "a_color"], ["u_resolution"]);
}

function createTextureProgram(gl: WebGL2RenderingContext): GlProgram {
  return createProgram(
    gl,
    TEXTURE_VERTEX_SHADER,
    TEXTURE_FRAGMENT_SHADER,
    ["a_position", "a_texCoord", "a_color"],
    ["u_resolution", "u_texture", "u_mask"],
  );
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  attributeNames: string[],
  uniformNames: string[],
): GlProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error("WebGL2 program allocation failed");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`WebGL2 program link failed: ${gl.getProgramInfoLog(program) ?? "unknown"}`);
  }
  const attributes = Object.fromEntries(attributeNames.map((name) => [name, gl.getAttribLocation(program, name)]));
  const uniforms = Object.fromEntries(uniformNames.map((name) => [name, gl.getUniformLocation(program, name)]));
  return { program, attributes, uniforms };
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL2 shader allocation failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`WebGL2 shader compile failed: ${gl.getShaderInfoLog(shader) ?? "unknown"}`);
  }
  return shader;
}

const RECT_VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec4 a_color;
uniform vec2 u_resolution;
out vec4 v_color;
void main() {
  vec2 zeroToOne = a_position / u_resolution;
  vec2 clip = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
  v_color = a_color;
}`;

const RECT_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 outColor;
void main() {
  outColor = v_color;
}`;

const TEXTURE_VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
in vec4 a_color;
uniform vec2 u_resolution;
out vec2 v_texCoord;
out vec4 v_color;
void main() {
  vec2 zeroToOne = a_position / u_resolution;
  vec2 clip = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
  v_texCoord = a_texCoord;
  v_color = a_color;
}`;

const TEXTURE_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D u_texture;
uniform bool u_mask;
in vec2 v_texCoord;
in vec4 v_color;
out vec4 outColor;
void main() {
  vec4 sampleColor = texture(u_texture, v_texCoord);
  if (u_mask) {
    outColor = vec4(v_color.rgb, sampleColor.a * v_color.a);
  } else {
    outColor = sampleColor * v_color;
  }
}`;
