// Ranges over the row list's rows: what any selection of the terminal's text (the DOM's or the mark) asks of them.
// One rule says which rows a range touches, and one join turns a range into Copy's text across soft wraps.
import { logicalLines } from "../../../touch/selection";
import type { TextRow } from "../rowList";

/** The row list the text is on; null while another view draws the terminal. */
interface RowSource {
  contains(node: Node): boolean;
  rowsIn(range: Range): TextRow[];
  span(range: Range): { first: HTMLElement; last: HTMLElement } | null;
  /** The rows of the live screen, top first. */
  screenRows(): HTMLElement[];
}

/** A selection's rows as they were before a frame redrew them: whole rows' text, and where in the first and last row it begins and ends. */
export interface Anchor {
  rows: HTMLElement[];
  texts: string[];
  /** Character offsets into the first row's text and the last row's. */
  start: number;
  end: number;
}

export class RowRanges {
  constructor(private readonly source: () => RowSource | null) {}

  /** Whether `node` is inside the rows' text. */
  holds(node: Node): boolean {
    return this.source()?.contains(node) ?? false;
  }

  /** `range` cut to the rows: one that runs on past them (a handle dragged out of the terminal) keeps what lies inside. Null when it touches none. */
  cut(range: Range): Range | null {
    const span = this.source()?.span(range);
    if (!span) return null;
    const { first, last } = span;
    const cut = range.cloneRange();
    if (!this.holds(range.startContainer)) cut.setStart(first, 0);
    if (!this.holds(range.endContainer)) cut.setEnd(last, last.childNodes.length);
    return cut;
  }

  /** The rows `range` covers and where in them it lies, to be kept across a frame that redraws them; null with none. */
  anchor(range: Range | null): Anchor | null {
    if (!range) return null;
    const rows = this.rowsOf(range).map(({ element }) => ({ element, part: clipped(range, element) }));
    // As in `textOf`: a row the range only touches at its edge is no part of it.
    while (rows.at(-1)?.part.collapsed) rows.pop();
    while (rows[0]?.part.collapsed) rows.shift();
    const first = rows[0];
    const last = rows.at(-1);
    if (!first || !last) return null;
    return {
      rows: rows.map(({ element }) => element),
      texts: rows.map(({ element }) => element.textContent),
      start: textBefore(first.element, first.part.startContainer, first.part.startOffset),
      end: textBefore(last.element, last.part.endContainer, last.part.endOffset),
    };
  }

  /** Whether the row `seq` lies between a range's first and last row: a redraw of it rewrites the text it marked (J7). */
  covers(range: Range | null, seq: number): boolean {
    const span = range && this.source()?.span(range);
    return !!span && seq >= Number(span.first.dataset["seq"]) && seq <= Number(span.last.dataset["seq"]);
  }

  /**
   * The anchor's range over the rows as they are now (J7): the same rows if their text is unchanged (the redraw
   * replaced their nodes, a style-only change among it), else the one place on the screen where that text now sits,
   * the same columns in it. Null when the text changed, sits in several places, or left the screen.
   */
  follow(anchor: Anchor): { range: Range; moved: boolean } | null {
    const { texts } = anchor;
    const stays = anchor.rows.every((row, i) => row.isConnected && row.textContent === texts[i]);
    const rows = stays ? anchor.rows : this.relocate(texts);
    const head = rows?.[0];
    const tail = rows?.at(-1);
    if (!head || !tail) return null;
    const range = document.createRange();
    range.setStart(...pointAt(head, anchor.start));
    range.setEnd(...pointAt(tail, anchor.end));
    return { range, moved: !stays };
  }

  /** The screen rows that now hold `texts` as a contiguous block, when exactly one place does. */
  private relocate(texts: readonly string[]): HTMLElement[] | null {
    const screen = this.source()?.screenRows() ?? [];
    if (texts.every((text) => text.trim() === "")) return null;
    const found: number[] = [];
    for (let at = 0; at + texts.length <= screen.length; at++) {
      if (texts.every((text, i) => screen[at + i]?.textContent === text)) found.push(at);
    }
    const [only, other] = found;
    return only !== undefined && other === undefined ? screen.slice(only, only + texts.length) : null;
  }

  /** Whether the rows `from` to `to` overlap a range's rows: the text it marked is about to go (J7). */
  drops(range: Range | null, from: number, to: number): boolean {
    const span = range && this.source()?.span(range);
    return !!span && from <= Number(span.last.dataset["seq"]) && to >= Number(span.first.dataset["seq"]);
  }

  /** `range`'s text with soft wraps joined, one line per logical line: Copy's text for the selection and the mark alike. */
  textOf(range: Range): string {
    const pieces = this.rowsOf(range)
      .map(({ element, wrapped }) => ({ text: clipped(range, element).toString().replaceAll(" ", " "), wrapped }));
    // A range that ends at a row's start still touches that row, and one that starts at a row's end touches it: neither selects it.
    while (pieces.at(-1)?.text === "") pieces.pop();
    while (pieces[0]?.text === "") pieces.shift();
    return logicalLines(pieces).map((line) => line.trimEnd()).join("\n");
  }

  /**
   * The client rects of `range`'s text, row by row. `range.getClientRects()` itself would add the box of every
   * element the range fully contains: a rect over a whole block. Each row's rects come from its clipped part.
   */
  rectsOf(range: Range): DOMRect[] {
    return this.rowsOf(range)
      .flatMap(({ element }) => {
        const part = clipped(range, element);
        return part.collapsed ? [] : [...part.getClientRects()];
      });
  }

  private rowsOf(range: Range): TextRow[] {
    return this.source()?.rowsIn(range) ?? [];
  }
}

/** The part of `element`'s contents that `range` covers. */
function clipped(range: Range, element: HTMLElement): Range {
  const part = document.createRange();
  part.selectNodeContents(element);
  if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(range.startContainer, range.startOffset);
  if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset);
  return part;
}

/** The number of characters of `row`'s text before the point. */
function textBefore(row: HTMLElement, node: Node, offset: number): number {
  const before = document.createRange();
  before.selectNodeContents(row);
  before.setEnd(node, offset);
  return before.toString().length;
}

/** The point `offset` characters into `row`'s text. */
function pointAt(row: HTMLElement, offset: number): [Node, number] {
  const texts = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  let left = offset;
  for (let node = texts.nextNode(); node; node = texts.nextNode()) {
    const { length } = node as Text;
    if (left <= length) return [node, left];
    left -= length;
  }
  return [row, row.childNodes.length];
}

/** Whether the client point is on one of `rects`, or within `reach` of it. */
export function near(rects: readonly DOMRect[], x: number, y: number, reach: number): boolean {
  return rects.some((r) => x >= r.left - reach && x <= r.right + reach && y >= r.top - reach && y <= r.bottom + reach);
}

/** The box around `rects`, or null with none. */
export function boxOf(rects: readonly DOMRect[]): DOMRect | null {
  const [first, ...rest] = rects;
  if (!first) return null;
  const left = Math.min(first.left, ...rest.map((r) => r.left));
  const top = Math.min(first.top, ...rest.map((r) => r.top));
  return new DOMRect(left, top, Math.max(first.right, ...rest.map((r) => r.right)) - left, Math.max(first.bottom, ...rest.map((r) => r.bottom)) - top);
}
