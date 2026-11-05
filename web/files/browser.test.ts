import { describe, expect, it } from "vitest";
import { FileBrowser, parentPlace } from "./browser";
import { entryPlace } from "./outline";
import { FakeFs, type FakeTree } from "../platform/test/fs";

const tree = (): FakeTree => ({
  home: "/home/j",
  dirs: ["/", "/home", "/etc", "/home/j", "/home/j/repo", "/home/j/repo/src", "/home/j/repo/.git", "/home/j/up", "/home/j/other", "/home/j/repo2"],
  files: {
    "/home/j/repo/README.md": "text/markdown; charset=utf-8",
    "/home/j/repo/a.ts": "text/plain; charset=utf-8",
    "/home/j/repo/b.png": "image/png",
    "/home/j/repo/c.rs": "text/plain; charset=utf-8",
    "/home/j/repo/src/main.rs": "text/plain; charset=utf-8",
  },
});

function setup(t = tree()) {
  const fs = new FakeFs(t);
  const browser = new FileBrowser({ api: fs, hidden: false });
  return { fs, browser };
}

/** The pages the browser shows: its folder's record. */
const pagesOf = (browser: FileBrowser) => browser.snapshot.dir && browser.folders.peek(browser.snapshot.dir.path, browser.snapshot.dir.hidden);

describe("FileBrowser", () => {
  it("opens ~ as the home the host names; lists directories first, pages on demand, and keeps hidden files out until asked", async () => {
    const { browser, fs } = setup();
    await browser.follow({ kind: "dir", path: "~" });
    expect(browser.snapshot.place).toEqual({ kind: "dir", path: "/home/j" });
    expect(browser.snapshot.home).toBe("/home/j");
    await browser.follow({ kind: "dir", path: "/home/j/repo" });
    expect(pagesOf(browser)?.entries.map((e) => e.name)).toEqual(["src", "README.md", "a.ts"]);
    await browser.more();
    expect(pagesOf(browser)?.entries.map((e) => e.name)).toEqual(["src", "README.md", "a.ts", "b.png", "c.rs"]);
    await browser.more(); // nothing left: no request
    expect(fs.calls.filter((c) => c.startsWith("list"))).toEqual(["list ~ 0", "list /home/j/repo 0", "list /home/j/repo 3"]);
    await browser.toggleHidden();
    expect(pagesOf(browser)?.entries.map((e) => e.name)).toContain(".git");
  });

  it("opens a listed file from the listing it came from, and returns to it without relisting", async () => {
    const { browser, fs } = setup();
    await browser.follow({ kind: "dir", path: "/home/j/repo" });
    const readme = pagesOf(browser)?.entries.find((e) => e.name === "README.md");
    if (!readme) throw new Error("no README");
    const place = entryPlace("/home/j/repo", readme);
    expect(place).toEqual({ kind: "file", path: "/home/j/repo/README.md" });
    if (!place) throw new Error("no place");
    await browser.follow(place);
    expect(browser.snapshot.place).toMatchObject({ kind: "file", file: { name: "README.md", mime: "text/markdown; charset=utf-8", size: 10 } });
    const calls = fs.calls.length;
    await browser.follow({ kind: "dir", path: "/home/j/repo" });
    expect(browser.snapshot.place).toEqual({ kind: "dir", path: "/home/j/repo" });
    expect(fs.calls.length).toBe(calls);
  });

  it("drops an answer for a folder already left", async () => {
    const { browser, fs } = setup();
    await browser.follow({ kind: "dir", path: "/home/j/repo" });
    fs.hold = true;
    const slow = browser.follow({ kind: "dir", path: "/home/j/repo/src" });
    fs.hold = false;
    await browser.follow({ kind: "dir", path: "/home/j/up" });
    fs.release();
    await slow;
    expect(browser.snapshot.place).toEqual({ kind: "dir", path: "/home/j/up" });
    expect(pagesOf(browser)?.path).toBe("/home/j/up");
  });

  it("lists a folder outside home, and a vanished folder has no stale entries and still a way up", async () => {
    const { browser } = setup();
    await browser.follow({ kind: "dir", path: "/home/j/repo" });
    await browser.follow({ kind: "dir", path: "/etc" });
    expect(pagesOf(browser)?.path).toBe("/etc");
    await browser.follow({ kind: "dir", path: "/home/j/gone/deeper" });
    expect(browser.snapshot.error?.code).toBe("not_found");
    expect(pagesOf(browser)).toBeNull();
    expect(parentPlace(browser.snapshot.place, pagesOf(browser))).toEqual({ kind: "dir", path: "/home/j/gone" });
    // up from a file and from home; `/` has no parent
    await browser.follow({ kind: "file", path: "/home/j/repo/src/main.rs" });
    expect(parentPlace(browser.snapshot.place, pagesOf(browser))).toEqual({ kind: "dir", path: "/home/j/repo/src" });
    await browser.follow({ kind: "dir", path: "/home/j" });
    expect(parentPlace(browser.snapshot.place, pagesOf(browser))).toEqual({ kind: "dir", path: "/home" });
    await browser.follow({ kind: "dir", path: "/" });
    expect(parentPlace(browser.snapshot.place, pagesOf(browser))).toBeNull();
  });
});
