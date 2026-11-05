import { describe, expect, it } from "vitest";
import type { FilesPlace } from "../platform/types";
import type { Landing } from "../workspace/state";
import { Router, type HistoryPort, type Entry } from "./router";

const hashOf = (l: Landing): string => (l.route === "home" ? "#/" : `#/${l.route}`);

/** A browser's history: a list of entries and a cursor. `back` pops synchronously here. */
function fakeHistory(initialHash = "#/", initialState: unknown = null) {
  const entries: { state: unknown; hash: string }[] = [{ state: initialState, hash: initialHash }];
  let at = 0;
  let pop: (() => void) | undefined;
  const port: HistoryPort = {
    current: () => entries[at] as { state: unknown; hash: string },
    push(state, hash) { entries.splice(at + 1); entries.push({ state, hash }); at++; },
    replace(state, hash) { entries[at] = { state, hash }; },
    go(delta) { if (at + delta >= 0 && at + delta < entries.length) { at += delta; pop?.(); } },
    onPop(l) { pop = l; return () => { pop = undefined; }; },
  };
  return { port, entries, get at() { return at; } };
}

const dir = (path: string): FilesPlace => ({ kind: "dir", path });

/** `state.active` stands in for the last tab of workspace `w1`, the only one. */
function setup(hash = "#/") {
  const h = fakeHistory(hash);
  const state = { active: null as string | null };
  const router = new Router(h.port, (id) => (id === "w1" ? { last: state.active } : undefined), hashOf);
  const seen: Entry[] = [];
  router.subscribe((n) => seen.push(n));
  const open = (tab: string, place: FilesPlace | null = null): void => { state.active = tab; router.openTab("w1", tab, place); };
  return { h, router, seen, state, open, hashes: () => h.entries.slice(0, h.at + 1).map((e) => e.hash) };
}

describe("Router", () => {
  it("starts at Home, whatever the hash says, replacing the first entry", () => {
    const { router, h } = setup("#/tab");
    expect(router.entry).toMatchObject({ route: "home", overlay: null });
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0]?.hash).toBe("#/");
  });

  it("keeps file paths out of the URL", () => {
    const { router, open, hashes } = setup();
    open("f1", { kind: "dir", path: "~" });
    router.pushPlace("f1", { kind: "file", path: "/secret/path.txt" });
    expect(hashes()).toEqual(["#/", "#/tab", "#/tab"]);
  });

  it("Back walks out of the folders of the tab they were opened in, each entry recording its place", () => {
    const { router, open, h } = setup();
    open("f1", { kind: "dir", path: "~" });
    router.pushPlace("f1", dir("/a"));
    router.pushPlace("f1", { kind: "file", path: "/a/b" });
    const places: (FilesPlace | null)[] = [];
    router.subscribe((entry) => places.push(entry.route === "tab" ? entry.place : null));
    h.port.go(-1);
    h.port.go(-1);
    h.port.go(-1);
    expect(places).toEqual([dir("/a"), { kind: "dir", path: "~" }, null]);
    expect(router.entry.route).toBe("home");
  });

  it("switching tabs replaces the current entry, so Back returns to the place in the tab that is active", () => {
    const { router, state, open, h } = setup();
    open("f1", { kind: "dir", path: "~" });
    state.active = "f2"; // the controller switches tabs: the entry now names f2
    router.switchTab("f2", dir("/x"));
    expect(h.entries).toHaveLength(2);
    router.pushPlace("f2", dir("/x/y"));
    h.port.go(-1);
    expect(router.entry).toMatchObject({ tab: "f2", place: dir("/x") });
  });

  it("tabs switched under an open overlay stay as they are when it closes, by an action or by Back", () => {
    for (const close of [(r: Router) => { r.closeOverlay(); }, (_: Router, back: () => void) => { back(); }]) {
      const { router, state, open, h } = setup();
      open("t1");
      router.openOverlay({ screen: "sessions", name: "find" });
      state.active = "t2";
      router.switchTab("t2", null);
      expect(router.entry).toMatchObject({ tab: "t2", overlay: { screen: "sessions" } });
      close(router, () => { h.port.go(-1); });
      expect(router.entry).toMatchObject({ route: "tab", tab: "t2", overlay: null });
      expect(h.at).toBe(1);
      h.port.go(-1);
      expect(router.entry.route).toBe("home");
    }
  });

  it("a Back that lands on an entry of a tab that is not active skips to Home, announcing nothing", () => {
    const { router, state, seen, open, h } = setup();
    open("f1", { kind: "dir", path: "~" });
    router.pushPlace("f1", dir("/a"));
    state.active = "t1"; // the user switched tabs
    const before = seen.length;
    h.port.go(-1);
    expect(seen).toHaveLength(before + 1);
    expect(router.entry.route).toBe("home");
    expect(h.at).toBe(0);
  });

  it("an entry from before a reload whose tab is not active is replaced with Home", () => {
    const { router, open, h } = setup();
    open("f1", { kind: "dir", path: "~" });
    router.pushPlace("f1", dir("/a"));
    const after = new Router(h.port, () => undefined, hashOf); // a reload: a new stack, no tab active
    h.port.go(-1);
    expect(after.entry.route).toBe("home");
    // and an overlay cannot be popped to: a new Router starts at Home with no overlay
    expect(new Router(h.port, () => undefined, hashOf).entry.overlay).toBeNull();
  });

  it("runs what follows a close after the overlay is gone, or at once when none is open; closing every overlay is one history step", () => {
    const { router, h } = setup();
    const ran: (string | null)[] = [];
    router.closeOverlay(() => ran.push("none open"));
    router.openOverlay({ screen: "sessions", name: "find" });
    router.closeOverlay(() => ran.push(router.entry.overlay?.name ?? null));
    expect(ran).toEqual(["none open", null]);
    const at = h.at;
    router.openOverlay({ screen: "settings", name: "open" });
    router.openOverlay({ screen: "settings", name: "clearData" });
    expect(h.at).toBe(at + 2);
    router.closeAllOverlays();
    expect(router.entry.overlay).toBeNull();
    expect(h.at).toBe(at);
  });

  it("a tab is a level above Home: its ‹ and Back go to Home, and an empty workspace's overview is never a stop", () => {
    const { router, open, h } = setup();
    open("t1");
    expect(h.entries.map((e) => e.hash)).toEqual(["#/", "#/tab"]);
    router.toHome();
    expect(router.entry.route).toBe("home");
    expect(h.at).toBe(0);

    // A workspace with no tab opens on its overview; the tab opened there replaces it.
    const empty = setup();
    empty.router.toOverview("w1");
    empty.open("t1");
    expect(empty.hashes()).toEqual(["#/", "#/tab"]);
    empty.h.port.go(-1);
    expect(empty.router.entry.route).toBe("home");
  });

  it("a Files tab's in-app back goes back when the previous entry is that place in that tab, else replaces", () => {
    const { router, open, h } = setup();
    open("f1", { kind: "dir", path: "~" });
    router.pushPlace("f1", dir("/a"));
    router.pushPlace("f1", { kind: "file", path: "/a/b" });
    router.toPlace("f1", dir("/a"));
    expect(router.entry).toMatchObject({ place: dir("/a") });
    expect(h.at).toBe(2);
    router.toPlace("f1", dir("/"));
    expect(router.entry).toMatchObject({ place: dir("/") });
    expect(h.at).toBe(2);
  });
});
