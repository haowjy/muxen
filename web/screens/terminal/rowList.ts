// The terminal's view of rows (touch-rows design.md, "The view: rowList"): one native scroller holding the lines
// that left the screen and the live screen as its newest rows. xterm owns the screen, this owns every line that
// has left it; the model's frames are pulled on animation frames. A row is created once for its line and
// redrawn only when that line's text changes, so a selection on rows that stay put survives scrolling and output.
// It assumes nothing about touch: no touch-action, no recognizer, no touch events (the touch layer, `touchControl.ts`,
// adds those, and tells the list when a gesture holds the view through `hold`).
import type { CellPosition, CellSize, Frame, Row, TerminalModel, TerminalTheme } from "../../term";
import { sameStyle } from "../../term/rows";
import { fontCell, terminalBottomPan } from "../../term/size";
import { ANCHOR_ROWS } from "./anchor";
import { Coast } from "./coast";
import { CHUNK, HistoryFetcher, type Chunk, type FetcherDeps } from "./historyFetcher";
import { drawRow, fitText } from "./rows/rowsDom";
import rowStyles from "./rows/Rows.module.css";
import styles from "./RowList.module.css";

/** Rows per block: each block has `content-visibility: auto` and an intrinsic height, so only what is near the view is laid out. */
const BLOCK_ROWS = 64;
/** The list keeps this many rows, trimming whole blocks from the top once the view is at rest. */
const CAP_ROWS = 10_000;
/** Past this the oldest blocks go even mid-gesture. */
const CEILING_ROWS = 20_000;
/** Fetch older rows from tmux once the view is within this many screens of the oldest row: a fling reaches them before the top. */
const PREFETCH_SCREENS = 4;
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
  /** Rows `start..=end` of the tab on screen (tmux line numbers), or null with no live tab. */
  fetch: FetcherDeps["fetch"];
  /** Ranges the list must not drop rows under (the selection, the mark). */
  held(): Range[];
}

const sameRow = (a: Row, b: Row): boolean =>
  a.wrapped === b.wrapped && a.runs.length === b.runs.length && a.runs.every((run, i) => {
    const other = b.runs[i];
    return other !== undefined && run.text === other.text && !run.wide === !other.wide && sameStyle(run.style, other.style);
  });

/** A block of rows already made: one place for its class, so `append` and `prepend` build alike. */
function newBlock(rows: HTMLElement[]): Block {
  const element = document.createElement("div");
  element.className = styles.block ?? "";
  element.append(...rows);
  return { element, rows };
}

export class RowList {
  /** The scroller. */
  readonly element: HTMLDivElement = document.createElement("div");
  private readonly run: HTMLDivElement = document.createElement("div");
  private readonly spacer: HTMLDivElement = document.createElement("div");
  /** The row that draws the cursor now (`data-caret`): the cursor lives in its row, so no edit above it can leave it behind. */
  private caretRow: HTMLElement | null = null;
  private blocks: Block[] = [];
  /** Blocks that gained rows this frame: their intrinsic height follows at its end. */
  private grown = new Set<Block>();
  private count = 0;
  private screen: ScreenRow[] = [];
  private seq = 0;
  /** The gap row, while the last frame was a gap frame: the next gap frame reuses it. */
  private gapRow: HTMLElement | null = null;
  private readonly history: HistoryFetcher;
  /**
   * Nothing more is fetched until a reset: tmux has no older rows, a fetch missed twice, or a gap row came
   * (after one nobody knows how far tmux's numbering is, and a gap row only leaves with a reset or the cap).
   */
  private historyDone = false;
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
  private readonly coast = new Coast(() => { this.rest(); });
  private pullFrame = 0;
  /**
   * A fetched chunk waiting for a bounce to settle. Its presence is what stops `wantOlder` asking again (the same
   * rows would come back). Only a chunk waits: a trim is recomputed every frame, so it never queues.
   */
  private pending: (() => boolean) | null = null;

  private readonly rewritten: ((seqs: number[]) => void)[] = [];
  private readonly dropped: ((first: number, last: number) => void)[] = [];
  private readonly shifted: (() => void)[] = [];
  private readonly scrolledListeners: ((scrolledUp: boolean) => void)[] = [];
  private readonly userScrolls: (() => void)[] = [];
  private scrolledUp = false;

  constructor(private readonly model: TerminalModel, private readonly options: RowListOptions) {
    const { element, run, spacer } = this;
    element.className = styles.scroller ?? "";
    element.dataset["rows"] = "";
    run.className = styles.run ?? "";
    spacer.className = styles.spacer ?? "";
    element.append(run, spacer);
    this.history = new HistoryFetcher({ fetch: options.fetch, cols: () => model.cols() });
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
    return this.coast.coasting;
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
    this.coast.hold(held);
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
    this.follow(true);
    this.flushPending(); // the bounce is over: land the chunk, so its rows (and `historyDone`) are not lost
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
        this.gapRow = null; // a frame that is no gap ends the run: the screens the user saw stay
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
      block = newBlock([]);
      this.run.append(block.element);
      this.blocks.push(block);
    }
    const created = this.makeRow(row, this.seq++);
    block.rows.push(created.element);
    block.element.append(created.element);
    this.grown.add(block);
    this.count++;
    return created;
  }

  private makeRow(row: Row, seq: number): ScreenRow {
    const element = document.createElement("div");
    element.className = rowStyles.row ?? "";
    element.dataset["seq"] = String(seq);
    const made = { element, drawn: row };
    this.draw(made, row);
    return made;
  }

  private appendGap(): void {
    const { element } = this.append({ runs: [{ text: GAP_TEXT, style: {} }], wrapped: false });
    element.dataset["gap"] = "";
    element.classList.add(styles.gap ?? "");
    this.gapRow = element;
    this.historyDone = true;
  }

  /** Removes every row after `row`. */
  private dropAfter(row: HTMLElement): void {
    this.remove(Number(row.dataset["seq"]) + 1, this.seq - 1);
  }

  /**
   * The one place rows leave the list: a selection over them closes (J7) before they go. Removes the rows whose
   * `seq` lies in `first..last` and reports the seqs of the rows it actually removes, so callers may pass wide
   * bounds (`clear` passes infinite ones); a block it empties goes with them.
   */
  private remove(first: number, last: number): void {
    const seq = (row: HTMLElement | undefined): number => Number(row?.dataset["seq"]);
    const doomed = this.blocks.flatMap((block) => block.rows.filter((row) => seq(row) >= first && seq(row) <= last));
    if (doomed.length === 0) return;
    for (const listener of this.dropped) listener(seq(doomed[0]), seq(doomed.at(-1)));
    this.blocks = this.blocks.filter((block) => {
      if (seq(block.rows.at(-1)) < first || seq(block.rows[0]) > last) return true;
      const kept = block.rows.filter((row) => seq(row) < first || seq(row) > last);
      this.count -= block.rows.length - kept.length;
      for (const row of block.rows) if (!kept.includes(row)) row.remove();
      block.rows = kept;
      if (kept.length === 0) {
        block.element.remove();
        this.grown.delete(block);
        return false;
      }
      this.grown.add(block);
      return true;
    });
  }

  private draw(screen: ScreenRow, row: Row): void {
    drawRow(screen.element, row, VARIABLE_THEME);
    screen.element.toggleAttribute("data-wrap", row.wrapped || screen.element.hasAttribute("data-seam"));
    screen.drawn = row;
  }

  private redraw(screen: ScreenRow | undefined, row: Row | undefined, changed: Set<number>): void {
    if (!screen || !row || sameRow(screen.drawn, row)) return;
    this.draw(screen, row);
    changed.add(Number(screen.element.dataset["seq"]));
  }

  private clear(): void {
    this.remove(-Infinity, Infinity);
    this.run.replaceChildren();
    this.blocks = [];
    this.gapRow = null;
    this.grown.clear();
    this.screen = [];
    this.count = 0;
    this.historyDone = false;
    this.history.reset();
    this.pending = null;
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

  /**
   * The cursor is drawn by its row (`data-caret`, a pseudo-element in `Rows.module.css`): it moves with the row through
   * every insert, trim and scroll anchor, and a redraw of the row's text leaves the attributes alone. Moving or blinking
   * it touches no text.
   */
  private placeCursor(frame: Frame): void {
    const { cursor } = frame;
    const cell = this.cell;
    const row = cursor.visible && cell ? (this.screen[cursor.row]?.element ?? null) : null;
    if (this.caretRow && this.caretRow !== row) {
      this.caretRow.removeAttribute("data-caret");
      this.caretRow.style.removeProperty("--caret-x");
      this.caretRow.style.removeProperty("--caret-w");
    }
    this.caretRow = row;
    if (!row || !cell) return;
    row.dataset["caret"] = cursor.shape;
    row.style.setProperty("--caret-x", `${String(cursor.cell * cell.width)}px`);
    row.style.setProperty("--caret-w", `${String(cell.width * cursor.width)}px`);
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
    if (!this.pinned && !force && this.coast.moving) return;
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
    this.coast.scrolled();
    for (const listener of this.userScrolls) listener();
    if (scrollTop >= 0) this.flushPending();
    this.wantOlder();
  };

  /** No gesture and no fling: what waited for rest may go. */
  private rest(): void {
    if (this.element.scrollTop >= 0) this.flushPending();
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
   * restored after, following or not (a finger may hold the view at latest). A change returns false when it
   * moved nothing. If it removes the row the view was anchored to, the view goes to the oldest row, the
   * nearest to where it was.
   */
  private editAbove(change: () => boolean): void {
    const { element } = this;
    const top = element.getBoundingClientRect().top;
    const anchor = this.topRow();
    const before = anchor ? anchor.getBoundingClientRect().top - top : 0;
    if (!change()) return;
    if (anchor?.isConnected) element.scrollTop += anchor.getBoundingClientRect().top - top - before;
    else element.scrollTop = 0;
    this.written = element.scrollTop;
    for (const listener of this.shifted) listener();
  }

  private flushPending(): void {
    const change = this.pending;
    this.pending = null;
    if (change) this.editAbove(change);
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
    // Not mid-bounce unless the ceiling forces it: a flash beats rows without bound. Otherwise the next frame retries.
    if (!urgent && (this.coast.moving || this.element.hidden || this.element.scrollTop < 0)) return;
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
      if (!first || !last) return false;
      this.remove(Number(first.dataset["seq"]), Number(last.dataset["seq"]));
      return true;
    });
  }

  // ---- older rows from tmux

  /**
   * Fetches the next chunk of tmux's history once the view is near the oldest row. The list asks on its own
   * scroll events; the touch layer asks when a swipe begins, since a list shorter than its box never scrolls.
   * Only while the list is contiguous with tmux's numbering: no gap row anywhere in it (after a gap nobody
   * knows how far the numbers are), no miss, and below the cap, which would trim the chunk the moment it landed.
   */
  wantOlder(): void {
    if (this.historyDone || this.pending || this.pinned || this.element.hidden || this.count >= CAP_ROWS || !this.history.idle) return;
    if (this.element.scrollTop >= PREFETCH_SCREENS * this.height) return;
    void this.fetchOlder();
  }

  private async fetchOlder(): Promise<void> {
    // A miss retries once with a fresh count; a second one stops fetching. Rows are never dropped for a miss.
    for (let attempt = 0; attempt < 2; attempt++) {
      const oldest = this.blocks[0]?.rows[0];
      if (!oldest || this.historyDone) return; // a gap may have come while the first request was out: the count is no longer tmux's
      const anchor: string[] = [];
      for (const block of this.blocks) {
        for (const row of block.rows) if (anchor.length < ANCHOR_ROWS) anchor.push(row.textContent.trimEnd());
        if (anchor.length >= ANCHOR_ROWS) break;
      }
      // The screen is tmux's lines 0 and up, so the oldest row sits as many lines above 0 as there are rows before the screen.
      const chunk = await this.history.load(anchor, this.screen.length - this.count);
      if (!chunk) return;
      // Anything that changed the top of the list while the request was out (cap, ceiling, reset) makes the chunk stale.
      if (this.blocks[0]?.rows[0] !== oldest) break;
      if (chunk.found !== null) {
        this.prepend(oldest, chunk, chunk.found);
        break;
      }
      if (attempt === 1) this.historyDone = true;
    }
    this.wantOlder();
  }

  /** The chunk's rows above its copy of the anchor go above `oldest`. */
  private prepend(oldest: HTMLElement, chunk: Chunk, found: number): void {
    const rows = chunk.rows.slice(0, found);
    const seam = chunk.rows[found];
    if (chunk.fetched.length < CHUNK || rows.length === 0) this.historyDone = true;
    if (rows.length === 0) return;
    const land = (): boolean => {
      if (this.blocks[0]?.rows[0] !== oldest) return false;
      if (seam?.wrapped) { // a soft wrap across the seam; `draw` keeps it if a frame redraws this row
        oldest.dataset["seam"] = "";
        oldest.dataset["wrap"] = "";
      }
      const first = Number(oldest.dataset["seq"]) - rows.length;
      const made = rows.map((row, i) => this.makeRow(row, first + i).element);
      const blocks: Block[] = [];
      // Whole blocks from the newest end, so only the oldest is short.
      for (let end = made.length; end > 0; end -= BLOCK_ROWS) blocks.unshift(newBlock(made.slice(Math.max(0, end - BLOCK_ROWS), end)));
      this.run.prepend(...blocks.map((block) => block.element));
      this.blocks.unshift(...blocks);
      this.count += rows.length;
      for (const block of blocks) this.sizeBlock(block);
      return true;
    };
    if (this.element.scrollTop < 0) this.pending = land; // lands when the bounce settles
    else this.editAbove(land);
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
