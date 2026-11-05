// A file API over an in-memory tree, following fs.md's rules closely enough for the
// browser model's tests: any listed directory opens, dirs sort first, pages of `page` entries. Paths are already canonical.
import { HttpRefusal } from "../../net/http";
import type { Entry, FsApi, Listing } from "../../files/api";
import type { Match, Search } from "../../proto/generated/messages";
import type { FakeDaemon } from ".";

export interface FakeTree {
  home: string;
  /** Directory paths and file paths (with their mime); parents are implied. */
  dirs: string[];
  files: Record<string, string>;
  /** Sizes and times (unix seconds) by path; a file without one is 10 bytes from 1970, a folder has no time. */
  stats?: Record<string, { size?: number; mtime?: number }>;
}

export class FakeFs implements FsApi {
  calls: string[] = [];
  /** Answers wait for `release()` while set, so a test can interleave them. */
  hold = false;
  /** Every call fails as a dead network does. */
  offline = false;
  private held: (() => void)[] = [];

  constructor(readonly tree: FakeTree, readonly page = 3) {}

  release(): void {
    const waiting = this.held;
    this.held = [];
    for (const go of waiting) go();
  }

  list(path: string, offset: number, hidden: boolean): Promise<Listing> {
    // `~` names the home folder, as the real list route is assumed to answer it.
    return this.answer(`list ${path} ${String(offset)}`, () => this.listing(path === "~" ? this.tree.home : path, offset, hidden));
  }

  probe(path: string): Promise<{ kind: "dir" } | { kind: "file"; mime: string | null; size: number | null }> {
    return this.answer(`probe ${path}`, () => {
      if (this.tree.dirs.includes(path)) return { kind: "dir" as const };
      const mime = this.tree.files[path];
      if (mime === undefined) throw new HttpRefusal(404, "not_found");
      return { kind: "file" as const, mime, size: this.tree.stats?.[path]?.size ?? 10 };
    });
  }

  text(path: string): Promise<{ text: string; size: number; truncated: boolean }> {
    if (this.tree.files[path] === undefined) return Promise.reject(new HttpRefusal(404, "not_found"));
    return Promise.resolve({ text: "", size: 0, truncated: false });
  }

  search(path: string, q: string, hidden: boolean): Promise<Search> {
    return this.answer(`search ${path} ${q}`, () => this.found(path === "~" ? this.tree.home : path, q, hidden));
  }

  rawUrl(path: string): string {
    return `fake://h/fs/raw${path}`;
  }

  /**
   * A stand-in for the daemon's search walk (fs.md "GET /fs/search"): every entry below `root`, skipping what the walk
   * skips, matched by a plain subsequence per term (fuzzy) or a glob, nearer first. Close enough to draw; the real
   * ranking is the daemon's.
   */
  private found(root: string, q: string, hidden: boolean): Search {
    if (!this.tree.dirs.includes(root)) throw new HttpRefusal(404, this.tree.files[root] ? "not_a_directory" : "not_found");
    const prefix = root === "/" ? "/" : `${root}/`;
    const skipped = (rel: string): boolean => rel.split("/").some((seg, i, all) => (!hidden && seg.startsWith(".")) || (i < all.length - 1 && [".git", "node_modules", "target"].includes(seg)));
    const below = [...this.tree.dirs, ...Object.keys(this.tree.files)].filter((p) => p.startsWith(prefix) && p !== root).map((p) => p.slice(prefix.length)).filter((rel) => !skipped(rel));
    const glob = /[*?]/.test(q);
    const matches: { rel: string; hits: [number, number][] }[] = [];
    for (const rel of below) {
      const hits = glob ? globHits(q, rel) : fuzzyHits(q, rel);
      if (hits) matches.push({ rel, hits });
    }
    matches.sort((a, b) => a.rel.split("/").length - b.rel.split("/").length || a.rel.length - b.rel.length || (a.rel < b.rel ? -1 : 1));
    const entry = (rel: string): Entry => {
      const path = prefix + rel;
      const name = rel.slice(rel.lastIndexOf("/") + 1);
      const stat = this.tree.stats?.[path];
      if (this.tree.dirs.includes(path)) return { name, kind: "dir", link: false, ...(stat?.mtime !== undefined && { mtime: stat.mtime }) };
      return { name, kind: "file", link: false, size: stat?.size ?? 10, mtime: stat?.mtime ?? 0, mime: this.tree.files[path] ?? "" };
    };
    return {
      path: root,
      matches: matches.slice(0, 50).map(({ rel, hits }): Match => ({ ...entry(rel), path: rel, hits })),
      read: below.length,
      stopped: null,
    };
  }

  private listing(path: string, offset: number, hidden: boolean): Listing {
    if (!this.tree.dirs.includes(path)) throw new HttpRefusal(404, this.tree.files[path] ? "not_a_directory" : "not_found");
    const childOf = (p: string): string | null => {
      const rest = p.slice(path === "/" ? 1 : path.length + 1);
      return p.startsWith(path === "/" ? "/" : `${path}/`) && p !== path && !rest.includes("/") ? rest : null;
    };
    const entries: Entry[] = [
      ...this.tree.dirs.flatMap((d) => {
        const name = childOf(d);
        const mtime = this.tree.stats?.[d]?.mtime;
        return name ? [{ name, kind: "dir" as const, link: false, ...(mtime !== undefined && { mtime }) }] : [];
      }),
      ...Object.entries(this.tree.files).flatMap(([f, mime]) => {
        const name = childOf(f);
        const stat = this.tree.stats?.[f];
        return name ? [{ name, kind: "file" as const, link: false, size: stat?.size ?? 10, mtime: stat?.mtime ?? 0, mime }] : [];
      }),
    ].filter((e) => hidden || !e.name.startsWith("."));
    return {
      path,
      parent: path === "/" ? null : path.slice(0, Math.max(1, path.lastIndexOf("/"))),
      total: entries.length,
      offset,
      truncated: false,
      entries: entries.slice(offset, offset + this.page),
    };
  }

  private answer<T>(call: string, body: () => T): Promise<T> {
    this.calls.push(call);
    const run = (): Promise<T> => new Promise((resolve, reject) => { if (this.offline) reject(new HttpRefusal(0, "network")); else resolve(body()); });
    if (!this.hold) return run();
    return new Promise((resolve, reject) => { this.held.push(() => { run().then(resolve, reject); }); });
  }
}

/** Each term of `q` (split on spaces) as a subsequence, in the last segment if it fits there, else the whole path; smart case. */
function fuzzyHits(q: string, rel: string): [number, number][] | null {
  const fold = q === q.toLowerCase();
  const text = fold ? rel.toLowerCase() : rel;
  const hit = new Set<number>();
  for (const term of q.split(" ").filter(Boolean)) {
    const at = (from: number): number[] | null => {
      const found: number[] = [];
      let i = from;
      for (const ch of fold ? term.toLowerCase() : term) {
        i = text.indexOf(ch, i);
        if (i < 0) return null;
        found.push(i++);
      }
      return found;
    };
    const found = at(rel.lastIndexOf("/") + 1) ?? at(0);
    if (!found) return null;
    for (const i of found) hit.add(i);
  }
  return runsOf([...hit].sort((a, b) => a - b));
}

/** `*` and `?` within a segment, `**` across them; with no `/`, against the last segment. The hits are the literal runs. */
function globHits(q: string, rel: string): [number, number][] | null {
  const segment = !q.includes("/");
  const base = segment ? rel.lastIndexOf("/") + 1 : 0;
  const text = rel.slice(base);
  let source = "";
  for (const part of q.split(/(\*\*\/?|\*|\?)/)) {
    if (part === "") continue;
    if (part.startsWith("**")) source += part.endsWith("/") ? "(?:.*/)?" : ".*";
    else if (part === "*") source += "[^/]*";
    else if (part === "?") source += "[^/]";
    else source += `(${part.replace(/[.+^${}()|[\]\\]/g, "\\$&")})`;
  }
  const m = new RegExp(`^${source}$`, q === q.toLowerCase() ? "di" : "d").exec(text);
  if (!m?.indices) return null;
  return m.indices.slice(1).flatMap((r) => (r ? [[r[0] + base, r[1] + base] as [number, number]] : []));
}

const runsOf = (at: number[]): [number, number][] => {
  const runs: [number, number][] = [];
  for (const i of at) {
    const last = runs[runs.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else runs.push([i, i + 1]);
  }
  return runs;
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** `/home/a%20b` → `/home/a b`: the inverse of the client's per-segment percent-encoding. */
const decodePath = (encoded: string): string => encoded.split("/").map(decodeURIComponent).join("/");

/**
 * The daemon's `/fs/*` routes (fs.md "Routes") over `fs`, for `FakeDaemon.fs`: the app's real
 * HTTP client talks to the tree. A raw read answers the whole file as 206 with its
 * `Content-Range`, which the client's one-byte probe and its text preview both accept.
 */
export function serveFs(fs: FakeFs): NonNullable<FakeDaemon["fs"]> {
  const page = (query: URLSearchParams): [number, boolean] => [Number(query.get("offset") ?? 0), query.get("hidden") === "1"];
  const route = async ({ method, path, query }: Parameters<NonNullable<FakeDaemon["fs"]>>[0]): Promise<Response> => {
    // `~` and `~/…` ride bare after the route's `/` (the client's `url`).
    const at = (prefix: string): string => {
      const rest = decodePath(path.slice(prefix.length));
      return rest.startsWith("/~") ? rest.slice(1) : rest;
    };
    if (method === "GET" && path.startsWith("/fs/list/")) return json(200, await fs.list(at("/fs/list"), ...page(query)));
    if (method === "GET" && path.startsWith("/fs/search/")) return json(200, await fs.search(at("/fs/search"), query.get("q") ?? "", query.get("hidden") === "1"));
    if (method === "GET" && path.startsWith("/fs/raw/")) {
      const target = at("/fs/raw");
      const probed = await fs.probe(target);
      if (probed.kind === "dir") throw new HttpRefusal(400, "not_a_file");
      const { text } = await fs.text(target);
      if (text === "") throw new HttpRefusal(416, "bad_range");
      const bytes = new TextEncoder().encode(text).length;
      return new Response(text, { status: 206, headers: { "Content-Type": probed.mime ?? "application/octet-stream", "Content-Range": `bytes 0-${String(bytes - 1)}/${String(bytes)}` } });
    }
    return json(404, { error: "not_found" });
  };
  return (request) => route(request).catch((error: unknown) => {
    if (error instanceof HttpRefusal) return json(error.status, { error: error.code });
    throw error;
  });
}
