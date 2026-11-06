import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFs } from "../platform/test/fs";
import { SETTLE_MS } from "./folders";
import { FileSearch } from "./search";

describe("FileSearch when the server answers again", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const setup = () => {
    const fs = new FakeFs({ home: "/home/j", dirs: ["/home/j"], files: { "/home/j/needle.txt": "text/plain" } });
    return { fs, search: new FileSearch(fs, "/home/j", false, []) };
  };

  it("asks again a typed query that failed as network, while its results are on screen", async () => {
    const { fs, search } = setup();
    search.resume();
    fs.offline = true;
    search.type("needle");
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(search.snapshot.error?.code).toBe("network");
    fs.offline = false;
    search.recovered();
    await vi.advanceTimersByTimeAsync(0);
    expect(search.snapshot).toMatchObject({ error: null, asking: false });
    expect(search.snapshot.shown.rows.map((r) => r.path)).toEqual(["/home/j/needle.txt"]);
  });

  it("leaves a search that is off screen alone", async () => {
    const { fs, search } = setup();
    search.resume();
    fs.offline = true;
    search.type("needle");
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    search.stop();
    fs.offline = false;
    fs.calls.length = 0;
    search.recovered();
    expect(fs.calls).toEqual([]);
  });
});
