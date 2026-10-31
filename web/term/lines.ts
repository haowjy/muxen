import type { IBuffer, IBufferCell } from "@xterm/xterm";
import { pushRun, trimRow, type Color, type Row, type Run, type Style } from "./rows";

function colorOf(cell: IBufferCell, side: "fg" | "bg"): Color | undefined {
  const [isDefault, isPalette, isRgb, value] =
    side === "fg"
      ? [cell.isFgDefault(), cell.isFgPalette(), cell.isFgRGB(), cell.getFgColor()]
      : [cell.isBgDefault(), cell.isBgPalette(), cell.isBgRGB(), cell.getBgColor()];
  if (isDefault) return undefined;
  if (isPalette) return value;
  return isRgb ? `#${value.toString(16).padStart(6, "0")}` : undefined;
}

function styleOf(cell: IBufferCell): Style {
  const style: Style = {};
  const fg = colorOf(cell, "fg");
  const bg = colorOf(cell, "bg");
  if (fg !== undefined) style.fg = fg;
  if (bg !== undefined) style.bg = bg;
  if (cell.isBold()) style.bold = true;
  if (cell.isDim()) style.dim = true;
  if (cell.isItalic()) style.italic = true;
  if (cell.isUnderline()) style.underline = true;
  if (cell.isInverse()) style.inverse = true;
  if (cell.isStrikethrough()) style.strike = true;
  if (cell.isInvisible()) style.invisible = true;
  return style;
}

/**
 * Rows `from` up to `to` exclusive, styled run by run. `wrapped(y)` says row `y` continues the one above it;
 * a row that nothing continues loses the blanks at its end.
 */
export function readRows(buffer: IBuffer, from: number, to: number, wrapped: (y: number) => boolean = (y) => buffer.getLine(y)?.isWrapped ?? false): Row[] {
  const rows: Row[] = [];
  let cell: IBufferCell | undefined;
  for (let y = Math.max(0, from); y < Math.min(to, buffer.length); y++) {
    const line = buffer.getLine(y);
    if (!line) break;
    const runs: Run[] = [];
    const cells: string[] = [];
    for (let x = 0; x < line.length; x++) {
      cell = line.getCell(x, cell);
      if (!cell) continue;
      const width = cell.getWidth();
      // The second cell of a wide character is empty in the cells and absent from the text.
      if (width === 0) {
        cells.push("");
        continue;
      }
      const chars = cell.getChars() || " ";
      cells.push(chars);
      if (width === 2) runs.push({ text: chars, style: styleOf(cell), wide: true }); // a run of its own, so the view can give it two cells
      else pushRun(runs, chars, styleOf(cell));
    }
    if (!wrapped(y + 1)) trimRow(runs);
    rows.push({ runs, wrapped: wrapped(y), cells });
  }
  return rows;
}

/**
 * The buffer's rows from `from` (moved up to the start of its logical line, and returned, so
 * a wrapped line is never cut) up to `to` exclusive (default: the end; run on to finish a wrapped line).
 */
export function bufferRows(buffer: IBuffer, from: number, to = buffer.length): { rows: Row[]; from: number } {
  let start = Math.max(0, from);
  while (start > 0 && buffer.getLine(start)?.isWrapped) start--;
  let end = Math.min(to, buffer.length);
  while (end < buffer.length && buffer.getLine(end)?.isWrapped) end++;
  return { rows: readRows(buffer, start, end), from: start };
}
