// The path field's model (browser-behaviors.md "Files"), apart from the DOM and the network: typed
// text and the folder pages held in; the rows the list narrows to and what Enter does out. The
// rows are the outline core's, with the typed last segment as its filter. `folders.ts` holds and
// fetches the listings; the screen draws what this returns.
import type { FilesPlace } from "../platform/types";
import { shorten } from "./format";
import { folderKey, type Held } from "./folders";
import { outline, type Outline } from "./outline";
import { parentOf } from "./paths";

/** Typed text split at its last `/`. */
export interface Typed {
  /** The text through the last `/` as typed (`~/re` → `~/`). */
  prefix: string;
  /** What follows the last `/`: the name being narrowed to. */
  segment: string;
  /** The folder holding the segment, `.` and `..` resolved. */
  parent: string;
  /** The path the whole text names. */
  named: string;
}

/** `~`, `~/x` and `/x` are paths; anything else is not. */
const isPath = (text: string): boolean => text === "~" || text.startsWith("~/") || text.startsWith("/");

/** The typed path split at its last `/`, or null when the text is not a path. `..` stops at `/`. */
export function parseTyped(text: string, home: string): Typed | null {
  if (!isPath(text)) return null;
  const homed = !text.startsWith("/");
  const cut = text.lastIndexOf("/");
  const prefix = cut < 0 ? "~/" : text.slice(0, cut + 1);
  const resolve = (typed: string): string => {
    const stack = homed ? home.split("/").filter(Boolean) : [];
    for (const part of typed.slice(homed ? 1 : 0).split("/")) {
      if (part === "..") stack.pop();
      else if (part !== "" && part !== ".") stack.push(part);
    }
    return `/${stack.join("/")}`;
  };
  return { prefix, segment: cut < 0 ? "" : text.slice(cut + 1), parent: resolve(prefix), named: resolve(text) };
}

export interface FieldContext {
  /** The canonical `$HOME`, which `~` names. */
  home: string;
  /** The hidden-files toggle. */
  showHidden: boolean;
  /** The record `Folders` holds under a key (`folderKey`). */
  held: (key: string) => Held | undefined;
}

export interface FieldView {
  /** Null while the text is not a path. */
  typed: Typed | null;
  /** The listing to ask for once typing settles (`Folders.ask` skips one it holds); null when none is needed. */
  ask: { path: string; hidden: boolean } | null;
  /** What `Folders` holds of the typed parent. */
  record: Held | undefined;
  /** The typed parent's rows narrowed to the segment, with the selection. Rows exist only once a listing is held. */
  out: Outline;
  /** The text that steps the field to the typed parent's parent folder; null at `/`. */
  up: string | null;
}

const NOTHING: ReadonlySet<string> = new Set();
const EMPTY: Outline = { rows: [], rootLoaded: "none", selected: null };

/** `.` and `..` name folders, not names to narrow to. */
const isDots = (segment: string): boolean => segment === "." || segment === "..";

export function fieldView(text: string, ctx: FieldContext, selection: string | null): FieldView {
  const typed = parseTyped(text, ctx.home);
  if (!typed) return { typed, ask: null, record: undefined, out: EMPTY, up: null };
  // A name starting with `.` is a hidden file: it is asked for, whatever the toggle says.
  const hidden = ctx.showHidden || typed.segment.startsWith(".");
  const record = ctx.held(folderKey(typed.parent, hidden));
  const up = typed.parent === "/" ? null : upText(typed.parent, ctx.home);
  const out = outline({
    root: typed.parent,
    parent: up === null ? null : parentOf(typed.parent),
    expanded: NOTHING,
    held: (path) => (path === typed.parent ? (record?.listing ?? null) : null),
    filter: isDots(typed.segment) ? "" : typed.segment,
    selection,
  });
  return { typed, ask: { path: typed.parent, hidden }, record, out, up };
}

/** The field's text for the folder above `path`: `~/repos/muxen` → `~/repos/`. */
function upText(path: string, home: string): string {
  const up = parentOf(path);
  return up === "/" ? "/" : `${shorten(up, home)}/`;
}

/** What Enter does: open a place, step the field up, say why not (null: the list already shows the refusal), ask the host what the path is, or wait for the typed parent's listing. */
export type Go = { open: FilesPlace } | { up: string } | { say: string | null } | { resolve: string } | { wait: true };

/** Enter opens the selected row (the first match, with a segment typed), else what the text names. */
export function enter(view: FieldView, home: string): Go {
  const { typed, record, out } = view;
  if (!typed) return { say: "Start with ~ or /" };
  if (isDots(typed.segment)) return { open: { kind: "dir", path: typed.named } };
  const row = out.rows.find((r) => r.key === out.selected);
  if (row?.kind === "up") return view.up === null ? { say: null } : { up: view.up };
  if (row?.place) return { open: row.place };
  if (typed.segment === "") return { open: { kind: "dir", path: typed.named } };
  if (record?.error) return { say: null };
  if (!record?.listing) return { wait: true };
  // Pages not loaded yet may hold the name: the host decides.
  return out.rootLoaded === "all" ? { say: `Nothing named ${typed.segment} in ${shorten(typed.parent, home)}` } : { resolve: typed.named };
}
