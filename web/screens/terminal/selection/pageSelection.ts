// The page's text of the terminal (phone, `directInput: "owned"`). On touch the row list's rows are page text:
// iOS's long press selects them with its own handles and menu (this reads that selection and closes it), and
// the keyboard-up mark (`mark.ts`) is a range over the same rows. One rule says what "selected" is, and one
// join turns a range into Copy's text across soft wraps.
import { logicalLines } from "../../../touch/selection";
import type { TextRow } from "../rowList";

export type { TextRow };

/** The row list the text is on; null while another view draws the terminal. */
interface PageSelectionDeps {
  list(): {
    contains(node: Node): boolean;
    rowsIn(range: Range): TextRow[];
    span(range: Range): { first: HTMLElement; last: HTMLElement } | null;
  } | null;
}

/**
 * A touch within this of the selected text is the system's: its handles reach past the glyphs. The mark's own
 * reach is smaller (`TAP_REACH`): its handles are drawn and hit-tested apart, and a tap near the mark but
 * off it should clear it.
 */
const REACH = 22;

export class PageSelection {
  constructor(private readonly deps: PageSelectionDeps) {}

  /** Whether a non-empty range reaches the rows. The line box's caret and the terminal input's fire the same event and don't count. */
  exists(): boolean {
    return this.range() !== null;
  }

  /** Whether the client point is on the selected text, or near enough that the system's handles are there. */
  contains(x: number, y: number): boolean {
    const range = this.range();
    return range !== null && near(this.rectsOf(range), x, y, REACH);
  }

  /** Whether `node` is inside the rows' text. */
  holds(node: Node): boolean {
    return this.deps.list()?.contains(node) ?? false;
  }

  /** The selection's range cut to the rows, or null with none. */
  current(): Range | null {
    return this.range();
  }

  /** Whether any row in `seqs` lies between a range's first and last row: the text it marked was rewritten (J7). */
  rewrites(range: Range | null, seqs: readonly number[]): boolean {
    const span = range && this.deps.list()?.span(range);
    if (!span) return false;
    const [first, last] = [Number(span.first.dataset["seq"]), Number(span.last.dataset["seq"])];
    return seqs.some((seq) => seq >= first && seq <= last);
  }

  /** The selected text with soft wraps joined, one line per logical line; empty with no selection. */
  text(): string {
    const range = this.range();
    return range ? this.textOf(range) : "";
  }

  /** `range`'s text with soft wraps joined, one line per logical line: Copy's text for the selection and the mark alike. */
  textOf(range: Range): string {
    const pieces = this.rowsOf(range)
      .map(({ element, wrapped }) => ({ text: clipped(range, element).toString().replaceAll("\u00a0", " "), wrapped }));
    // A range that ends at a row's start still touches that row, and one that starts at a row's end touches it: neither selects it.
    while (pieces.at(-1)?.text === "") pieces.pop();
    while (pieces[0]?.text === "") pieces.shift();
    return logicalLines(pieces).lines.map((line) => line.trimEnd()).join("\n");
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
    return this.deps.list()?.rowsIn(range) ?? [];
  }

  clear(): void {
    if (this.range()) getSelection()?.removeAllRanges();
  }

  /** The selection cut to the rows: a range that runs on past them (a handle dragged out of the terminal) keeps what lies inside. */
  private range(): Range | null {
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    const span = this.deps.list()?.span(range);
    if (!span) return null;
    const { first, last } = span;
    const cut = range.cloneRange();
    if (!this.holds(range.startContainer)) cut.setStart(first, 0);
    if (!this.holds(range.endContainer)) cut.setEnd(last, last.childNodes.length);
    return cut;
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
