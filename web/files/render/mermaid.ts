// Mermaid, the part of diagrams.ts that loads on the first diagram. A diagram's source is
// untrusted (plan.md "Rendered content is untrusted"). Three layers hold it:
//  - Mermaid runs in `strict` mode, from a reset configuration on every render: a document's
//    frontmatter or `%%{init}%%` can set any key not listed in `secure`, and a failed render
//    leaves the document's settings in Mermaid's shared config for the next one to inherit.
//    `secure` holds every key that reaches CSS (`theme`, `themeCSS`, `themeVariables`,
//    `fontFamily`, `fontSize`, `look`), so a document cannot write a stylesheet or pick a theme;
//    the app's light or dark scheme decides. This is what stops a request for an external URL
//    from CSS, because Mermaid draws into <body> before anything here sanitizes.
//  - The SVG it returns is sanitized again with DOMPurify's SVG profile, and its <style> goes
//    through `cleanStyle`: a rule with a backslash (a CSS escape such as `\75rl(` spells `url(`
//    past a literal filter), `@font-face`, `@keyframes` (global at-rules, which Mermaid's id prefix
//    does not scope) or `@import` is dropped, and an external `url()` is stripped from the rest.
//  - The page's CSP. Mermaid draws into a temporary element of <body> *before* this module
//    sanitizes, so a node's `img: "https://…"` is requested by the browser; the daemon's
//    `img-src` and the app's refuse it. Loosening the CSP opens that fetch.
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import type { Viewport } from "../../platform/types";

/** The only `url()` a diagram's styles may use is an in-document reference such as a marker. */
const EXTERNAL_URL = /url\(\s*(?!["']?#)[^)]*\)|@import[^;]*;?/giu;

/** Mermaid writes no backslash itself, so one in its stylesheet came from the document. */
const DROPPED_RULE = /\\|^\s*@(?:font-face|keyframes|-[a-z]+-keyframes|import)\b/iu;

/** `css` as top-level rules (nested braces stay inside their rule) without the dropped ones. */
function cleanStyle(css: string): string {
  const kept: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        const rule = css.slice(start, i + 1);
        if (!DROPPED_RULE.test(rule)) kept.push(rule.replace(EXTERNAL_URL, ""));
        start = i + 1;
      }
    }
  }
  // Text after the last closed rule is an unfinished rule: nothing the browser applies.
  return kept.join("");
}

const purify = DOMPurify();
purify.addHook("uponSanitizeElement", (node) => {
  if (node.nodeName.toLowerCase() === "style") node.textContent = cleanStyle(node.textContent ?? "");
});
purify.addHook("afterSanitizeAttributes", (node) => {
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
