import { describe, expect, it } from "vitest";
import { linkTarget } from "./markdown";

describe("Markdown links", () => {
  const doc = "muxen-app://h-dev/fs/raw/home/j/repo/docs/README.md";
  it("resolves relative links against the document, sends the web out of the app and drops the rest", () => {
    expect(linkTarget("../src/main.rs", doc)).toEqual({ kind: "path", path: "/home/j/repo/src/main.rs" });
    expect(linkTarget("img%20one.png", doc)).toEqual({ kind: "path", path: "/home/j/repo/docs/img one.png" });
    expect(linkTarget("https://example.com/x", doc)).toEqual({ kind: "external", url: "https://example.com/x" });
    expect(linkTarget("javascript:alert(1)", doc)).toEqual({ kind: "none" });
    expect(linkTarget("#usage", doc)).toEqual({ kind: "none" });
    expect(linkTarget("../../../../../../etc", doc)).toEqual({ kind: "none" });
  });
});
