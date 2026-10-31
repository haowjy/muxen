// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { linkTarget, renderMarkdown } from "./markdown";

const doc = "muxen-app://h-dev/fs/raw/home/j/repo/docs/README.md";

describe("Markdown links", () => {
  it("resolves relative links against the document, sends the web out of the app and drops the rest", () => {
    expect(linkTarget("../src/main.rs", doc)).toEqual({ kind: "path", path: "/home/j/repo/src/main.rs" });
    expect(linkTarget("img%20one.png", doc)).toEqual({ kind: "path", path: "/home/j/repo/docs/img one.png" });
    expect(linkTarget("https://example.com/x", doc)).toEqual({ kind: "external", url: "https://example.com/x" });
    expect(linkTarget("javascript:alert(1)", doc)).toEqual({ kind: "none" });
    expect(linkTarget("#usage", doc)).toEqual({ kind: "none" });
    expect(linkTarget("../../../../../../etc", doc)).toEqual({ kind: "none" });
  });
});

// A document is untrusted: nothing in it may run, style the app, or fetch from outside the host.
describe("Markdown sanitizing", () => {
  it.each([
    ["a script", "<script>alert(1)</script>", /<script|alert/],
    ["an event handler", '<p onclick="alert(1)">x</p>', /onclick/],
    ["a javascript: link", '<a href="javascript:alert(1)">x</a>', /javascript:/],
    ["svg and foreignObject", '<svg><foreignObject><img src="a.png"></foreignObject></svg>', /<svg|foreignObject/],
    ["a style or iframe", "<style>*{}</style><iframe src=\"/x\"></iframe>", /<style|<iframe/],
  ])("drops %s", async (_, input, banned) => {
    expect(await renderMarkdown(input, doc)).not.toMatch(banned);
  });

  it("loads images only from the host, and keeps the mermaid fence's class", async () => {
    const html = await renderMarkdown('![a](pic.png) <img src="https://evil.example/t.png">\n\n```mermaid\ngraph TD\n```', doc);
    expect(html).toContain('data-src="muxen-app://h-dev/fs/raw/home/j/repo/docs/pic.png"');
    expect(html).not.toContain("evil.example");
    expect(html).not.toMatch(/\ssrc=/);
    expect(html).toContain('class="language-mermaid"');
  });
});
