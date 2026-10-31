import type { ITheme } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import type { ViewOptions, XtermView } from ".";
import { bufferRows } from "./lines";
import type { TerminalModel } from "./model";
import { fontCell, terminalBottomPan, type CellSize } from "./size";
import { createDesktopInput } from "./xterm-input";

/** Context losses tolerated before settling on the DOM renderer. */
const MAX_WEBGL_RECREATIONS = 3;

/**
 * The interim xterm view (deleted in phase 6): opens the model's Terminal on the page. WebGL when the
 * context can be had, the DOM renderer otherwise; a lost context is recreated, a few times, since the
 * buffer lives in the Terminal and survives the renderer.
 */
export function createXtermView(model: TerminalModel, container: HTMLElement, options: ViewOptions): XtermView {
  const { term } = model;
  term.options.fontFamily = options.fontFamily;
  term.options.fontSize = options.fontSize;
  term.options.theme = withoutScrollbar(options.theme);
  // A tapped URL leaves the app through native, never `window.open` (ios-shell.md "Web content security").
  term.loadAddon(new WebLinksAddon((_event, url) => { options.openLink(url); }));
  term.open(container);
  // Stdin is off until the input is chosen: when muxen's owned input or native's takes over (an iPad that loses its
  // trackpad), xterm's helper textarea must never take focus (ios-shell.md "Keyboard"). `setInput` turns it on for desktop.
  const setDesktopInput = createDesktopInput(term);
  setDesktopInput(null);

  let recreations = 0;
  let webgl: WebglAddon | undefined;
  let webglWanted = true;
  const attachWebgl = (): void => {
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        addon.dispose(); // xterm falls back to the DOM renderer meanwhile
        if (webgl !== addon) return;
        webgl = undefined; // `webgl` names a live addon only: the cell rounding follows the renderer that draws
        if (webglWanted && recreations++ < MAX_WEBGL_RECREATIONS) attachWebgl();
      });
      term.loadAddon(addon);
      webgl = addon;
    } catch {
      webgl = undefined; // no WebGL here: stay on the DOM renderer
    }
  };
  attachWebgl();

  const cellSize = (): CellSize | null => {
    // The screen element is exactly cols × rows cells, so this needs no private API.
    const screen = term.element?.querySelector(".xterm-screen");
    if (!screen || term.cols === 0 || term.rows === 0) return null;
    const { width, height } = screen.getBoundingClientRect();
    return width > 0 && height > 0 ? { width: width / term.cols, height: height / term.rows } : null;
  };

  // A pane larger than the container keeps its rows and slides to put the last row at the container's bottom.
  // If that would hide the cursor above it, the cursor row meets the bottom instead.
  // In history the pan anchors to the top, so no row is skipped; the cursor lives at the bottom.
  // The slide follows a resize with the keyboard's motion; a cursor move jumps, as text does.
  let panned = 0;
  let scrolledUp = false;
  const pan = (animate: boolean): void => {
    const element = term.element;
    const cell = cellSize();
    if (!element || !cell) return;
    const next = scrolledUp ? 0 : terminalBottomPan(term.buffer.active.cursorY, term.rows, cell.height, container.clientHeight);
    if (next === panned) return;
    panned = next;
    // The pan's slide follows the keyboard's (ui/theme.ts writes its duration beside the inset).
    element.style.transition = animate ? "transform var(--keyboard-timing)" : "none";
    element.style.transform = next ? `translateY(${String(-next)}px)` : "";
  };
  const scrollListeners: ((scrolledUp: boolean) => void)[] = [];
  // New output while scrolled up moves the newest line away without scrolling the view,
  // so writes are checked as well as scrolls.
  const checkScroll = (): void => {
    const buffer = term.buffer.active;
    const up = buffer.viewportY < buffer.baseY;
    if (up === scrolledUp) return;
    scrolledUp = up;
    pan(false);
    for (const listener of scrollListeners) listener(up);
  };
  term.onScroll(checkScroll);
  term.onWriteParsed(checkScroll);

  const resized = new ResizeObserver(() => { pan(true); });
  resized.observe(container);
  term.onCursorMove(() => { pan(false); });
  term.onResize(() => { pan(false); });

  return {
    cellSize,
    // The WebGL renderer floors the cell's width; only the view knows whether it is live.
    fontCell: () => fontCell(term.options.fontFamily ?? "", term.options.fontSize ?? 0, webgl !== undefined),
    setTheme: (theme) => { term.options.theme = withoutScrollbar(theme); },
    onScrolledUp: (listener) => { scrollListeners.push(listener); },
    scrollToBottom: () => { term.scrollToBottom(); },
    setFont: (fontFamily, fontSize) => {
      term.options.fontFamily = fontFamily;
      term.options.fontSize = fontSize;
    },
    setWebgl: (on) => {
      webglWanted = on;
      if (on && !webgl) attachWebgl();
      else if (!on && webgl) {
        const addon = webgl;
        webgl = undefined;
        addon.dispose(); // xterm falls back to the DOM renderer
      }
    },
    refreshGlyphs: () => { webgl?.clearTextureAtlas(); },
    setInput: setDesktopInput,
    inputElement: () => term.textarea ?? null,
    selectionText: () => term.getSelection(),
    setHidden: (hidden) => {
      if (term.element) term.element.hidden = hidden;
    },
    scrollback: () => {
      const buffer = term.buffer.active;
      return { rows: buffer.baseY, up: buffer.baseY - buffer.viewportY };
    },
    scrollRows: (rows) => {
      const before = term.buffer.active.viewportY;
      term.scrollLines(rows);
      return term.buffer.active.viewportY - before;
    },
    shift: (px) => {
      if (term.element) term.element.style.translate = px === 0 ? "" : `0 ${String(px)}px`;
    },
    rows: (from, to) => bufferRows(term.buffer.active, from, to),
    viewportTop: () => term.buffer.active.viewportY,
  };
}

/** xterm 6 draws its own scrollbar slider; muxen scrolls by touch and shows none. A clear slider leaves
 *  xterm's scrolling alone. The colour is 8-digit hex because xterm's parser rejects any colour it can't
 *  read as opaque except `#rrggbbaa` and `rgba()`: `"transparent"` falls back to the default grey. */
const CLEAR = "#00000000";
function withoutScrollbar(theme: ITheme): ITheme {
  return { ...theme, scrollbarSliderBackground: CLEAR, scrollbarSliderHoverBackground: CLEAR, scrollbarSliderActiveBackground: CLEAR };
}
