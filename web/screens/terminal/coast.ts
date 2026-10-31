// Whether something other than muxen is moving the row list (touch-rows design.md, "Scrolling"): a finger holds the
// view, or the view coasts after one lifted. Writes to `scrollTop` and drops of rows wait for it to be over.

/** A scroll event this long after the last one with no finger down is no longer a coast. */
const QUIET_MS = 100;

export class Coast {
  /** The touch layer's word that a gesture holds the view. */
  private held = false;
  /** The user's scroll is still moving with no finger down: a `scroll` event after the finger lifted, until it falls quiet. */
  private flinging = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** `onRest` runs once nothing holds the view and it has been quiet. */
  constructor(private readonly onRest: () => void) {}

  get coasting(): boolean {
    return this.flinging;
  }

  /** A finger or a fling is moving the view. */
  get moving(): boolean {
    return this.held || this.flinging;
  }

  hold(held: boolean): void {
    if (held === this.held) return;
    this.held = held;
    if (!held) this.settle();
  }

  /** A scroll event that was not muxen's own. */
  scrolled(): void {
    if (this.held) return;
    this.flinging = true;
    this.settle();
  }

  private settle(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.flinging = false;
      if (!this.held) this.onRest();
    }, QUIET_MS);
  }
}
