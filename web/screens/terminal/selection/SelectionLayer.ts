import type { TerminalTheme } from "../../../term";
import { rowText, type Row } from "../../../term/rows";
import { logicalLines, pointOf, selectedText, type Logical } from "../../../touch/selection";
import { rowElement } from "../rows/rowsDom";
import styles from "./SelectionLayer.module.css";

/** A boundary of the DOM selection, as a row and a character offset in that row's text. */
interface RowPoint {
  row: number;
  offset: number;
}

/**
 * The snapshot as DOM: one element per row, text only the system's selection handles can
 * work on. It holds the rows it was made from and nothing live, so new output cannot reach
 * it, and dropping it frees them.
 */
/** Enough characters that one advance measures to well under a device pixel. */
const PROBE_CHARS = 100;

export class SelectionLayer {
  readonly element: HTMLDivElement = document.createElement("div");
  private readonly rows: HTMLDivElement[];
  private readonly logical: Logical;

  constructor(rows: readonly Row[], theme: TerminalTheme, cellHeight: number) {
    this.element.className = styles.layer ?? "";
    // Inert until the finger lifts (control.ts `release`), so WebKit's own long-press can't take the touch.
    this.element.dataset["held"] = "";
    this.element.style.setProperty("--cell-height", `${String(cellHeight)}px`);
    this.element.setAttribute("role", "document");
    this.element.setAttribute("aria-label", "Terminal text for selection");
    this.rows = rows.map((row, index) => {
      const element = rowElement(row, theme);
      element.dataset["row"] = String(index);
      return element;
    });
    this.element.append(...this.rows);
    this.logical = logicalLines(rows.map((row) => ({ text: rowText(row), wrapped: row.wrapped })));
  }

  /**
   * Matches the DOM text's advance to the canvas cell. The renderer rounds its cell to device
   * pixels (WebGL floors it), while DOM text advances by the font's own fractional width, so
   * without this the snapshot's text runs wider than the canvas it covers and drifts a little
   * more each column. Call once the layer is in the document, where its font applies.
   */
  fit(cellWidth: number): void {
    const probe = document.createElement("span");
    probe.textContent = "W".repeat(PROBE_CHARS);
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;letter-spacing:0";
    this.element.append(probe);
    const advance = probe.getBoundingClientRect().width / PROBE_CHARS;
    probe.remove();
    if (advance > 0) this.element.style.letterSpacing = `${String(cellWidth - advance)}px`;
  }

  /**
   * Scrolls so the row `top` (fractional) is at the layer's top edge. Rows lay out at a height
   * the browser rounds, not the cell height, so the position comes from the row `top` falls in,
   * measured, rather than from `top` times the cell height. What the scroll position cannot hold (the browser
   * may round it) is moved by a transform. The rows end where the screen's do, so below them it
   * pads out whatever the scroll needs to get there.
   */
  align(top: number): void {
    const { element } = this;
    const anchor = this.rows[Math.min(this.rows.length - 1, Math.max(0, Math.floor(top)))];
    const last = this.rows[this.rows.length - 1];
    if (!anchor || !last) return;
    element.style.transform = "";
    const origin = element.getBoundingClientRect().top - element.scrollTop;
    const anchorRect = anchor.getBoundingClientRect();
    const scroll = anchorRect.top - origin + (top - Math.floor(top)) * anchorRect.height;
    element.style.paddingBottom = `${String(Math.max(0, scroll + element.clientHeight - (last.getBoundingClientRect().bottom - origin)))}px`;
    element.scrollTop = scroll;
    element.style.transform = `translateY(${String(element.scrollTop - scroll)}px)`;
  }

  /** Selects from one point to another, in either order. */
  select(a: RowPoint, b: RowPoint): void {
    const [from, to] = a.row < b.row || (a.row === b.row && a.offset <= b.offset) ? [a, b] : [b, a];
    const startRow = this.rows[from.row];
    const endRow = this.rows[to.row];
    const start = startRow && locate(startRow, from.offset);
    const end = endRow && locate(endRow, to.offset);
    const selection = getSelection();
    if (!start || !end || !selection) return;
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  /** The selection's logical text, soft wraps joined; empty when nothing inside the snapshot is selected. */
  text(): string {
    const range = this.range();
    if (!range) return "";
    const start = this.pointOf(range.startContainer, range.startOffset);
    const end = this.pointOf(range.endContainer, range.endOffset);
    if (!start || !end) return "";
    return selectedText(this.logical.lines, pointOf(this.logical, start.row, start.offset), pointOf(this.logical, end.row, end.offset));
  }

  /** Where the selection is on screen, or null with none. */
  rect(): DOMRect | null {
    return this.range()?.getBoundingClientRect() ?? null;
  }

  /** Calls `listener` whenever the selection inside the snapshot changes or is lost. */
  onChange(listener: () => void): () => void {
    const handler = (): void => { listener(); };
    document.addEventListener("selectionchange", handler);
    this.element.addEventListener("scroll", handler, { passive: true });
    return () => {
      document.removeEventListener("selectionchange", handler);
      this.element.removeEventListener("scroll", handler);
    };
  }

  /** Whether the selection is a non-empty range inside the snapshot. */
  hasSelection(): boolean {
    return this.range() !== null;
  }

  private range(): Range | null {
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    return this.element.contains(range.commonAncestorContainer) ? range : null;
  }

  /** A DOM boundary as a row and a character offset; boundaries on the layer itself or a row element count children. */
  private pointOf(node: Node, offset: number): RowPoint | null {
    if (node === this.element) return offset >= this.rows.length ? { row: this.rows.length - 1, offset: this.rows[this.rows.length - 1]?.textContent.length ?? 0 } : { row: offset, offset: 0 };
    const element = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-row]");
    if (!element || !this.element.contains(element)) return null;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(node, offset);
    return { row: Number(element.dataset["row"]), offset: range.toString().length };
  }
}

/** The text node and offset where character `offset` of the element's text is. */
function locate(element: HTMLElement, offset: number): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let last: Text | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    last = text;
    if (remaining <= text.length) return { node: text, offset: remaining };
    remaining -= text.length;
  }
  return last ? { node: last, offset: last.length } : { node: element, offset: 0 };
}
