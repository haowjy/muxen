// The touch shell (client-architecture.md §7.6): touches in, the sans-IO recognizer in the middle,
// the terminal's side effects out. What it means is decided when a touch resolves.
//
// With the phone's own input (`directInput: "owned"`) the rows are page text and the long press is
// WebKit's. Touch events are shared with it: `touchstart` is left alone so the long press can begin,
// `touchmove` is cancelled once the finger is scrolling, `touchend` is cancelled for a tap (so a tap is
// never a click or a blur), and `touchcancel` is what a long press that WebKit took over looks like.
// A touch on a live selection is WebKit's and never reaches the recognizer. After a touch, mouse events
// on the surface stop for a while: iOS's imitation mouse-move over a link would redraw rows and end a selection.
// With the keyboard up in the app the hold is tether's instead (`Mark`): WebKit's selection would take the
// keyboard down. The recognizer's hold marks the word, the finger extends it, a tap inside toggles the menu and a
// tap elsewhere clears it; the handles' touches are the mark's own and never get here.
//
// Native input (`directInput: "native"`) is the pointer path until step 4 of ios-simplify removes it:
// `pointerdown` is cancelled, so a touch never moves focus or reaches xterm as a mouse event, and a long
// press builds the selection snapshot.
import type { Owner } from "../../app/focus";
import type { HapticKind, InputEvent } from "../../platform/types";
import type { PromptLine, TerminalRenderer } from "../../term";
import { mouseInput } from "../../term/mouse";
import { DEFAULT_GESTURE, GestureRecognizer, type GestureAction } from "../../touch/gesture";
import { charsAcross } from "../../touch/selection";
import type { ScrollControl } from "./scroll";
import type { SelectionControl } from "./selection/control";
import type { Mark } from "./selection/mark";
import type { PageSelection } from "./selection/pageSelection";

interface TouchDeps {
  element: HTMLElement;
  renderer(): TerminalRenderer | null;
  scroll: ScrollControl;
  selection: SelectionControl;
  page: PageSelection;
  /** The app's keyboard-up mark. */
  mark: Mark;
  /** Typed input for the tab this view is showing. */
  send(events: InputEvent[]): void;
  haptic(kind: HapticKind): void;
  /** Desktop direct input is xterm's textarea: a touch there is a click, which focuses it. */
  directInput(): "xterm" | "owned" | "native";
  /** Focuses the terminal's input: a desktop tap, or a touch tap on or beside the cursor row. */
  focusTerminal(): void;
  /** The shell's command line under the cursor (OSC 133), or null. */
  prompt(): PromptLine | null;
  /** Who holds the keyboard. */
  owner(): Owner;
}

/** What a short press on the terminal does: exactly one of these. */
export type TapAction = "focus" | "focusAndClick" | "click" | "moveCursor" | "none";

/**
 * A tap, resolved (terminal-interaction-design.md, "One gesture owner"). It is aimed at a cell (`cell`, false in
 * history), and never raises or lowers the keyboard: a click for an application that asked for the mouse
 * (`mouse`), else the tap moves the prompt cursor while the terminal's own input holds the keyboard.
 *
 * Native input (`raises`) keeps its older rule until step 4 removes it: with the compose box typing a tap only
 * gives typing back, and with the keyboard down a tap near the cursor row (`nearCursor`) raises it.
 */
export function tapAction(t: { owner: Owner; cell: boolean; nearCursor: boolean; mouse: boolean; raises: boolean }): TapAction {
  if (!t.raises) {
    if (!t.cell) return "none";
    if (t.mouse) return "click";
    return t.owner === "terminal" ? "moveCursor" : "none";
  }
  if (t.owner === "line") return "focus";
  if (!t.cell) return "none";
  if (t.owner === "terminal") return t.mouse ? "click" : "moveCursor";
  if (t.mouse) return t.nearCursor ? "focusAndClick" : "click";
  return t.nearCursor ? "focus" : "none";
}

/** A second tap this soon and this near the first is a double tap: it selects the word. */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 24;

/** How long after a touch the surface takes no mouse events. */
const MOUSE_AFTER_TOUCH_MS = 800;
const MOUSE_EVENTS = ["mousedown", "mouseup", "mousemove", "mouseover", "mouseout", "click", "dblclick"] as const;

export class TouchControl {
  private readonly recognizer = new GestureRecognizer();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The fingers down, and the touches that belong to nobody (the one that dismissed the menu). */
  private readonly fingers = new Set<number>();
  private readonly spent = new Set<number>();
  /** Where the first finger went down: a wheel event's cell. */
  private origin = { x: 0, y: 0 };
  private scrolling = false;
  /** A long-press began a selection and the finger has not lifted. */
  private selecting = false;
  /** The touch that stopped a coasting scroll is that, and not a tap. */
  private stoppedCoast = false;
  /** The last tap, so a second one close by in time and place selects the word (as a long-press does) instead of zooming. */
  private lastTap: { x: number; y: number; at: number } | null = null;
  /** A touch on the selection snapshot: if it lifts as a tap, the selection closes. */
  private snapshotTouch: { id: number; x: number; y: number; at: number } | null = null;
  /** Owned input: the touch began on a live selection, so it is WebKit's until every finger lifts. */
  private handedOver = false;
  /** Owned input: a selection or mark was up when the touch began, so a tap closes it and does nothing else. */
  private dismissing = false;
  /** Owned input: the touch began on the mark's text, so a tap there toggles its menu. */
  private onMark = false;
  /** A hold marked a word and the finger has not lifted. */
  private marking = false;
  private lastTouchAt = -Infinity;

  constructor(private readonly deps: TouchDeps) {
    const { element } = deps;
    element.addEventListener("pointerdown", this.down);
    element.addEventListener("pointermove", this.move);
    element.addEventListener("pointerup", this.up);
    element.addEventListener("pointercancel", this.cancelled);
    // A finger whose pointer was taken away, or an app sent to the background mid-gesture, never lifts: end the gesture.
    element.addEventListener("lostpointercapture", this.cancelled);
    element.addEventListener("touchstart", this.touchStart, { passive: true });
    element.addEventListener("touchmove", this.touchMove, { passive: false });
    element.addEventListener("touchend", this.touchEnd, { passive: false });
    element.addEventListener("touchcancel", this.touchCancelled);
    for (const type of MOUSE_EVENTS) element.addEventListener(type, this.blockMouse, true);
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.cancel(); });
    // Android's long-press menu would fight the gesture; iOS shows no callout (CSS). Owned input leaves it to the system.
    element.addEventListener("contextmenu", (event) => { if (!this.owned && !this.deps.selection.owns(event.target)) event.preventDefault(); });
  }

  /** The phone's own input: touch events, and a long press that is WebKit's. */
  private get owned(): boolean {
    return this.deps.directInput() === "owned";
  }

  /** Ends any gesture in progress: a selection still being dragged goes with it. */
  cancel(): void {
    clearTimeout(this.timer);
    this.handedOver = false;
    this.dismissing = false;
    this.onMark = false;
    this.fingers.clear();
    this.spent.clear();
    this.run(this.recognizer.cancel());
    this.schedule();
  }

  private readonly touchStart = (event: TouchEvent): void => {
    if (!this.owned) return;
    this.lastTouchAt = performance.now();
    if (this.handedOver) return;
    const first = event.changedTouches[0];
    if (this.fingers.size === 0 && first && this.deps.page.exists()) {
      // A touch on the selection is WebKit's (handle drags and its menu); a touch elsewhere only closes it, if it is a tap.
      if (this.deps.page.contains(first.clientX, first.clientY)) {
        this.handedOver = true;
        return;
      }
      this.dismissing = true;
    } else if (this.fingers.size === 0 && first && this.deps.mark.exists()) {
      if (this.deps.mark.contains(first.clientX, first.clientY)) this.onMark = true;
      else this.dismissing = true;
    }
    for (const touch of event.changedTouches) {
      if (this.fingers.size === 0) {
        this.stoppedCoast = this.deps.scroll.coasting;
        this.deps.scroll.stop();
        this.origin = { x: touch.clientX, y: touch.clientY };
      }
      this.fingers.add(touch.identifier);
      this.run(this.recognizer.down(touch.identifier, touch.clientX, touch.clientY, performance.now()));
    }
    this.schedule();
  };

  private readonly touchMove = (event: TouchEvent): void => {
    if (!this.owned) return;
    this.lastTouchAt = performance.now();
    if (this.handedOver) return;
    for (const touch of event.changedTouches) {
      if (this.fingers.has(touch.identifier)) this.run(this.recognizer.move(touch.identifier, touch.clientX, touch.clientY, performance.now()));
    }
    this.schedule();
    // The first move past the slop starts a scroll, and WebKit's long press has given up by then. A second finger
    // would pinch the page, which the terminal never does.
    if (this.recognizer.scrolling || this.marking || event.touches.length > 1) event.preventDefault();
  };

  private readonly touchEnd = (event: TouchEvent): void => {
    if (!this.owned) return;
    this.lastTouchAt = performance.now();
    if (this.handedOver) {
      if (event.touches.length === 0) this.handedOver = false;
      return;
    }
    for (const touch of event.changedTouches) {
      if (!this.fingers.delete(touch.identifier)) continue;
      const actions = this.recognizer.up(touch.identifier, performance.now());
      if (this.marking || actions.some((action) => action.type === "tap")) event.preventDefault();
      this.run(actions);
    }
    if (this.fingers.size === 0) {
      this.dismissing = false;
      this.onMark = false;
    }
    this.schedule();
  };

  private readonly touchCancelled = (): void => {
    if (this.owned) this.cancel();
  };

  /** Mouse events imitating a touch (a mouse-move over a link underlines it, and redraws rows) go no further than the surface. */
  private readonly blockMouse = (event: MouseEvent): void => {
    if (performance.now() - this.lastTouchAt < MOUSE_AFTER_TOUCH_MS) event.stopPropagation();
  };

  private readonly down = (event: PointerEvent): void => {
    if (event.pointerType !== "touch" || this.owned) return; // a mouse is xterm's
    // The selection snapshot's own touches are the system's: handles, and scrolling its rows. A tap on it
    // closes the selection, wherever it lands: WebKit kept the selection on a tap over the selected text,
    // and every long press after it then landed on the snapshot and did nothing.
    if (this.deps.selection.owns(event.target)) {
      this.snapshotTouch = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now() };
      return;
    }
    event.preventDefault();
    if (this.fingers.size === 0 && this.deps.selection.active) {
      // The touch that closes the edit menu is that, and nothing else.
      this.deps.selection.dismiss();
      this.spent.add(event.pointerId);
      return;
    }
    if (this.fingers.size === 0) {
      this.deps.element.setPointerCapture(event.pointerId);
      this.stoppedCoast = this.deps.scroll.coasting;
      this.deps.scroll.stop();
      this.origin = { x: event.clientX, y: event.clientY };
    }
    this.fingers.add(event.pointerId);
    this.run(this.recognizer.down(event.pointerId, event.clientX, event.clientY, performance.now()));
    this.schedule();
  };

  private readonly move = (event: PointerEvent): void => {
    if (this.owned) return;
    const touch = this.snapshotTouch;
    if (touch?.id === event.pointerId && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > DEFAULT_GESTURE.slop) this.snapshotTouch = null;
    if (!this.fingers.has(event.pointerId)) return;
    this.run(this.recognizer.move(event.pointerId, event.clientX, event.clientY, performance.now()));
    this.schedule();
  };

  private readonly up = (event: PointerEvent): void => {
    if (this.owned) return;
    const touch = this.snapshotTouch;
    if (touch?.id === event.pointerId) {
      this.snapshotTouch = null;
      if (performance.now() - touch.at < DEFAULT_GESTURE.longPressMs) this.deps.selection.dismiss();
      return;
    }
    if (this.spent.delete(event.pointerId) || !this.fingers.delete(event.pointerId)) return;
    this.run(this.recognizer.up(event.pointerId, performance.now()));
    this.schedule();
  };

  private readonly cancelled = (event: PointerEvent): void => {
    if (this.owned) return;
    if (this.snapshotTouch?.id === event.pointerId) this.snapshotTouch = null;
    if (event.pointerType !== "touch" || !(this.fingers.has(event.pointerId) || this.spent.has(event.pointerId))) return;
    this.cancel();
  };

  /** One timer, set to the recognizer's next deadline. */
  private schedule(): void {
    clearTimeout(this.timer);
    const deadline = this.recognizer.deadline;
    if (deadline === null) return;
    this.timer = setTimeout(() => {
      this.run(this.recognizer.advance(performance.now()));
      this.schedule();
    }, Math.max(0, deadline - performance.now()));
  }

  private run(actions: GestureAction[]): void {
    for (const action of actions) this.handle(action);
  }

  private handle(action: GestureAction): void {
    const { scroll, selection } = this.deps;
    switch (action.type) {
      case "tap": {
        if (this.stoppedCoast) break;
        if (this.onMark) {
          this.deps.mark.toggleMenu();
          break;
        }
        if (this.dismissing) {
          this.deps.page.clear();
          this.deps.mark.clear();
          break;
        }
        const now = performance.now();
        const last = this.lastTap;
        if (!this.owned && last && now - last.at < DOUBLE_TAP_MS && Math.hypot(action.x - last.x, action.y - last.y) < DOUBLE_TAP_SLOP) {
          this.lastTap = null;
          this.deps.haptic("rigid");
          selection.begin(action.x, action.y);
          selection.release();
          break;
        }
        this.lastTap = { x: action.x, y: action.y, at: now };
        this.tap(action.x, action.y);
        break;
      }
      case "scroll":
        if (!this.scrolling) {
          this.scrolling = true;
          this.deps.page.clear(); // scrolling redraws the rows
          this.deps.mark.clear();
          scroll.begin(this.deps.renderer()?.cellAt(this.origin.x, this.origin.y) ?? null);
        }
        scroll.by(action.dy);
        break;
      case "scrollEnd":
        this.scrolling = false;
        scroll.release(action.velocity);
        break;
      case "longPress":
        if (this.owned) {
          // Keyboard down, or in a browser: WebKit's, iOS selects the word under the finger. Keyboard up in the app: the mark.
          this.marking = this.deps.owner() !== "none" && this.deps.mark.available && this.deps.mark.begin(action.x, action.y);
          break;
        }
        this.deps.haptic("rigid");
        selection.begin(action.x, action.y);
        this.selecting = true;
        break;
      case "selectMove":
        if (this.marking) this.deps.mark.extend(action.x, action.y);
        else selection.extend(action.x, action.y);
        break;
      case "selectEnd":
        if (this.marking) {
          this.marking = false;
          this.deps.mark.lift();
          break;
        }
        this.selecting = false;
        selection.release();
        break;
      case "cancel":
        this.scrolling = false;
        if (this.marking) this.deps.mark.clear(); // a system gesture took the touch
        this.marking = false;
        if (this.selecting) selection.dismiss();
        this.selecting = false;
        break;
    }
  }

  /** A short press, resolved to the one thing it does (`tapAction`). */
  private tap(x: number, y: number): void {
    const renderer = this.deps.renderer();
    if (this.deps.directInput() === "xterm") {
      this.deps.focusTerminal();
      return;
    }
    const cell = this.deps.scroll.atLatest ? renderer?.cellAt(x, y) ?? null : null;
    const action = tapAction({
      owner: this.deps.owner(),
      cell: cell !== null,
      nearCursor: cell !== null && renderer !== null && Math.abs(cell.row - renderer.cursor().row) <= 1,
      mouse: renderer !== null && renderer.mouseMode() !== "none",
      raises: this.deps.directInput() === "native",
    });
    if (action === "focus" || action === "focusAndClick") this.deps.focusTerminal();
    if (!renderer || !cell) return;
    if (action === "click" || action === "focusAndClick") {
      const mode = renderer.mouseMode();
      const events = mode === "none" ? null : mouseInput("tap", cell.col, cell.row, mode, renderer.mouseEncoding());
      if (events) this.deps.send(events);
    } else if (action === "moveCursor") this.moveCursorTo(cell.col, cell.row);
  }

  /** On the prompt's input row, a tap moves the cursor there; the caller has checked that the terminal's own input held the keyboard. */
  private moveCursorTo(col: number, row: number): void {
    const renderer = this.deps.renderer();
    const line = this.deps.prompt();
    if (!renderer || !line) return;
    const cursor = renderer.cursor();
    if (row !== cursor.row || col === cursor.col) return;
    // The cursor moves a character a key, and a cell is not a character: wide text takes two cells, a combining mark none.
    const left = col < cursor.col;
    const keys = left ? charsAcross(line.before, cursor.col - col, "end") : charsAcross(line.after, col - cursor.col, "start");
    this.deps.send(Array.from({ length: keys }, () => ({ key: left ? "Left" : "Right" })));
  }
}
