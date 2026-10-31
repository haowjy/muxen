import { describe, expect, it } from "vitest";
import type { TmuxListing } from "../proto/generated/messages";
import { SessionsCache } from "./cache";

const listing = (...ids: number[]): TmuxListing => ({
  server: "main:1-1",
  version: "3.4",
  sessions: ids.map((id) => ({ id, name: `s${String(id)}`, bell: { mark: 0, covered: true }, windows: [{ id: id * 10, index: 0, name: "shell", active: true, activity: 0 }] })),
});

describe("SessionsCache", () => {
  it("a failure marks the cached rows stale and a listing clears it; a refusal differs from a network failure; busy and background are ignored", () => {
    const cache = new SessionsCache();
    cache.listed("h1", listing(1));
    cache.failed("h1", "timeout");
    expect(cache.snapshot.hosts["h1"]).toMatchObject({ listing: listing(1), failure: "offline" });
    cache.failed("h1", "tmux");
    expect(cache.snapshot.hosts["h1"]?.failure).toBe("refused");
    cache.listed("h1", listing(1));
    expect(cache.snapshot.hosts["h1"]?.failure).toBeNull();

    const fresh = new SessionsCache();
    fresh.requested("h2");
    fresh.failed("h2", "busy");
    fresh.failed("h2", "background");
    expect(fresh.snapshot.hosts["h2"]).toEqual({ listing: undefined, reachedAt: null, failure: null, updating: true });
  });

  it("keeps a null listing (no tmux server) distinct from never listed", () => {
    const cache = new SessionsCache();
    expect(cache.snapshot.hosts["h1"]).toBeUndefined();
    cache.listed("h1", null);
    expect(cache.snapshot.hosts["h1"]?.listing).toBeNull();
  });
});
