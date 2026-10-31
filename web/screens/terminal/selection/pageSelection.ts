// The page's own selection over the terminal's text (phone, `directInput: "owned"`). On touch xterm's
// rows and the history view are page text, so iOS's long press selects them with its own handles and
// menu. tether draws nothing of it: this only reads the selection, joins its text across soft wraps
// for Copy, and closes it.
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

  /** Whether a non-empty range lies inside the rows. The line box's caret and the terminal input's fire the same event and don't count. */
  exists(): boolean {
    return this.range() !== null;
  }

  /** Whether the client point is on the selected text, or near enough that the system's handles are there. */
  contains(x: number, y: number): boolean {
    const rects = this.range()?.getClientRects() ?? [];
    return [...rects].some((r) => x >= r.left - REACH && x <= r.right + REACH && y >= r.top - REACH && y <= r.bottom + REACH);
  }

  /** The selected text with soft wraps joined, one line per logical line; empty with no selection. */
  text(): string {
    const range = this.range();
    if (!range) return "";
    const pieces = this.deps.rows()
      .filter(({ element }) => range.intersectsNode(element))
      .map(({ element, wrapped }) => ({ text: clipped(range, element).replaceAll(" ", " "), wrapped }));
    return logicalLines(pieces).lines.map((line) => line.trimEnd()).join("\n");
  }

  clear(): void {
    if (this.range()) getSelection()?.removeAllRanges();
  }

  private range(): Range | null {
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    const inside = (node: Node): boolean => this.deps.roots().some((root) => root?.contains(node));
    return inside(range.startContainer) && inside(range.endContainer) ? range : null;
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
