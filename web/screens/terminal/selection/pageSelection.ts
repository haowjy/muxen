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

/** A touch within this of the selected text is the system's: its handles reach past the glyphs. */
const REACH = 22;

export class PageSelection {
  constructor(private readonly deps: PageSelectionDeps) {}

  /** Whether a non-empty range reaches the rows. The line box's caret and the terminal input's fire the same event and don't count. */
  exists(): boolean {
    return this.range() !== null;
  }

  /** Whether the client point is on the selected text, or near enough that the system's handles are there. */
  contains(x: number, y: number): boolean {
    const rects = this.range()?.getClientRects() ?? [];
    return [...rects].some((r) => x >= r.left - REACH && x <= r.right + REACH && y >= r.top - REACH && y <= r.bottom + REACH);
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
      .map(({ element, wrapped }) => ({ text: clipped(range, element).replaceAll("\u00a0", " "), wrapped }));
    // A range that ends at a row's start still touches that row, and one that starts at a row's end touches it: neither selects it.
    while (pieces.at(-1)?.text === "") pieces.pop();
    while (pieces[0]?.text === "") pieces.shift();
    return logicalLines(pieces).lines.map((line) => line.trimEnd()).join("\n");
  }

  /**
   * Calls `onRedraw` once, when output redraws the rows `range` touches or adds or drops rows: the text the
   * range marked is gone. Rows the range doesn't touch may redraw. Returns the cancel.
   */
  watch(range: Range, onRedraw: () => void): () => void {
    const touched = this.deps.rows().filter(({ element }) => range.intersectsNode(element)).map(({ element }) => element);
    const roots = this.deps.roots().filter((root) => root !== null);
    const observer = new MutationObserver((records) => {
      if (!records.some(({ target }) => roots.includes(target as HTMLElement) || touched.some((row) => row.contains(target)))) return;
      observer.disconnect();
      onRedraw();
    });
    for (const root of roots) observer.observe(root, { childList: true, characterData: true, subtree: true });
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

/** The part of `element`'s text that `range` covers. */
function clipped(range: Range, element: HTMLElement): string {
  const part = document.createRange();
  part.selectNodeContents(element);
  if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(range.startContainer, range.startOffset);
  if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset);
  return part.toString();
}
