import { describe, expect, it } from "vitest";
import type { ViewStore } from "../platform/types";
import { ViewMemory } from "./viewMemory";

function store(initial: Record<string, string> = {}): ViewStore {
  const map = new Map(Object.entries(initial));
  return { get: (k) => map.get(k) ?? null, set: (k, v) => { map.set(k, v); }, clear: () => { map.clear(); } };
}

describe("ViewMemory", () => {
  it("remembers a setting, and a missing or unreadable value is the default", () => {
    const memory = new ViewMemory(store());
    expect(memory.get("showHidden")).toBe(false);
    memory.set("showHidden", true);
    expect(memory.get("showHidden")).toBe(true);
    for (const stored of ["not json", '"yes"', "1", "null"]) expect(new ViewMemory(store({ showHidden: stored })).get("showHidden")).toBe(false);
  });
});
