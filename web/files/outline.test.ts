import { describe, expect, it } from "vitest";
import type { Entry, Listing } from "./api";
import { move, narrow, outline, UP, type OutlineInput } from "./outline";

const dir = (name: string): Entry => ({ name, kind: "dir", link: false });
const file = (name: string): Entry => ({ name, kind: "file", link: false, size: 1 });
const listing = (path: string, entries: Entry[], total = entries.length, truncated = false): Listing => ({ path, parent: null, total, offset: 0, truncated, entries });

const held = (map: Record<string, Listing>) => (path: string): Listing | null => map[path] ?? null;
const base = (map: Record<string, Listing>, over: Partial<OutlineInput> = {}): OutlineInput => ({ root: "/r", parent: "/", expanded: new Set(), held: held(map), filter: "", selection: null, ...over });

describe("outline", () => {
  const tree = { "/r": listing("/r", [dir("src"), dir("docs"), file("a.md"), file("Readme.md")]), "/r/src": listing("/r/src", [file("main.rs"), file("lib.rs")], 5) };

  it("lists the root flat with an up row, and nothing held yields no rows but the up row", () => {
    expect(outline(base(tree)).rows.map((r) => [r.key, r.depth])).toEqual([[UP, 0], ["/r/src", 0], ["/r/docs", 0], ["/r/a.md", 0], ["/r/Readme.md", 0]]);
    expect(outline(base({})).rows.map((r) => r.key)).toEqual([UP]);
    expect(outline(base(tree, { parent: null })).rows[0]?.key).toBe("/r/src");
  });

  it("draws an expanded folder's held rows below it and says how much of it is held", () => {
    const out = outline(base(tree, { expanded: new Set(["/r/src", "/r/docs"]) }));
    expect(out.rows.map((r) => [r.name, r.depth, r.loaded])).toEqual([["..", 0, "none"], ["src", 0, "some"], ["main.rs", 1, "none"], ["lib.rs", 1, "none"], ["docs", 0, "none"], ["a.md", 0, "none"], ["Readme.md", 0, "none"]]);
    expect(out.rootLoaded).toBe("all");
    expect(outline(base({ "/r": listing("/r", [file("a")], 9) })).rootLoaded).toBe("some");
    expect(outline(base({ "/r": listing("/r", [file("a")], 1, true) })).rootLoaded).toBe("some");
  });

  it("narrows the root's folders and files, names starting with the text first, then names holding it", () => {
    const names = narrow([dir("src"), file("cursor.md"), file("Source.md"), file("x")], "SO").map((e) => e.name);
    expect(names).toEqual(["Source.md", "cursor.md"]);
    expect(narrow([file("a-doc"), file("doc"), dir("my-docs")], "doc").map((e) => e.name)).toEqual(["doc", "a-doc", "my-docs"]);
    // the name typed whole comes first, even after names that only start with it
    expect(narrow([dir("docs-old"), file("docs")], "docs").map((e) => e.name)).toEqual(["docs", "docs-old"]);
    // with a filter and no selection, Enter has a first match; the up row never is one
    const out = outline(base(tree, { filter: "a" }));
    expect(out.selected).toBe("/r/a.md");
    expect(outline(base(tree, { filter: "a", selection: "/r/Readme.md" })).selected).toBe("/r/Readme.md");
    expect(outline(base(tree)).selected).toBeNull();
  });

  it("keeps a selection that is no longer a row from naming one", () => {
    expect(outline(base(tree, { selection: "/r/gone" })).selected).toBeNull();
  });
});

describe("move", () => {
  const rows = outline({ ...base({ "/r": listing("/r", [dir("src"), dir("docs"), file("a")]), "/r/src": listing("/r/src", [dir("deep"), file("m")]), "/r/src/deep": listing("/r/src/deep", [file("z")]) }), expanded: new Set(["/r/src", "/r/src/deep"]) }).rows;

  it("steps one row and stops at the ends; from nothing, down is the first and up the last", () => {
    expect(move(rows, null, "down").selection).toBe(UP);
    expect(move(rows, null, "up").selection).toBe("/r/a");
    expect(move(rows, "/r/a", "down").selection).toBe("/r/a");
    expect(move(rows, UP, "up").selection).toBe(UP);
    expect(move(rows, "/r/src", "down").selection).toBe("/r/src/deep");
    expect(move(rows, "/r/src", "first").selection).toBe(UP);
    expect(move(rows, "/r/src", "last").selection).toBe("/r/a");
  });

  it("right opens a closed folder, steps into an open one; left closes an open one, else steps to the holding folder", () => {
    expect(move(rows, "/r/docs", "right")).toEqual({ selection: "/r/docs", expand: "/r/docs" });
    expect(move(rows, "/r/src", "right").selection).toBe("/r/src/deep");
    expect(move(rows, "/r/a", "right").selection).toBe("/r/a");
    expect(move(rows, "/r/src", "left")).toEqual({ selection: "/r/src", collapse: "/r/src" });
    expect(move(rows, "/r/src/deep/z", "left").selection).toBe("/r/src/deep");
    expect(move(rows, "/r/src/m", "parent").selection).toBe("/r/src");
    expect(move(rows, "/r/docs", "left").selection).toBe("/r/docs");
  });
});
