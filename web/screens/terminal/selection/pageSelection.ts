// The page's text of the terminal (phone, `directInput: "owned"`). On touch xterm's rows and the history
// view are page text: iOS's long press selects them with its own handles and menu (this reads that
// selection and closes it), and the keyboard-up mark (`mark.ts`) is a range over the same rows. One rule
// says what "selected" is, and one join turns a range into Copy's text across soft wraps.
import { logicalLines } from "../../../touch/selection";

/** A row of the selectable text: its element, and whether it continues the row above (a soft wrap). */
export interface TextRow {
  element: HTMLElement;
  wrapped: boolean;
}

interface PageSelectionDeps {
  /** The containers of the selectable rows: xterm's, and the history view's. */
  roots(): readonly (HTMLElement | null)[];
  /** Every selectable row, oldest first. */
  rows(): TextRow[];
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
    return this.deps.roots().some((root) => root?.contains(node));
  }

  /** The selected text with soft wraps joined, one line per logical line; empty with no selection. */
  text(): string {
    const range = this.range();
    return range ? this.textOf(range) : "";
  }

  /** `range`'s text with soft wraps joined, one line per logical line: Copy's text for the selection and the mark alike. */
  textOf(range: Range): string {
    const pieces = this.deps.rows()
      .filter(({ element }) => range.intersectsNode(element))
      .map(({ element, wrapped }) => ({ text: clipped(range, element).toString().replaceAll("\u00a0", " "), wrapped }));
    // A range that ends at a row's start still touches that row, and one that starts at a row's end touches it: neither selects it.
    while (pieces.at(-1)?.text === "") pieces.pop();
    while (pieces[0]?.text === "") pieces.shift();
    return logicalLines(pieces).lines.map((line) => line.trimEnd()).join("\n");
  }

  /**
   * The client rects of `range`'s text, row by row. `range.getClientRects()` itself would add the box of every
   * element the range fully contains, and across the history/live seam those include xterm's viewport and its
   * off-screen measure span: a rect over the whole terminal. Each row's rects come from its clipped part.
   */
  rectsOf(range: Range): DOMRect[] {
    return this.deps.rows()
      .filter(({ element }) => range.intersectsNode(element))
      .flatMap(({ element }) => {
        const part = clipped(range, element);
        return part.collapsed ? [] : [...part.getClientRects()];
      });
  }

  /**
   * Calls `onRedraw` once, when output redraws or drops a row the range touches: the text the range marked is
   * gone. Rows it doesn't touch may redraw, and rows may be added. `range()` is read when output arrives, so a
   * drag that moves the range's ends costs nothing here; the rows it touches are found once per range.
   * Returns the cancel.
   */
  watch(range: () => Range, onRedraw: () => void): () => void {
    let seen: { range: Range; rows: HTMLElement[] } | null = null;
    const touched = (): HTMLElement[] => {
      const current = range();
      if (seen?.range !== current) seen = { range: current, rows: this.deps.rows().filter(({ element }) => current.intersectsNode(element)).map(({ element }) => element) };
      return seen.rows;
    };
    // Redrawn (a mutation inside it) or dropped (removed with its root's child): a row that isn't touched may do either.
    const gone = (record: MutationRecord, rows: HTMLElement[]): boolean =>
      rows.some((row) => row.contains(record.target) || [...record.removedNodes].some((node) => node.contains(row)));
    const observer = new MutationObserver((records) => {
      const rows = touched();
      if (!records.some((record) => gone(record, rows))) return;
      observer.disconnect();
      onRedraw();
    });
    for (const root of this.deps.roots()) if (root) observer.observe(root, { childList: true, characterData: true, subtree: true });
    return () => { observer.disconnect(); };
  }

  clear(): void {
    if (this.range()) getSelection()?.removeAllRanges();
  }

  /** The selection cut to the rows: a range that runs on past them (a handle dragged out of the terminal) keeps what lies inside. */
  private range(): Range | null {
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    const touched = this.deps.rows().filter(({ element }) => range.intersectsNode(element));
    const first = touched[0]?.element;
    const last = touched.at(-1)?.element;
    if (!first || !last) return null;
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
