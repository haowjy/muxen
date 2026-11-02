// The mark: the app's selection of the terminal's text, keyboard up or down (terminal-interaction-design.md "Phone
// selection"). The recognizer's hold marks the word under the finger with a CSS Custom Highlight, which is not a DOM
// selection, so focus and the keyboard stay. The finger, still down, extends it; two drawn handles adjust it;
// native's edit menu (`Platform.editMenu`) sits over it. It is a range over the row list's rows, and its text is
// `RowRanges.textOf`: one join for Copy. Output never pauses: when rows under the mark redraw, the view closes it
// with its handles (`RowRanges.rewrites`). The handles sit in the row list's scroller, so they
// ride its native scroll; a finger or handle near the scroller's top or bottom edge scrolls it (the mark's own
// autoscroll, which iOS gives its own selection but not a CSS highlight).
import type { MenuRect } from "../../../platform/types";
import { boxOf, near, type RowRanges } from "./rowRanges";
import type { Selection, TouchStart } from "./selection";
import styles from "./Mark.module.css";

interface MarkDeps {
  /** The row list's scroller: the handles are its children, placed in its content's coordinates. It clips, so a start knob that would lie above its visible top hangs below its line. */
  layer(): HTMLElement | null;
  rows: RowRanges;
  /** The platform's edit menu, or undefined where there is none (a browser): the mark is the app's. */
  editMenu(): ((rect: MenuRect | null) => void) | undefined;
  /** One light tick when the hold marks a word. */
  tick(): void;
}

/** A touch this near the marked text counts as on it; `pageSelection.ts` says why the system's reach is wider. */
const TAP_REACH = 8;
/** Half a handle's hit area: a touch this near a knob's centre is that handle's. */
const HIT = 22;
/** A finger this near the scroller's top or bottom edge scrolls it, this many px a frame. */
const EDGE = 40;
const EDGE_STEP = 8;
/** From a handle's line to its knob's centre: 2 px of air and the 10 px knob's radius. */
const KNOB_OFFSET = 7;

type End = "start" | "end";
const ENDS: readonly End[] = ["start", "end"];

interface Point {
  x: number;
  y: number;
}

/** Where a handle is, in client px: its knob's centre, and the text point it stands for (the stem's x, its line's middle). */
interface Place {
  knob: Point;
  text: Point;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });

export class Mark implements Selection {
  /** `range` is what is marked; `word` is the word the hold began on, which a finger's drag extends from. */
  private state: { range: Range; word: Range } | null = null;
  private handles: Record<End, HTMLElement> | null = null;
  private places: Record<End, Place> | null = null;
  /** A hold marked a word and the finger has not lifted. */
  private holding = false;
  /** A handle being dragged, and the vector from the finger to its text point at the grab. */
  private grabbed: { end: End; touch: number; dx: number; dy: number } | null = null;
  /** The menu may be up: native owns whether it is, so only a shown one is hidden. */
  private menuShown = false;
  /** The edge autoscroll: the direction, the finger it follows, and what moves the mark's end to it. */
  private edge: { dir: -1 | 1; x: number; y: number; apply: (x: number, y: number) => void; frame: number } | null = null;

  constructor(private readonly deps: MarkDeps) {}

  /** Whether the hold may mark: only where native shows the menu. */
  get available(): boolean {
    return this.deps.editMenu() !== undefined;
  }

  /** A touch on the marked text toggles its menu; one elsewhere only closes the mark if it is a tap. */
  touch(x: number, y: number): TouchStart {
    if (!this.state) return "plain";
    return near(this.deps.rows.rectsOf(this.state.range), x, y, TAP_REACH) ? "toggle" : "dismiss";
  }

  /** The marked range, or null. */
  range(): Range | null {
    return this.state?.range ?? null;
  }

  /** Whether `target` is one of the handles: their touches are the mark's own, never the terminal's. */
  owns(target: EventTarget | null): boolean {
    return target instanceof Node && this.handles !== null && ENDS.some((end) => this.handles?.[end].contains(target));
  }

  /** Copy's text: the mark's range through the rows' join. Empty with no mark. */
  text(): string {
    return this.state ? this.deps.rows.textOf(this.state.range) : "";
  }

  /** The hold: marks the word under the finger. False when the finger is on no text. */
  begin(x: number, y: number): boolean {
    this.clear();
    const word = this.wordAt(x, y);
    if (!word) return false;
    this.deps.tick();
    this.state = { range: word.cloneRange(), word };
    this.holding = true;
    this.sync();
    return true;
  }

  /** The finger, still down after the hold, drags the mark's far end: it grows from the word the hold began on, either way. */
  extend(x: number, y: number): void {
    this.follow(x, y, (px, py) => { this.extendTo(px, py); });
    this.extendTo(x, y);
  }

  private extendTo(x: number, y: number): void {
    if (!this.state) return;
    const at = this.caretAt(x, y);
    if (!at) return;
    const { word } = this.state;
    const range = word.cloneRange();
    if (at.compareBoundaryPoints(Range.START_TO_START, word) < 0) range.setStart(at.startContainer, at.startOffset);
    else if (at.compareBoundaryPoints(Range.END_TO_END, word) > 0) range.setEnd(at.startContainer, at.startOffset);
    this.state.range = range;
    this.sync();
  }

  /** The finger that held and dragged lifted: the mark is final and the menu comes up. */
  lift(): void {
    this.stopEdge();
    this.holding = false;
    this.sync();
    this.toggleMenu();
  }

  /** A tap inside the mark. Native owns whether the menu is up (iOS can dismiss it itself): it shows over the mark or, if showing, hides. */
  toggleMenu(): void {
    const box = this.state && boxOf(this.deps.rows.rectsOf(this.state.range));
    if (!box) return;
    this.menuShown = true;
    this.deps.editMenu()?.({ x: box.x, y: box.y, width: box.width, height: box.height });
  }

  /** The menu hides when a scroll starts and stays hidden: a tap inside the mark brings it back. */
  hideMenu(): void {
    if (!this.menuShown) return;
    this.menuShown = false;
    this.deps.editMenu()?.(null);
  }

  clear(): void {
    if (!this.state) return;
    this.state = null;
    this.places = null;
    this.grabbed = null;
    this.holding = false;
    this.stopEdge();
    this.hideMenu();
    this.sync();
  }

  /** Content moved under the rows (a block dropped above): the handles stand in content coordinates, so they follow their text again. */
  reposition(): void {
    if (this.state) this.placeHandles(this.state.range);
  }

  /**
   * Everything drawn follows from `state`, `holding` and `grabbed`; every path changes those and calls this, so no
   * path has a pair to remember. The handles are `data-inert` while a finger is down on the mark, so a handle's hit
   * area is never what hit-testing finds under a holding finger.
   */
  private sync(): void {
    const { state } = this;
    if (state) {
      CSS.highlights.set("tsel", new Highlight(state.range));
      this.placeHandles(state.range);
    } else CSS.highlights.delete("tsel");
    for (const end of ENDS) {
      const handle = this.handles?.[end]; // made by the first placeHandles
      handle?.toggleAttribute("hidden", !state);
      handle?.toggleAttribute("data-inert", this.holding || this.grabbed !== null);
    }
  }

  /** The word under a client point, or null off the rows' text or on a blank. */
  private wordAt(x: number, y: number): Range | null {
    const at = this.caretAt(x, y);
    if (!at || at.startContainer.nodeType !== Node.TEXT_NODE) return null;
    const node = at.startContainer as Text;
    for (const part of segmenter.segment(node.data)) {
      const end = part.index + part.segment.length;
      if (at.startOffset >= part.index && at.startOffset <= end && part.segment.trim()) {
        const word = document.createRange();
        word.setStart(node, part.index);
        word.setEnd(node, end);
        return word;
      }
    }
    return null;
  }

  /** The caret position under a client point, if it lies in the rows' text. */
  private caretAt(x: number, y: number): Range | null {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- WebKit's own; the standard caretPositionFromPoint is later than iOS 17
    const at = document.caretRangeFromPoint(x, y);
    return at && this.deps.rows.holds(at.startContainer) ? at : null;
  }

  // The handles (selection-look.md). Each stands on the first or last rect's outer edge, and is dragged by
  // the vector from the finger to its text point, so it doesn't jump on grab and the finger never covers
  // the character being chosen.

  private placeHandles(range: Range): void {
    const rects = this.deps.rows.rectsOf(range).filter((r) => r.width > 0);
    const first = rects[0];
    const last = rects.at(-1);
    if (!first || !last) return;
    const layer = this.deps.layer();
    if (!layer) return;
    const handles = this.ensureHandles();
    const host = layer.getBoundingClientRect();
    const place = (end: End, x: number, rect: DOMRect): Place => {
      const element = handles[end];
      if (element.parentElement !== layer) layer.append(element);
      element.style.left = `${String(x - host.left + layer.scrollLeft)}px`;
      element.style.top = `${String(rect.top - host.top + layer.scrollTop)}px`;
      element.style.height = `${String(rect.height)}px`;
      // The scroller clips: a start knob that would lie above its visible top hangs below its line, as the end knob does.
      const below = end === "end" || rect.top - host.top < 2 * KNOB_OFFSET;
      element.toggleAttribute("data-below", below);
      return { knob: { x, y: below ? rect.bottom + KNOB_OFFSET : rect.top - KNOB_OFFSET }, text: { x, y: rect.top + rect.height / 2 } };
    };
    this.places = { start: place("start", first.left, first), end: place("end", last.right, last) };
  }

  private ensureHandles(): Record<End, HTMLElement> {
    if (this.handles) return this.handles;
    const make = (end: End): HTMLElement => {
      const element = document.createElement("div");
      element.className = styles["handle"] ?? "";
      element.dataset["end"] = end;
      for (const part of ["stem", "knob", "hit"] as const) {
        const child = document.createElement("div");
        child.className = styles[part] ?? "";
        element.append(child);
      }
      element.addEventListener("touchstart", (event) => { this.grab(end, event); }, { passive: false });
      element.addEventListener("touchmove", (event) => { this.drag(event); }, { passive: false });
      element.addEventListener("touchend", (event) => { this.drop(event); }, { passive: false });
      element.addEventListener("touchcancel", (event) => { this.drop(event); }, { passive: false });
      return element;
    };
    this.handles = { start: make("start"), end: make("end") };
    return this.handles;
  }

  private grab(end: End, event: TouchEvent): void {
    event.preventDefault();
    const finger = event.changedTouches[0];
    if (this.state) this.placeHandles(this.state.range); // the list may have scrolled since the last sync
    const { places } = this;
    if (!finger || !places || this.grabbed) return;
    // Two short marks' hit areas overlap: of the handles whose area holds the touch, the nearer knob takes it.
    const near = (e: End): number => Math.hypot(finger.clientX - places[e].knob.x, finger.clientY - places[e].knob.y);
    const other: End = end === "start" ? "end" : "start";
    const chosen = near(other) < near(end) && Math.abs(finger.clientX - places[other].knob.x) <= HIT && Math.abs(finger.clientY - places[other].knob.y) <= HIT ? other : end;
    const { text } = places[chosen];
    this.grabbed = { end: chosen, touch: finger.identifier, dx: text.x - finger.clientX, dy: text.y - finger.clientY };
    this.sync();
    this.hideMenu();
  }

  private drag(event: TouchEvent): void {
    event.preventDefault();
    const { grabbed, state } = this;
    if (!grabbed || !state) return;
    const finger = [...event.changedTouches].find((t) => t.identifier === grabbed.touch);
    if (!finger) return;
    this.follow(finger.clientX + grabbed.dx, finger.clientY + grabbed.dy, (x, y) => { this.dragTo(x, y); });
    this.dragTo(finger.clientX + grabbed.dx, finger.clientY + grabbed.dy);
  }

  /** The grabbed handle's text point moves to (`x`, `y`). */
  private dragTo(x: number, y: number): void {
    const { grabbed, state } = this;
    if (!grabbed || !state) return;
    const at = this.caretAt(x, y);
    if (!at) return;
    const range = state.range.cloneRange();
    if (grabbed.end === "start") range.setStart(at.startContainer, at.startOffset);
    else range.setEnd(at.startContainer, at.startOffset);
    // A mark never collapses and its ends never swap: a drag onto or past the other end stops one character short of it.
    if (range.collapsed) {
      const keep = state.range;
      const [node, offset] = grabbed.end === "start" ? [keep.endContainer, keep.endOffset - 1] : [keep.startContainer, keep.startOffset + 1];
      if (node.nodeType !== Node.TEXT_NODE || offset < 0 || offset > (node as Text).length) return;
      const short = keep.cloneRange();
      if (grabbed.end === "start") short.setStart(node, offset);
      else short.setEnd(node, offset);
      if (short.collapsed) return;
      state.range = short;
      this.sync();
      return;
    }
    state.range = range;
    this.sync();
  }

  private drop(event: TouchEvent): void {
    event.preventDefault();
    if (!this.grabbed || ![...event.changedTouches].some((t) => t.identifier === this.grabbed?.touch)) return;
    this.grabbed = null;
    this.lift();
  }

  /** Starts, keeps or stops the edge autoscroll for a finger at (`x`, `y`) in the scroller's coordinates. */
  private follow(x: number, y: number, apply: (x: number, y: number) => void): void {
    const box = this.deps.layer()?.getBoundingClientRect();
    if (!box) return;
    const dir = y < box.top + EDGE ? -1 : y > box.bottom - EDGE ? 1 : 0;
    if (dir === 0) {
      this.stopEdge();
      return;
    }
    this.edge = { dir, x, y, apply, frame: this.edge?.frame ?? 0 };
    if (!this.edge.frame) this.edge.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (): void => {
    const { edge } = this;
    const layer = this.deps.layer();
    if (!edge || !layer) return;
    layer.scrollTop += edge.dir * EDGE_STEP;
    const box = layer.getBoundingClientRect();
    edge.apply(edge.x, Math.max(box.top + 3, Math.min(box.bottom - 3, edge.y)));
    edge.frame = requestAnimationFrame(this.tick);
  };

  private stopEdge(): void {
    if (this.edge) cancelAnimationFrame(this.edge.frame);
    this.edge = null;
  }
}
