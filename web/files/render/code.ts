// The code viewer's renderer. Text becomes DOM through textContent only, so a file's
// contents can never become markup; Shiki adds colours from the --shiki-* tokens.
import type { HighlighterCore } from "shiki/core";
import { LANGUAGES, type Language } from "../kinds";

/** Past this many characters the file shows as plain text: Shiki on a phone takes seconds. */
export const HIGHLIGHT_MAX = 128 * 1024;
/** Longer lines (minified code) are left plain, as Shiki's tokenizer is slow on them. */
const LINE_MAX = 2_000;

let highlighter: Promise<HighlighterCore> | null = null;

/**
 * Shiki's core with the JavaScript regex engine: the Oniguruma engine needs WebAssembly,
 * which the app's `script-src 'self'` doesn't allow. Grammars load one by one, on first use.
 */
async function highlighterFor(lang: Language): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore, createCssVariablesTheme }, { createJavaScriptRegexEngine }] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
    ]);
    return createHighlighterCore({
      themes: [createCssVariablesTheme({ name: "muxen", variablePrefix: "--shiki-" })],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  const h = await highlighter;
  if (!h.getLoadedLanguages().includes(lang)) await h.loadLanguage((await LANGUAGES[lang]()).default);
  return h;
}

/** A line's box: `<span class="line">` (a block, so copying keeps the breaks, numbered by the viewer's CSS) holding one `<span class="text">`. */
function lineBox(): { line: HTMLSpanElement; text: HTMLSpanElement } {
  const line = document.createElement("span");
  line.className = "line";
  const text = document.createElement("span");
  text.className = "text";
  line.append(text);
  return { line, text };
}

/** One line box per line, the text set as text. */
export function plainLines(text: string): DocumentFragment {
  const out = document.createDocumentFragment();
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const content of lines) {
    const { line, text: box } = lineBox();
    box.textContent = content;
    out.append(line);
  }
  return out;
}

/** The same lines, coloured; null when the grammar couldn't load. */
export async function highlightedLines(text: string, lang: Language): Promise<DocumentFragment | null> {
  let h: HighlighterCore;
  try {
    h = await highlighterFor(lang);
  } catch {
    return null;
  }
  const { tokens } = h.codeToTokens(text, { lang, theme: "muxen", tokenizeMaxLineLength: LINE_MAX });
  if (tokens.at(-1)?.length === 0) tokens.pop();
  const out = document.createDocumentFragment();
  for (const tokensOfLine of tokens) {
    const { line, text: box } = lineBox();
    for (const token of tokensOfLine) {
      const part = document.createElement("span");
      if (token.color) part.style.color = token.color;
      part.textContent = token.content;
      box.append(part);
    }
    out.append(line);
  }
  return out;
}
