// The keyboard-up mark (the app, `directInput: "owned"`; terminal-interaction-design.md "Phone selection"). The
// recognizer's hold marks the word under the finger with a CSS Custom Highlight, which is not a DOM selection, so
// focus and the keyboard stay. The finger, still down, extends it; two drawn handles adjust it; native's edit
// menu (`Platform.editMenu`) sits over it. The mark is a range over the same rows `PageSelection` reads, and its
// text is `PageSelection.textOf`: one join for Copy. Output never pauses: when rows under the mark redraw, the
// mark goes with its handles (`PageSelection.watch`).
import type { MenuRect } from "../../../platform/types";
import { boxOf, near, type PageSelection } from "./pageSelection";
import styles from "./Mark.module.css";

interface MarkDeps {
  /** The surface the terminal is in: the handles are its children, placed in its coordinates. The host clips, and a first row's start knob lies above it. */
  layer(): HTMLElement;
  page: PageSelection;
  /** The platform's edit menu, or undefined where there is none (a browser): the mark is the app's. */
  editMenu(): ((rect: MenuRect | null) => void) | undefined;
  /** One light tick when the hold marks a word. */
  tick(): void;
}

/** A touch this near the marked text counts as on it; `pageSelection.ts` says why the system's reach is wider. */
const TAP_REACH = 8;
/** Half a handle's hit area: a touch this near a knob's centre is that handle's. */
const HIT = 22;
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

export class Mark {
  /** `range` is what is marked; `word` is the word the hold began on, which a finger's drag extends from. */
  private state: { range: Range; word: Range } | null = null;
  private handles: Record<End, HTMLElement> | null = null;
  private places: Record<End, Place> | null = null;
  /** A handle being dragged, and the vector from the finger to its text point at the grab. */
  private grabbed: { end: End; touch: number; dx: number; dy: number } | null = null;
  private unwatch: (() => void) | null = null;

  constructor(private readonly deps: MarkDeps) {}

  /** Whether the hold may mark: only where native shows the menu. */
  get available(): boolean {
    return this.deps.editMenu() !== undefined;
  }

  exists(): boolean {
    return this.state !== null;
  }

  /** Whether the client point is on the marked text. */
  contains(x: number, y: number): boolean {
    return this.state !== null && near(this.deps.page.rectsOf(this.state.range), x, y, TAP_REACH);
  }

  /** Copy's text: the mark's range through the page selection's join. Empty with no mark. */
  text(): string {
    return this.state ? this.deps.page.textOf(this.state.range) : "";
  }

  /** The hold: marks the word under the finger. False when the finger is on no text. */
  begin(x: number, y: number): boolean {
    this.clear();
    const word = this.wordAt(x, y);
    if (!word) return false;
    this.deps.tick();
    this.state = { range: word.cloneRange(), word };
    this.unwatch = this.deps.page.watch(() => this.state?.range ?? word, () => { this.clear(); });
    this.paint();
    this.setInert(true); // until the finger lifts, a handle's hit area must not be what hit-testing finds under it
    return true;
  }

  /** The finger, still down after the hold, drags the mark's far end: it grows from the word the hold began on, either way. */
  extend(x: number, y: number): void {
    if (!this.state) return;
    const at = this.caretAt(x, y);
    if (!at) return;
    const { word } = this.state;
    const range = word.cloneRange();
    if (at.compareBoundaryPoints(Range.START_TO_START, word) < 0) range.setStart(at.startContainer, at.startOffset);
    else if (at.compareBoundaryPoints(Range.END_TO_END, word) > 0) range.setEnd(at.startContainer, at.startOffset);
    this.state.range = range;
    this.paint();
  }

  /** The finger that held and dragged lifted: the mark is final and the menu comes up. */
  lift(): void {
    this.setInert(false);
    this.toggleMenu();
  }

  /** A tap inside the mark. Native owns whether the menu is up (iOS can dismiss it itself): it shows over the mark or, if showing, hides. */
  toggleMenu(): void {
    const box = this.state && boxOf(this.deps.page.rectsOf(this.state.range));
    if (box) this.deps.editMenu()?.({ x: box.x, y: box.y, width: box.width, height: box.height });
  }

  clear(): void {
    if (!this.state) return;
    this.state = null;
    this.places = null;
    this.grabbed = null;
    this.unwatch?.();
    this.unwatch = null;
    CSS.highlights.delete("tsel");
    this.hideMenu();
    this.setInert(false);
    if (this.handles) for (const end of ENDS) this.handles[end].hidden = true;
  }

  private paint(): void {
    const { state } = this;
    if (!state) return;
    CSS.highlights.set("tsel", new Highlight(state.range));
    this.placeHandles(state.range);
  }

  private hideMenu(): void {
    this.deps.editMenu()?.(null);
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
    return at && this.deps.page.holds(at.startContainer) ? at : null;
  }

  // The handles (selection-look.md). Each stands on the first or last rect's outer edge, and is dragged by
  // the vector from the finger to its text point, so it doesn't jump on grab and the finger never covers
  // the character being chosen.

  private placeHandles(range: Range): void {
    const rects = this.deps.page.rectsOf(range).filter((r) => r.width > 0);
    const first = rects[0];
    const last = rects.at(-1);
    if (!first || !last) return;
    const handles = this.ensureHandles();
    const layer = this.deps.layer();
    const host = layer.getBoundingClientRect();
    const place = (end: End, x: number, rect: DOMRect): Place => {
      const element = handles[end];
      if (element.parentElement !== layer) layer.append(element);
      element.hidden = rect.bottom < host.top || rect.top > host.bottom; // a row scrolled out of the surface
      element.style.left = `${String(x - host.left)}px`;
      element.style.top = `${String(rect.top - host.top)}px`;
      element.style.height = `${String(rect.height)}px`;
      return { knob: { x, y: end === "start" ? rect.top - KNOB_OFFSET : rect.bottom + KNOB_OFFSET }, text: { x, y: rect.top + rect.height / 2 } };
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
    const { places } = this;
    if (!finger || !places || this.grabbed) return;
    // Two short marks' hit areas overlap: of the handles whose area holds the touch, the nearer knob takes it.
    const near = (e: End): number => Math.hypot(finger.clientX - places[e].knob.x, finger.clientY - places[e].knob.y);
    const other: End = end === "start" ? "end" : "start";
    const chosen = near(other) < near(end) && Math.abs(finger.clientX - places[other].knob.x) <= HIT && Math.abs(finger.clientY - places[other].knob.y) <= HIT ? other : end;
    const { text } = places[chosen];
    this.grabbed = { end: chosen, touch: finger.identifier, dx: text.x - finger.clientX, dy: text.y - finger.clientY };
    this.setInert(true);
    this.hideMenu();
  }

  private drag(event: TouchEvent): void {
    event.preventDefault();
    const { grabbed, state } = this;
    if (!grabbed || !state) return;
    const finger = [...event.changedTouches].find((t) => t.identifier === grabbed.touch);
    if (!finger) return;
    const at = this.caretAt(finger.clientX + grabbed.dx, finger.clientY + grabbed.dy);
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
      this.paint();
      return;
    }
    state.range = range;
    this.paint();
  }

  private drop(event: TouchEvent): void {
    event.preventDefault();
    if (!this.grabbed || ![...event.changedTouches].some((t) => t.identifier === this.grabbed?.touch)) return;
    this.grabbed = null;
    this.lift();
  }

  private setInert(on: boolean): void {
    for (const end of ENDS) this.handles?.[end].toggleAttribute("data-inert", on);
  }
}
