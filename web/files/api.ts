// The file API client (fs.md). Hand-written wire types until src/proto/fs.rs is generated
// for TypeScript like the WebSocket messages; keep them in step with fs.md "Routes".

import { HttpRefusal, readBody, send, sendJson } from "../net/http";
import type { CreateKind, CreateRequest, DeleteRequest, RenameRequest, Search } from "../proto/generated/messages";

export interface Entry {
  name: string;
  /** After following a link. */
  kind: "dir" | "file" | "other" | "broken";
  /** The entry itself is a symlink. */
  link: boolean;
  size?: number;
  /** Unix seconds; absent for "broken". */
  mtime?: number;
  /** Files: the type /fs/raw would send. */
  mime?: string;
  /** Present (false) only for a name that isn't UTF-8: listed, never openable. */
  utf8?: false;
}

export interface Listing {
  path: string;
  /** Null only at `/`. */
  parent: string | null;
  total: number;
  offset: number;
  truncated: boolean;
  entries: Entry[];
}

/** A file's first bytes as text, for the code and Markdown viewers. */
export interface TextPreview {
  text: string;
  /** The whole file's size, when the response says. */
  size: number | null;
  truncated: boolean;
  /** Of the file read; a save names it, so it can't replace a change made elsewhere. */
  etag: string | null;
  /** The file's one line ending, which a save keeps; null when an edit couldn't keep the file as it is (part of it read, not UTF-8, a BOM, mixed endings). */
  ending: "\n" | "\r\n" | null;
}

/** What a one-byte read says about a path: its type and size, or that it is a directory. */
export type Probe = { kind: "file"; mime: string | null; size: number | null } | { kind: "dir" };

export interface FsApi {
  list(path: string, offset: number, hidden: boolean): Promise<Listing>;
  probe(path: string): Promise<Probe>;
  text(path: string, limit: number, signal?: AbortSignal): Promise<TextPreview>;
  /** The best 50 files and folders below `path` whose relative path matches `q` (fs.md "GET /fs/search"). */
  search(path: string, q: string, hidden: boolean, signal: AbortSignal): Promise<Search>;
  /** The URL an `<img>` loads a file from. */
  rawUrl(path: string): string;
  /** The file's new text, if it is still `etag` (`*`: whatever it is), and its new ETag; `changed` if it moved (fs.md "PUT /fs/file"). */
  save(path: string, text: string, etag: string): Promise<string>;
  /** An empty file or a new folder; `exists` if the name is taken (fs.md "POST /fs/create"). */
  create(dir: string, name: string, kind: CreateKind): Promise<void>;
  /** A new name in the same folder; `exists` if it is taken (fs.md "POST /fs/rename"). */
  rename(dir: string, name: string, to: string): Promise<void>;
  /** Gone for good, a folder with all it holds (fs.md "POST /fs/delete"). */
  delete(dir: string, name: string): Promise<void>;
}

/** `/a/b c` → `/a/b%20c`: each segment percent-encoded, joined with `/` (fs.md "Routes"). */
export function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** The inverse of {@link encodePath} for a `/fs/raw/…` URL path; null for any other URL path. */
export function rawPathOf(urlPath: string): string | null {
  const prefix = "/fs/raw/";
  if (!urlPath.startsWith(prefix)) return null;
  try {
    const path = urlPath.slice(prefix.length).split("/").map(decodeURIComponent).join("/");
    return path.startsWith("~") ? path : `/${path}`;
  } catch {
    return null;
  }
}

/** `bytes 0-99/1234` → 1234; null when absent or unreadable (native must expose it). */
function totalOf(contentRange: string | null): number | null {
  const m = contentRange ? /\/(\d+)\s*$/.exec(contentRange) : null;
  return m?.[1] ? Number(m[1]) : null;
}

/** A file's bytes as text, and the one line ending that lets an editor keep every other byte as it is, if it has one. */
function decodeText(bytes: Uint8Array): { text: string; ending: TextPreview["ending"] } {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { text: new TextDecoder().decode(bytes), ending: null };
  }
  if (text.startsWith("\uFEFF")) return { text: text.slice(1), ending: null };
  const crlf = text.includes("\r\n");
  if (/\r(?!\n)/.test(text) || (crlf && /(?<!\r)\n/.test(text))) return { text, ending: null };
  return { text, ending: crlf ? "\r\n" : "\n" };
}

/**
 * The file API on one host's HTTP origin: `muxen-app://h-{host}` in the app, the dev
 * server's proxy on the desktop. Native (or the proxy) adds the Bearer token.
 */
export function httpFsApi(origin: string, fetchFn?: typeof fetch): FsApi {
  // An absolute path's own `/` is the route's; `~` and `~/…` ride bare after one (fs.md "Routes").
  const url = (route: string, path: string, query = ""): string => `${origin}/fs/${route}${path.startsWith("~") ? "/" : ""}${encodePath(path)}${query}`;
  const post = (request: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
  const json = <T>(target: string, init?: RequestInit): Promise<T> => sendJson<T>(target, init, fetchFn);
  const page = (offset: number, hidden: boolean): string => `?offset=${String(offset)}&hidden=${hidden ? "1" : "0"}`;

  return {
    // `~` is the daemon's $HOME (fs.md "Path resolution"), and a listing's path is canonical.
    list: (path, offset, hidden) => json<Listing>(url("list", path, page(offset, hidden))),

    async probe(path) {
      try {
        const res = await send(url("raw", path), { headers: { Range: "bytes=0-0" } }, fetchFn);
        void res.body?.cancel();
        const size = res.status === 206 ? totalOf(res.headers.get("Content-Range")) : Number(res.headers.get("Content-Length") ?? NaN);
        return { kind: "file", mime: res.headers.get("Content-Type"), size: Number.isFinite(size) ? size : null };
      } catch (error) {
        if (error instanceof HttpRefusal && error.code === "not_a_file") return { kind: "dir" };
        if (error instanceof HttpRefusal && error.code === "bad_range") return { kind: "file", mime: null, size: 0 }; // empty
        throw error;
      }
    },

    async text(path, limit, signal) {
      let res: Response;
      try {
        res = await send(url("raw", path), { headers: { Range: `bytes=0-${String(limit - 1)}` }, ...(signal && { signal }) }, fetchFn);
      } catch (error) {
        // An empty file has no range to read, and its 416 no ETag.
        if (!(error instanceof HttpRefusal && error.code === "bad_range")) throw error;
        res = await send(url("raw", path), { ...(signal && { signal }) }, fetchFn);
      }
      const bytes = new Uint8Array(await readBody(res, signal, (r) => r.arrayBuffer()));
      const size = res.status === 206 ? totalOf(res.headers.get("Content-Range")) : bytes.length;
      // Without Content-Range (a cross-origin header native may not expose), a full window means more may follow.
      const truncated = size !== null ? size > bytes.length : bytes.length >= limit;
      const { text, ending } = decodeText(bytes);
      const etag = res.headers.get("ETag");
      return { text, size, truncated, etag, ending: truncated || etag === null ? null : ending };
    },

    search: (path, q, hidden, signal) => json<Search>(url("search", path, `?q=${encodeURIComponent(q)}&hidden=${hidden ? "1" : "0"}`), { signal }),

    rawUrl: (path) => url("raw", path),

    save: async (path, text, etag) => {
      const res = await send(url("file", path), { method: "PUT", headers: { "If-Match": etag, "Content-Type": "text/plain; charset=utf-8" }, body: text }, fetchFn);
      return res.headers.get("ETag") ?? etag;
    },

    create: async (dir, name, kind) => {
      const request: CreateRequest = { dir, name, kind };
      await send(`${origin}/fs/create`, post(request), fetchFn);
    },

    rename: async (dir, name, to) => {
      const request: RenameRequest = { dir, name, to };
      await send(`${origin}/fs/rename`, post(request), fetchFn);
    },

    delete: async (dir, name) => {
      const request: DeleteRequest = { dir, name };
      await send(`${origin}/fs/delete`, post(request), fetchFn);
    },
  };
}
