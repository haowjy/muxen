// The terminal's view of rows (touch-rows design.md, "The view: rowList"): one native scroller holding the lines
// that left the screen and the live screen as its newest rows. xterm owns the screen, this owns every line that
// has left it; the model's frames are pulled on animation frames. A row is created once for its line and
// redrawn only when that line's text changes, so a selection on rows that stay put survives scrolling and output.
// It assumes nothing about touch: no touch-action, no recognizer, no touch events (the touch layer, `touchControl.ts`,
// adds those, and tells the list when a gesture holds the view through `hold`).
import type { CellPosition, CellSize, Frame, Row, TerminalModel, TerminalTheme } from "../../term";
import { sameStyle } from "../../term/rows";
import { fontCell, terminalBottomPan } from "../../term/size";
import { drawRow, fitText } from "./rows/rowsDom";
import rowStyles from "./rows/Rows.module.css";
import styles from "./RowList.module.css";

/** Rows per block: each block has `content-visibility: auto` and an intrinsic height, so only what is near the view is laid out. */
const BLOCK_ROWS = 64;
/** The list keeps this many rows, trimming whole blocks from the top once the view is at rest. */
const CAP_ROWS = 10_000;
/** Past this the oldest blocks go even mid-gesture. */
const CEILING_ROWS = 20_000;
/** A scroll event this long after the last one with no finger down is no longer a coast. */
const COAST_QUIET_MS = 100;
const GAP_TEXT = "output skipped";

/** The theme as CSS variables: the global tokens follow the colour scheme, so a theme change writes nothing here. */
const ANSI = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;
const VARIABLE_THEME: TerminalTheme = { foreground: "var(--term-fg)", background: "var(--term-bg)" };
for (const name of ANSI) {
  VARIABLE_THEME[name] = `var(--term-${name})`;
  VARIABLE_THEME[`bright${name[0]?.toUpperCase() ?? ""}${name.slice(1)}` as keyof TerminalTheme] = `var(--term-bright-${name})`;
}

/** A row of selectable text: its element, its place in the list's order, and whether it continues the row above. */
export interface TextRow {
  element: HTMLElement;
  seq: number;
  wrapped: boolean;
}

interface Block {
  element: HTMLElement;
  rows: HTMLElement[];
}

interface ScreenRow {
  element: HTMLElement;
  drawn: Row;
}

export interface RowListOptions {
  /** Ranges the list must not drop rows under (the selection, the mark). */
  held(): Range[];
}

const sameRow = (a: Row, b: Row): boolean =>
  a.wrapped === b.wrapped && a.runs.length === b.runs.length && a.runs.every((run, i) => {
    const other = b.runs[i];
    return other !== undefined && run.text === other.text && !run.wide === !other.wide && sameStyle(run.style, other.style);
  });

export class RowList {
  /** The scroller. */
  readonly element: HTMLDivElement = document.createElement("div");
  private readonly run: HTMLDivElement = document.createElement("div");
  private readonly spacer: HTMLDivElement = document.createElement("div");
  private readonly cursorBox: HTMLDivElement = document.createElement("div");
  private blocks: Block[] = [];
  /** Blocks that gained rows this frame: their intrinsic height follows at its end. */
  private grown = new Set<Block>();
  private count = 0;
  private screen: ScreenRow[] = [];
  private seq = 0;
  /** The gap row, while the last frames were gap frames: the next gap frame reuses it. */
  private gapRow: HTMLElement | null = null;
  private lastFrame: Frame | null = null;
  private cell: CellSize | null = null;
  private font: { family: string; size: number } | null = null;
  private fitted = false;
  /** The scroller's height, read when its size changes: a per-frame read would force a layout. */
  private height = 0;
  /** What remains visible above the keyboard; null is all of it. */
  private visible: number | null = null;
  private pinned = false;

  /** Following: muxen writes `scrollTop` to keep the view at latest while it is there. */
  private following = true;
  /** The `scrollTop` muxen last wrote: the scroll event that lands on it is its own. */
  private written = Number.NaN;
  /** The touch layer's word that a gesture holds the view. */
  private held = false;
  private flinging = false;
  private coastTimer: ReturnType<typeof setTimeout> | undefined;
  private pullFrame = 0;
  /** Changes above the view that waited for a bounce to settle, in order. */
  private deferred: (() => void)[] = [];

  private readonly rewritten: ((seqs: number[]) => void)[] = [];
  private readonly dropped: ((first: number, last: number) => void)[] = [];
  private readonly shifted: (() => void)[] = [];
  private readonly scrolledListeners: ((scrolledUp: boolean) => void)[] = [];
  private readonly userScrolls: (() => void)[] = [];
  private scrolledUp = false;

  constructor(private readonly model: TerminalModel, private readonly options: RowListOptions) {
    const { element, run, spacer, cursorBox } = this;
    element.className = styles.scroller ?? "";
    element.dataset["rows"] = "";
    run.className = styles.run ?? "";
    spacer.className = styles.spacer ?? "";
    cursorBox.className = styles.cursor ?? "";
    cursorBox.hidden = true;
    element.append(run, spacer, cursorBox);
    // The list starts from the model's screen: whatever froze before it existed is not its to show.
    model.onChange(() => { this.schedule(); });
    element.addEventListener("scroll", this.scrolled, { passive: true });
    new ResizeObserver(() => { this.layout(); }).observe(element);
    this.apply(model.frame());
  }

  // ---- what the callers read

  /** One cell's size in CSS pixels, from the font alone: current at once and while hidden. Null before the font is set. */
  cellSize(): CellSize | null {
    return this.cell;
  }

  /** The cursor on the screen, from the last frame. */
  cursor(): CellPosition {
    const cursor = this.lastFrame?.cursor;
    return { col: cursor?.col ?? 0, row: cursor?.row ?? 0 };
  }

  /** The screen cell under a client point; null above the screen (older rows) and outside the list. */
  cellAt(x: number, y: number): CellPosition | null {
    const cell = this.cell;
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-seq]");
    const cols = this.model.cols();
    const index = row ? this.screen.findIndex((s) => s.element === row) : -1;
    if (!cell || index < 0 || cols === 0) return null;
    const left = this.element.getBoundingClientRect().left;
    return { col: Math.max(0, Math.min(cols - 1, Math.floor((x - left) / cell.width))), row: index };
  }

  get atLatest(): boolean {
    return Math.abs(this.element.scrollTop - this.latestPosition().top) < 2;
  }

  /** A fling is still moving the view with no finger down: a touch then stops it, and is not a tap. */
  get coasting(): boolean {
    return this.flinging;
  }

  // ---- what the callers tell it

  /** Calls `listener` when the view moves onto or off the newest line. */
  onScrolledUp(listener: (scrolledUp: boolean) => void): void {
    this.scrolledListeners.push(listener);
  }

  /** The user's scroll, not muxen's own writes. */
  onUserScroll(listener: () => void): void {
    this.userScrolls.push(listener);
  }

  /** Rows that were rewritten in a frame (J7), by their `seq`. */
  onRewritten(listener: (seqs: number[]) => void): void {
    this.rewritten.push(listener);
  }

  /** Rows `first` to `last` (by `seq`) are about to leave the list: called before they go, while a range over them still reads true. */
  onDropped(listener: (first: number, last: number) => void): void {
    this.dropped.push(listener);
  }

  /** Content moved under the rows that stayed (a block dropped or prepended above): anything placed in content coordinates is stale. */
  onShifted(listener: () => void): void {
    this.shifted.push(listener);
  }

  /**
   * A gesture holds the view (a finger is down): it is not written to, and rows above it stay. The touch layer
   * says so, since it alone knows its fingers. When the hold ends the view is at rest after a quiet moment.
   */
  hold(held: boolean): void {
    if (held === this.held) return;
    this.held = held;
    if (!held) this.settle();
  }

  /** A density change or a new font: the cell, and so every row's height, follows. */
  setFont(family: string, size: number): void {
    this.font = { family, size };
    this.cell = fontCell(family, size, false);
    this.fitted = false;
    const height = this.cell?.height ?? 0;
    this.element.style.setProperty("--cell-height", `${String(height)}px`);
    for (const block of this.blocks) this.sizeBlock(block);
    this.layout();
  }

  /** What remains visible of the terminal, in CSS pixels, for the keyboard; null is all of it. The covered part scrolls into view instead. */
  setVisible(px: number | null): void {
    this.visible = px;
    this.layout();
  }

  /** Hidden while another view of the model is shown: it keeps pulling frames, but writes nothing that needs layout. */
  setHidden(hidden: boolean): void {
    this.element.hidden = hidden;
    if (!hidden) this.layout();
  }

  /** Takes a frame now: a snapshot has landed and the surface is about to show. */
  update(): void {
    cancelAnimationFrame(this.pullFrame);
    this.pullFrame = 0;
    this.apply(this.model.frame());
  }

  /** Leaves history for the newest line. */
  toLatest(): void {
    this.following = true;
    this.deferred = [];
    this.follow(true);
    this.setScrolledUp(false);
  }

  /** The rows a range touches, oldest first; the gap row is no text. Empty when it touches none. */
  rowsIn(range: Range): TextRow[] {
    const span = this.span(range);
    const rows: TextRow[] = [];
    for (let row: HTMLElement | null = span?.first ?? null; row; row = row === span?.last ? null : this.next(row)) {
      if (!row.hasAttribute("data-gap")) rows.push({ element: row, seq: Number(row.dataset["seq"]), wrapped: row.hasAttribute("data-wrap") });
    }
    return rows;
  }

  /** The first and last row a range touches, from its two ends only. */
  span(range: Range): { first: HTMLElement; last: HTMLElement } | null {
    const first = this.rowAt(range.startContainer, range.startOffset, "start");
    const last = this.rowAt(range.endContainer, range.endOffset, "end");
    return first && last ? { first, last } : null;
  }

  contains(node: Node): boolean {
    return this.run.contains(node);
  }

  // ---- frames

  private schedule(): void {
    if (this.pullFrame) return;
    this.pullFrame = requestAnimationFrame(() => {
      this.pullFrame = 0;
      this.apply(this.model.frame());
    });
  }

  private apply(frame: Frame): void {
    this.lastFrame = frame;
    const changed = new Set<number>();
    const screenRows = frame.screen.length;
    if (frame.reset || this.screen.length !== screenRows) this.clear();
    if (this.screen.length === 0) {
      this.screen = frame.screen.map((row) => this.append(row));
    } else {
      const old = this.screen;
      if (frame.gap) {
        // The old screen's final text was lost in the overflow: its rows freeze as last drawn. Heavy output
        // overflows frame after frame: what the last gap frame left behind (a few screens, shown for a frame)
        // goes, so the whole run is one "output skipped" row.
        if (this.gapRow?.isConnected) this.dropAfter(this.gapRow);
        else this.appendGap();
        for (const row of frame.frozen) this.append(row);
        this.screen = frame.screen.map((row) => this.append(row));
      } else {
        if (frame.frozen.length > 0) this.gapRow = null; // lines that were seen now follow the gap
        // The old screen's top rows are the lines that left: they take their final text, once drawn they never change.
        const left = Math.min(frame.frozen.length, old.length);
        for (let i = 0; i < left; i++) this.redraw(old[i], frame.frozen[i], changed);
        for (const row of frame.frozen.slice(left)) this.append(row);
        this.screen = [...old.slice(left), ...frame.screen.slice(screenRows - left).map((row) => this.append(row))];
      }
    }
    // What remains of the screen takes the frame's text where it differs.
    for (let i = 0; i < screenRows; i++) this.redraw(this.screen[i], frame.screen[i], changed);
    this.trim();
    this.finish(frame, changed);
  }

  /** A new row at the end of the run. */
  private append(row: Row): ScreenRow {
    let block = this.blocks.at(-1);
    if (!block || block.rows.length >= BLOCK_ROWS) {
      const element = document.createElement("div");
      element.className = styles.block ?? "";
      this.run.append(element);
      block = { element, rows: [] };
      this.blocks.push(block);
    }
    const element = document.createElement("div");
    element.className = rowStyles.row ?? "";
    element.dataset["seq"] = String(this.seq++);
    block.rows.push(element);
    block.element.append(element);
    this.grown.add(block);
    this.count++;
    const created = { element, drawn: row };
    this.draw(created, row);
    return created;
  }

  private appendGap(): void {
    const { element } = this.append({ runs: [{ text: GAP_TEXT, style: {} }], wrapped: false, cells: [] });
    element.dataset["gap"] = "";
    element.classList.add(styles.gap ?? "");
    this.gapRow = element;
  }

  /** Removes every row after `row`. */
  private dropAfter(row: HTMLElement): void {
    this.reportDropped(Number(row.dataset["seq"]) + 1, this.seq - 1);
    for (let block = this.blocks.at(-1); block; block = this.blocks.at(-1)) {
      while (block.rows.length > 0 && block.rows.at(-1) !== row) {
        const gone = block.rows.pop();
        gone?.remove();
        this.count--;
      }
      this.grown.add(block);
      if (block.rows.length > 0) break;
      this.blocks.pop();
      this.grown.delete(block);
      block.element.remove();
    }
  }

  /** The one place rows are announced before they leave: a selection over them closes (J7). */
  private reportDropped(first: number, last: number): void {
    for (const listener of this.dropped) listener(first, last);
  }

  private draw(screen: ScreenRow, row: Row): void {
    drawRow(screen.element, row, VARIABLE_THEME);
    screen.element.toggleAttribute("data-wrap", row.wrapped);
    screen.drawn = row;
  }

  private redraw(screen: ScreenRow | undefined, row: Row | undefined, changed: Set<number>): void {
    if (!screen || !row || sameRow(screen.drawn, row)) return;
    this.draw(screen, row);
    changed.add(Number(screen.element.dataset["seq"]));
  }

  private clear(): void {
    const first = this.blocks[0]?.rows[0];
    if (first) this.reportDropped(Number(first.dataset["seq"]), this.seq - 1);
    this.run.replaceChildren();
    this.blocks = [];
    this.gapRow = null;
    this.grown.clear();
    this.screen = [];
    this.count = 0;
    this.deferred = [];
    this.following = true;
  }

  /** The end of a frame: the pinned state, the cursor, following, and what was rewritten. */
  private finish(frame: Frame, changed: Set<number>): void {
    for (const block of this.grown) this.sizeBlock(block);
    this.grown.clear();
    const pinned = this.model.altScreen() || this.model.mouseMode() !== "none";
    if (pinned !== this.pinned) {
      this.pinned = pinned;
      this.element.toggleAttribute("data-pinned", pinned);
      if (pinned) this.following = true;
    }
    if (!this.element.hidden) {
      this.follow();
      this.placeCursor(frame);
    }
    this.setScrolledUp(!this.following);
    if (changed.size > 0) for (const listener of this.rewritten) listener([...changed]);
  }

  private sizeBlock(block: Block): void {
    block.element.style.containIntrinsicSize = `auto ${String(block.rows.length * (this.cell?.height ?? 0))}px`;
  }

  /** The cursor is an overlay in the scroller's content: moving or blinking it never touches a row. */
  private placeCursor(frame: Frame): void {
    const { cursor } = frame;
    const box = this.cursorBox;
    const row = this.screen[cursor.row]?.element;
    const cell = this.cell;
    box.hidden = !cursor.visible || !row || !cell;
    if (box.hidden || !row || !cell) return;
    const top = this.contentTop(row);
    box.dataset["shape"] = cursor.shape;
    box.style.width = `${String(cell.width * cursor.width)}px`;
    box.style.height = `${String(cell.height)}px`;
    box.style.transform = `translate(${String(cursor.col * cell.width)}px, ${String(top)}px)`;
  }

  /** What a new size, font, keyboard or showing changes: the advance, the view's place and the cursor's. */
  private layout(): void {
    if (!this.element.hidden) this.height = this.element.clientHeight;
    this.fit();
    this.follow();
    if (this.lastFrame && !this.element.hidden) this.placeCursor(this.lastFrame);
  }

  /** Sets the font's advance to the cell's, once the list is laid out. */
  private fit(): void {
    if (this.fitted || this.element.hidden || !this.cell || this.element.clientWidth === 0) return;
    fitText(this.element, this.cell.width);
    this.fitted = true;
  }

  // ---- scrolling

  /** A row's top in the scroller's content, from layout: rows are laid out in 1/64 px, so no position is multiplied out. */
  private contentTop(row: HTMLElement): number {
    const { element } = this;
    return row.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop;
  }

  /**
   * Where "at latest" is: the screen's bottom at the box's bottom, or at the top of what the keyboard leaves visible;
   * if that would hide the cursor, the cursor row at the bottom instead (`terminalBottomPan`). `spacer` is the room
   * that position needs: the keyboard's, so every row of a tall screen scrolls into view, or the slack under a
   * screen that fits.
   */
  private latestPosition(): { top: number; spacer: number } {
    const { screen, cell } = this;
    const first = screen[0]?.element;
    const last = screen.at(-1)?.element;
    if (!cell || !first || !last) return { top: 0, spacer: 0 };
    const top = this.contentTop(first);
    const size = this.contentTop(last) + last.getBoundingClientRect().height - top;
    const covered = this.visible === null ? 0 : Math.max(0, this.height - this.visible);
    const visible = this.height - covered;
    const pan = terminalBottomPan(this.lastFrame?.cursor.row ?? 0, screen.length, size / screen.length, visible);
    return { top: top + pan, spacer: size > visible ? covered : Math.max(0, this.height - size) };
  }

  /** Writes `scrollTop` to keep the view at latest, only while it is there and no gesture or fling is moving it. */
  private follow(force = false): void {
    if (this.element.hidden) return;
    // The room for "at latest" is kept whether or not the view is there.
    const { top, spacer } = this.latestPosition();
    this.spacer.style.height = `${String(spacer)}px`;
    if (!(force || this.following)) return;
    if (!this.pinned && !force && (this.held || this.flinging)) return;
    if (Math.abs(this.element.scrollTop - top) < 0.5) return;
    this.element.scrollTop = top;
    this.written = this.element.scrollTop;
  }

  private readonly scrolled = (): void => {
    const { scrollTop } = this.element;
    if (Math.abs(scrollTop - this.written) < 0.5) return;
    if (this.pinned) {
      // Something scrolled a pinned list (a selection's autoscroll): back to latest.
      this.follow(true);
      return;
    }
    this.following = this.atLatest;
    this.setScrolledUp(!this.following);
    if (!this.held) {
      this.flinging = true;
      this.settle();
    }
    for (const listener of this.userScrolls) listener();
    if (scrollTop >= 0) this.flushDeferred();
  };

  /** The view is at rest once it has been quiet this long with nothing holding it. */
  private settle(): void {
    clearTimeout(this.coastTimer);
    this.coastTimer = setTimeout(() => { this.flinging = false; this.rest(); }, COAST_QUIET_MS);
  }

  /** No gesture and no fling: what waited for rest may go. */
  private rest(): void {
    if (this.flinging || this.held) return;
    this.flushDeferred();
    this.trim();
    this.follow();
  }

  private setScrolledUp(scrolledUp: boolean): void {
    if (scrolledUp === this.scrolledUp) return;
    this.scrolledUp = scrolledUp;
    for (const listener of this.scrolledListeners) listener(scrolledUp);
  }

  // ---- changes above the view

  /**
   * Every change above the view goes through here: Safari does no scroll anchoring of its own (and
   * `overflow-anchor: none` keeps Chromium's out), so the top visible row's offset is read before and
   * restored after, following or not (a finger may hold the view at latest). While the view is overscrolled
   * the change waits for the bounce to settle; waiting changes run in order.
   */
  private editAbove(change: () => void): void {
    const { element } = this;
    if (element.scrollTop < 0) {
      this.deferred.push(change);
      return;
    }
    const top = element.getBoundingClientRect().top;
    const anchor = this.topRow();
    const before = anchor ? anchor.getBoundingClientRect().top - top : 0;
    change();
    if (anchor?.isConnected) {
      element.scrollTop += anchor.getBoundingClientRect().top - top - before;
      this.written = element.scrollTop;
    }
    for (const listener of this.shifted) listener();
  }

  private flushDeferred(): void {
    const changes = this.deferred;
    this.deferred = [];
    for (const change of changes) this.editAbove(change);
  }

  /** The first of `items` whose bottom edge is below `edge`, as an index: a binary search, so it reads a few rects and no more. */
  private firstBelow<T>(items: readonly T[], element: (item: T) => HTMLElement, edge: number): number {
    let low = 0;
    let high = items.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      const item = items[mid];
      if (item !== undefined && element(item).getBoundingClientRect().bottom > edge) high = mid;
      else low = mid + 1;
    }
    return low;
  }

  /** The first row at or below the scroller's top edge. */
  private topRow(): HTMLElement | null {
    const edge = this.element.getBoundingClientRect().top;
    const block = this.blocks[this.firstBelow(this.blocks, (b) => b.element, edge)];
    return block?.rows[this.firstBelow(block.rows, (row) => row, edge)] ?? null;
  }

  /**
   * Past the cap, whole blocks go from the top: at rest, never the block in view or one a selection
   * starts in. Past the ceiling they go mid-gesture too. Which blocks go is settled before any goes,
   * so no layout is read between removals.
   */
  private trim(): void {
    if (this.count - (this.blocks[0]?.rows.length ?? 0) < CAP_ROWS) return;
    const urgent = this.count > CEILING_ROWS;
    if (!urgent && (this.held || this.flinging || this.element.hidden)) return;
    const held = this.options.held();
    this.editAbove(() => {
      const inView = urgent ? this.blocks.length : this.firstBelow(this.blocks, (b) => b.element, this.element.getBoundingClientRect().top);
      let gone = 0;
      let rows = this.count;
      for (; gone < inView; gone++) {
        const block = this.blocks[gone];
        if (!block || rows - block.rows.length < CAP_ROWS) break;
        if (!urgent && held.some((range) => block.element.contains(range.startContainer))) break;
        rows -= block.rows.length;
      }
      const first = this.blocks[0]?.rows[0];
      const last = this.blocks[gone - 1]?.rows.at(-1);
      if (!first || !last) return;
      this.reportDropped(Number(first.dataset["seq"]), Number(last.dataset["seq"]));
      for (const block of this.blocks.splice(0, gone)) block.element.remove();
      this.count = rows;
    });
  }

  // ---- rows of a range

  /** The row holding a range's end; an end outside the list is the list's first or last row, or none when the range lies beyond. */
  private rowAt(node: Node, offset: number, end: "start" | "end"): HTMLElement | null {
    if (!this.run.contains(node)) {
      const rows = document.createRange();
      rows.selectNodeContents(this.run);
      const side = rows.comparePoint(node, offset);
      // A start before the list begins at its first row; an end past it ends at its last. Otherwise the range misses the list.
      if (end === "start" && side < 0) return this.blocks[0]?.rows[0] ?? null;
      if (end === "end" && side > 0) return this.blocks.at(-1)?.rows.at(-1) ?? null;
      return null;
    }
    const element = node instanceof Element ? node : node.parentElement;
    const row = element?.closest<HTMLElement>("[data-seq]");
    if (row) return row;
    // The end is a block or the run itself: the child it points at.
    const children = element?.children;
    const child = children?.[Math.max(0, Math.min(children.length - 1, end === "end" && offset > 0 ? offset - 1 : offset))];
    if (!child) return null;
    const asRow = child.matches("[data-seq]") ? child : end === "end" ? child.lastElementChild : child.firstElementChild;
    return asRow instanceof HTMLElement ? asRow : null;
  }

  private next(row: HTMLElement): HTMLElement | null {
    const sibling = row.nextElementSibling ?? row.parentElement?.nextElementSibling?.firstElementChild;
    return sibling instanceof HTMLElement && sibling.hasAttribute("data-seq") ? sibling : null;
  }
}
