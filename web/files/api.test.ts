import { describe, expect, it, vi } from "vitest";
import { HttpRefusal } from "../net/http";
import { encodePath, httpFsApi, rawPathOf } from "./api";

const response = (status: number, body: BodyInit | null, headers: Record<string, string> = {}): Response => new Response(body, { status, headers });

describe("paths in URLs", () => {
  it("encodes each segment and decodes back, and builds routes on the host's origin", async () => {
    const path = "/home/j/my repo/#1?/ü.md";
    expect(encodePath(path)).toBe("/home/j/my%20repo/%231%3F/%C3%BC.md");
    expect(rawPathOf(`/fs/raw${encodePath(path)}`)).toBe(path);
    expect(encodePath("/")).toBe("/");
    expect(rawPathOf("/fs/list/x")).toBeNull();
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(response(200, JSON.stringify({ path: "/", entries: [] }))));
    const api = httpFsApi("muxen-app://h-dev", fetch);
    await api.list("/home/j/a b", 200, true);
    expect(fetch.mock.calls[0]?.[0]).toBe("muxen-app://h-dev/fs/list/home/j/a%20b?offset=200&hidden=1");
    expect(api.rawUrl("/x/y.png")).toBe("muxen-app://h-dev/fs/raw/x/y.png");
  });
});

describe("httpFsApi", () => {
  it("turns the daemon's JSON error into an HttpRefusal, and a dead network into `network`", async () => {
    const api = httpFsApi("o", () => Promise.resolve(response(403, JSON.stringify({ error: "denied" }))));
    await expect(api.list("~", 0, false)).rejects.toEqual(new HttpRefusal(403, "denied"));
    const down = httpFsApi("o", () => Promise.reject(new TypeError("Load failed")));
    await expect(down.list("~", 0, false)).rejects.toMatchObject({ code: "network" });
  });

  it("retries `busy` after Retry-After", async () => {
    vi.useFakeTimers();
    let n = 0;
    const api = httpFsApi("o", () => Promise.resolve(n++ === 0
      ? response(503, JSON.stringify({ error: "busy" }), { "Retry-After": "1" })
      : response(200, JSON.stringify({ path: "/h", parent: "/", total: 0, offset: 0, truncated: false, entries: [] }))));
    const home = api.list("~", 0, false);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(home).resolves.toMatchObject({ path: "/h" });
    vi.useRealTimers();
  });

  it("reads a text preview with Range and says when it is cut", async () => {
    const api = httpFsApi("o", (_url, init) => {
      expect(new Headers(init?.headers).get("Range")).toBe("bytes=0-3");
      return Promise.resolve(response(206, "abcd", { "Content-Range": "bytes 0-3/10" }));
    });
    await expect(api.text("/f", 4)).resolves.toEqual({ text: "abcd", size: 10, truncated: true });
    const empty = httpFsApi("o", () => Promise.resolve(response(416, JSON.stringify({ error: "bad_range" }))));
    await expect(empty.text("/f", 4)).resolves.toEqual({ text: "", size: 0, truncated: false });
  });
});
