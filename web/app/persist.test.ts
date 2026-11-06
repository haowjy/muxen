import { describe, expect, it } from "vitest";
import type { PlatformStorage, SavedWorkspaces } from "../platform/types";
import { parseSavedWorkspaces } from "../workspace/saved";
import { Persist } from "./persist";

function persistWith(reached: Record<string, number>) {
  const saved: SavedWorkspaces[] = [];
  const storage = { saveWorkspace: (ws: SavedWorkspaces) => saved.push(ws), clearLocalData: () => Promise.resolve() } as unknown as PlatformStorage;
  const persist = new Persist(storage, () => [], () => ({}), () => null, () => reached);
  return { persist, saved };
}

describe("last reached is saved with the workspace", () => {
  it("is written, and read back by the parser; a server never reached is not written", () => {
    const { persist, saved } = persistWith({ "h-pop": 1_700_000_000_000 });
    persist.save();
    expect(parseSavedWorkspaces(saved[0])?.reached).toEqual({ "h-pop": 1_700_000_000_000 });
    const none = persistWith({});
    none.persist.save();
    expect(none.saved[0]).not.toHaveProperty("reached");
    expect(parseSavedWorkspaces(none.saved[0])?.reached).toBeUndefined();
  });

  it("drops anything that is not a finite time when it reads", () => {
    const parsed = parseSavedWorkspaces({ version: 5, workspaces: [], reached: { a: 5, b: "x", c: null, d: Infinity } });
    expect(parsed?.reached).toEqual({ a: 5 });
  });
});
