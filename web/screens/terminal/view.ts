// How the shown tab is looked at by touch (client-architecture.md §7.6): the recognizer, the selection on the
// row list (which scrolls natively), and, for desktop's xterm view, the wheel past the buffer's top onto the history rows. All of it is state of one tab on a surface every tab shares, so it lives in one object
// that is told which tab is shown and drops everything when that changes or a snapshot repaints the
// pane. Nothing here outlives the view it began on: a held drag or a selection never reaches another tab's pane.
import type { Owner } from "../../app/focus";
import type { HapticKind, InputEvent, MenuRect } from "../../platform/types";
import type { HistoryRow } from "../../tabs/driver";
import type { PromptLine, TerminalModel, TerminalTheme, XtermView } from "../../term";
import { rowText } from "../../term/rows";
import { HistoryView } from "./history";
import { PinnedWheel } from "./pinnedWheel";
import type { RowList, RowListOptions } from "./rowList";
import { ScrollControl } from "./scroll";
import { Mark } from "./selection/mark";
import { PageSelection } from "./selection/pageSelection";
import { type Anchor, RowRanges } from "./selection/rowRanges";
import type { Selection } from "./selection/selection";
import { TouchControl } from "./touchControl";

interface ViewDeps {
  /** The surface: the host of the views and the history rows. */
  element: HTMLElement;
  renderer(): XtermView | null;
  /** The row list, once it exists; it is the view on every input but desktop's xterm. */
  list(): RowList | null;
  model(): TerminalModel | null;
  theme(): TerminalTheme;
  /** Scrollback rows `start..=end` of the tab shown, or null when none is live. */
  fetchHistory(start: number, end: number): Promise<HistoryRow[]> | null;
  /** Typed input for `tab`; dropped when it is no longer the one shown. */
  send(tab: string, events: InputEvent[]): void;
  haptic(kind: HapticKind): void;
  /** Desktop direct input is xterm's textarea: a touch there is a click, which focuses it. */
  directInput(): "xterm" | "owned" | "native";
  focusTerminal(): void;
  /** The shell's command line under the cursor (OSC 133), or null. */
  prompt(): PromptLine | null;
  /** Who holds the keyboard. */
  owner(): Owner;
  /** The platform's edit menu, where it has one (the app). */
  editMenu(): ((rect: MenuRect | null) => void) | undefined;
  /** The view is above the newest line. */
  onScrolled(scrolled: boolean): void;
}

export class TerminalView {
  private tab: string | null = null;
  private readonly history: HistoryView;
  readonly scroll: ScrollControl;
  private readonly rows: RowRanges;
  private readonly mark: Mark;
  /** The selection of the rows' text: the mark where the platform has an edit menu (the app), the browser's own otherwise. */
  private readonly selection: Selection;
  private readonly touch: TouchControl;
  /** The selection's rows as they were before the frame in progress redrew any (J7). */
  private anchored: Anchor | null = null;
  private readonly wheel: PinnedWheel;

  constructor(private readonly deps: ViewDeps) {
    const { element } = deps;
    this.history = new HistoryView({
      fetch: (start, end) => deps.fetchHistory(start, end),
      cols: () => deps.model()?.cols() ?? 80,
      scrollbackRows: () => deps.renderer()?.scrollback().rows ?? 0,
      theme: () => deps.theme(),
      onRows: () => { this.scroll.apply(); },
      bufferHead: (count) => deps.renderer()?.rows(0, count).rows.slice(0, count).map((row) => rowText(row).trimEnd()) ?? [],
    });
    element.append(this.history.element);
    this.scroll = new ScrollControl({
      renderer: () => deps.renderer(),
      model: () => deps.model(),
      history: this.history,
      onScrolled: (scrolled) => { deps.onScrolled(scrolled); },
      surfaceHeight: () => element.clientHeight,
    });
    this.rows = new RowRanges(() => deps.list());
    this.mark = new Mark({ layer: () => deps.list()?.element ?? null, rows: this.rows, editMenu: () => deps.editMenu(), tick: () => { deps.haptic("key"); } });
    this.selection = deps.editMenu() ? this.mark : new PageSelection(this.rows);
    this.wheel = new PinnedWheel({ model: () => deps.model(), cell: () => deps.list()?.cellSize() ?? null, send: (events) => { this.send(events); } });
    // The recognizer owns every touch on the surface (§7.6): none moves focus, and what a touch means is decided when it resolves.
    this.touch = new TouchControl({
      ...deps,
      list: () => deps.list(),
      wheel: this.wheel,
      selection: this.selection,
      mark: this.mark,
      send: (events) => { this.send(events); },
    });
    // A mouse wheel past the buffer's top goes on into the history, as a swipe does.
    element.addEventListener("wheel", this.wheelPastTop, { capture: true, passive: false });
  }

  /**
   * What the row list asks of the view: output that rewrites a selected row moves the selection with its text or
   * closes it, and output that drops one closes it (J7); a scroll hides the mark's menu; and it holds the rows a
   * selection is over.
   */
  readonly listOptions: RowListOptions = {
    fetch: (start, end) => this.deps.fetchHistory(start, end),
    held: () => {
      const range = this.selection.range();
      return range ? [range] : [];
    },
    rewriting: (seq) => {
      const range = this.selection.range();
      if (!this.anchored && this.rows.covers(range, seq)) this.anchored = this.rows.anchor(range);
    },
    rewritten: () => {
      const { anchored } = this;
      this.anchored = null;
      if (!anchored) return;
      const followed = this.rows.follow(anchored);
      if (!followed) this.dismissSelection();
      else {
        this.selection.replace(followed.range);
        if (followed.moved) this.mark.hideMenu();
      }
    },
    dropped: (first, last) => {
      if (this.rows.drops(this.selection.range(), first, last)) this.dismissSelection();
    },
    shifted: () => { this.mark.reposition(); },
    userScroll: () => {
      this.mark.hideMenu();
      this.touch.scrolled();
    },
    scrolledUp: (scrolled) => { this.deps.onScrolled(scrolled); },
  };

  /** The row list moved onto or off the newest line: the jump-to-latest control follows. */
  reportScrolled(scrolled: boolean): void {
    this.deps.onScrolled(scrolled);
  }

  /** Whether the view is on the newest line. */
  get atLatest(): boolean {
    return this.deps.directInput() === "xterm" ? this.scroll.atLatest : (this.deps.list()?.atLatest ?? true);
  }

  /** Leaves history for the newest line. */
  toLatest(): void {
    if (this.deps.directInput() === "xterm") this.scroll.toLatest();
    else this.deps.list()?.toLatest();
  }

  /** The tab on screen changed: everything the last one had going stops. */
  show(tab: string | null): void {
    if (tab === this.tab) return;
    this.tab = tab;
    this.reset();
  }

  /** A snapshot repainted the pane, or the tab changed: stop any gesture, and drop the selection and the fetched history. */
  reset(): void {
    // Selection first: a hold cancelled with its mark still up would lift and show the menu for a mark about to go.
    this.dismissSelection();
    this.touch.cancel();
    this.scroll.reset();
    this.wheel.stop();
  }

  /** The selection's text, soft wraps joined; empty with none. */
  selectionText(): string {
    return this.selection.text();
  }

  /** Closes the selection and returns its text: the edit menu's Copy. */
  takeSelection(): string {
    const text = this.selection.text();
    this.selection.clear();
    return text;
  }

  dismissSelection(): void {
    this.anchored = null;
    this.selection.clear();
  }

  private send(events: InputEvent[]): void {
    if (this.tab !== null) this.deps.send(this.tab, events);
  }

  private readonly wheelPastTop = (event: WheelEvent): void => {
    const cell = this.deps.renderer()?.cellSize();
    if (!cell || event.deltaY === 0) return;
    // A wheel up (negative) shows older content; some wheels report lines, not pixels.
    const dy = -event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? cell.height : 1);
    if (this.scroll.wheelPastTop(dy)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
}
