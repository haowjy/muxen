// Mermaid, the part of diagrams.ts that loads on the first diagram. A diagram's source is
// untrusted (plan.md "Rendered content is untrusted"). Three layers hold it:
//  - Mermaid runs in `strict` mode, from a reset configuration on every render: a document's
//    frontmatter or `%%{init}%%` can set any key not listed in `secure`, and a failed render
//    leaves the document's settings in Mermaid's shared config for the next one to inherit.
//    `secure` holds every key that reaches CSS (`theme`, `themeCSS`, `themeVariables`,
//    `fontFamily`, `fontSize`, `look`), so a document cannot write a stylesheet or pick a theme;
//    the app's light or dark scheme decides. `secure` closes the config route; a `classDef`
//    (a state diagram accepts `url()` in one) still reaches the draw, where only the CSP stops a
//    fetch, because Mermaid draws into <body> before anything here sanitizes.
//  - The SVG it returns is sanitized again with DOMPurify's SVG profile. The sanitizer cleans what
//    stays in the page: the browser parses each <style> and `style=` (so CSS escapes such as
//    `\75rl(` arrive decoded), and a rule or attribute whose serialized text refers outside the
//    document is dropped (`externalRef`).
//  - The page's CSP. Mermaid draws into a temporary element of <body> *before* this module
//    sanitizes, so a node's `img: "https://…"` or a `classDef` `url()` is requested by the
//    browser; the daemon's `img-src` and the app's refuse it. Loosening the CSP opens that fetch.
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import type { Viewport } from "../../platform/types";

/**
 * The browser's own parse of `css` refers outside the document: a `url()` that is not a `#`
 * fragment, `image-set`, `@import` or `@font-face`. `replaceSync` decodes escapes and
 * normalizes strings and comments and starts no request, so the serialized text is what to test.
 */
const EXTERNAL_REF = /url\(\s*(?!["']?#)|image-set|@import|@font-face/iu;

/** The top-level rules of `css` as the browser serializes them. */
function parseRules(css: string): string[] {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  return Array.from(sheet.cssRules, (rule) => rule.cssText);
}

/** `css` without the top-level rules that refer outside the document. */
function cleanStyle(css: string): string {
  return parseRules(css).filter((text) => !EXTERNAL_REF.test(text)).join("");
}

/** A `style=` value is the body of a rule: parse it as one and test what came out. */
function hasExternalRef(declarations: string): boolean {
  return parseRules(`*{${declarations}}`).some((text) => EXTERNAL_REF.test(text));
}

const purify = DOMPurify();
purify.addHook("uponSanitizeElement", (node) => {
  if (node.nodeName.toLowerCase() === "style") node.textContent = cleanStyle(node.textContent ?? "");
});
purify.addHook("afterSanitizeAttributes", (node) => {
  const style = node.getAttribute("style");
  if (style !== null && hasExternalRef(style)) node.removeAttribute("style");
  // Only in-document fragments: no `use` or marker leads anywhere else.
  for (const name of ["href", "xlink:href"]) {
    const value = node.getAttribute(name);
    if (value !== null && !value.startsWith("#")) node.removeAttribute(name);
  }
});

let counter = 0;
/** Mermaid's configuration is global, so one render at a time owns it from reset to SVG. */
let turn: Promise<unknown> = Promise.resolve();

/** The sanitized SVG of one diagram, or a rejection with Mermaid's first line of reason. */
export function renderDiagram(source: string, scheme: Viewport["scheme"]): Promise<DocumentFragment> {
  const result = turn.then(() => draw(source, scheme));
  turn = result.catch(() => undefined);
  return result;
}

async function draw(source: string, scheme: Viewport["scheme"]): Promise<DocumentFragment> {
  counter += 1;
  const id = `mermaid-${String(counter)}`;
  // `reset` has no replacement on the public API.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  mermaid.mermaidAPI.reset();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    // Labels in `foreignObject` would be removed below, leaving empty boxes. `layout`: ELK is not shipped.
    htmlLabels: false,
    layout: "dagre",
    secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "htmlLabels", "layout", "theme", "themeCSS", "themeVariables", "fontFamily", "fontSize", "altFontFamily", "look"],
    theme: scheme === "dark" ? "dark" : "neutral",
    fontFamily: "system-ui, sans-serif",
  });
  try {
    const { svg } = await mermaid.render(id, source);
    return purify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      // `a`: a diagram link is not followable here (the viewer reads `href`), only a dead tab stop.
      FORBID_TAGS: ["foreignObject", "image", "script", "a"],
      RETURN_DOM_FRAGMENT: true,
    });
  } finally {
    // A failed render leaves its error drawing (a bomb) in <body>.
    document.getElementById(`d${id}`)?.remove();
  }
}
