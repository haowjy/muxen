import { HttpRefusal } from "../net/http";
import { Store } from "../ui/store";
import type { FsApi, Listing } from "./api";

/** Typing pauses this long before a folder is asked for. */
export const SETTLE_MS = 250;
/**
 * Entries held across every folder before the least recently used unpinned one goes. An entry is a
 * name and a few facts, about 200 bytes, so this is a few MB in a phone's web view. Every folder
 * costs one more than its entries, so a thousand empty folders are bounded too.
 */
export const MAX_ENTRIES = 10_000;
/** The path field pages a folder for its subfolders until it holds this many entries, then gives up. */
const MAX_FOLDERS = 1_000;

/** One subfolder listing's names as the daemon sorted them, and whether the scan stopped short. */
export interface FolderNames {
  names: string[];
  /** Past the page limit or the daemon's scan cap: more folders may exist than are listed. */
  capped: boolean;
}

export type FolderState = { status: "loading" } | { status: "error"; error: HttpRefusal } | ({ status: "ready" } & FolderNames);

/** The cache key of one listing; `hidden` listings are kept apart (`hidden=1` is a different scan). */
export const folderKey = (path: string, hidden: boolean): string => `${hidden ? "1" : "0"}${path}`;

/** What is known of one folder: every page loaded so far, and what is being asked of it now. */
export interface Held {
  /** The pages loaded so far, merged: `entries` grows as the next pages arrive. */
  listing: Listing | null;
  /** A request for the first page, or for the subfolders the path field completes from, is under way. */
  loading: boolean;
  /** The last request failed; the listing stays as it was. */
  error: HttpRefusal | null;
}

export interface FoldersView {
  /** Oldest use first: the first to go when more than `MAX_ENTRIES` are held. */
  held: ReadonlyMap<string, Held>;
}

/**
 * What one host's folders have told us: one record per folder (and per hidden-files setting) holding
 * every page loaded so far, for browsing, the path field and whatever else draws a folder. The
 * records are bounded by `MAX_ENTRIES` in all, least recently used first, and a pinned folder (one on
 * screen) is never dropped. Holding a page costs no request when it is shown again on a tab switch or
 * a Back. `drop` clears a folder a refresh or an upload changed. The path field's folder is asked
 * for once typing settles, never once per keystroke.
 */
export class Folders extends Store<FoldersView> {
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** One request at a time per folder: a second ask for the next page joins the first. */
  private readonly inflight = new Map<string, Promise<void>>();
  private pinned = new Set<string>();

  constructor(private readonly api: FsApi) {
    super({ held: new Map() });
  }

  /** The folders on screen: they are not dropped for room. */
  pin(paths: readonly { path: string; hidden: boolean }[]): void {
    this.pinned = new Set(paths.map((p) => folderKey(p.path, p.hidden)));
    const held = new Map(this.snapshot.held);
    this.trim(held);
    if (held.size !== this.snapshot.held.size) this.update({ held });
  }

  /** The folder the field names now: fetched once typing settles, unless held or already under way. */
  ask(target: { path: string; hidden: boolean } | null): void {
    clearTimeout(this.timer);
    if (!target) return;
    const record = this.snapshot.held.get(folderKey(target.path, target.hidden));
    // A listing that failed for want of a connection is asked for again: it may be back.
    if (record && (record.loading || (record.listing && foldersKnown(record.listing)) || (record.error && record.error.code !== "network"))) {
      this.put(target.path, target.hidden, {});
      return;
    }
    this.timer = setTimeout(() => { void this.load(target.path, target.hidden); }, SETTLE_MS);
  }

  /** Fetches the subfolders of `path` now (Go cannot wait out the settle), or joins the fetch under way. */
  load(path: string, hidden: boolean): Promise<void> {
    const key = folderKey(path, hidden);
    const running = this.inflight.get(key);
    if (running) return running;
    this.put(path, hidden, { loading: true, error: null });
    const done = this.fetchNames(path, hidden).then(
      () => { this.put(path, hidden, { loading: false }); },
      (error: unknown) => { this.put(path, hidden, { loading: false, error: error instanceof HttpRefusal ? error : new HttpRefusal(0, "internal") }); },
    ).finally(() => { this.inflight.delete(key); });
    this.inflight.set(key, done);
    return done;
  }

  /** The pages held of `path`, if any. */
  peek(path: string, hidden: boolean): Listing | null {
    return this.snapshot.held.get(folderKey(path, hidden))?.listing ?? null;
  }

  /** Like {@link peek}, but waits for a fetch under way instead of asking again. */
  async settled(path: string, hidden: boolean): Promise<Listing | null> {
    await this.inflight.get(folderKey(path, hidden));
    return this.peek(path, hidden);
  }

  /**
   * Replaces `path`'s pages with its first page, fresh from the host (a first visit, a refresh), and
   * returns the listing; the pages held stay in view until it lands. The daemon answers with the
   * canonical path, which `asked` may only name (`~`): both keys hold it.
   */
  async first(path: string, hidden: boolean): Promise<Listing> {
    const listing = await this.api.list(path, 0, hidden);
    this.put(listing.path, hidden, { listing, error: null });
    if (path !== listing.path) this.put(path, hidden, { listing });
    return listing;
  }

  /** The next page of `path` after what is held; joins the request under way. */
  more(path: string, hidden: boolean): Promise<void> {
    const key = folderKey(path, hidden);
    const running = this.inflight.get(key);
    if (running) return running;
    const done = this.nextPage(path, hidden).finally(() => { this.inflight.delete(key); });
    this.inflight.set(key, done);
    return done;
  }

  /** A refresh or an upload changed `path`. */
  drop(path: string): void {
    const held = new Map(this.snapshot.held);
    held.delete(folderKey(path, false));
    held.delete(folderKey(path, true));
    this.update({ held });
  }

  /** Merges `patch` into the folder's record and makes it the newest, then makes room. */
  private put(path: string, hidden: boolean, patch: Partial<Held>): void {
    const key = folderKey(path, hidden);
    const held = new Map(this.snapshot.held);
    const record = { listing: null, loading: false, error: null, ...held.get(key), ...patch };
    held.delete(key);
    held.set(key, record);
    this.trim(held, key);
    this.update({ held });
  }

  /** Drops the least recently used folders until the entries held fit; a pinned folder, or the one just written, stays. */
  private trim(held: Map<string, Held>, keep?: string): void {
    let size = 0;
    for (const record of held.values()) size += weigh(record);
    for (const [key, record] of held) {
      if (size <= MAX_ENTRIES) break;
      if (key === keep || this.pinned.has(key)) continue;
      held.delete(key);
      size -= weigh(record);
    }
  }

  private async nextPage(path: string, hidden: boolean): Promise<void> {
    const have = this.peek(path, hidden);
    if (!have || have.entries.length >= have.total) return;
    const next = await this.api.list(path, have.entries.length, hidden);
    // The folder was refreshed or dropped while this page was on its way: it belongs to the old pages.
    const now = this.peek(path, hidden);
    if (now !== have) return;
    this.put(path, hidden, { listing: { ...now, total: next.total, truncated: next.truncated, entries: [...now.entries, ...next.entries] } });
  }

  /** Pages the folder until every subfolder is held (they sort first), or `MAX_FOLDERS` entries are. */
  private async fetchNames(path: string, hidden: boolean): Promise<void> {
    if (!this.peek(path, hidden)) {
      const listing = await this.api.list(path, 0, hidden);
      this.put(listing.path, hidden, { listing });
      if (listing.path !== path) this.put(path, hidden, { listing });
    }
    for (let have = this.peek(path, hidden); have && !foldersKnown(have); have = this.peek(path, hidden)) await this.nextPage(path, hidden);
  }
}

const weigh = (record: Held): number => 1 + (record.listing?.entries.length ?? 0);

/** Every subfolder is held (they sort first), or the scan or `MAX_FOLDERS` stopped the paging. */
function foldersKnown(listing: Listing): boolean {
  return holdsAll(listing) || listing.truncated || listing.entries.length >= MAX_FOLDERS;
}

const holdsAll = (listing: Listing): boolean => listing.entries.length >= listing.total || listing.entries.some((e) => e.kind !== "dir");

/** The subfolder names held, and whether more folders may exist unlisted. */
export function namesOf(listing: Listing): FolderNames {
  return { names: listing.entries.filter((e) => e.kind === "dir" && e.utf8 !== false).map((e) => e.name), capped: listing.truncated || !holdsAll(listing) };
}

/** What the path field's completion model reads of a record. */
export function stateOf(record: Held | undefined): FolderState | undefined {
  if (!record) return undefined;
  if (record.error) return { status: "error", error: record.error };
  if (record.listing && foldersKnown(record.listing)) return { status: "ready", ...namesOf(record.listing) };
  return record.loading || record.listing ? { status: "loading" } : undefined;
}
