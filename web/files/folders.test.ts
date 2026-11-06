import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFs, type FakeTree } from "../platform/test/fs";
import { Folders, MAX_ENTRIES, SETTLE_MS } from "./folders";

const many = (n: number): string[] => Array.from({ length: n }, (_, i) => `/home/j/repos/d${String(i).padStart(3, "0")}`);
const tree = (extra: string[] = []): FakeTree => ({
  home: "/home/j",
  dirs: ["/home/j", "/home/j/repos", "/home/j/repos/muxen", "/home/j/repos/muxen/web", "/home/j/up", ...extra],
  files: { "/home/j/repos/muxen/README.md": "text/markdown" },
});

function setup(extra: string[] = [], page = 3) {
  const fs = new FakeFs(tree(extra), page);
  return { fs, folders: new Folders(fs) };
}
const record = (f: Folders, path: string) => f.snapshot.held.get(`0${path}`);

describe("Folders", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("asks once typing settles, for the last folder only", async () => {
    const { fs, folders } = setup();
    folders.ask({ path: "/home/j", hidden: false });
    folders.ask({ path: "/home/j/repos", hidden: false });
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
    expect(fs.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(fs.calls).toEqual(["list /home/j/repos 0"]);
    expect(record(folders, "/home/j/repos")).toMatchObject({ loading: false, error: null });
    expect(folders.peek("/home/j/repos", false)?.entries.map((e) => e.name)).toEqual(["muxen"]);
  });

  it("does not ask again for a folder it holds or has under way", async () => {
    const { fs, folders } = setup();
    fs.hold = true;
    folders.ask({ path: "/home/j/repos", hidden: false });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    folders.ask({ path: "/home/j/repos", hidden: false });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(fs.calls).toHaveLength(1);
    fs.release();
    await vi.advanceTimersByTimeAsync(0);
    folders.ask({ path: "/home/j/repos", hidden: false });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(fs.calls).toHaveLength(1);
    // a settled waits for a fetch under way instead of asking again, and the pages are held until a refresh drops them
    fs.hold = true;
    const loading = folders.load("/home/j/repos/muxen", false);
    const taken = folders.settled("/home/j/repos/muxen", false);
    fs.release();
    await loading;
    expect(await taken).toMatchObject({ path: "/home/j/repos/muxen" });
    expect(folders.peek("/home/j/repos/muxen", false)).not.toBeNull();
    expect(folders.peek("/home/j/repos/muxen", true)).toBeNull();
    void folders.drop("/home/j/repos/muxen");
    expect(folders.peek("/home/j/repos/muxen", false)).toBeNull();
    expect(fs.calls).toHaveLength(2);
  });

  it("lists a folder's first page only for the field, and loads the rest page by page when asked, into the same record", async () => {
    const { fs, folders } = setup(many(5), 4);
    await folders.load("/home/j/repos", false);
    expect(fs.calls).toEqual(["list /home/j/repos 0"]);
    expect(folders.peek("/home/j/repos", false)?.entries).toHaveLength(4);
    await folders.rest("/home/j/repos", false);
    expect(fs.calls).toEqual(["list /home/j/repos 0", "list /home/j/repos 4"]);
    expect(folders.peek("/home/j/repos", false)?.entries).toHaveLength(6);
  });

  it("asks again for a folder whose listing failed for want of a connection, not for one that is missing", async () => {
    const { fs, folders } = setup();
    const ask = async (): Promise<void> => { folders.ask({ path: "/home/j/repos", hidden: false }); await vi.advanceTimersByTimeAsync(SETTLE_MS); };
    fs.offline = true;
    await ask();
    expect(record(folders, "/home/j/repos")).toMatchObject({ error: { code: "network" } });
    fs.offline = false;
    await ask();
    expect(record(folders, "/home/j/repos")).toMatchObject({ error: null, loading: false });
    folders.ask({ path: "/home/j/nope", hidden: false });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    folders.ask({ path: "/home/j/nope", hidden: false });
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(fs.calls.filter((c) => c.includes("nope"))).toHaveLength(1);
  });

  it("appends the next page to what is held, and not a page that was asked for before a refresh", async () => {
    const { fs, folders } = setup(many(5), 4);
    await folders.first("/home/j/repos", false);
    expect(folders.peek("/home/j/repos", false)?.entries).toHaveLength(4);
    await folders.more("/home/j/repos", false);
    expect(folders.peek("/home/j/repos", false)?.entries).toHaveLength(6);
    await folders.more("/home/j/repos", false); // nothing left: no request
    expect(fs.calls).toHaveLength(2);
    fs.hold = true;
    const late = folders.more("/home/j/repos", false);
    fs.hold = false;
    await folders.first("/home/j/repos", false);
    fs.release();
    await late;
    expect(folders.peek("/home/j/repos", false)?.entries).toHaveLength(4);
  });

  it("bounds what it holds by entries in all, least recently used first, and never drops a pinned folder", async () => {
    const kids = (dir: string): string[] => Array.from({ length: MAX_ENTRIES * 0.4 }, (_, i) => `${dir}/d${String(i)}`);
    const { folders } = setup([...["/a", "/b", "/c"].flatMap((d) => [d, ...kids(d)])], MAX_ENTRIES);
    await folders.first("/a", false);
    await folders.first("/b", false);
    folders.pin("place", [{ path: "/a", hidden: false }]);
    await folders.first("/c", false);
    // a is the oldest but pinned, so b goes; c, the one just loaded, stays
    expect(folders.peek("/a", false)).not.toBeNull();
    expect(folders.peek("/b", false)).toBeNull();
    expect(folders.peek("/c", false)).not.toBeNull();
    // a folder on screen is listed again in place, never removed
    void folders.drop("/a");
    expect(folders.peek("/a", false)).not.toBeNull();
    await folders.settled("/a", false);
    expect(folders.peek("/a", false)).not.toBeNull();
  });
});
