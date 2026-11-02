// The touch shell (client-architecture.md §7.6): touches in, the sans-IO recognizer in the middle,
// the terminal's side effects out. What it means is decided when a touch resolves.
//
// The rows are the row list's page text, and its scroll and the long press are WebKit's.
// Touch events are shared with it: every listener but the handles' is passive
// where it can be, `touchmove` is cancelled only for the mark and a pinned terminal's swipe
// (which becomes wheel events), `touchend` is cancelled for a tap (so a tap is never a click or a blur), and
// `touchcancel` is a finger a system gesture took. A swipe past the slop is the browser's
// scroll: the recognizer only hides the mark's menu for it.
// A touch on a live selection is WebKit's and never reaches the recognizer. After a touch, mouse events
// on the surface stop for a while: iOS's imitation mouse-move over a link would redraw rows and end a selection.
// In the app the hold is muxen's instead (`Mark`), keyboard up or down: WebKit's selection would take the
// keyboard down. The recognizer's hold marks the word, the finger extends it, a tap inside toggles the menu and a
// tap elsewhere clears it; the handles' touches are the mark's own and never get here.
import type { Owner } from "../../app/focus";
import type { HapticKind, InputEvent } from "../../platform/types";
import type { PromptLine, TerminalModel } from "../../term";
import { mouseInput } from "../../term/mouse";
import { GestureRecognizer, type GestureAction } from "../../touch/gesture";
import { charsAcross } from "../../touch/selection";
import type { PinnedWheel } from "./pinnedWheel";
import type { RowList } from "./rowList";
import type { Mark } from "./selection/mark";
import type { PageSelection } from "./selection/pageSelection";

interface TouchDeps {
  element: HTMLElement;
  /** The row list that draws the terminal on touch; null before it exists. */
  list(): RowList | null;
  model(): TerminalModel | null;
  /** A pinned terminal's swipe as wheel events. */
  wheel: PinnedWheel;
  page: PageSelection;
  /** The app's keyboard-up mark. */
  mark: Mark;
  /** Typed input for the tab this view is showing. */
  send(events: InputEvent[]): void;
  haptic(kind: HapticKind): void;
  /** Desktop's xterm owns its pointer; everything else is touch. */
  directInput(): "xterm" | "owned" | "native";
  /** Focuses the terminal's input: a touch tap on or beside the cursor row, native input only. */
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
 * Native input (`raises`) keeps its older rule: with the compose box typing a tap only gives typing back, and
 * with the keyboard down a tap near the cursor row (`nearCursor`) raises it.
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
  /** The touch that stopped a coasting scroll is that, and not a tap. */
  private stoppedCoast = false;
  /** The touch began on a live selection, so it is WebKit's until every finger lifts. */
  private handedOver = false;
  /** A selection or mark was up when the touch began, so a tap closes it and does nothing else. */
  private dismissing = false;
  /** The touch began on the mark's text, so a tap there toggles its menu. */
  private onMark = false;
  /** A hold marked a word and the finger has not lifted. */
  private marking = false;
  private lastTouchAt = -Infinity;

  constructor(private readonly deps: TouchDeps) {
    const { element } = deps;
    element.addEventListener("touchstart", this.touchStart, { passive: true });
    // The rest of a touch's events go to its own target (`follow`), not the surface: a touch that began on a row a redraw
    // then replaced goes on being dispatched to that detached node, and never bubbles to the surface or the document.
    for (const type of MOUSE_EVENTS) element.addEventListener(type, this.blockMouse, true);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) return;
      this.cancel();
      for (const id of [...this.targets.keys()]) this.unfollow(id); // a finger the background took never lifts
    });
    // Desktop's right click is not the browser's; on touch the long press is the system's.
    element.addEventListener("contextmenu", (event) => { if (!this.touch) event.preventDefault(); });
  }

  /** Touch events, and a long press that is WebKit's: every input but desktop's xterm, which takes the mouse. */
  private get touch(): boolean {
    return this.deps.directInput() !== "xterm";
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
   * Listens on the node a touch began on, which keeps receiving its events after a redraw replaces it. `touchend` is
   * non-passive to cancel a tap; `touchmove` only where a move may need cancelling (the mark, a pinned swipe), so
   * that elsewhere a native scroll never waits on this code. The list is held while any such touch is down.
   */
  private follow(touch: Touch): void {
    const target = touch.target;
    this.targets.set(touch.identifier, target);
    this.deps.list()?.hold(true);
    const cancellable = this.deps.wheel.active || this.deps.mark.available;
    target.addEventListener("touchmove", this.touchMove as EventListener, { passive: !cancellable });
    target.addEventListener("touchend", this.touchEnd as EventListener, { passive: false });
    target.addEventListener("touchcancel", this.touchCancelled as EventListener);
  }

  /** The touch is over: its node is released unless another touch began on it too. */
  private unfollow(id: number): void {
    const target = this.targets.get(id);
    if (!target) return;
    this.targets.delete(id);
    this.deps.list()?.hold(this.targets.size > 0);
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
    if (!this.touch) return;
    this.lastTouchAt = performance.now();
    this.reap(event);
    const inside = (touch: Touch): boolean => touch.target instanceof Node && this.deps.element.contains(touch.target);
    // Every finger on the surface holds the list, the mark's handles included: output must not slide the text under a drag.
    for (const touch of event.changedTouches) if (inside(touch)) this.follow(touch);
    if (this.handedOver) return;
    // A mark handle's finger is the handle's: it starts no gesture here, and sets none of the flags below.
    const first = Array.from(event.changedTouches).find((touch) => inside(touch) && !this.deps.mark.owns(touch.target));
    if (this.fingers.size === 0 && first) {
      // Per-gesture state is reset where a gesture starts, so a finger whose end never came leaves nothing set.
      this.dismissing = false;
      this.onMark = false;
    }
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
      if (this.fingers.has(touch.identifier) || !inside(touch) || this.deps.mark.owns(touch.target)) continue;
      if (this.fingers.size === 0) {
        this.stoppedCoast = (this.deps.list()?.coasting ?? false) || this.deps.wheel.coasting;
        this.deps.wheel.stop();
        this.origin = { x: touch.clientX, y: touch.clientY };
      }
      this.fingers.add(touch.identifier);
      this.run(this.recognizer.down(touch.identifier, touch.clientX, touch.clientY, performance.now()));
    }
    this.schedule();
  };

  private readonly touchMove = (event: TouchEvent): void => {
    if (!this.touch) return;
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
    if (!this.touch) return;
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
    this.schedule();
  }

  private readonly touchCancelled = (event: TouchEvent): void => {
    for (const touch of event.changedTouches) this.unfollow(touch.identifier);
    if (!this.touch) return;
    // A handed-over touch is not a counted finger, and its cancel is how a long press WebKit took ends.
    if (event.touches.length === 0) this.handedOver = false;
    if (Array.from(event.changedTouches).some((touch) => this.fingers.has(touch.identifier))) this.cancel();
  };

  /** Mouse events iOS synthesizes after a touch go no further than the surface, so they never reach the page's own handlers. */
  private readonly blockMouse = (event: MouseEvent): void => {
    if (performance.now() - this.lastTouchAt < MOUSE_AFTER_TOUCH_MS) event.stopPropagation();
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
        this.tap(action.x, action.y);
        break;
      }
      case "scroll":
        if (!this.scrolling) {
          this.scrolling = true;
          const anchor = this.deps.list()?.cellAt(this.origin.x, this.origin.y) ?? null;
          // The list scrolls natively and a selection survives it; the mark's menu hides until a tap inside it.
          this.deps.mark.hideMenu();
          this.deps.list()?.wantOlder(); // a list too short to scroll sends no scroll event
          this.pinned = this.deps.wheel.active;
          if (this.pinned) this.deps.wheel.begin(anchor);
        }
        if (this.pinned) this.deps.wheel.by(action.dy);
        break;
      case "scrollEnd":
        this.scrolling = false;
        if (this.pinned) this.deps.wheel.release(action.velocity);
        this.pinned = false;
        break;
      case "longPress":
        // In the app the hold is the mark; a browser has no edit menu, so its long press stays WebKit's.
        this.marking = this.deps.mark.available && this.deps.mark.begin(action.x, action.y);
        break;
      case "selectMove":
        if (this.marking) this.deps.mark.extend(action.x, action.y);
        break;
      case "selectEnd":
        if (this.marking) {
          this.marking = false;
          this.deps.mark.lift();
        }
        break;
      case "cancel":
        this.scrolling = false;
        // A system gesture took the finger: the mark is made and has its handles, so it ends as a lift does. Clearing it would
        // lose a selection nobody dismissed; a redraw (J7), a tap elsewhere or a reset still close it.
        if (this.marking) this.deps.mark.lift();
        this.marking = false;
        break;
    }
  }

  /** A short press, resolved to the one thing it does (`tapAction`). */
  private tap(x: number, y: number): void {
    const surface = this.deps.list();
    const model = this.deps.model();
    // A cell is a screen row under the finger, wherever the view is.
    const cell = surface?.cellAt(x, y) ?? null;
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
    const surface = this.deps.list();
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
