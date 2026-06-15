/**
 * AI CLI screen + input-anchor + cursor detection for the terminal canvas.
 *
 * Pure grid analysis extracted from TerminalCanvas so it can be unit-tested
 * without a canvas context and so the renderer shrinks toward the 800-line
 * budget. Given a GridSnapshot these helpers locate an AI CLI's input line,
 * detect whether the screen looks like an AI CLI prompt, and decide whether
 * the real terminal cursor is "parked" off the visible input row (AI CLIs
 * routinely leave the cursor on a status/footer line).
 */
import { CellAttr, type CellSnapshot, type CursorSnapshot, type GridSnapshot, hasAttr } from "../../shared/types/terminal";

export type CursorPoint = { row: number; col: number };
type RowTextMap = { text: string; startCols: number[]; endCols: number[] };

const AI_INPUT_PLACEHOLDERS = [
  "Type your message",
  "Ask me anything",
  "Message Codex",
  "Send a message",
  "Enter your prompt",
  "What can I help",
] as const;

const AI_SHORTCUT_HINTS = ["? for shortcuts"] as const;
const AI_PROMPT_MARKERS = new Set([">", "❯", "›", "»", "λ", "→"]);
const AI_INPUT_RIGHT_FRAME_CHARS = new Set(["│", "┃", "║", "▌", "▐", "╎", "┆", "┊", "┋", "╏", "┤", "╮", "╯"]);
const AI_INPUT_MIN_ROW_RATIO = 0.35;
const AI_CLI_SCREEN_SIGNATURE =
  /\b(?:Claude Code|Codex(?: CLI)?|Gemini CLI)\b|(?:\?|\/help)\s+for shortcuts|\b(?:tokens?|MCP servers?|directory|model)\b/i;

function rowToTextMap(row: readonly CellSnapshot[]): RowTextMap {
  const startCols: number[] = [];
  const endCols: number[] = [];
  let text = "";

  for (let col = 0; col < row.length; col++) {
    const cell = row[col];
    if (!cell || hasAttr(cell, CellAttr.WIDE_CHAR_SPACER)) continue;
    const ch = cell.ch && cell.ch !== "\0" ? cell.ch : " ";
    const startIndex = text.length;
    text += ch;
    const endCol = col + (hasAttr(cell, CellAttr.WIDE_CHAR) ? 2 : 1);
    for (let i = startIndex; i < text.length; i++) {
      startCols[i] = col;
      endCols[i] = endCol;
    }
  }

  return { text, startCols, endCols };
}

function lastNonSpaceTextIndex(text: string): number {
  return Math.max(0, text.trimEnd().length);
}

function trimRightFrameIndex(text: string): number {
  let end = text.trimEnd().length;
  while (end > 0 && AI_INPUT_RIGHT_FRAME_CHARS.has(text[end - 1])) {
    end = text.slice(0, end - 1).trimEnd().length;
  }
  return end;
}

function columnAtTextIndex(rowText: RowTextMap, index: number): number {
  if (rowText.text.length === 0) return 0;
  const clamped = Math.min(Math.max(0, index), rowText.text.length - 1);
  return rowText.startCols[clamped] ?? 0;
}

function columnAfterTextIndex(rowText: RowTextMap, index: number): number {
  if (index <= 0 || rowText.text.length === 0) return 0;
  const clamped = Math.min(index - 1, rowText.text.length - 1);
  return rowText.endCols[clamped] ?? 0;
}

function aiPromptInputColumn(rowText: RowTextMap, promptCol: number): number {
  return Math.max(promptCol, columnAfterTextIndex(rowText, trimRightFrameIndex(rowText.text)));
}

function clampColumn(col: number, cols: number): number {
  return Math.min(Math.max(0, col), Math.max(0, cols - 1));
}

export function terminalCellSpan(text: string): number {
  let cells = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    cells += code > 0x7f ? 2 : 1;
  }
  return cells;
}

export function shouldClampGlyphToCell(cell: CellSnapshot, ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return hasAttr(cell, CellAttr.WIDE_CHAR) || code > 0x7f;
}

export function isVisibleCursor(cursor: CursorSnapshot | null | undefined): cursor is CursorSnapshot {
  return !!cursor && cursor.visible && cursor.shape !== "hidden";
}

export function isParkedAiCliCursor(
  snapshot: GridSnapshot | null,
  cursor: CursorSnapshot | null,
  aiInputAnchor: CursorPoint | null,
): boolean {
  if (!aiInputAnchor) return false;
  if (!isVisibleCursor(cursor)) return true;
  if (!snapshot) return false;

  const rowText = rowToTextMap(snapshot.cells[cursor.row] ?? []).text.trim();
  const parkedAtRightEdge = cursor.col >= Math.max(0, snapshot.cols - 2);
  if (cursor.row === aiInputAnchor.row) {
    const row = snapshot.cells[cursor.row] ?? [];
    const betweenAnchorAndCursor = row
      .slice(Math.min(aiInputAnchor.col, cursor.col), Math.max(aiInputAnchor.col, cursor.col))
      .map((cell) => (cell?.ch && cell.ch !== "\0" ? cell.ch : " "))
      .join("");
    const cursorParkedOnInputRunway =
      cursor.col > aiInputAnchor.col + 2 && /^[\s│┃║▌▐╎┆┊┋╏┤╮╯]*$/.test(betweenAnchorAndCursor);
    return parkedAtRightEdge || cursor.col > aiInputAnchor.col + 8 || cursorParkedOnInputRunway;
  }
  const parkedBelowInput = cursor.row > aiInputAnchor.row;
  const statusLikeRow =
    rowText.length === 0 ||
    /^[╰└┗╚─━┄┅┈┉═]+/.test(rowText) ||
    /\b(tokens?|workspace|branch|model|quota|shortcuts?|directory)\b/i.test(rowText);

  return parkedAtRightEdge || (parkedBelowInput && statusLikeRow);
}

function isPromptBoundary(ch: string | undefined): boolean {
  return ch === undefined || ch === " " || ch === "\t" || ch === "│" || ch === "┃" || ch === "╎" || ch === "┆";
}

function findPromptInputColumn(rowText: RowTextMap, beforeIndex = rowText.text.length): number | null {
  const { text } = rowText;
  const limit = Math.min(Math.max(0, beforeIndex), text.length);
  for (let i = 0; i < limit; i++) {
    if (!AI_PROMPT_MARKERS.has(text[i])) continue;
    if (!isPromptBoundary(text[i - 1]) || !isPromptBoundary(text[i + 1])) continue;
    const markerEndCol = columnAfterTextIndex(rowText, i + 1);
    if (text[i + 1] === undefined) return markerEndCol + 1;
    return columnAfterTextIndex(rowText, i + 2);
  }
  return null;
}

export function findAiCliInputAnchor(snapshot: GridSnapshot | null): CursorPoint | null {
  if (!snapshot) return null;

  const minInputRow = Math.max(0, Math.floor(snapshot.cells.length * AI_INPUT_MIN_ROW_RATIO));
  for (let row = snapshot.cells.length - 1; row >= minInputRow; row--) {
    const rowText = rowToTextMap(snapshot.cells[row] ?? []);
    const { text } = rowText;
    for (const placeholder of AI_INPUT_PLACEHOLDERS) {
      const hintIndex = text.indexOf(placeholder);
      if (hintIndex < 0) continue;
      const promptCol = findPromptInputColumn(rowText, hintIndex);
      return { row, col: clampColumn(promptCol ?? columnAtTextIndex(rowText, hintIndex), snapshot.cols) };
    }

    for (const hint of AI_SHORTCUT_HINTS) {
      const hintIndex = text.indexOf(hint);
      if (hintIndex < 0) continue;
      const hintEnd = hintIndex + hint.length + 1;
      const typedEnd = lastNonSpaceTextIndex(text);
      if (typedEnd <= hintEnd) continue;
      return {
        row,
        col: clampColumn(
          Math.max(columnAfterTextIndex(rowText, hintEnd), columnAfterTextIndex(rowText, typedEnd)),
          snapshot.cols,
        ),
      };
    }

    const promptCol = findPromptInputColumn(rowText);
    if (promptCol !== null) {
      return { row, col: clampColumn(aiPromptInputColumn(rowText, promptCol), snapshot.cols) };
    }
  }

  return null;
}

export function hasAiCliScreenSignature(snapshot: GridSnapshot | null): boolean {
  if (!snapshot) return false;
  const startRow = Math.max(0, Math.floor(snapshot.cells.length * 0.15));
  for (let row = startRow; row < snapshot.cells.length; row++) {
    if (AI_CLI_SCREEN_SIGNATURE.test(rowToTextMap(snapshot.cells[row] ?? []).text)) return true;
  }
  return false;
}
