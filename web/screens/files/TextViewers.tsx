import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { FsApi, TextPreview } from "../../files/api";
import type { FilesSession } from "./session";
import type { FileRef } from "../../files/browser";
import { HIGHLIGHT_MAX, highlightedLines, plainLines } from "../../files/render/code";
import { linkTarget, renderMarkdown, type LinkTarget } from "../../files/render/markdown";
import { mountDiagrams } from "../../files/render/diagrams";
import { lazyImages } from "../../files/images";
import { useAppView } from "../../app/context";
import { formatSize } from "../../files/format";
import { languageFor, type Language } from "../../files/kinds";
import { HttpRefusal } from "../../net/http";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { Spinner } from "../../ui/primitives/Spinner";
import { cx } from "../../ui/cx";
import styles from "./Viewers.module.css";

/** The code and Markdown viewers read at most this much, with Range (fs.md "Text previews"). */
export const TEXT_LIMIT = 1024 * 1024;

export type Loaded<T> = { kind: "loading" } | { kind: "done"; value: T } | { kind: "error"; error: HttpRefusal };

/**
 * A file's first MiB as text, fetched once per path while `wanted` (a text viewer is showing) and abandoned when it
 * closes. The file's header copies it. A view that mounts in place of another showing the same file (the Preview
 * panel's file opened full width, and Back) takes the text that one handed over (`FilesSession.handed`) instead of
 * reading it again; nothing else is kept, so a file shown again later is read fresh.
 */
export function useText(session: FilesSession, path: string, wanted: boolean): Loaded<TextPreview> {
  const [state, setState] = useState<{ path: string; loaded: Loaded<TextPreview> } | null>(() => {
    const handed = session.handed?.path === path ? session.handed.text : null;
    if (!handed) return null;
    session.handed = null;
    return { path, loaded: { kind: "done", value: handed } };
  });
  const have = state?.path === path;
  useEffect(() => {
    if (!wanted || have) return undefined;
    const abort = new AbortController();
    session.browser.api.text(path, TEXT_LIMIT, abort.signal).then(
      (value) => { setState({ path, loaded: { kind: "done", value } }); },
      (error: unknown) => { if (!abort.signal.aborted) setState({ path, loaded: { kind: "error", error: error instanceof HttpRefusal ? error : new HttpRefusal(0, "internal") } }); },
    );
    return () => { abort.abort(); };
  }, [session, path, wanted]);
  // Another file's text, from before a switch, is never this one's.
  return have ? state.loaded : { kind: "loading" };
}

function Loading({ what }: { what: string }) {
  return <div class={styles.loading}><Spinner label={what} /><p>{what}</p></div>;
}

function Failed({ error, describe }: { error: HttpRefusal; describe: (e: HttpRefusal) => string }) {
  return <EmptyState icon="alert" title="Can't show this file">{describe(error)}</EmptyState>;
}

function Truncated({ preview }: { preview: TextPreview }) {
  if (!preview.truncated) return null;
  const of = preview.size !== null ? ` of ${formatSize(preview.size)}` : "";
  return <p class={styles.note}>Showing the first {formatSize(TEXT_LIMIT)}{of}. Open it in the terminal for the rest.</p>;
}

/** Source and text, coloured by Shiki when the extension is on the allowlist and the file is small. */
/** The facts Info adds for a file read as text. */
const LANGUAGE_NAMES: Record<Language, string> = {
  bash: "Shell", c: "C", diff: "Diff", go: "Go", javascript: "JavaScript", json: "JSON", markdown: "Markdown", python: "Python",
  rust: "Rust", swift: "Swift", toml: "TOML", tsx: "TypeScript JSX", typescript: "TypeScript", yaml: "YAML",
};

/** Mounted only while Info is open, so a MiB of text is counted when someone asks. A file read in part has at least this many lines. */
export function TextFacts({ name, preview, plain }: { name: string; preview: TextPreview; plain: boolean }) {
  const lang = plain ? null : languageFor(name);
  const source = preview.text;
  const lines = useMemo(() => (source === "" ? 0 : source.split("\n").length - (source.endsWith("\n") ? 1 : 0)), [source]);
  return (
    <>
      <dt>Type</dt><dd>{lang ? LANGUAGE_NAMES[lang] : "Text"}</dd>
      <dt>Lines</dt><dd>{lines.toLocaleString()}{preview.truncated ? "+" : ""}</dd>
    </>
  );
}

/** Source and text, numbered, edge to edge; coloured by Shiki when the extension is on the allowlist and the file is small. */
export function CodeViewer({ text, file, wrap, plain, describe }: { text: Loaded<TextPreview>; file: FileRef; wrap: boolean; plain: boolean; describe: (e: HttpRefusal) => string }) {
  const ref = useRef<HTMLElement>(null);
  const gutter = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const code = ref.current;
    if (!code || text.kind !== "done") return undefined;
    const source = text.value.text;
    code.replaceChildren(plainLines(source));
    // The unwrapped gutter's numbers, one per line, as generated content: a copy or a selection never takes them.
    gutter.current?.setAttribute("data-lines", Array.from({ length: code.childElementCount }, (_, i) => String(i + 1)).join("\n"));
    const lang = plain ? null : languageFor(file.name);
    if (!lang || source.length > HIGHLIGHT_MAX) return undefined;
    let live = true;
    void highlightedLines(source, lang).then((lines) => { if (live && lines) code.replaceChildren(lines); });
    return () => { live = false; };
  }, [text, file.name, plain]);
  if (text.kind === "loading") return <Loading what="Loading the file" />;
  if (text.kind === "error") return <Failed error={text.error} describe={describe} />;
  return (
    <div class={cx(styles.text, styles.sunken)}>
      <Truncated preview={text.value} />
      {text.value.text === "" && <p class={styles.note}>This file is empty.</p>}
      <pre class={cx(styles.code, wrap && styles.wrap)} tabIndex={0} aria-label={`Contents of ${file.name}`}><span ref={gutter} class={styles.gutter} aria-hidden="true" /><code ref={ref} /></pre>
    </div>
  );
}

/** Rendered Markdown. Links to files open here; links to the web leave the app. */
export function MarkdownViewer({ api, text, file, onLink, describe }: { api: FsApi; text: Loaded<TextPreview>; file: FileRef; onLink: (target: LinkTarget) => void; describe: (e: HttpRefusal) => string }) {
  const [html, setHtml] = useState<string | null>(null);
  const article = useRef<HTMLElement>(null);
  const scheme = useAppView((v) => v.viewport.scheme);
  const docUrl = new URL(api.rawUrl(file.path), location.href).href;
  useEffect(() => {
    if (text.kind !== "done") return undefined;
    let live = true;
    void renderMarkdown(text.value.text, docUrl).then((out) => { if (live) setHtml(out); });
    return () => { live = false; };
  }, [text, docUrl]);
  useEffect(() => (html !== null && article.current ? lazyImages(article.current, null) : undefined), [html]);
  useEffect(() => {
    const root = article.current;
    if (html === null || !root) return undefined;
    return mountDiagrams(root, scheme);
  }, [html, scheme]);
  if (text.kind === "error") return <Failed error={text.error} describe={describe} />;
  if (text.kind === "loading" || html === null) return <Loading what="Loading the document" />;
  return (
    <div
      class={styles.text}
      onClick={(e) => {
        // Nothing in a document navigates the page itself: every click is ours, whatever element it landed on.
        e.preventDefault();
        const a = e.target instanceof Element ? e.target.closest("a, area") : null;
        if (a) onLink(linkTarget(a.getAttribute("href") ?? "", docUrl));
      }}
      onAuxClick={(e) => { e.preventDefault(); }}
    >
      <Truncated preview={text.value} />
      <article ref={article} class={styles.md} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
