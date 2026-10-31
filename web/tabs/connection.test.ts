import { describe, expect, it } from "vitest";
import { backoffMs, initialState, reduce, type ConnectionEvent, type ConnectionState } from "./connection";

const run = (events: ConnectionEvent[], from: ConnectionState = initialState): ConnectionState =>
  events.reduce(reduce, from);
const lostMid = { type: "linkLost", retryInMs: 500 } as const;

describe("backoffMs", () => {
  it("doubles from 0.5 s and caps at 30 s, jittering within ±20% and never past the cap", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 20].map((a) => backoffMs(a, 0.5))).toEqual([
      500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
    expect(backoffMs(2, 0)).toBe(1600);
    expect(backoffMs(2, 0.999)).toBeLessThanOrEqual(2400);
    expect(backoffMs(9, 0.999)).toBe(30000);
  });
});

describe("tab connection", () => {
  it("a stale timer after a nudge changes nothing", () => {
    const s = run([lostMid, { type: "nudge" }, { type: "retry" }]);
    expect(s).toEqual({ kind: "connecting", attempt: 0 });
  });

  it("closes only on window/server closure or the user, from any state, and stays closed; network loss never closes a tab", () => {
    for (const from of [initialState, run([{ type: "bound" }]), run([lostMid])]) {
      expect(reduce(from, { type: "sessionClosed" })).toEqual({ kind: "closed", reason: "sessionClosed" });
      expect(reduce(from, { type: "serverExited" })).toEqual({ kind: "closed", reason: "serverExited" });
      expect(reduce(from, { type: "userClosed" })).toEqual({ kind: "closed", reason: "user" });
    }
    const closed = run([{ type: "sessionClosed" }]);
    expect(run([{ type: "bound" }, lostMid, { type: "nudge" }], closed)).toBe(closed);
    const lossy = run(Array.from({ length: 50 }, () => [lostMid, { type: "retry" }] as const).flat());
    expect(lossy.kind).not.toBe("closed");
  });
});
