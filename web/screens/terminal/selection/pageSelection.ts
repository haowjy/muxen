// The browser's selection of the terminal's text (phone Safari, `directInput: "owned"`): the rows are page text, and
// the long press selects them with WebKit's own handles and menu. This reads that selection and closes it.
import { near, type RowRanges } from "./rowRanges";
import type { Selection, TouchStart } from "./selection";

/**
 * A touch within this of the selected text is the system's: its handles reach past the glyphs. The mark's own
 * reach is smaller (`TAP_REACH`): its handles are drawn and hit-tested apart, and a tap near the mark but
 * off it should clear it.
 */
const REACH = 22;

export class PageSelection implements Selection {
  constructor(private readonly rows: RowRanges) {}

  /** The selection's range cut to the rows, or null with none. The line box's caret and the terminal input's fire the same event and don't count. */
  range(): Range | null {
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    return this.rows.cut(selection.getRangeAt(0));
  }

  text(): string {
    const range = this.range();
    return range ? this.rows.textOf(range) : "";
  }

  touch(x: number, y: number): TouchStart {
    const range = this.range();
    if (!range) return "plain";
    return near(this.rows.rectsOf(range), x, y, REACH) ? "handOver" : "dismiss";
  }

  replace(range: Range): void {
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  clear(): void {
    if (this.range()) getSelection()?.removeAllRanges();
  }
}
