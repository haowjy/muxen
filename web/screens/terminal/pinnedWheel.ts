// A swipe on a pinned terminal (a full-screen or mouse-aware application, which owns its scrolling): wheel events
// for an application that asked for the mouse, else ↑/↓. The finger's distance becomes whole rows and a release
// coasts on with `Momentum`. Touch-only: a desktop wheel coasts by itself.
import type { InputEvent } from "../../platform/types";
import type { CellPosition, CellSize, TerminalModel } from "../../term";
import { mouseInput } from "../../term/mouse";
import { Momentum } from "../../touch/momentum";

/** Wheel events or arrows sent in one frame at most, so a hard flick never floods the pane. */
const MAX_EVENTS_PER_FRAME = 4;

interface PinnedWheelDeps {
  model(): TerminalModel | null;
  cell(): CellSize | null;
  /** Typed input for the tab this view is showing. */
  send(events: InputEvent[]): void;
}

export class PinnedWheel {
  private remainder = 0;
  private momentum: Momentum | null = null;
  private frame = 0;
  private last = 0;
  /** Where the gesture began, for a wheel event's cell. */
  private anchor: CellPosition = { col: 0, row: 0 };
  /** The cell, measured when a gesture begins: a frame of momentum measures nothing. */
  private cell: CellSize | null = null;

  constructor(private readonly deps: PinnedWheelDeps) {}

  /** Whether the terminal is pinned: swipes are the application's. */
  get active(): boolean {
    return this.deps.model()?.pinned() ?? false;
  }

  /** Whether a fling is still coasting. */
  get coasting(): boolean {
    return this.momentum !== null;
  }

  begin(anchor: CellPosition | null): void {
    this.stop();
    this.remainder = 0;
    this.cell = this.deps.cell();
    if (anchor) this.anchor = anchor;
  }

  /** The finger moved `dy` px downward. */
  by(dy: number): void {
    this.send(dy, Infinity);
  }

  /** The finger lifted at `velocity` px/s downward: coast. */
  release(velocity: number): void {
    const momentum = new Momentum(velocity);
    if (momentum.done) return;
    this.momentum = momentum;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.momentum = null;
  }

  private readonly tick = (now: number): void => {
    const momentum = this.momentum;
    if (!momentum) return;
    this.send(momentum.step(now - this.last), MAX_EVENTS_PER_FRAME);
    this.last = now;
    if (momentum.done) this.momentum = null;
    else this.frame = requestAnimationFrame(this.tick);
  };

  /** Wheel events (or arrows) for `dy` px, at most `cap` rows' worth. */
  private send(dy: number, cap: number): void {
    const model = this.deps.model();
    const cell = this.cell;
    if (!model || !cell) return;
    this.remainder += dy;
    let rows = Math.trunc(this.remainder / cell.height);
    this.remainder -= rows * cell.height;
    if (rows === 0) return;
    const up = rows > 0; // the finger moved down: older content, the wheel turns up
    rows = Math.min(Math.abs(rows), cap);
    const events = mouseInput(up ? "wheelUp" : "wheelDown", this.anchor.col, this.anchor.row, model.mouseMode(), model.mouseEncoding()) ?? [{ key: up ? "Up" : "Down" }];
    this.deps.send(Array.from({ length: rows }, () => events).flat());
  }
}
