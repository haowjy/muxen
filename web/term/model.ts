import { Terminal, type IMarker } from "@xterm/xterm";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { readRows } from "./lines";
import type { MouseEncoding, MouseMode } from "./mouse";
import { WritePipeline, type Snapshot } from "./pipeline";
import type { PromptLine } from ".";
import { PromptTracker } from "./prompt";
import type { Row } from "./rows";

export type CursorShape = "block" | "underline" | "bar";

export interface Frame {
  /** ED3, a snapshot or a resize: drop every row before applying the rest. */
  reset: boolean;
  /** Lines were skipped before `frozen` (overflow). */
  gap: boolean;
  /** The final text of the lines that left the screen since the last frame, oldest first; with `gap`, at most two screens. */
  frozen: Row[];
  /** The whole screen, top to bottom. */
  screen: Row[];
  /** `col` is the logical column (`cols` while a wrap pends; input code counts from it); `cell` is the column the cursor is drawn on. */
  cursor: { row: number; col: number; cell: number; width: 1 | 2; shape: CursorShape; visible: boolean };
}

/** xterm's scrollback, which bounds how many lines one frame can carry. */
const SCROLLBACK = 5000;

/** A Terminal that parses with the Unicode 11 width table, as tmux lays its rows out. */
export function parsingTerminal(options: { cols?: number; rows?: number; scrollback: number }): Terminal {
  const term = new Terminal({ ...options, allowProposedApi: true, disableStdin: true });
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11";
  claimQueries(term);
  return term;
}

/**
 * Claim every terminal query xterm would answer, so the answer never reaches `onData`, where the
 * desktop input path forwards it to the pane as typing. tmux is the terminal the pane's program
 * talks to and answers for itself (DA, DSR, DECRQM, DECRQSS, colour queries, from the pane's
 * state); a second answer from each attached browser tab would be stray input. Queries have no
 * drawing effect. An OSC 4/10/11/12 with a colour value still applies, and only the `?` slot is
 * claimed.
 */
function claimQueries(term: Terminal): void {
  const { parser } = term;
  const csi = (id: { prefix?: string; intermediates?: string; final: string }): void => {
    parser.registerCsiHandler(id, () => true);
  };
  csi({ final: "c" }); // DA1
  csi({ prefix: ">", final: "c" }); // DA2
  csi({ prefix: "=", final: "c" }); // DA3
  csi({ final: "n" }); // DSR 5, CPR
  csi({ prefix: "?", final: "n" }); // DECDSR variants
  csi({ intermediates: "$", final: "p" }); // DECRQM, ANSI modes
  csi({ prefix: "?", intermediates: "$", final: "p" }); // DECRQM, private modes
  parser.registerEscHandler({ final: "Z" }, () => true); // DECID
  parser.registerDcsHandler({ intermediates: "$", final: "q" }, () => true); // DECRQSS
  for (const ident of [4, 10, 11, 12]) {
    parser.registerOscHandler(ident, (data) => data.split(";").includes("?"));
  }
}

/** The one xterm internal the model reaches: nothing public runs before a scroll moves a line out of the screen. */
interface XtermCore {
  _bufferService: { scroll: (...args: unknown[]) => unknown; buffer: { scrollTop: number; scrollBottom: number } };
}

/**
 * One per terminal surface, on every platform (one for all tabs until phase 6): the xterm Terminal
 * that parses a pane's output, and the frames the view draws from it. The rule: xterm owns the screen; the view owns every line
 * that has left it. Nothing outside term/ imports xterm.
 */
export class TerminalModel {
  /** The parser and the screen. Only term/'s xterm view reads it, to open it on the page. */
  readonly term: Terminal = parsingTerminal({ scrollback: SCROLLBACK });
  private readonly prompt: PromptTracker;
  private readonly pipeline: WritePipeline;
  private readonly listeners: (() => void)[] = [];

  // What `frame()` reports. `pending` holds lines that left the screen before the last collect.
  private pending: Row[] = [];
  private gap = false;
  private resetPending = false;
  /**
   * On the line just above the screen, moved by every collect. The lines between it and the
   * screen's top are the ones that left since: counted by the marker, not by `baseY`, which stops
   * moving once the buffer is full. Null after ED3 or a reset (everything in the buffer is new);
   * disposed when xterm trimmed its line (lines were skipped). Not on the screen's top line: xterm
   * disposes a marker whose line an erase (ED2) or a delete clears, and a marker above the screen is
   * untouched by every edit inside it. The price is a spurious gap when exactly `SCROLLBACK` lines
   * scroll between two collects.
   */
  private marker: IMarker | null = null;

  // xterm keeps these private; the parser sees the same sequences that set them.
  private encoding: MouseEncoding = "x10";
  private cursorVisible = true;
  private cursorShape: CursorShape = "block";

  constructor() {
    const { term } = this;
    const mode = (set: boolean) => (params: (number | number[])[]): boolean => {
      for (const param of params) {
        // Collect before the alternate screen goes up: the normal buffer cannot change while it is.
        if (set && (param === 47 || param === 1047 || param === 1049)) this.collect();
        else if (param === 1006) this.encoding = set ? "sgr" : "x10";
        else if (param === 1005 && this.encoding !== "sgr") this.encoding = set ? "utf8" : "x10";
        else if (param === 25) this.cursorVisible = set;
      }
      return false; // xterm still applies it
    };
    term.parser.registerCsiHandler({ prefix: "?", final: "h" }, mode(true));
    term.parser.registerCsiHandler({ prefix: "?", final: "l" }, mode(false));
    term.parser.registerCsiHandler({ intermediates: " ", final: "q" }, (params) => {
      const style = params[0];
      this.cursorShape = style === 3 || style === 4 ? "underline" : style === 5 || style === 6 ? "bar" : "block";
      return false;
    });
    // ED3 empties xterm's scrollback and the view's list. ED2, and ED0 from the top-left, are what tmux
    // pushes into its history (scroll-on-clear, on by default); xterm just erases, so the screen is frozen first.
    term.parser.registerCsiHandler({ final: "J" }, (params) => {
      const kind = params[0] ?? 0;
      const buffer = term.buffer.active;
      if (buffer.type !== "normal") return false; // the alternate screen has no history to clear or push to
      if (kind === 3) this.restart();
      else if (kind === 2 || (kind === 0 && buffer.cursorX === 0 && buffer.cursorY === 0)) this.freezeScreen();
      return false;
    });
    // RIS: xterm swaps in empty buffers, so the marker's buffer is gone. tmux pushes the screen into its history and keeps it.
    term.parser.registerEscHandler({ final: "c" }, () => {
      if (term.buffer.active.type === "normal") this.freezeScreen();
      this.marker?.dispose();
      this.marker = null;
      this.resetModes();
      return false;
    });
    // DECSTR: xterm resets the cursor and keeps the mouse modes, as tmux does.
    term.parser.registerCsiHandler({ intermediates: "!", final: "p" }, () => {
      this.resetCursor();
      return false;
    });
    // SU drops the region's top lines in xterm and pushes them into tmux's history: freeze them first.
    term.parser.registerCsiHandler({ final: "S" }, (params) => {
      if (!this.altScreen()) {
        const { scrollTop, scrollBottom } = this.bufferService().buffer;
        this.collect(); // the lines that left before this one come first
        this.freezeRows(scrollTop, Math.min(scrollTop + (params[0] as number || 1), scrollBottom + 1));
      }
      return false;
    });
    term.onWriteParsed(() => { this.changed(); });
    this.hookScroll();

    this.prompt = new PromptTracker(term);
    this.pipeline = new WritePipeline({
      write: (data, callback) => { term.write(data, callback); },
      reset: () => {
        this.resetModes();
        this.prompt.reset();
        term.reset();
        this.restart();
        this.anchor();
      },
      resize: (cols, rows) => {
        term.resize(cols, rows);
        this.restart();
        this.anchor();
      },
    });
    this.anchor();
  }

  /** Queue pane output behind every earlier write. */
  output(bytes: Uint8Array): void {
    this.pipeline.output(bytes);
  }

  /** Reset, resize and restore; resolves once every earlier write has parsed. */
  snapshot(snapshot: Snapshot): Promise<void> {
    return this.pipeline.snapshot(snapshot);
  }

  /** Output parsed, or a reset: the view takes a frame on its next animation frame. */
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  onPromptLine(listener: (line: PromptLine | null) => void): void {
    this.prompt.onLine(listener);
  }

  /** The screen's width in columns. */
  cols(): number {
    return this.term.cols;
  }

  mouseMode(): MouseMode {
    return this.term.modes.mouseTrackingMode;
  }

  mouseEncoding(): MouseEncoding {
    return this.encoding;
  }

  altScreen(): boolean {
    return this.term.buffer.active.type === "alternate";
  }

  /** The application owns scrolling (a full-screen or mouse-aware one): swipes are its wheel events, and the view stays at latest. */
  pinned(): boolean {
    return this.altScreen() || this.mouseMode() !== "none";
  }

  /** Everything that changed since the last call. */
  frame(): Frame {
    this.collect();
    const buffer = this.term.buffer.active;
    const line = buffer.getLine(buffer.baseY + buffer.cursorY);
    // After the last column is filled xterm parks the cursor at `cols` (the wrap pends), and a wide character's second
    // cell is a continuation with width 0: the drawn cursor sits on the cell that has the glyph, as xterm's own renderers do.
    let cell = Math.min(buffer.cursorX, this.term.cols - 1);
    if (cell > 0 && line?.getCell(cell)?.getWidth() === 0) cell--;
    const frame: Frame = {
      reset: this.resetPending,
      gap: this.gap,
      frozen: this.pending,
      screen: readRows(buffer, buffer.baseY, buffer.baseY + this.term.rows),
      cursor: { row: buffer.cursorY, col: buffer.cursorX, cell, width: line?.getCell(cell)?.getWidth() === 2 ? 2 : 1, shape: this.cursorShape, visible: this.cursorVisible },
    };
    this.pending = [];
    this.gap = false;
    this.resetPending = false;
    return frame;
  }

  /** A snapshot and RIS put every mode back to xterm's defaults. */
  private resetModes(): void {
    this.encoding = "x10";
    this.resetCursor();
  }

  private resetCursor(): void {
    this.cursorVisible = true;
    this.cursorShape = "block";
  }

  /** Read `buffer` on every use: reset and the alternate screen swap the object. */
  private bufferService(): XtermCore["_bufferService"] {
    return (this.term as unknown as { _core: XtermCore })._core._bufferService;
  }

  /**
   * LF, IND, NEL and a wrapping print at the bottom of a region with a top margin scroll through
   * `bufferService.scroll`, which has no public hook; tmux pushes the region's top line into its
   * history where xterm drops it. With no top margin xterm sends the line to scrollback itself.
   */
  private hookScroll(): void {
    const service = this.bufferService();
    const original = service.scroll;
    service.scroll = (...args) => {
      const { scrollTop } = service.buffer;
      if (scrollTop > 0 && !this.altScreen()) {
        this.collect();
        this.freezeRows(scrollTop, scrollTop + 1);
      }
      return original.apply(service, args);
    };
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  /**
   * Moves the marker to the line just above the screen. The alternate screen keeps the old one:
   * xterm would put a new marker on the alternate buffer, which nothing scrolls.
   */
  private anchor(): void {
    const buffer = this.term.buffer.active;
    if (buffer.type !== "normal") return;
    this.marker?.dispose();
    this.marker = this.term.registerMarker(-buffer.cursorY - 1);
  }

  /** Moves the lines that left the screen since the last collect into `pending`. */
  private collect(): void {
    if (this.altScreen()) return; // the normal buffer cannot change under it
    const normal = this.term.buffer.normal;
    const marker = this.marker;
    let from = marker === null ? 0 : marker.line + 1;
    if (marker?.isDisposed) {
      this.gap = true;
      this.pending = [];
      from = Math.max(0, normal.baseY - 2 * this.term.rows);
    }
    this.push(readRows(normal, from, normal.baseY));
    this.anchor();
  }

  /** Pending rows are bounded like xterm's scrollback: past it the oldest are lost, as they would be scrolling, and the newest two screens stay. */
  private push(rows: Row[]): void {
    this.pending.push(...rows);
    if (this.pending.length <= SCROLLBACK) return;
    this.pending = this.pending.slice(-2 * this.term.rows);
    this.gap = true;
  }

  /** Rows `from` to `to` of the normal screen leave it for tmux's history. */
  private freezeRows(from: number, to: number): void {
    const { baseY } = this.term.buffer.normal;
    this.push(readRows(this.term.buffer.normal, baseY + from, baseY + to));
  }

  private freezeScreen(): void {
    this.collect();
    const buffer = this.term.buffer.normal;
    const screen = readRows(buffer, buffer.baseY, buffer.baseY + this.term.rows);
    // tmux leaves the blank rows at the bottom out of its history.
    while (screen.length > 0 && screen[screen.length - 1]?.runs.length === 0) screen.pop();
    this.push(screen);
  }

  /** ED3, a snapshot or a resize: the view starts over, and the buffer holds only what is new. */
  private restart(): void {
    this.marker?.dispose();
    this.marker = null;
    this.pending = [];
    this.gap = false;
    this.resetPending = true;
    this.changed();
  }
}
