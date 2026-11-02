// Ranges over the row list's rows: what any selection of the terminal's text (the DOM's or the mark) asks of them.
// One rule says which rows a range touches, and one join turns a range into Copy's text across soft wraps.
import { logicalLines } from "../../../touch/selection";
import type { TextRow } from "../rowList";

/** The row list the text is on; null while another view draws the terminal. */
interface RowSource {
  contains(node: Node): boolean;
  rowsIn(range: Range): TextRow[];
  span(range: Range): { first: HTMLElement; last: HTMLElement } | null;
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

  /** Whether any row in `seqs` lies between a range's first and last row: the text it marked was rewritten (J7). */
  rewrites(range: Range | null, seqs: readonly number[]): boolean {
    return this.overlaps(range, (first, last) => seqs.some((seq) => seq >= first && seq <= last));
  }

  /** Whether the rows `from` to `to` overlap a range's rows: the text it marked is about to go (J7). */
  drops(range: Range | null, from: number, to: number): boolean {
    return this.overlaps(range, (first, last) => from <= last && to >= first);
  }

  private overlaps(range: Range | null, test: (first: number, last: number) => boolean): boolean {
    const span = range && this.source()?.span(range);
    return !!span && test(Number(span.first.dataset["seq"]), Number(span.last.dataset["seq"]));
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
