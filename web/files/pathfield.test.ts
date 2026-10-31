import { describe, expect, it } from "vitest";
import { HttpRefusal } from "../net/http";
import { accept, complete, folderKey, go, parseTyped, slashAccepts, type CompleteContext, type FolderState } from "./pathfield";

const ready = (names: string[], capped = false): FolderState => ({ status: "ready", names, capped });

/** The listings held, by `path` (hidden=0 unless the key says otherwise). */
function ctxOf(held: Record<string, FolderState>, showHidden = false): CompleteContext {
  return { home: "/home/j", showHidden, folder: (key) => held[key] };
}
const at = (path: string, state: FolderState, hidden = false): Record<string, FolderState> => ({ [folderKey(path, hidden)]: state });

const repos = ctxOf({
  ...at("/home/j/repos", ready(["many", "muxen", "muxen-old", "muxer", "Zed"])),
  ...at("/home/j/repos/muxen", ready(["src", "web"])),
  ...at("/home/j", ready(["repos", "other"])),
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

describe("complete", () => {
  it("lists the parent's folders that start with the segment, case folded, and predicts the first; an empty segment lists every folder and predicts none", () => {
    const c = complete("~/repos/mu", repos);
    expect(c.rows.map((r) => r.name)).toEqual(["muxen", "muxen-old", "muxer"]);
    expect(c.predicted?.name).toBe("muxen");
    expect(c.ghost).toBe("xen/");
    expect(complete("~/repos/z", repos).rows.map((r) => r.name)).toEqual(["Zed"]);
    const all = complete("~/repos/", repos);
    expect(all.rows).toHaveLength(5);
    expect(all.predicted).toBeNull();
    expect(all.ghost).toBe("");
  });

  it("asks for the typed parent, hidden only for a dot segment or the toggle, and only until it is held", () => {
    const none = ctxOf({});
    expect(complete("~/repos/te", none).ask).toEqual({ path: "/home/j/repos", hidden: false });
    expect(complete("~/repos/.g", none).ask).toEqual({ path: "/home/j/repos", hidden: true });
    expect(complete("~/repos/te", ctxOf({}, true)).ask).toEqual({ path: "/home/j/repos", hidden: true });
    // A held hidden listing is a different cache entry.
    expect(complete("~/repos/.g", repos).rows).toEqual([]);
  });
});

describe("accept and slash", () => {
  it("accept puts the full path and a slash; a slash accepts the prediction only after a partial name that is not . or ..", () => {
    const typed = parseTyped("~/repos/mu", "/home/j");
    expect(typed && accept(typed, "muxen")).toBe("~/repos/muxen/");
    expect(slashAccepts("~/repos/mu", repos)).toBe("~/repos/muxen/");
    expect(slashAccepts("~/re", repos)).toBe("~/repos/");
    const hidden = ctxOf({ ...at("/home/j/repos/muxen", ready([".git", "src"]), true) });
    expect(slashAccepts("~/repos/muxen/.", hidden)).toBeNull();
    expect(slashAccepts("~/repos/muxen/..", hidden)).toBeNull();
    expect(slashAccepts("~/repos/muxen/.g", hidden)).toBe("~/repos/muxen/.git/");
    expect(slashAccepts("~/repos/muxen", repos)).toBeNull();
    expect(slashAccepts("~/repos/", repos)).toBeNull();
    expect(slashAccepts("~/repos/qq", repos)).toBeNull();
  });
});

describe("go", () => {
  const missing: FolderState = { status: "error", error: new HttpRefusal(404, "not_found") };
  const denied: FolderState = { status: "error", error: new HttpRefusal(403, "denied") };
  const highlighted = complete("~/repos/mu", repos).predicted;
  it.each([
    ["the highlighted row", "~/repos/mu", highlighted, repos, { open: "/home/j/repos/muxen" }],
    ["the folder the text names, right after an accept too", "~/repos/muxen/", null, repos, { open: "/home/j/repos/muxen" }],
    ["a folder named without the slash", "~/repos/many", null, repos, { open: "/home/j/repos/many" }],
    ["a folder named whole without waiting for a listing", "~/repos/muxen/", null, ctxOf({}), { open: "/home/j/repos/muxen" }],
    ["a folder past the scan cap that the list lacks", "~/repos/zzz", null, ctxOf(at("/home/j/repos", ready(["a"], true))), { open: "/home/j/repos/zzz" }],
    ["the parent for a trailing ..", "~/repos/muxen/..", null, repos, { open: "/home/j/repos" }],
    ["any folder", "/", null, repos, { open: "/" }],
    ["any folder, with no listing", "/srv/", null, ctxOf({}), { open: "/srv" }],
    ["says when the text names nothing", "~/repos/muxenx", null, repos, { say: "No folder ~/repos/muxenx" }],
    ["waits for a listing it has not got", "~/repos/muxen", null, ctxOf({}), { wait: true }],
    ["says a missing parent is no folder", "~/gone/", null, ctxOf(at("/home/j/gone", missing)), { say: "No folder ~/gone" }],
    ["leaves other refusals to the list", "~/x/", null, ctxOf(at("/home/j/x", denied)), { say: null }],
    ["says where a path must start", "repos", null, repos, { say: "Start with ~ or /" }],
  ])("%s", (_name, text, row, ctx, expected) => {
    expect(go(text, row, ctx)).toEqual(expected);
  });
});
