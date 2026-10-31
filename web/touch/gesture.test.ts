import { describe, expect, it } from "vitest";
import { GestureRecognizer, type GestureAction } from "./gesture";

/** Drives a recognizer with a clock; the shell's timer is `tickTo`. */
function rig() {
  const r = new GestureRecognizer();
  let now = 0;
  const out: GestureAction[] = [];
  const take = (actions: GestureAction[]): GestureAction[] => { out.push(...actions); return actions; };
  return {
    out,
    get now() { return now; },
    down: (x: number, y: number, id = 1) => take(r.down(id, x, y, now)),
    move: (x: number, y: number, id = 1) => take(r.move(id, x, y, now)),
    up: (id = 1) => take(r.up(id, now)),
    cancel: () => take(r.cancel()),
    /** Advance the clock by `ms`, firing every deadline on the way. */
    wait: (ms: number) => {
      const end = now + ms;
      for (let d = r.deadline; d !== null && d <= end; d = r.deadline) {
        now = d;
        take(r.advance(now));
      }
      now = end;
    },
    r,
  };
}

describe("GestureRecognizer", () => {
  it("a press released before the long-press, unmoved, is a tap where it began", () => {
    const g = rig();
    g.down(40, 60);
    g.wait(120);
    g.move(43, 62); // inside the slop
    g.up();
    expect(g.out).toEqual([{ type: "tap", x: 40, y: 60 }]);
  });

  it("a hold fires the long-press; the finger then drags the selection, and lifting ends it", () => {
    const g = rig();
    g.down(40, 60);
    g.wait(400);
    g.move(44, 63);
    g.move(200, 300); // far past the slop: still the selection, never a scroll
    g.up();
    expect(g.out).toEqual([
      { type: "longPress", x: 40, y: 60 },
      { type: "selectMove", x: 44, y: 63 },
      { type: "selectMove", x: 200, y: 300 },
      { type: "selectEnd" },
    ]);
  });

  it("a fast release carries its velocity; a finger that paused before lifting has none", () => {
    const flick = rig();
    flick.down(100, 400);
    for (let y = 400; y >= 300; y -= 10) {
      flick.wait(8);
      flick.move(100, y);
    }
    flick.up();
    const end = flick.out.at(-1);
    expect(end).toMatchObject({ type: "scrollEnd" });
    expect((end as { velocity: number }).velocity).toBeLessThan(-800);

    const paused = rig();
    paused.down(100, 400);
    for (let y = 400; y >= 300; y -= 10) {
      paused.wait(8);
      paused.move(100, y);
    }
    paused.wait(300);
    paused.up();
    expect(paused.out.at(-1)).toEqual({ type: "scrollEnd", velocity: 0 });
  });

  it("pointercancel sends nothing but ends what was running", () => {
    const pending = rig();
    pending.down(1, 1);
    pending.cancel();
    pending.wait(1000);
    expect(pending.out).toEqual([{ type: "cancel" }]);

    const held = rig();
    held.down(100, 100);
    held.wait(400);
    held.move(100, 150);
    held.cancel();
    expect(held.out.at(-1)).toEqual({ type: "cancel" });
    expect(held.out.some((a) => a.type === "selectEnd")).toBe(false);
  });

  it("a second finger cancels the first and resolves nothing until both lift", () => {
    const g = rig();
    g.down(10, 10, 1);
    g.down(200, 10, 2);
    g.wait(800);
    g.up(1);
    g.up(2);
    expect(g.out).toEqual([{ type: "cancel" }]);
    g.down(5, 5, 3);
    g.up(3);
    expect(g.out.at(-1)).toEqual({ type: "tap", x: 5, y: 5 });
  });
});
