// The terminal boundary: nothing outside term/ imports xterm.js, so ghostty-web could
// replace it (plan.md "Layout"). `TerminalModel` parses a pane's output into frames; the view draws.
// Until phase 6 both platforms are drawn by the interim xterm view over the model's Terminal.
import type { Snapshot } from "./pipeline";
import type { CellSize } from "./size";
import type { Row } from "./rows";
import type { MouseEncoding, MouseMode } from "./mouse";
import type { InputSink } from "./xterm-input";
import { TerminalModel, type CursorShape, type Frame } from "./model";
import { createXtermView } from "./xterm";

export type { CellSize, CursorShape, Frame, InputSink, MouseEncoding, MouseMode, Row, Snapshot };
export { createXtermView, TerminalModel };

/** A cell in the visible screen, zero-based from its top-left. */
export interface CellPosition {
  col: number;
  row: number;
}

type Ansi = "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white";
type ThemeKey = "background" | "foreground" | "cursor" | "cursorAccent" | "selectionBackground" | Ansi | `bright${Capitalize<Ansi>}`;

/** Terminal colours as CSS colour strings the renderer can parse (`rgba(…)`, `#rrggbb`). */
export type TerminalTheme = Partial<Record<ThemeKey, string>>;

/**
 * The shell's command line as the terminal shows it, read from the OSC 133 marks
 * (complete.md "What the client does"). Null when there is no line to read: no input-start
 * mark since the last prompt or snapshot, a command running, the alternate screen, or a
 * cursor outside the input.
 */
export interface PromptLine {
  /** From the input start to the cursor, wrapped rows joined. */
  before: string;
  /** From the cursor to the end of the input's last row, trailing spaces dropped. */
  after: string;
}

export interface ViewOptions {
  fontFamily: string;
  fontSize: number;
  theme: TerminalTheme;
  /** A URL in the output was tapped. */
  openLink(url: string): void;
}

/** The interim xterm view over a {@link TerminalModel}: what xterm draws, scrolls and selects (desktop). */
export interface XtermView {
  /** One cell's size in CSS pixels, null until the first paint; changes with font size. */
  cellSize(): CellSize | null;
  /** {@link fontCell} for this view's font and renderer (the WebGL floor applies only while that renderer is live). */
  fontCell(): CellSize | null;
  /** Applies a theme; while a selection is on the rows it waits, since redrawing them would end the selection. */
  setTheme(theme: TerminalTheme): void;
  /** Hides or shows the xterm element: while the row list is the view of the model, this one is hidden and stops rendering. */
  setHidden(hidden: boolean): void;
  /** Calls `listener` whenever the view moves onto or off the newest line. */
  onScrolledUp(listener: (scrolledUp: boolean) => void): void;
  scrollToBottom(): void;
  /** A density change: the cell, and so tmux's size, follow it. */
  setFont(fontFamily: string, fontSize: number): void;
  /**
   * WebGL when `on` and the context can be had, else the DOM renderer. A pane larger than the tab
   * turns it off: the canvas would be the pane's size in device pixels, past WebKit's limit.
   */
  setWebgl(on: boolean): void;
  /** A fallback font arrived after first paint: drop the glyph atlas so its glyphs draw. */
  refreshGlyphs(): void;
  /** Points desktop direct input (xterm's own textarea, under the key-handler contract) at a sink, or turns stdin off with `null`. */
  setInput(sink: InputSink | null): void;
  /** xterm's input element, which the focus controller holds while desktop direct input is live; null before it exists. */
  inputElement(): HTMLElement | null;
  /** The selection's logical text: soft wraps joined, as xterm marks them. Empty with no selection. */
  selectionText(): string;
  /** Scrollback rows above the visible screen, and how many of them the view is scrolled up by. */
  scrollback(): { rows: number; up: number };
  /** Scrolls the buffer by whole rows, negative toward older ones, and returns the rows it moved: fewer than asked at either end. */
  scrollRows(rows: number): number;
  /**
   * Slides the whole terminal down by `px`, to make room above it for the history view. The
   * terminal stays where the pan puts it otherwise; `0` puts it back.
   */
  shift(px: number): void;
  /**
   * The buffer's rows from the row `from` (moved up to its line's start, and returned as
   * `from`) up to the row `to` exclusive (default: the end; run on to finish a wrapped line),
   * styled: the history seam's anchor.
   */
  rows(from: number, to?: number): { rows: Row[]; from: number };
  /** The buffer row at the top of the visible screen. */
  viewportTop(): number;
}
