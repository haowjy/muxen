// The touch shell (client-architecture.md §7.6): touches in, the sans-IO recognizer in the middle,
// the terminal's side effects out. What it means is decided when a touch resolves.
//
// With the phone's own input (`directInput: "owned"`) the rows are the row list's page text, and its scroll and
// the long press are WebKit's. Touch events are shared with it: every listener but the handles' is passive
// where it can be, `touchmove` is cancelled only for the mark and a pinned terminal's swipe
// (which becomes wheel events), `touchend` is cancelled for a tap (so a tap is never a click or a blur), and
// `touchcancel` is what a long press that WebKit took over looks like. A swipe past the slop is the browser's
// scroll: the recognizer only hides the mark's menu for it.
// A touch on a live selection is WebKit's and never reaches the recognizer. After a touch, mouse events
// on the surface stop for a while: iOS's imitation mouse-move over a link would redraw rows and end a selection.
// With the keyboard up in the app the hold is muxen's instead (`Mark`): WebKit's selection would take the
// keyboard down. The recognizer's hold marks the word, the finger extends it, a tap inside toggles the menu and a
// tap elsewhere clears it; the handles' touches are the mark's own and never get here.
//
// Native input (`directInput: "native"`) is the pointer path until step 4 of ios-simplify removes it:
// `pointerdown` is cancelled, so a touch never moves focus or reaches xterm as a mouse event, and a long
// press builds the selection snapshot.
import type { Owner } from "../../app/focus";
import type { HapticKind, InputEvent } from "../../platform/types";
import type { CellPosition, PromptLine, TerminalModel } from "../../term";
import { mouseInput } from "../../term/mouse";
import { DEFAULT_GESTURE, GestureRecognizer, type GestureAction } from "../../touch/gesture";
import { charsAcross } from "../../touch/selection";
import type { ScrollControl } from "./scroll";
import type { SelectionControl } from "./selection/control";
import type { PinnedWheel } from "./pinnedWheel";
import type { Mark } from "./selection/mark";
import type { PageSelection } from "./selection/pageSelection";

/** What a tap and a swipe need of the view that draws the terminal: the row list's, or xterm's. */
export interface TouchSurface {
  cellAt(x: number, y: number): CellPosition | null;
  cursor(): CellPosition;
}

interface TouchDeps {
  element: HTMLElement;
  surface(): TouchSurface | null;
  model(): TerminalModel | null;
  /** The xterm view's scroll (the native input path). */
  scroll: ScrollControl;
  /** A pinned terminal's swipe as wheel events, and whether the row list is coasting (the owned path). */
  wheel: PinnedWheel;
  listCoasting(): boolean;
  /** Whether a finger holds the row list: it is left alone, and at rest a moment after the last lifts. */
  holdList(held: boolean): void;
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
  /** Where each touch began: the node that gets the rest of its events, and carries our listeners until it ends. */
  private readonly targets = new Map<number, EventTarget>();
  /** Where the first finger went down: a wheel event's cell. */
  private origin = { x: 0, y: 0 };
  private scrolling = false;
  /** The scroll in progress is a pinned terminal's: its swipes are wheel events. */
  private pinned = false;
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
    // The rest of a touch's events go to its own target (`follow`), not the surface: a touch that began on a row xterm
    // then replaced goes on being dispatched to that detached node, and never bubbles to the surface or the document.
    for (const type of MOUSE_EVENTS) element.addEventListener(type, this.blockMouse, true);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) return;
      this.cancel();
      for (const id of [...this.targets.keys()]) this.unfollow(id); // a finger the background took never lifts
    });
    // Android's long-press menu would fight the gesture; iOS shows no callout (CSS). Owned input leaves it to the system.
    element.addEventListener("contextmenu", (event) => { if (!this.owned && !this.deps.selection.owns(event.target)) event.preventDefault(); });
  }

  /** The phone's own input: touch events, and a long press that is WebKit's. */
  private get owned(): boolean {
    return this.deps.directInput() === "owned";
  }

  /** The list scrolled: a press still waiting to become a tap or a hold is the browser's scroll, and neither. */
  scrolled(): void {
    if (this.recognizer.deadline === null) return;
    this.run(this.recognizer.cancel());
    this.schedule();
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

  /**
   * Listens on the node a touch began on, which keeps receiving its events after xterm replaces it. `touchend` is
   * non-passive to cancel a tap; `touchmove` only where a move may need cancelling (the mark, a pinned swipe), so
   * that elsewhere a native scroll never waits on this code. The list is held while any such touch is down.
   */
  private follow(touch: Touch): void {
    const target = touch.target;
    this.targets.set(touch.identifier, target);
    this.deps.holdList(true);
    const cancellable = this.deps.wheel.active || (this.deps.owner() !== "none" && this.deps.mark.available);
    target.addEventListener("touchmove", this.touchMove as EventListener, { passive: !cancellable });
    target.addEventListener("touchend", this.touchEnd as EventListener, { passive: false });
    target.addEventListener("touchcancel", this.touchCancelled as EventListener);
  }

  /** The touch is over: its node is released unless another touch began on it too. */
  private unfollow(id: number): void {
    const target = this.targets.get(id);
    if (!target) return;
    this.targets.delete(id);
    this.deps.holdList(this.targets.size > 0);
    if ([...this.targets.values()].includes(target)) return;
    target.removeEventListener("touchmove", this.touchMove as EventListener);
    target.removeEventListener("touchend", this.touchEnd as EventListener);
    target.removeEventListener("touchcancel", this.touchCancelled as EventListener);
  }

  /**
   * The platform's list of touches is the truth. A finger it no longer lists never delivered its end (WebKit took the
   * touch, or its node went away unheard): counted on, it would make every later swipe a two-finger one. The gesture
   * that finger belonged to is dead, so it is cancelled, never resolved as a tap.
   */
  private reap(event: TouchEvent): void {
    const listed = new Set<number>();
    for (const touch of event.touches) listed.add(touch.identifier);
    if (event.type === "touchend") for (const touch of event.changedTouches) listed.add(touch.identifier);
    for (const id of this.targets.keys()) if (!listed.has(id)) this.unfollow(id);
    for (const id of this.fingers) {
      if (!listed.has(id)) {
        this.cancel();
        return;
      }
    }
  }

  private readonly touchStart = (event: TouchEvent): void => {
    if (!this.owned) return;
    this.lastTouchAt = performance.now();
    this.reap(event);
    // Not the mark's handles, which are inside the list but have touches of their own.
    const inside = (touch: Touch): boolean => touch.target instanceof Node && this.deps.element.contains(touch.target) && !this.deps.mark.owns(touch.target);
    for (const touch of event.changedTouches) if (inside(touch)) this.follow(touch);
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
    // Only the surface's own fingers: one held on a dock key or a handle is not a second finger on the terminal.
    for (const touch of event.touches) {
      if (this.fingers.has(touch.identifier) || !inside(touch)) continue;
      if (this.fingers.size === 0) {
        this.stoppedCoast = this.deps.listCoasting() || this.deps.wheel.coasting;
        this.deps.wheel.stop();
        this.origin = { x: touch.clientX, y: touch.clientY };
      }
      this.fingers.add(touch.identifier);
      this.run(this.recognizer.down(touch.identifier, touch.clientX, touch.clientY, performance.now()));
    }
    this.schedule();
  };

  private readonly touchMove = (event: TouchEvent): void => {
    if (!this.owned) return;
    this.reap(event);
    if (this.handedOver || !Array.from(event.changedTouches).some((touch) => this.fingers.has(touch.identifier))) return;
    this.lastTouchAt = performance.now();
    for (const touch of event.changedTouches) {
      if (this.fingers.has(touch.identifier)) this.run(this.recognizer.move(touch.identifier, touch.clientX, touch.clientY, performance.now()));
    }
    this.schedule();
    // Only a pinned terminal's swipe and the mark are muxen's: any other move is WebKit's, and the list scrolls
    // natively (`touch-action: pan-y` keeps a second finger from pinching the page).
    if ((this.pinned && this.recognizer.scrolling) || this.marking) event.preventDefault();
  };

  private readonly touchEnd = (event: TouchEvent): void => {
    this.end(event);
    for (const touch of event.changedTouches) this.unfollow(touch.identifier);
  };

  private end(event: TouchEvent): void {
    if (!this.owned) return;
    this.reap(event);
    if (this.handedOver) {
      if (event.touches.length === 0) this.handedOver = false;
      return;
    }
    let ours = false;
    for (const touch of event.changedTouches) {
      if (!this.fingers.delete(touch.identifier)) continue;
      ours = true;
      const actions = this.recognizer.up(touch.identifier, performance.now());
      if (this.marking || actions.some((action) => action.type === "tap")) event.preventDefault();
      this.run(actions);
    }
    if (!ours) return;
    this.lastTouchAt = performance.now();
    if (this.fingers.size === 0) {
      this.dismissing = false;
      this.onMark = false;
    }
    this.schedule();
  }

  private readonly touchCancelled = (event: TouchEvent): void => {
    for (const touch of event.changedTouches) this.unfollow(touch.identifier);
    if (!this.owned) return;
    // A handed-over touch is not a counted finger, and its cancel is how a long press WebKit took ends.
    if (event.touches.length === 0) this.handedOver = false;
    if (Array.from(event.changedTouches).some((touch) => this.fingers.has(touch.identifier))) this.cancel();
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
          const anchor = this.deps.surface()?.cellAt(this.origin.x, this.origin.y) ?? null;
          if (this.owned) {
            // The list scrolls natively and a selection survives it; the mark's menu hides until a tap inside it.
            this.deps.mark.hideMenu();
            this.pinned = this.deps.wheel.active;
            if (this.pinned) this.deps.wheel.begin(anchor);
          } else scroll.begin(anchor);
        }
        if (!this.owned) scroll.by(action.dy);
        else if (this.pinned) this.deps.wheel.by(action.dy);
        break;
      case "scrollEnd":
        this.scrolling = false;
        if (!this.owned) scroll.release(action.velocity);
        else if (this.pinned) this.deps.wheel.release(action.velocity);
        this.pinned = false;
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
    const surface = this.deps.surface();
    const model = this.deps.model();
    if (this.deps.directInput() === "xterm") {
      this.deps.focusTerminal();
      return;
    }
    // On the list a cell is a screen row under the finger, wherever the view is; xterm's slide hides the screen above the history.
    const cell = this.owned || this.deps.scroll.atLatest ? surface?.cellAt(x, y) ?? null : null;
    const action = tapAction({
      owner: this.deps.owner(),
      cell: cell !== null,
      nearCursor: cell !== null && surface !== null && Math.abs(cell.row - surface.cursor().row) <= 1,
      mouse: model !== null && model.mouseMode() !== "none",
      raises: this.deps.directInput() === "native",
    });
    if (action === "focus" || action === "focusAndClick") this.deps.focusTerminal();
    if (!model || !cell) return;
    if (action === "click" || action === "focusAndClick") {
      const mode = model.mouseMode();
      const events = mode === "none" ? null : mouseInput("tap", cell.col, cell.row, mode, model.mouseEncoding());
      if (events) this.deps.send(events);
    } else if (action === "moveCursor") this.moveCursorTo(cell.col, cell.row);
  }

  /** On the prompt's input row, a tap moves the cursor there; the caller has checked that the terminal's own input held the keyboard. */
  private moveCursorTo(col: number, row: number): void {
    const surface = this.deps.surface();
    const line = this.deps.prompt();
    if (!surface || !line) return;
    const cursor = surface.cursor();
    if (row !== cursor.row || col === cursor.col) return;
    // The cursor moves a character a key, and a cell is not a character: wide text takes two cells, a combining mark none.
    const left = col < cursor.col;
    const keys = left ? charsAcross(line.before, cursor.col - col, "end") : charsAcross(line.after, col - cursor.col, "start");
    this.deps.send(Array.from({ length: keys }, () => ({ key: left ? "Left" : "Right" })));
  }
}
