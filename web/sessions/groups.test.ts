import { describe, expect, it } from "vitest";
import type { TmuxListing } from "../proto/generated/messages";
import { findSession } from "./groups";

const LISTING: TmuxListing = {
  server: "main:1-1",
  version: "3.4",
  sessions: [
    { id: 1, name: "Muxen", bell: { mark: 0, covered: true }, windows: [] },
    { id: 2, name: "notes", bell: { mark: 0, covered: true }, windows: [] },
    { id: 3, name: "web", bell: { mark: 0, covered: true }, windows: [] },
  ],
};
describe("findSession", () => {
  it("finds a session of this run only", () => {
    expect(findSession(LISTING, { server: "main:1-1", session: 2 })?.name).toBe("notes");
    expect(findSession(LISTING, { server: "main:2-1", session: 2 })).toBeUndefined();
    expect(findSession(LISTING, { server: "main:1-1", session: 99 })).toBeUndefined();
  });
});
