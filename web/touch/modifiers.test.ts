import { describe, expect, it } from "vitest";
import { apply } from "./modifiers";

describe("apply", () => {
  it.each([
    ["ctrl", [{ text: "c" }], [{ key: "C-c" }]],
    ["ctrl", [{ text: "C" }], [{ key: "C-c" }]], // a capital typed by accident still makes Ctrl-C
    ["alt", [{ text: "B" }], [{ key: "M-B" }]], // armed alt keeps the case
    ["alt", [{ text: "b" }], [{ key: "M-b" }]],
    ["alt", [{ text: " " }], [{ key: "M-Space" }]],
    ["ctrl", [{ key: "Up" }, { text: "x" }], [{ key: "C-Up" }, { text: "x" }]], // a named key, the rest of the batch left alone
    ["ctrl", [{ text: "[" }], [{ bytes: btoa("\x1b") }]], // punctuation as the control byte
    ["ctrl", [{ text: "/" }], [{ bytes: btoa("\x1f") }]],
    ["alt", [{ text: "." }], [{ bytes: btoa("\x1b.") }]], // ESC and the character
  ] as const)("armed %s turns %j into its chord and disarms", (armed, events, chorded) => {
    expect(apply(armed, [...events])).toEqual({ events: chorded, armed: null });
  });

  it("changes nothing while nothing is armed, and only disarms for what has no chord", () => {
    const plain = [{ text: "c" }];
    expect(apply(null, plain)).toEqual({ events: plain, armed: null });
    for (const events of [[{ text: "ab" }], [{ text: "." }], [{ paste: "x" }], [{ key: "F1" }]]) {
      const result = apply("ctrl", events);
      expect(result.armed).toBeNull();
      expect(result.events).toBe(events);
    }
  });
});
