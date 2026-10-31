import { describe, expect, it } from "vitest";
import { apply, toggle } from "./modifiers";

describe("toggle", () => {
  it("arms, disarms on a second tap, and switches to the other key", () => {
    expect(toggle(null, "ctrl")).toBe("ctrl");
    expect(toggle("ctrl", "ctrl")).toBeNull();
    expect(toggle("ctrl", "alt")).toBe("alt");
  });
});

describe("apply", () => {
  it("changes nothing while nothing is armed", () => {
    const events = [{ text: "c" }];
    expect(apply(null, events)).toEqual({ events, armed: null });
  });

  it("turns the next character into its chord and disarms", () => {
    expect(apply("ctrl", [{ text: "c" }])).toEqual({ events: [{ key: "C-c" }], armed: null });
    // A capital typed by accident still makes Ctrl-C; an armed alt keeps the case.
    expect(apply("ctrl", [{ text: "C" }])).toEqual({ events: [{ key: "C-c" }], armed: null });
    expect(apply("alt", [{ text: "B" }])).toEqual({ events: [{ key: "M-B" }], armed: null });
    expect(apply("alt", [{ text: "b" }])).toEqual({ events: [{ key: "M-b" }], armed: null });
    expect(apply("alt", [{ text: " " }])).toEqual({ events: [{ key: "M-Space" }], armed: null });
  });

  it("chords a named key and leaves the rest of the batch", () => {
    expect(apply("ctrl", [{ key: "Up" }, { text: "x" }])).toEqual({ events: [{ key: "C-Up" }, { text: "x" }], armed: null });
  });

  it("sends armed Ctrl on punctuation as its control byte and armed Alt as ESC and the character", () => {
    expect(apply("ctrl", [{ text: "[" }])).toEqual({ events: [{ bytes: btoa("\x1b") }], armed: null });
    expect(apply("ctrl", [{ text: "/" }])).toEqual({ events: [{ bytes: btoa("\x1f") }], armed: null });
    expect(apply("alt", [{ text: "." }])).toEqual({ events: [{ bytes: btoa("\x1b.") }], armed: null });
  });

  it("only disarms for what has no chord: a multi-character insert, punctuation, a paste", () => {
    for (const events of [[{ text: "ab" }], [{ text: "." }], [{ paste: "x" }], [{ key: "F1" }]]) {
      const result = apply("ctrl", events);
      expect(result.armed).toBeNull();
      expect(result.events).toBe(events);
    }
  });
});
