// Files' Search (browser-behaviors.md "Files", Search): one search below one folder, as typed. The daemon matches and
// ranks (fs.md "GET /fs/search"); this asks once typing settles, aborts what the text has moved past, and keeps the
// last answer up, quieted, until the next lands. Nothing here matches: `hits` come from the daemon and are only drawn.
import { HttpRefusal } from "../net/http";
import type { Match, Stopped } from "../proto/generated/messages";
import { Store } from "../ui/store";
import type { Entry, FsApi } from "./api";
import { SETTLE_MS } from "./folders";

/** A query with `*` or `?` is a glob; anything else is fuzzy (fs.md "Matching"). */
export const isGlob = (q: string): boolean => /[*?]/.test(q);

/** The daemon searches for at most this many bytes of query (fs.md "Limits"). */
const MAX_QUERY_BYTES = 256;
export const tooLong = (q: string): boolean => new TextEncoder().encode(q).length > MAX_QUERY_BYTES;

/** One row of Search: a match, or (with the field empty) a file opened recently. */
export interface Found {
  /** Absolute. */
  path: string;
  /** Relative to the searched folder, `/`-separated: the text `hits` index. */
  rel: string;
  /** `[start, end)` runs of `rel` the query matched, in UTF-16 code units. */
  hits: readonly (readonly [number, number])[];
  entry: Entry;
  /** A recent: when this device last opened it, unix seconds. */
  opened?: number;
}

export interface SearchView {
  /** What the field holds. */
  text: string;
  /** The rows on screen: the last answer (the recents with the field empty), and where its walk stopped. */
  shown: { rows: readonly Found[]; stopped: Stopped | null };
  /** A request for `text` is waiting for typing to settle, or under way: the rows shown answer something else, and are quieted. */
  asking: boolean;
  /** Why `text` couldn't be searched; Try again asks again. */
  error: HttpRefusal | null;
  /** The selected row's path: the first row of each new answer, for Enter, until the user moves it. */
  selected: string | null;
  /** The user picked `selected` (an arrow key, a click): only then does the Preview panel follow it. */
  chosen: boolean;
}

/** `root/rel`, for a canonical root. */
const below = (root: string, rel: string): string => (root === "/" ? `/${rel}` : `${root}/${rel}`);

function foundOf(root: string, match: Match): Found {
  const { path, hits, name, kind, link, size, mtime, mime } = match;
  return {
    path: below(root, path),
    rel: path,
    hits,
    entry: { name, kind, link, ...(size !== undefined && { size }), ...(mtime !== undefined && { mtime }), ...(mime !== undefined && { mime }) },
  };
}

/**
 * One Search below `root`, kept in the host's Files session while its tab may come back to it (Back from a file opened
 * from the results finds the query, the rows and the scroll as they were).
 */
export class FileSearch extends Store<SearchView> {
  /** Where the results were scrolled. */
  scroll = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private request: AbortController | null = null;
  /** What the rows shown answer: the text and the hidden setting it was asked with; null for the recents. */
  private answered: string | null = null;

  constructor(private readonly api: FsApi, readonly root: string, private hidden: boolean, private readonly recents: readonly Found[]) {
    super({ text: "", shown: { rows: recents, stopped: null }, asking: false, error: null, selected: recents[0]?.path ?? null, chosen: false });
  }

  /** The field's text: asked for once typing pauses; emptied, the recents are back at once. */
  type(text: string): void {
    this.stop();
    if (text.trim() === "") {
      this.answered = null;
      this.update({ text, shown: { rows: this.recents, stopped: null }, error: null, selected: this.recents[0]?.path ?? null, chosen: false });
      return;
    }
    // Back to the text the rows answer (a letter typed and deleted): nothing to ask.
    if (this.answered === this.key(text)) {
      this.update({ text, error: null });
      return;
    }
    // Past what the daemon takes: nothing is asked, and no rows stand for the text (Enter would act on them).
    if (tooLong(text)) {
      this.answered = null;
      this.update({ text, shown: { rows: [], stopped: null }, error: null, selected: null, chosen: false });
      return;
    }
    this.update({ text, asking: true, error: null });
    this.timer = setTimeout(() => { this.ask(); }, SETTLE_MS);
  }

  /** The folder's Show hidden files changed: the text is searched again under it, at once; a request under the old setting is dropped. */
  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    this.stop();
    this.resume();
  }

  /** The user picked a row. */
  select(path: string | null): void {
    this.update({ selected: path, chosen: path !== null });
  }

  /** Try again, or the results came back on screen: `text` is asked for unless its answer is up. */
  resume(): void {
    const { text, asking } = this.snapshot;
    if (text.trim() !== "" && !tooLong(text) && this.answered !== this.key(text) && !asking) this.ask();
  }

  /** The results left the screen: nothing more is asked or waited for. */
  stop(): void {
    clearTimeout(this.timer);
    this.request?.abort();
    this.request = null;
    if (this.snapshot.asking) this.update({ asking: false });
  }

  private key(text: string): string {
    return `${this.hidden ? "1" : "0"}${text}`;
  }

  private ask(): void {
    this.stop();
    const { text } = this.snapshot;
    // What the answer answers is fixed now: the hidden setting may change while it is on its way.
    const key = this.key(text);
    const request = new AbortController();
    this.request = request;
    this.update({ asking: true, error: null });
    this.api.search(this.root, text, this.hidden, request.signal).then(
      (answer) => {
        if (this.request !== request) return;
        this.request = null;
        const rows = answer.matches.map((m) => foundOf(answer.path, m));
        this.answered = key;
        this.update({ shown: { rows, stopped: answer.stopped }, asking: false, selected: rows[0]?.path ?? null, chosen: false });
      },
      (error: unknown) => {
        if (this.request !== request) return;
        this.request = null;
        this.update({ asking: false, error: error instanceof HttpRefusal ? error : new HttpRefusal(0, "internal") });
      },
    );
  }
}

/** `text` cut at `from` and `to` into runs, each marked or not by `hits` (sorted, as the daemon sends them). */
export function marked(text: string, hits: Found["hits"], from: number, to: number): { text: string; hit: boolean }[] {
  const runs: { text: string; hit: boolean }[] = [];
  let at = from;
  for (const [start, end] of hits) {
    const a = Math.max(start, from);
    const b = Math.min(end, to);
    if (a >= b) continue;
    if (a > at) runs.push({ text: text.slice(at, a), hit: false });
    runs.push({ text: text.slice(a, b), hit: true });
    at = b;
  }
  if (at < to) runs.push({ text: text.slice(at, to), hit: false });
  return runs;
}
