// Desktop's wheel past the xterm buffer's top (client-architecture.md §7.6): the buffer scrolls itself, and past
// its top the terminal slides down onto the history view. This is the xterm view's scroll, which phase 6 deletes
// with the view; on touch the row list scrolls natively.
import type { TerminalModel, XtermView } from "../../term";
import type { CellSize } from "../../term/size";
import type { HistoryView } from "./history";

interface ScrollDeps {
  renderer(): XtermView | null;
  model(): TerminalModel | null;
  history: HistoryView;
  /** The view moved onto or off the newest line. */
  onScrolled(scrolled: boolean): void;
  /** The height of the surface the terminal and the history share, in px. */
  surfaceHeight(): number;
}

export class ScrollControl {
  /** How far the terminal is slid down onto the history, in px. */
  private shift = 0;
  /** The part of a row not yet scrolled, in px; the buffer moves whole rows. */
  private remainder = 0;
  /** The cell and the screen's row count, measured at each wheel turn. */
  private cell: CellSize | null = null;
  private screenRows = 0;
  /** Whether the view was above the newest line when last reported. */
  private scrolled = false;

  constructor(private readonly deps: ScrollDeps) {}

  /**
   * A mouse wheel turned `dy` px toward older content. The buffer scrolls itself; this takes
   * the wheel only once it is past the buffer's top or already in the history, and says so.
   */
  wheelPastTop(dy: number): boolean {
    const renderer = this.deps.renderer();
    const model = this.deps.model();
    if (!renderer || !model || model.pinned()) return false;
    const { rows, up } = renderer.scrollback();
    if (this.shift === 0 && !(dy > 0 && up === rows)) return false;
    this.measure();
    if (this.cell) this.buffer(dy, this.cell);
    return true;
  }

  /** Leaves history for the newest line. */
  toLatest(): void {
    this.measure();
    this.shift = 0;
    this.remainder = 0;
    this.deps.renderer()?.scrollToBottom();
    this.apply();
  }

  /** A snapshot repainted the pane, or another tab came to the surface: nothing slid or fetched belongs to it. */
  reset(): void {
    this.shift = 0;
    this.remainder = 0;
    this.cell = null;
    this.deps.history.reset();
    this.scrolled = false;
    this.deps.renderer()?.shift(0);
    this.scrolledChanged();
  }

  /** The view is on the newest line. */
  get atLatest(): boolean {
    return this.shift === 0 && (this.deps.renderer()?.scrollback().up ?? 0) === 0;
  }

  /**
   * The view may have moved onto or off the newest line, by a finger, a wheel, a key or new
   * output: the jump-to-latest control follows. Back on the newest line the fetched rows are
   * dead weight, and scrolling up again fetches them afresh.
   */
  scrolledChanged(): void {
    const scrolled = !this.atLatest;
    if (this.scrolled && !scrolled) this.deps.history.reset();
    this.scrolled = scrolled;
    this.deps.onScrolled(scrolled);
  }

  private measure(): void {
    this.cell = this.deps.renderer()?.cellSize() ?? null;
    this.screenRows = this.cell ? Math.ceil(this.deps.surfaceHeight() / this.cell.height) : 0;
  }

  /** The distance from the newest line, in px: the buffer's rows, the part row, and the slide onto the history. */
  private position(renderer: XtermView, cell: CellSize): number {
    return renderer.scrollback().up * cell.height + this.remainder + this.shift;
  }

  /** Scrolls the buffer, then the history. False when `dy` could not move anything: an edge. */
  private buffer(dy: number, cell: CellSize): boolean {
    const renderer = this.deps.renderer();
    if (!renderer || dy === 0) return true;
    const before = this.position(renderer, cell);
    let pending = dy;
    if (pending < 0 && this.shift > 0) {
      // Newer: back out of the history first.
      const back = Math.min(this.shift, -pending);
      this.shift -= back;
      pending += back;
    }
    if (pending !== 0 && this.shift === 0) {
      this.remainder += pending;
      const rows = Math.trunc(this.remainder / cell.height);
      if (rows !== 0) {
        this.remainder -= rows * cell.height;
        const short = rows + renderer.scrollRows(-rows); // rows the buffer could not take
        if (short > 0) {
          // Past the buffer's top: the rest slides the terminal onto the history.
          this.shift = Math.min(short * cell.height + this.remainder, this.deps.history.px);
          this.remainder = 0;
        } else if (short < 0) {
          this.remainder = 0; // the newest line
        }
      }
    } else if (pending > 0) {
      this.shift = Math.min(this.shift + pending, this.deps.history.px);
    }
    this.apply();
    return this.position(renderer, cell) !== before;
  }

  /** The slide, the history rows' place and the fetch ahead of the view, after any of them changed. */
  apply(): void {
    const renderer = this.deps.renderer();
    const cell = this.cell;
    if (!renderer || !cell) return;
    // The history may have been dropped under the view (its rows no longer lined up).
    this.shift = Math.min(this.shift, this.deps.history.px);
    renderer.shift(this.shift);
    this.deps.history.place(this.shift, cell);
    // A first swipe up on a short buffer is still at latest and needs the fetch; coming back to latest does not.
    const returned = this.scrolled && this.atLatest;
    this.scrolledChanged();
    if (!returned) this.deps.history.want(this.shift, renderer.viewportTop() * cell.height, cell, this.screenRows);
  }
}
