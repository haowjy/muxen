import { HttpRefusal } from "../net/http";
import { Store } from "../ui/store";
import type { FsApi, Listing } from "./api";
import { fold } from "./outline";
import { baseName, within } from "./paths";

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
 * Pages asked of the host at once. The daemon scans one folder at a time and refuses a request past a few waiting
 * (`busy`), so a burst (Show hidden over 30 open folders, a reveal down a deep path of big folders) waits here instead.
 */
export const LISTINGS_AT_ONCE = 2;
/** The cache key of one listing; `hidden` listings are kept apart (`hidden=1` is a different scan). */
export const folderKey = (path: string, hidden: boolean): string => `${hidden ? "1" : "0"}${path}`;
const folderOf = (key: string): string => key.slice(1);

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
 * for once typing settles, never once per keystroke. Records are keyed by canonical path, and a symlink's also by the link's own (the row that names it); `~` is the
 * browser's to resolve (it knows home) before it asks here.
 */
export class Folders extends Store<FoldersView> {
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** One request at a time per folder: a second ask for the next page joins the first. */
  private readonly inflight = new Map<string, Promise<void>>();
  /** A folder's links seen so far, by its canonical path: each holds its own record, which `drop` must reach. */
  private readonly links = new Map<string, ReadonlySet<string>>();
  /** The newest request per folder: a page that lands after a newer request began belongs to the past and is dropped. */
  private readonly latest = new Map<string, number>();
  private serial = 0;
  /** The folders each owner has on screen (the browser's place, the outline's open folders). */
  private readonly pins = new Map<string, Set<string>>();
  /** Pages under way, at most `LISTINGS_AT_ONCE`; the rest wait their turn, by folder, the ones asked `behind` last. */
  private running = 0;
  private readonly waiting: { key: string; go: () => void; behind: boolean }[] = [];

  /** The folder the field names now, asked again when the server answers after it failed. */
  private asked: { path: string; hidden: boolean } | null = null;

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
    this.asked = target;
    if (!target) return;
    if (this.answered(target.path, target.hidden)) {
      this.put(target.path, target.hidden, {});
      return;
    }
    // Checked again when the timer fires: Go may have listed the folder meanwhile.
    this.timer = setTimeout(() => { if (!this.answered(target.path, target.hidden)) void this.load(target.path, target.hidden); }, SETTLE_MS);
  }

  /**
   * The server answers again: pinned folders and the one the field asked for, whose last listing failed for want of a
   * connection, are listed again, except `except`, which the caller lists itself. An unpinned record is asked for again when something wants it (`answered`).
   */
  async recovered(except?: string): Promise<void> {
    const asked = this.asked && folderKey(this.asked.path, this.asked.hidden);
    const failed = [...this.snapshot.held].filter(([key, record]) => key !== except && record.error?.code === "network" && !record.loading && (key === asked || this.pinned(key)));
    await Promise.all(failed.map(([key]) => this.relist(folderOf(key), key.startsWith("1"))));
  }

  /** The folder is held, under way, or refused for a reason a second ask would not change. A failure for want of a connection is asked again: it may be back. */
  private answered(path: string, hidden: boolean): boolean {
    const record = this.snapshot.held.get(folderKey(path, hidden));
    return !!record && (record.loading || !!record.listing || (!!record.error && record.error.code !== "network"));
  }

  /**
   * Lists `path` now (Go cannot wait out the settle), or joins the listing under way. The refusal is the record's, not
   * thrown. `behind`: the folder is one of many asked together (the outline's open folders), so what the user is looking
   * at (the place, the path field) goes first; asked for again without `behind`, a queued folder
   * moves ahead of them.
   */
  load(path: string, hidden: boolean, behind = false): Promise<void> {
    // Its state is written under `path`, so `path` must be the canonical one; `first` takes `~`.
    if (path === "~") return Promise.reject(new Error("Folders.load needs a canonical path"));
    const key = folderKey(path, hidden);
    const running = this.inflight.get(key);
    if (!running) return this.relist(path, hidden, behind);
    if (!behind) this.ahead(key);
    return running;
  }

  /** A folder the user now looks at, queued behind the outline's: it waits only for what the user asked before it. */
  private ahead(key: string): void {
    for (const waiter of this.waiting) if (waiter.key === key) waiter.behind = false;
  }

  /** Starts a first-page listing whatever is under way; the older requests' pages are discarded when they land. */
  private relist(path: string, hidden: boolean, behind = false): Promise<void> {
    const key = folderKey(path, hidden);
    this.put(path, hidden, { loading: true, error: null });
    const done = this.first(path, hidden, behind).then(
      () => { if (this.inflight.get(key) === done) this.put(path, hidden, { loading: false }); },
      (error: unknown) => { if (this.inflight.get(key) === done) this.put(path, hidden, { loading: false, error: error instanceof HttpRefusal ? error : new HttpRefusal(0, "internal") }); },
    ).finally(() => { if (this.inflight.get(key) === done) this.inflight.delete(key); });
    this.inflight.set(key, done);
    return done;
  }

  /** The pages held of `path`, if any. */
  peek(path: string, hidden: boolean): Listing | null {
    return this.snapshot.held.get(folderKey(path, hidden))?.listing ?? null;
  }

  /** Like {@link peek}, but waits for a fetch under way instead of asking again; one queued behind the outline's moves ahead. */
  async settled(path: string, hidden: boolean): Promise<Listing | null> {
    const key = folderKey(path, hidden);
    this.ahead(key);
    await this.inflight.get(key);
    return this.peek(path, hidden);
  }

  /**
   * Replaces `path`'s pages with its first page, fresh from the host (a first visit, a refresh), and
   * returns the listing; the pages held stay in view until it lands. The record is the canonical
   * path's, which the daemon names (`path` may be `~`).
   */
  async first(path: string, hidden: boolean, behind = false): Promise<Listing> {
    const key = folderKey(path, hidden);
    const ticket = this.begin(key);
    const listing = await this.turn(key, behind, () => this.api.list(path, 0, hidden));
    if (this.landed(key, ticket)) {
      this.put(listing.path, hidden, { listing, error: null });
      // A symlink's listing is named for its target; the link, a row of its own, is held too or it stays "Loading".
      if (listing.path !== path && path.startsWith("/")) {
        this.put(path, hidden, { listing, error: null });
        this.links.set(listing.path, new Set(this.links.get(listing.path)).add(path));
      }
    }
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

  /**
   * Every page of `path` not yet held, one request after another: the path field's "Load the rest". With `until`, only
   * until that name is held or the pages have sorted past where it would be (it is gone): a reveal needs its row, which
   * a folder of more than a page may sort past the first. `until.dir` unknown is given as false: a file sorts after the
   * folder of the same name, so the paging stops no earlier. The first page is asked for (ahead of the outline's) if
   * none is held. A refused page rejects.
   */
  async rest(path: string, hidden: boolean, until?: { name: string; dir: boolean }): Promise<void> {
    if (!this.peek(path, hidden)) await this.load(path, hidden);
    for (;;) {
      const have = this.peek(path, hidden);
      if (!have || have.entries.length >= have.total || have.truncated) return;
      const last = have.entries.at(-1);
      if (until && last && (have.entries.some((e) => e.name === until.name) || sortsBefore(until, { name: last.name, dir: last.kind === "dir" }))) return;
      await this.more(path, hidden);
      // A page that added nothing (the daemon's total moved) ends the loop instead of asking again.
      if ((this.peek(path, hidden)?.entries.length ?? 0) <= have.entries.length) return;
    }
  }

  /**
   * A refresh or an upload changed `path`: its pages go, and those of the links seen to it, or if they are on screen
   * they are replaced when the new ones land, which the answer waits for.
   */
  async drop(path: string): Promise<void> {
    const held = new Map(this.snapshot.held);
    const shown: { folder: string; hidden: boolean }[] = [];
    for (const folder of [path, ...(this.links.get(path) ?? [])]) {
      for (const hidden of [false, true]) {
        const key = folderKey(folder, hidden);
        if (this.pinned(key)) shown.push({ folder, hidden });
        else this.evict(held, key);
      }
    }
    this.update({ held });
    await Promise.all(shown.map(({ folder, hidden }) => this.relist(folder, hidden)));
  }

  /**
   * `dir`'s entries changed: its listing goes first, alone. With `gone`, what was at that path left it: the row leaves
   * the pages at once, and every folder held at or under it goes. One still on screen once the new listing has landed
   * is listed again, which finds it missing; the outline has let go of the rest, so they cost no request.
   */
  async changed(dir: string, gone: string | null = null): Promise<void> {
    const held = new Map(this.snapshot.held);
    const under = gone === null ? [] : [...held.keys()].filter((key) => within(folderOf(key), gone));
    if (gone !== null) {
      for (const key of under) if (!this.pinned(key)) this.evict(held, key);
      for (const folder of [dir, ...(this.links.get(dir) ?? [])]) {
        for (const hidden of [false, true]) {
          const record = held.get(folderKey(folder, hidden));
          if (!record?.listing) continue;
          const entries = record.listing.entries.filter((entry) => entry.name !== baseName(gone));
          const total = record.listing.total - (record.listing.entries.length - entries.length);
          held.set(folderKey(folder, hidden), { ...record, listing: { ...record.listing, entries, total } });
        }
      }
    }
    this.update({ held });
    await this.drop(dir);
    const after = new Map(this.snapshot.held);
    const still = under.filter((key) => after.has(key));
    for (const key of still) if (!this.pinned(key)) this.evict(after, key);
    this.update({ held: after });
    await Promise.all(still.filter((key) => this.pinned(key)).map((key) => this.relist(folderOf(key), key.startsWith("1"))));
  }

  /** The record goes, and an answer under way is from before the change, so it can't bring it back. */
  private evict(held: Map<string, Held>, key: string): void {
    held.delete(key);
    this.latest.delete(key);
    this.inflight.delete(key);
  }

  /** Runs `ask` once fewer than `LISTINGS_AT_ONCE` pages are under way; a finished one hands its turn on. */
  private async turn<T>(key: string, behind: boolean, ask: () => Promise<T>): Promise<T> {
    if (this.running < LISTINGS_AT_ONCE) this.running++;
    else await new Promise<void>((go) => { this.waiting.push({ key, go, behind }); });
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
    const next = await this.turn(folderKey(path, hidden), false, () => this.api.list(path, have.entries.length, hidden));
    // A newer request began, or the folder was dropped, while this page was on its way: it belongs to the old pages.
    const now = this.peek(path, hidden);
    if (!this.landed(folderKey(path, hidden), ticket) || now !== have) return;
    this.put(path, hidden, { listing: { ...now, total: next.total, truncated: next.truncated, entries: [...now.entries, ...next.entries] } });
  }
}

const weigh = (record: Held): number => 1 + (record.listing?.entries.length ?? 0);

/**
 * Whether `a` sorts before `b` in a listing, as the daemon sorts (`src/fs/list.rs`): folders first, then the name's
 * UTF-8 bytes with ASCII letters folded, ties by bytes. A name that is not UTF-8 comes lossy and may sort elsewhere.
 */
function sortsBefore(a: { name: string; dir: boolean }, b: { name: string; dir: boolean }): boolean {
  if (a.dir !== b.dir) return a.dir;
  const folded = compareBytes(fold(a.name), fold(b.name));
  return (folded === 0 ? compareBytes(a.name, b.name) : folded) < 0;
}

const utf8 = new TextEncoder();

function compareBytes(a: string, b: string): number {
  const x = utf8.encode(a);
  const y = utf8.encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  return x.length - y.length;
}
