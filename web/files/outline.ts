// The Files list's one model, apart from the DOM and the network (like workspace/state.ts): a root
// folder, the folders expanded under it, the pages held of each, a filter and the selection in; the
// rows to draw and the selection moves out. The phone's flat list is this with nothing expanded; the
// path field's narrowed list is this with a filter. Rows are named by `key`, so a selection survives
// a page arriving or a folder expanding.
import type { Entry, Listing } from "./api";
import { entryPlace } from "./browser";
import type { FilesPlace } from "../platform/types";
import { join } from "./paths";

/** How much of a folder is held: nothing, some pages (more can be asked for), or all of it. A folder the daemon cut short at its scan cap is never all. */
export type Loaded = "none" | "some" | "all";

export interface OutlineRow {
  /** The row's name in selections: the entry's path, or `..` for the up row. */
  key: string;
  kind: "up" | "dir" | "file" | "other" | "broken";
  name: string;
  /** Folders opened above this row; 0 for the root's own rows. */
  depth: number;
  entry: Entry | null;
  /** Where opening the row goes; null for what cannot open. */
  place: FilesPlace | null;
  /** A folder row shown open, its rows below it. */
  expanded: boolean;
  /** For a folder row that is expanded, how much of it is held. */
  loaded: Loaded;
}

export interface OutlineInput {
  /** The folder the rows are of. */
  root: string;
  /** The folder above the root, for the up row; null at `/`. */
  parent: string | null;
  expanded: ReadonlySet<string>;
  /** The pages held of a folder, if any. */
  held: (path: string) => Listing | null;
  /** Narrows the root's own rows; folders and files alike. */
  filter: string;
  selection: string | null;
}

export interface Outline {
  rows: OutlineRow[];
  /** How much of the root is held: when not all, a filter only sees what is loaded. */
  rootLoaded: Loaded;
  /** The row the selection names, or with a filter and no (visible) selection the first match: what Enter opens. Null when none. */
  selected: string | null;
}

export const UP = "..";

/** Matches as the daemon sorts: ASCII letters folded, nothing else. */
const fold = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

export const loadedOf = (listing: Listing | null): Loaded =>
  !listing ? "none" : listing.entries.length >= listing.total && !listing.truncated ? "all" : "some";

/** The entries a filter keeps: names that start with it, then names that contain it, each in the daemon's order. */
export function narrow(entries: readonly Entry[], filter: string): Entry[] {
  const wanted = fold(filter);
  if (wanted === "") return [...entries];
  const starts: Entry[] = [];
  const holds: Entry[] = [];
  for (const entry of entries) {
    const at = fold(entry.name).indexOf(wanted);
    if (at === 0) starts.push(entry);
    else if (at > 0) holds.push(entry);
  }
  return [...starts, ...holds];
}

export function outline(input: OutlineInput): Outline {
  const { root, parent, expanded, held, filter, selection } = input;
  const rows: OutlineRow[] = [];
  if (parent !== null) rows.push({ key: UP, kind: "up", name: "..", depth: 0, entry: null, place: { kind: "dir", path: parent }, expanded: false, loaded: "none" });
  const add = (dir: string, depth: number, entries: readonly Entry[]): void => {
    for (const entry of entries) {
      const path = join(dir, entry.name);
      const open = entry.kind === "dir" && entry.utf8 !== false && expanded.has(path);
      const listing = open ? held(path) : null;
      rows.push({ key: path, kind: entry.kind, name: entry.name, depth, entry, place: entryPlace(dir, entry), expanded: open, loaded: open ? loadedOf(listing) : "none" });
      if (listing) add(path, depth + 1, listing.entries);
    }
  };
  const top = held(root);
  add(root, 0, top ? narrow(top.entries, filter) : []);
  const keys = new Set(rows.map((r) => r.key));
  const first = rows.find((r) => r.kind !== "up")?.key ?? null;
  const selected = selection !== null && keys.has(selection) ? selection : filter !== "" ? first : null;
  return { rows, rootLoaded: loadedOf(top), selected };
}

export type Move = "up" | "down" | "left" | "right" | "parent" | "first" | "last";

/** What a move asks: a new selection, and maybe a folder to open or close in place. */
export interface Moved {
  selection: string | null;
  expand?: string;
  collapse?: string;
}

/**
 * Where the selection goes. Up and down step one row and stop at the ends; with nothing selected,
 * down takes the first row and up the last. Right opens a closed folder, else steps into an open
 * one; left closes an open folder, else steps to the folder holding the row. `parent` steps to the
 * holding folder without closing anything.
 */
export function move(rows: readonly OutlineRow[], selection: string | null, by: Move): Moved {
  const at = rows.findIndex((r) => r.key === selection);
  const row = rows[at];
  const last = rows.length - 1;
  const to = (index: number): Moved => ({ selection: rows[Math.max(0, Math.min(last, index))]?.key ?? null });
  const holder = (): Moved => {
    if (!row || row.depth === 0) return { selection };
    for (let i = at - 1; i >= 0; i--) if ((rows[i]?.depth ?? 0) < row.depth) return to(i);
    return { selection };
  };
  switch (by) {
    case "first": return to(0);
    case "last": return to(last);
    case "down": return at < 0 ? to(0) : to(at + 1);
    case "up": return at < 0 ? to(last) : to(at - 1);
    case "parent": return holder();
    case "right":
      if (!row || row.kind !== "dir" || row.place === null) return { selection };
      return row.expanded ? (rows[at + 1] && rows[at + 1]?.depth === row.depth + 1 ? to(at + 1) : { selection }) : { selection, expand: row.key };
    case "left":
      return row?.expanded ? { selection, collapse: row.key } : holder();
  }
}
