import { HttpRefusal } from "../net/http";
import { Store } from "../ui/store";
import type { FsApi, Listing } from "./api";

/** Typing pauses this long before a folder is asked for. */
export const SETTLE_MS = 250;
/**
 * Entries held across every folder before the least recently used unpinned one goes. An entry is a
 * name and a few facts, about 200 bytes, so this is a few MB in a phone's web view. Every folder
 * costs one more than its entries, so a thousand empty folders are bounded too. It is not a hard
 * cap: the pinned folders and the one just written stay whatever they weigh, and each host has its
 * own `Folders`, so N servers can hold N times this.
 */
export const MAX_ENTRIES = 10_000;
/**
 * First pages asked of the host at once. The daemon scans one folder at a time and refuses a request past a few
 * waiting (`busy`), so a burst (Show hidden over 30 open folders, a reveal down a deep path) waits here instead.
 */
export const LISTINGS_AT_ONCE = 2;
/** The cache key of one listing; `hidden` listings are kept apart (`hidden=1` is a different scan). */
export const folderKey = (path: string, hidden: boolean): string => `${hidden ? "1" : "0"}${path}`;

/** What is known of one folder: every page loaded so far, and what is being asked of it now. */
export interface Held {
  /** The pages loaded so far, merged: `entries` grows as the next pages arrive. */
  listing: Listing | null;
  /** The path field's request for the folder's first page is under way. */
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
 * records are bounded by `MAX_ENTRIES` in all, least recently used first. A pinned folder (one on
 * screen) is never removed, so a screen that names one always finds its record: `drop` of a pinned
 * folder lists it again in place, its old pages staying up until the new ones land. Holding a page
 * costs no request when it is shown again on a tab switch or a Back. The path field's folder is asked
 * for once typing settles, never once per keystroke. Records are keyed by canonical path; `~` is the
 * browser's to resolve (it knows home) before it asks here.
 */
export class Folders extends Store<FoldersView> {
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** One request at a time per folder: a second ask for the next page joins the first. */
  private readonly inflight = new Map<string, Promise<void>>();
  /** The newest request per folder: a page that lands after a newer request began belongs to the past and is dropped. */
  private readonly latest = new Map<string, number>();
  private serial = 0;
  /** The folders each owner has on screen (the browser's place, the outline's open folders, the Preview panel's folder). */
  private readonly pins = new Map<string, Set<string>>();
  /** First pages under way, at most `LISTINGS_AT_ONCE`; the rest wait their turn, the ones asked `behind` last. */
  private running = 0;
  private readonly waiting: { go: () => void; behind: boolean }[] = [];

  constructor(private readonly api: FsApi) {
    super({ held: new Map() });
  }

  /** The folders `owner` has on screen, replacing what it pinned before: they are not dropped for room. */
  pin(owner: string, paths: readonly { path: string; hidden: boolean }[]): void {
    if (paths.length === 0) this.pins.delete(owner);
    else this.pins.set(owner, new Set(paths.map((p) => folderKey(p.path, p.hidden))));
    const held = new Map(this.snapshot.held);
    this.trim(held);
    if (held.size !== this.snapshot.held.size) this.update({ held });
  }

  /** The folder the field names now: listed once typing settles, unless held or already under way. */
  ask(target: { path: string; hidden: boolean } | null): void {
    clearTimeout(this.timer);
    if (!target) return;
    if (this.answered(target.path, target.hidden)) {
      this.put(target.path, target.hidden, {});
      return;
    }
    // Checked again when the timer fires: Go may have listed the folder meanwhile.
    this.timer = setTimeout(() => { if (!this.answered(target.path, target.hidden)) void this.load(target.path, target.hidden); }, SETTLE_MS);
  }

  /** The folder is held, under way, or refused for a reason a second ask would not change. A failure for want of a connection is asked again: it may be back. */
  private answered(path: string, hidden: boolean): boolean {
    const record = this.snapshot.held.get(folderKey(path, hidden));
    return !!record && (record.loading || !!record.listing || (!!record.error && record.error.code !== "network"));
  }

  /**
   * Lists `path` now (Go cannot wait out the settle), or joins the listing under way. The refusal is the record's, not
   * thrown. `behind`: the folder is one of many asked together (the outline's open folders), so what the user is looking
   * at (the place, the Preview panel, the path field) goes first.
   */
  load(path: string, hidden: boolean, behind = false): Promise<void> {
    // Its state is written under `path`, so `path` must be the canonical one; `first` takes `~`.
    if (path === "~") return Promise.reject(new Error("Folders.load needs a canonical path"));
    return this.inflight.get(folderKey(path, hidden)) ?? this.relist(path, hidden, behind);
  }

  /** Starts a first-page listing whatever is under way; the older requests' pages are discarded when they land. */
  private relist(path: string, hidden: boolean, behind = false): Promise<void> {
    const key = folderKey(path, hidden);
    this.put(path, hidden, { loading: true, error: null });
    const done = this.first(path, hidden, behind).then(
      () => { this.put(path, hidden, { loading: false }); },
      (error: unknown) => { this.put(path, hidden, { loading: false, error: error instanceof HttpRefusal ? error : new HttpRefusal(0, "internal") }); },
    ).finally(() => { if (this.inflight.get(key) === done) this.inflight.delete(key); });
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
   * returns the listing; the pages held stay in view until it lands. The record is the canonical
   * path's, which the daemon names (`path` may be `~`).
   */
  async first(path: string, hidden: boolean, behind = false): Promise<Listing> {
    const ticket = this.begin(folderKey(path, hidden));
    const listing = await this.turn(behind, () => this.api.list(path, 0, hidden));
    if (this.landed(folderKey(path, hidden), ticket)) this.put(listing.path, hidden, { listing, error: null });
    return listing;
  }

  /** The next page of `path` after what is held; joins the request under way. */
  more(path: string, hidden: boolean): Promise<void> {
    const key = folderKey(path, hidden);
    const running = this.inflight.get(key);
    if (running) return running;
    const done = this.nextPage(path, hidden).finally(() => { if (this.inflight.get(key) === done) this.inflight.delete(key); });
    this.inflight.set(key, done);
    return done;
  }

  /** Every page of `path` not yet held, one request after another: the path field's "Load the rest". */
  async rest(path: string, hidden: boolean): Promise<void> {
    for (;;) {
      const have = this.peek(path, hidden);
      if (!have || have.entries.length >= have.total || have.truncated) return;
      await this.more(path, hidden);
      // A page that added nothing (the daemon's total moved) ends the loop instead of asking again.
      if ((this.peek(path, hidden)?.entries.length ?? 0) <= have.entries.length) return;
    }
  }

  /** A refresh or an upload changed `path`: its pages go, or if it is on screen they are replaced when the new ones land. */
  drop(path: string): void {
    const held = new Map(this.snapshot.held);
    const shown = [false, true].filter((hidden) => this.pinned(folderKey(path, hidden)));
    for (const hidden of [false, true]) if (!shown.includes(hidden)) held.delete(folderKey(path, hidden));
    this.update({ held });
    for (const hidden of shown) void this.relist(path, hidden);
  }

  /** Runs `ask` once fewer than `LISTINGS_AT_ONCE` first pages are under way; a finished one hands its turn on. */
  private async turn<T>(behind: boolean, ask: () => Promise<T>): Promise<T> {
    if (this.running < LISTINGS_AT_ONCE) this.running++;
    else await new Promise<void>((go) => { this.waiting.push({ go, behind }); });
    try {
      return await ask();
    } finally {
      const next = this.waiting.findIndex((w) => !w.behind);
      const [waiter] = this.waiting.splice(next < 0 ? 0 : next, 1);
      if (waiter) waiter.go();
      else this.running--;
    }
  }

  private pinned(key: string): boolean {
    for (const keys of this.pins.values()) if (keys.has(key)) return true;
    return false;
  }

  /** Whether `ticket` is still the newest request for `key`; the newest one is done, so the entry goes. */
  private landed(key: string, ticket: number): boolean {
    const newest = this.latest.get(key) === ticket;
    if (newest) this.latest.delete(key);
    return newest;
  }

  private begin(key: string): number {
    this.latest.set(key, ++this.serial);
    return this.serial;
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
      if (key === keep || this.pinned(key)) continue;
      held.delete(key);
      size -= weigh(record);
    }
  }

  private async nextPage(path: string, hidden: boolean): Promise<void> {
    const have = this.peek(path, hidden);
    if (!have || have.entries.length >= have.total) return;
    const ticket = this.begin(folderKey(path, hidden));
    const next = await this.api.list(path, have.entries.length, hidden);
    // A newer request began, or the folder was dropped, while this page was on its way: it belongs to the old pages.
    const now = this.peek(path, hidden);
    if (!this.landed(folderKey(path, hidden), ticket) || now !== have) return;
    this.put(path, hidden, { listing: { ...now, total: next.total, truncated: next.truncated, entries: [...now.entries, ...next.entries] } });
  }
}

const weigh = (record: Held): number => 1 + (record.listing?.entries.length ?? 0);
