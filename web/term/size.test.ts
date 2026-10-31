import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Viewport } from "../platform/types";
import { TerminalSizer, terminalBottomPan } from "./size";

const cell = { width: 7, height: 15 };
const vp = (over: Partial<Viewport> = {}): Viewport => ({
  layout: "phone",
  density: "touch",
  directInput: "owned",
  scheme: "dark",
  width: 393,
  stableHeight: 852,
  visibleHeight: 852,
  keyboardInset: 0,
  safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
  keyboard: false,
  ...over,
});
const chrome = { x: 0, y: 52 };
const key = (s: { cols: number; rows: number }): string => `${String(s.cols)}x${String(s.rows)}`;

describe("TerminalSizer", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function setup(measured: typeof cell | null = cell) {
    const changes: string[] = [];
    let current = measured;
    const sizer = new TerminalSizer({ cell: () => current, onChange: (s) => changes.push(key(s)) });
    return { sizer, changes, setCell: (c: typeof cell) => { current = c; } };
  }

  it("knows no size until the viewport, the chrome and the cell are all known", () => {
    const { sizer } = setup(null);
    expect(sizer.measured).toBe(false);
    sizer.setViewport(vp());
    sizer.setChrome(chrome);
    expect(sizer.measured).toBe(false);
  });

  it("hands the first size to the first watch and sends only later changes, after they settle", () => {
    const { sizer, changes } = setup();
    sizer.setViewport(vp());
    sizer.setChrome(chrome);
    expect(key(sizer.sizeForWatch())).toBe("56x47");
    vi.advanceTimersByTime(500);
    expect(changes).toEqual([]);
    sizer.setViewport(vp({ width: 852, stableHeight: 393, safeArea: { top: 0, right: 59, bottom: 21, left: 59 } }));
    vi.advanceTimersByTime(149);
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(changes).toEqual(["104x21"]);
  });

  it("never resizes for the keyboard: it changes none of the inputs", () => {
    const { sizer, changes } = setup();
    sizer.setViewport(vp());
    sizer.setChrome(chrome);
    sizer.sizeForWatch();
    sizer.setViewport(vp({ visibleHeight: 400, keyboard: true }));
    sizer.setViewport(vp());
    vi.advanceTimersByTime(500);
    expect(changes).toEqual([]);
  });
});

describe("terminalBottomPan", () => {
  // 45 rows of 15 px = 675 px of terminal.
  it.each([
    [44, 675, 0], // every row fits: stays put
    [44, 300, 375], // last row: everything above slides
    [30, 300, 375], // parked cursor, footer rows stay visible
    [20, 300, 15], // cursor stays at the bottom instead
    [5, 300, 0], // cursor near the top: no slide
    [60, 300, 375], // never slides past the last row
  ])("cursor row %i in a %i px box slides %i px", (row, box, slide) => {
    expect(terminalBottomPan(row, 45, 15, box)).toBe(slide);
  });
});
