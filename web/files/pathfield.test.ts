import { describe, expect, it } from "vitest";
import type { Entry, Listing } from "./api";
import { folderKey, type Held } from "./folders";
import { enter, fieldView, parseTyped, type FieldContext } from "./pathfield";
import { HttpRefusal } from "../net/http";

const dir = (name: string): Entry => ({ name, kind: "dir", link: false });
const file = (name: string): Entry => ({ name, kind: "file", link: false, size: 1 });
const listing = (path: string, entries: Entry[], total = entries.length): Listing => ({ path, parent: null, total, offset: 0, truncated: false, entries });
const record = (l: Listing | null, over: Partial<Held> = {}): Held => ({ listing: l, loading: false, error: null, ...over });

/** The listings held, by `path` (hidden=0 unless the key says otherwise). */
function ctxOf(held: Record<string, Held>, showHidden = false): FieldContext {
  return { home: "/home/j", showHidden, held: (key) => held[key] };
}
const at = (path: string, h: Held, hidden = false): Record<string, Held> => ({ [folderKey(path, hidden)]: h });

const repos = ctxOf({
  ...at("/home/j/repos", record(listing("/home/j/repos", [dir("many"), dir("muxen"), dir("muxen-old"), dir("Zed"), file("notes.txt"), file("a-muxen.md")]))),
  ...at("/home/j/big", record(listing("/home/j/big", [dir("alpha"), file("f1")], 400))),
});

describe("parseTyped", () => {
  it("splits at the last slash and resolves ~, . and ..; it is no path without a ~ or / start", () => {
    expect(parseTyped("~/repos/te", "/home/j")).toEqual({ prefix: "~/repos/", segment: "te", parent: "/home/j/repos", named: "/home/j/repos/te" });
    expect(parseTyped("~", "/home/j")).toMatchObject({ prefix: "~/", segment: "", parent: "/home/j" });
    expect(parseTyped("~/repos/../other/./x", "/home/j")).toMatchObject({ parent: "/home/j/other", segment: "x" });
    expect(parseTyped("/srv/", "/home/j")).toMatchObject({ prefix: "/srv/", segment: "", parent: "/srv", named: "/srv" });
    expect(parseTyped("/..", "/home/j")).toMatchObject({ parent: "/", named: "/" });
    for (const text of ["repos", "~repos/", ""]) expect(parseTyped(text, "/home/j")).toBeNull();
  });
});

describe("fieldView", () => {
  it("narrows the typed folder's folders and files, starts-with first then contains, case folded", () => {
    const v = fieldView("~/repos/mu", repos, null);
    expect(v.out.rows.filter((r) => r.kind !== "up").map((r) => r.name)).toEqual(["muxen", "muxen-old", "a-muxen.md"]);
    expect(v.out.selected).toBe("/home/j/repos/muxen");
    expect(fieldView("~/repos/z", repos, null).out.rows.map((r) => r.name)).toEqual(["..", "Zed"]);
    // an empty segment lists everything and selects nothing
    const all = fieldView("~/repos/", repos, null);
    expect(all.out.rows).toHaveLength(7);
    expect(all.out.selected).toBeNull();
  });

  it("asks for the typed parent, with hidden files when the name starts with a dot; the up row steps the text up", () => {
    expect(fieldView("~/repos/mu", repos, null).ask).toEqual({ path: "/home/j/repos", hidden: false });
    expect(fieldView("~/repos/.g", repos, null)).toMatchObject({ ask: { path: "/home/j/repos", hidden: true }, up: "~/" });
    expect(fieldView("/srv/x", repos, null)).toMatchObject({ up: "/" });
    expect(fieldView("/x", repos, null).up).toBeNull();
    expect(fieldView("repos", repos, null)).toMatchObject({ typed: null, ask: null });
  });

  it("says when the folder is not held in full, so its matches come from the pages loaded", () => {
    expect(fieldView("~/big/f", repos, null).out.rootLoaded).toBe("some");
    expect(fieldView("~/repos/f", repos, null).out.rootLoaded).toBe("all");
    expect(fieldView("~/nowhere/", repos, null).out.rootLoaded).toBe("none");
  });
});

describe("enter", () => {
  const go = (text: string, ctx = repos, selection: string | null = null) => enter(fieldView(text, ctx, selection), "/home/j");

  it("opens the first match, a file as a file and a folder as a folder; the arrow-picked row wins", () => {
    expect(go("~/repos/mux")).toEqual({ open: { kind: "dir", path: "/home/j/repos/muxen" } });
    expect(go("~/repos/not")).toEqual({ open: { kind: "file", path: "/home/j/repos/notes.txt" } });
    expect(go("~/repos/mux", repos, "/home/j/repos/a-muxen.md")).toEqual({ open: { kind: "file", path: "/home/j/repos/a-muxen.md" } });
    expect(go("~/repos/mux", repos, "..")).toEqual({ up: "~/" });
  });

  it("opens the folder a trailing slash or dots name, and says when a held folder has no such name", () => {
    expect(go("~/repos/")).toEqual({ open: { kind: "dir", path: "/home/j/repos" } });
    expect(go("~/repos/..")).toEqual({ open: { kind: "dir", path: "/home/j" } });
    expect(go("~/repos/nothing")).toEqual({ say: "Nothing named nothing in ~/repos" });
    expect(go("repos")).toEqual({ say: "Start with ~ or /" });
  });

  it("asks the host about a name that may be on an unloaded page, waits for a listing not held, and leaves a refusal to the list", () => {
    expect(go("~/big/zzz")).toEqual({ resolve: "/home/j/big/zzz" });
    expect(go("~/other/x")).toEqual({ wait: true });
    const refused = ctxOf(at("/home/j/other", record(null, { error: new HttpRefusal(403, "denied") })));
    expect(go("~/other/x", refused)).toEqual({ say: null });
  });
});
