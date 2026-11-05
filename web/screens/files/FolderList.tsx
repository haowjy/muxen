import { Component, type TargetedMouseEvent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Entry, Listing } from "../../files/api";
import { formatAge, formatSize, formatTime } from "../../files/format";
import { outline, type OutlineRow } from "../../files/outline";
import { baseName } from "../../files/paths";
import type { FilesPlace } from "../../platform/types";
import { cx } from "../../ui/cx";
import { Button } from "../../ui/primitives/Button";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { Icon } from "../../ui/primitives/Icon";
import { useFocusRef } from "../../ui/focus";
import { useLongPress } from "../../ui/longPress";
import { Spinner } from "../../ui/primitives/Spinner";
import type { OutlineView } from "./session";
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
  onOpen: (place: FilesPlace) => void;
  onUp?: () => void;
}

interface FileRowProps {
  row: OutlineRow;
  id: string;
  selected: boolean;
  fresh: boolean;
  upName: string;
  /** The time ages count from: taken again whenever the rows are rebuilt (a new page, a refresh). */
  now: number;
  /** The latest handlers, read when a row is tapped: a row is not redrawn for a new closure. */
  act: { current: { onOpen: (place: FilesPlace) => void; onUp: (() => void) | undefined } };
}

/**
 * One option. Folders and files read apart at a glance: a folder has the coloured icon, a heavier name and, on the
 * phone, a chevron; a file has its kind's muted icon and its size. Redrawn only when its own row, selection or mark
 * changes, so an arrow key costs two rows, not the folder.
 */
class FileRow extends Component<FileRowProps> {
  override shouldComponentUpdate(next: FileRowProps): boolean {
    const p = this.props;
    return next.row !== p.row || next.id !== p.id || next.selected !== p.selected || next.fresh !== p.fresh || next.upName !== p.upName || next.now !== p.now;
  }

  override render({ row, id, selected, fresh, upName, now, act }: FileRowProps) {
    const { entry, place } = row;
    if (!entry) {
      return (
        <div id={id} role="option" aria-selected={selected} aria-label={`Up to ${upName}`} class={cx(styles.row, styles.up, selected && styles.selected)} onClick={() => { act.current.onUp?.(); }}>
          <span class={cx(styles.icon, styles.folder)}><Icon name="folder" size={16} /></span>
          <span class={styles.name}>..</span>
        </div>
      );
    }
    const dir = entry.kind === "dir";
    const why = whyNot(entry);
    return (
      <div
        id={id}
        role="option"
        aria-selected={selected}
        aria-disabled={place === null || undefined}
        data-kind={dir ? "dir" : "file"}
        {...(fresh && { "data-fresh": "" })}
        class={cx(styles.row, dir && styles.dir, entry.name.startsWith(".") && styles.dotted, place === null && styles.disabled, selected && styles.selected)}
        onClick={() => { if (place) act.current.onOpen(place); }}
      >
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
        {dir && place && <Icon name="chevron" size={16} class={styles.chevron} />}
      </div>
    );
  }
}

/** The rows of a listbox, as options: the caller's container holds the focus and names the selected one by `optionId(selected)`. */
export function RowList({ rows, selected, optionId, fresh, onOpen, onUp }: RowListProps) {
  const act = useRef({ onOpen, onUp });
  act.current = { onOpen, onUp };
  const now = useMemo(() => Date.now(), [rows]);
  const upName = baseName(rows[0]?.kind === "up" ? (rows[0].place?.path ?? "") : "") || "/";
  return (
    <>
      {rows.map((row) => (
        <FileRow key={row.key} row={row} id={optionId(row.key)} selected={row.key === selected} fresh={row.entry !== null && row.entry.name === fresh} upName={upName} now={now} act={act} />
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
  onSelect: (selection: string | null) => void;
  onOpen: (place: FilesPlace) => void;
  /** A key is about to open a place: the next list takes the keys on. */
  onKeyNavigate: () => void;
  /** The first row: up to the enclosing folder. Absent at `/`. */
  onUp?: (() => void) | undefined;
  /** A row's menu was asked for (right click, a held touch, Shift+F10 or the menu key), at this point. */
  onRowMenu?: ((ask: RowMenuAsk) => void) | undefined;
}

/** A folder's rows as the page's one focusable listbox, which stays when the folder has no rows, so the keys work there too. */
function FolderListbox({ rows, selected, fresh, onSelect, onOpen, onKeyNavigate, onUp, onRowMenu }: FolderListboxProps) {
  const ref = useFocusRef("list");
  /** The row a menu is for: one that opens something, never `..`. */
  const menuRow = (el: Element | null): OutlineRow | null => {
    const id = el?.closest("[role=option]")?.id;
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
  });
  const goUp = onUp && (() => { onKeyNavigate(); onUp(); });
  const box = useListbox({
    rows,
    selected,
    onSelect,
    onOpen: (row) => {
      if (!row.place) return;
      onKeyNavigate();
      if (row.kind === "up") onUp?.();
      else onOpen(row.place);
    },
    ...(goUp && { onUp: goUp }),
  });
  return (
    <div
      ref={ref}
      role="listbox"
      aria-label="Contents"
      tabIndex={0}
      aria-activedescendant={box.activeId}
      class={styles.list}
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
      <RowList rows={rows} selected={selected} optionId={box.optionId} fresh={fresh} onOpen={onOpen} {...(onUp && { onUp })} />
    </div>
  );
}

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
  /** The folders expanded and the row selected, as the tab last left them; changes go to `onView`. */
  view: OutlineView;
  onView: (view: OutlineView) => void;
  /** A key is about to open a place: the next list takes the keys on. */
  onKeyNavigate: () => void;
  onMore: () => void;
  onToggleHidden: () => void;
  /** The first row: up to the enclosing folder. Absent at `/`. */
  onUp?: () => void;
  onRowMenu?: (ask: RowMenuAsk) => void;
}

/** The folder's rows as the outline draws them with nothing expanded: one flat list. */
export function DirList({ pages, hidden, loading, fresh, onOpen, view: initial, onView, onKeyNavigate, onMore, onToggleHidden, onUp, onRowMenu }: DirListProps) {
  const { entries, total, truncated } = pages;
  const [view, setView] = useState(initial);
  const parent = onUp ? (pages.parent ?? null) : null;
  // The rows are rebuilt when the pages or the expanded folders change, never for a selection move, so the rows keep their identity.
  const { rows } = useMemo(() => outline({ root: pages.path, parent, expanded: view.expanded, held: (path) => (path === pages.path ? pages : null), filter: "", selection: null }), [pages, parent, view.expanded]);
  const selected = rows.some((r) => r.key === view.selection) ? view.selection : null;
  const select = (selection: string | null): void => {
    const next = { ...view, selection };
    setView(next);
    onView(next);
  };
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
      <FolderListbox rows={rows} selected={selected} fresh={fresh} onSelect={select} onOpen={onOpen} onKeyNavigate={onKeyNavigate} onUp={onUp} onRowMenu={onRowMenu} />
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
