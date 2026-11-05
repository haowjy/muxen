import { Component, type TargetedMouseEvent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Entry, Listing } from "../../files/api";
import { folderKey, type Held } from "../../files/folders";
import { formatAge, formatSize, formatTime } from "../../files/format";
import { outline, restFolder, type OutlineRow } from "../../files/outline";
import { baseName } from "../../files/paths";
import type { FilesPlace } from "../../platform/types";
import { cx } from "../../ui/cx";
import { Button } from "../../ui/primitives/Button";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { Icon } from "../../ui/primitives/Icon";
import { useFocusRef } from "../../ui/focus";
import { useLongPress } from "../../ui/longPress";
import { Spinner } from "../../ui/primitives/Spinner";
import { fileIcon } from "./fileIcon";
import { useListbox } from "./useListbox";
import styles from "./FolderList.module.css";

/** Why a row can't be opened, said where its size would be. */
function whyNot(entry: Entry): string | null {
  if (entry.utf8 === false) return "Name can't be opened";
  if (entry.kind === "broken") return "Broken link";
  if (entry.kind === "other") return "Not a file";
  return null;
}

interface RowListProps {
  rows: readonly OutlineRow[];
  selected: string | null;
  optionId: (key: string) => string;
  /** The entry just added by an upload or a paste: marked. */
  fresh?: string | null | undefined;
  /** The desktop's outline: rows are tree items, indented, folders with a disclosure. */
  tree?: boolean;
  /** What each `rest` row says, by its key. */
  notes?: ReadonlyMap<string, RestNote>;
  /** A click or tap on a row. */
  onPress: (row: OutlineRow, e: MouseEvent) => void;
  /** A double-click on a row. */
  onDouble?: (row: OutlineRow, e: MouseEvent) => void;
}

/** What an expanded folder's `rest` row says, and what choosing it does. */
export interface RestNote {
  /** What is known: "Loading", "Empty", why it failed. */
  words?: string;
  busy?: boolean;
  /** What a click or Enter on the row does, and its label. */
  action?: { label: string; act: "more" | "retry" };
}

/** The latest handlers, read when a row is pressed: a row is not redrawn for a new closure. */
type Act = { current: { onPress: RowListProps["onPress"]; onDouble: RowListProps["onDouble"] | undefined } };

interface FileRowProps {
  row: OutlineRow;
  id: string;
  selected: boolean;
  fresh: boolean;
  tree: boolean;
  note: RestNote | null;
  upName: string;
  /** The time ages count from: taken again whenever the rows are rebuilt (a new page, a refresh). */
  now: number;
  act: Act;
}

/** One line per folder level above a row, under its folder's disclosure: the outline's indent guides. */
function Guides({ depth }: { depth: number }) {
  return <>{Array.from({ length: depth }, (_, i) => <span key={i} class={styles.guide} style={{ "--level": i }} />)}</>;
}

/**
 * One option (a tree item in the outline). Folders and files read apart at a glance: a folder has the coloured icon,
 * a heavier name and a chevron (a disclosure before it in the outline, after it on the phone); a file has its kind's
 * muted icon and its size. Redrawn only when its own row, selection or mark changes, so an arrow key costs two rows,
 * not the folder.
 */
class FileRow extends Component<FileRowProps> {
  override shouldComponentUpdate(next: FileRowProps): boolean {
    const p = this.props;
    return next.row !== p.row || next.id !== p.id || next.selected !== p.selected || next.fresh !== p.fresh || next.upName !== p.upName || next.now !== p.now || next.note !== p.note || next.tree !== p.tree;
  }

  override render({ row, id, selected, fresh, tree, note, upName, now, act }: FileRowProps) {
    const { entry, place, depth } = row;
    const item = {
      id,
      role: tree ? ("treeitem" as const) : ("option" as const),
      "aria-selected": selected,
      ...(tree && { "aria-level": depth + 1 }),
      style: { "--depth": depth },
      onClick: (e: MouseEvent) => { act.current.onPress(row, e); },
      onDblClick: (e: MouseEvent) => { act.current.onDouble?.(row, e); },
    };
    if (row.kind === "rest") {
      return (
        <div {...item} class={cx(styles.row, styles.rest, selected && styles.selected)}>
          {tree && <Guides depth={depth} />}
          {tree && <span />}
          <span class={styles.icon}>{note?.busy && <Spinner label={note.words ?? ""} />}</span>
          <span class={styles.name}>
            {note?.words}
            {note?.action && <span class={styles.act}>{note.action.label}</span>}
          </span>
        </div>
      );
    }
    if (!entry) {
      return (
        <div {...item} aria-label={`Up to ${upName}`} class={cx(styles.row, styles.up, selected && styles.selected)}>
          {tree && <span />}
          <span class={cx(styles.icon, styles.folder)}><Icon name="folder" size={16} /></span>
          <span class={styles.name}>..</span>
        </div>
      );
    }
    const dir = entry.kind === "dir";
    const why = whyNot(entry);
    return (
      <div
        {...item}
        {...(tree && dir && place && { "aria-expanded": row.expanded })}
        aria-disabled={place === null || undefined}
        data-kind={dir ? "dir" : "file"}
        data-depth={depth}
        {...(fresh && { "data-fresh": "" })}
        class={cx(styles.row, dir && styles.dir, entry.name.startsWith(".") && styles.dotted, place === null && styles.disabled, selected && styles.selected)}
      >
        {tree && <Guides depth={depth} />}
        {tree && (dir && place ? <span class={styles.disclosure} data-disclosure><Icon name="chevron" size={16} class={cx(styles.chevronTurn, row.expanded && styles.open)} /></span> : <span />)}
        <span class={cx(styles.icon, dir && styles.folder)}><Icon name={dir ? "folder" : fileIcon(entry.name, entry.mime)} size={16} /></span>
        <span class={styles.name}>{entry.name}</span>
        {why !== null ? <span class={styles.why}>{why}</span> : (
          <>
            <span class={styles.size}>{entry.kind === "file" && entry.size !== undefined ? formatSize(entry.size) : ""}</span>
            {/* Changed in the last day: full text colour, so what just changed stands out. */}
            {entry.mtime !== undefined
              ? <span class={cx(styles.age, now / 1000 - entry.mtime < 86_400 && styles.recent)} title={`Modified ${formatTime(entry.mtime)}`}>{formatAge(entry.mtime, now)}</span>
              : <span class={styles.age} />}
          </>
        )}
        {dir && place && !tree && <Icon name="chevron" size={16} class={styles.chevron} />}
      </div>
    );
  }
}

/** The rows of a listbox (or the outline's tree), as options: the caller's container holds the focus and names the selected one by `optionId(selected)`. */
export function RowList({ rows, selected, optionId, fresh, tree = false, notes, onPress, onDouble }: RowListProps) {
  const act: Act = useRef({ onPress, onDouble });
  act.current = { onPress, onDouble };
  const now = useMemo(() => Date.now(), [rows]);
  const upName = baseName(rows[0]?.kind === "up" ? (rows[0].place?.path ?? "") : "") || "/";
  return (
    <>
      {rows.map((row) => (
        <FileRow key={row.key} row={row} id={optionId(row.key)} selected={row.key === selected} fresh={row.entry !== null && row.entry.name === fresh} tree={tree} note={notes?.get(row.key) ?? null} upName={upName} now={now} act={act} />
      ))}
    </>
  );
}

/** A row's menu, asked for at a point; `list` is the listbox, where focus goes back when the menu closes. */
export interface RowMenuAsk {
  row: OutlineRow;
  at: { x: number; y: number };
  list: HTMLElement;
}

interface FolderListboxProps {
  rows: readonly OutlineRow[];
  selected: string | null;
  fresh?: string | null | undefined;
  /** The desktop's outline: a click selects, the disclosure opens or closes a folder in place, a double-click or Enter goes in. */
  tree?: TreeProps | undefined;
  onSelect: (selection: string | null) => void;
  onOpen: (place: FilesPlace) => void;
  /** A key is about to open a place: the next list takes the keys on. */
  onKeyNavigate: () => void;
  /** The first row: up to the enclosing folder. Absent at `/`. */
  onUp?: (() => void) | undefined;
  /** A row's menu was asked for (right click, a held touch, Shift+F10 or the menu key), at this point. */
  onRowMenu?: ((ask: RowMenuAsk) => void) | undefined;
}

/** What the outline adds to a flat list. */
interface TreeProps {
  notes: ReadonlyMap<string, RestNote>;
  onToggle: (folder: string, open: boolean) => void;
  /** An expanded folder's `rest` row was chosen: show more of it, or ask for it again. */
  onRest: (folder: string, act: "more" | "retry") => void;
}

/** A folder's rows as the page's one focusable listbox (a tree on a desktop), which stays when the folder has no rows, so the keys work there too. */
function FolderListbox({ rows, selected, fresh, tree, onSelect, onOpen, onKeyNavigate, onUp, onRowMenu }: FolderListboxProps) {
  const ref = useFocusRef("list");
  /** The row a menu is for: one that opens something, never `..`. */
  const menuRow = (el: Element | null): OutlineRow | null => {
    const id = el?.closest("[role=option], [role=treeitem]")?.id;
    const row = id === undefined ? undefined : rows.find((r) => box.optionId(r.key) === id);
    return row && row.kind !== "up" && row.place ? row : null;
  };
  /** A pointer or a key selects the row the menu is for; a held touch leaves the phone's list unselected, as a tap does. */
  const ask = (row: OutlineRow, at: RowMenuAsk["at"], list: HTMLElement, select = true): void => {
    if (select) onSelect(row.key);
    onRowMenu?.({ row, at, list });
  };
  // One gesture for the whole list, found by the row under the press: rows are redrawn only for their own changes.
  const press = useLongPress<HTMLDivElement>(({ anchor, x, y, touch }) => {
    const row = menuRow(document.elementFromPoint(x, y));
    if (row) ask(row, { x, y }, anchor, !touch);
    return row !== null;
  });
  const goUp = onUp && (() => { onKeyNavigate(); onUp(); });
  const rest = (row: OutlineRow): void => {
    const action = tree?.notes.get(row.key)?.action;
    if (tree && action) tree.onRest(restFolder(row.key), action.act);
  };
  const box = useListbox({
    rows,
    selected,
    onSelect,
    onOpen: (row) => {
      if (row.kind === "rest") rest(row);
      if (!row.place) return;
      onKeyNavigate();
      if (row.kind === "up") onUp?.();
      else onOpen(row.place);
    },
    ...(goUp && { onUp: goUp }),
    ...(tree && { onToggle: tree.onToggle }),
  });
  /** The outline's click looks: it selects, and only a folder's disclosure opens or closes it in place. A flat list's tap opens. */
  const onPress = (row: OutlineRow, e: MouseEvent): void => {
    if (row.kind === "up") onUp?.();
    else if (!tree) { if (row.place) onOpen(row.place); }
    else if (onDisclosure(e)) tree.onToggle(row.key, !row.expanded);
    // The second click of a double-click is the double-click's: it doesn't ask for a folder's next page twice.
    else if (e.detail < 2) {
      onSelect(row.key);
      if (row.kind === "rest") rest(row);
    }
  };
  const onDouble = (row: OutlineRow, e: MouseEvent): void => {
    if (tree && row.kind !== "up" && row.place && !onDisclosure(e)) onOpen(row.place);
  };
  return (
    <div
      ref={ref}
      role={tree ? "tree" : "listbox"}
      aria-label="Contents"
      tabIndex={0}
      aria-activedescendant={box.activeId}
      class={cx(styles.list, tree && styles.tree)}
      onKeyDown={(e) => {
        if (onRowMenu && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) {
          const row = rows.find((r) => r.key === selected);
          const el = row ? document.getElementById(box.optionId(row.key)) : null;
          if (row && el && menuRow(el)) {
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            ask(row, { x: rect.left + 40, y: rect.bottom }, e.currentTarget);
          }
          return;
        }
        box.onKeyDown(e);
      }}
      {...(onRowMenu && {
        onPointerDown: press.onPointerDown,
        onPointerMove: press.onPointerMove,
        onPointerUp: press.onPointerUp,
        onPointerCancel: press.onPointerCancel,
        onContextMenu: (e: TargetedMouseEvent<HTMLDivElement>) => { if (menuRow(e.target as Element)) press.onContextMenu(e); },
        // The click that ends a held touch that opened the menu opens nothing.
        onClickCapture: (e: MouseEvent) => { if (press.swallowClick()) { e.stopPropagation(); e.preventDefault(); } },
      })}
    >
      <RowList rows={rows} selected={selected} optionId={box.optionId} fresh={fresh} tree={!!tree} {...(tree && { notes: tree.notes })} onPress={onPress} onDouble={onDouble} />
    </div>
  );
}

/** The press landed on a folder's disclosure: each click there opens or closes it, and a double-click goes nowhere. */
const onDisclosure = (e: MouseEvent): boolean => e.target instanceof Element && e.target.closest("[data-disclosure]") !== null;

/** A folder that was moved or deleted since the tab last showed it: only the way up remains. */
export function MissingFolder({ parent, onKeyNavigate }: { parent?: { path: string; onOpen: () => void }; onKeyNavigate: () => void }) {
  const [selection, setSelection] = useState<string | null>(null);
  const { rows, selected } = outline({ root: "", parent: parent?.path ?? null, expanded: new Set(), held: () => null, filter: "", selection });
  return (
    <div class={styles.wrap}>
      <FolderListbox rows={rows} selected={selected} onSelect={setSelection} onOpen={() => undefined} onKeyNavigate={onKeyNavigate} onUp={parent?.onOpen} />
      <EmptyState icon="folder" title="This folder no longer exists" />
    </div>
  );
}

export interface DirListProps {
  /** The pages held of the folder shown. */
  pages: Listing;
  hidden: boolean;
  loading: boolean;
  /** The entry just added by an upload or a paste: marked, and scrolled into view. */
  fresh?: string | null;
  onOpen: (place: FilesPlace) => void;
  /** The desktop's outline: the folders open in place and every record held, to draw them. Absent: one flat list. */
  outline?: OutlineProps | undefined;
  /** The selected row's key, as the tab last left it; changes go to `onSelect`. */
  selection: string | null;
  onSelect: (selection: string | null) => void;
  /** A key is about to open a place: the next list takes the keys on. */
  onKeyNavigate: () => void;
  onMore: () => void;
  onToggleHidden: () => void;
  /** The first row: up to the enclosing folder. Absent at `/`. */
  onUp?: () => void;
  onRowMenu?: (ask: RowMenuAsk) => void;
}

export interface OutlineProps {
  expanded: ReadonlySet<string>;
  held: ReadonlyMap<string, Held>;
  /** Why a folder's listing failed, in the file manager's words. */
  describe: (error: NonNullable<Held["error"]>) => string;
  onToggle: (folder: string, open: boolean) => void;
  onRest: (folder: string, act: "more" | "retry") => void;
  /** The folders open on screen now (every folder above them open too): each needs its listing, pinned while shown. */
  onShown: (folders: readonly string[]) => void;
}

/** What an expanded folder's rest row says: it is loading, failed, empty, too big, or has more to show. */
function restNote(record: Held | undefined, describe: OutlineProps["describe"]): RestNote {
  const listing = record?.listing ?? null;
  if (record?.error && !listing) return { words: describe(record.error), action: { label: "Try again", act: "retry" } };
  if (!listing) return { words: "Loading", busy: true };
  if (listing.entries.length === 0 && listing.total === 0) return { words: "Empty" };
  if (listing.truncated) return { words: "Too big to list in full" };
  if (record?.loading) return { words: "Loading more", busy: true };
  return { action: { label: `Show more (${(listing.total - listing.entries.length).toLocaleString()} left)`, act: "more" } };
}

/** The folder's rows: on a desktop the outline, its folders open in place; on the phone one flat list. */
export function DirList({ pages, hidden, loading, fresh, onOpen, outline: tree, selection, onSelect, onKeyNavigate, onMore, onToggleHidden, onUp, onRowMenu }: DirListProps) {
  const { entries, total, truncated } = pages;
  const parent = onUp ? (pages.parent ?? null) : null;
  const expanded = tree?.expanded;
  const held = tree?.held;
  const describe = tree?.describe;
  // The rows are rebuilt when the pages or the open folders change, never for a selection move, so the rows keep their identity.
  const { rows, notes } = useMemo(() => {
    const record = (path: string): Held | undefined => held?.get(folderKey(path, hidden));
    const out = outline({
      root: pages.path,
      parent,
      expanded: expanded ?? new Set(),
      held: (path) => (path === pages.path ? pages : record(path)?.listing ?? null),
      filter: "",
      selection: null,
    });
    const said = new Map<string, RestNote>();
    if (describe) for (const row of out.rows) if (row.kind === "rest") said.set(row.key, restNote(record(restFolder(row.key)), describe));
    return { rows: out.rows, notes: said };
  }, [pages, parent, expanded, held, hidden, describe]);
  const selected = rows.some((r) => r.key === selection) ? selection : null;
  const shown = rows.filter((r) => r.expanded).map((r) => r.key).join("\0");
  const onShown = useRef(tree?.onShown);
  onShown.current = tree?.onShown;
  useEffect(() => { onShown.current?.(shown === "" ? [] : shown.split("\0")); }, [shown, hidden]);
  const more = entries.length < total;
  const sentinel = useRef<HTMLDivElement>(null);
  const latest = useRef(onMore);
  latest.current = onMore;
  // The next page loads as the end of the list nears the screen.
  useEffect(() => {
    const el = sentinel.current;
    if (!more || !el) return undefined;
    const observer = new IntersectionObserver((seen) => { if (seen.some((s) => s.isIntersecting)) latest.current(); }, { rootMargin: "300px 0px" });
    observer.observe(el);
    return () => { observer.disconnect(); };
  }, [more, entries.length]);

  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => { wrap.current?.querySelector("[data-fresh]")?.scrollIntoView({ block: "nearest" }); }, [fresh, entries]);

  return (
    <div ref={wrap} class={styles.wrap} aria-busy={loading}>
      <FolderListbox
        rows={rows}
        selected={selected}
        fresh={fresh}
        tree={tree && { notes, onToggle: tree.onToggle, onRest: tree.onRest }}
        onSelect={onSelect}
        onOpen={onOpen}
        onKeyNavigate={onKeyNavigate}
        onUp={onUp}
        onRowMenu={onRowMenu}
      />
      {entries.length === 0 && <EmptyState icon="folder" title="This folder is empty">{hidden ? undefined : "Hidden files are not shown."}</EmptyState>}
      {more && (
        <div ref={sentinel} class={styles.more}>
          {loading ? <Spinner label="Loading more" /> : <Button variant="quiet" onClick={onMore}>Show more ({String(total - entries.length)} left)</Button>}
        </div>
      )}
      {truncated && <p class={styles.note}>This folder is too big to list in full. Use the terminal for the rest.</p>}
      <div class={styles.footer}>
        <Button variant="quiet" onClick={onToggleHidden}>{hidden ? "Hide hidden files" : "Show hidden files"}</Button>
      </div>
    </div>
  );
}
