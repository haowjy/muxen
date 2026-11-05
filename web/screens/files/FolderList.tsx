import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { Entry, Listing } from "../../files/api";
import { formatSize } from "../../files/format";
import { move, outline, type Move, type OutlineRow } from "../../files/outline";
import { baseName } from "../../files/paths";
import type { FilesPlace } from "../../platform/types";
import { Button } from "../../ui/primitives/Button";
import { EmptyState } from "../../ui/primitives/EmptyState";
import type { IconName } from "../../ui/primitives/Icon";
import { useFocusRef } from "../../ui/focus";
import { OptionRow, Row } from "../../ui/primitives/Row";
import { Spinner } from "../../ui/primitives/Spinner";
import type { OutlineView } from "./session";
import styles from "./FolderList.module.css";

function iconFor(entry: Entry): IconName {
  if (entry.kind === "dir") return "folder";
  const type = entry.mime ?? "";
  return type.startsWith("image/") ? "image" : type.startsWith("video/") || type.startsWith("audio/") ? "film" : "file";
}

/** What a row says on its right: a size for a file, and why anything unopenable can't be opened. */
function metaFor(entry: Entry): string | undefined {
  if (entry.utf8 === false) return "Name can't be opened";
  if (entry.kind === "broken") return "Broken link";
  if (entry.kind === "other") return "Not a file";
  return entry.kind === "file" && entry.size !== undefined ? formatSize(entry.size) : undefined;
}

/** The first row of a folder list, and of its completions: one step up, named for the folder it goes to. */
export function UpRow({ label, name, onOpen, ...rest }: { label: string; name: string; onOpen: () => void; onMouseDown?: (e: MouseEvent) => void }) {
  return <Row {...rest} icon="back" label={label} aria-label={`Up to ${name}`} class={styles.item} onClick={onOpen} />;
}

/** A folder that was moved or deleted since the tab last showed it: only the way up remains. */
export function MissingFolder({ parent }: { parent?: { name: string; onOpen: () => void } }) {
  return (
    <div class={styles.wrap}>
      {parent && <div class={styles.list}><UpRow label={parent.name} name={parent.name} onOpen={parent.onOpen} /></div>}
      <EmptyState icon="folder" title="This folder no longer exists" />
    </div>
  );
}

/** What a key does in the list: a selection move, opening the selected row, or going up. */
export function listKey(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): Move | "open" | "goUp" | null {
  if (e.altKey || e.shiftKey) return null;
  const cmd = e.metaKey || e.ctrlKey;
  if (e.key === "ArrowUp" && cmd) return "goUp";
  if (cmd) return null;
  switch (e.key) {
    case "ArrowDown": return "down";
    case "ArrowUp": return "up";
    case "Home": return "first";
    case "End": return "last";
    case "Enter": return "open";
    case "Backspace": return "goUp";
    default: return null;
  }
}

/** The rows of a listbox, as options: the caller's container holds the focus and names the selected one by `${listId}-${index}`. */
export function RowList({ rows, selected, listId, fresh, upLabel, onOpen, onUp }: { rows: OutlineRow[]; selected: string | null; listId: string; fresh?: string | null | undefined; /** The up row's text; the folder it goes to, by default. */ upLabel?: string; onOpen: (place: FilesPlace) => void; onUp?: () => void }) {
  const upName = baseName(rows[0]?.kind === "up" ? (rows[0].place?.path ?? "") : "");
  return (
    <>
      {rows.map((row, at) => {
        const { entry, place } = row;
        const common = { key: row.key, id: rowId(listId, at), class: styles.item, selected: row.key === selected || (entry !== null && entry.name === fresh) };
        if (!entry) return <OptionRow {...common} icon="back" label={upLabel ?? upName} aria-label={`Up to ${upName}`} onClick={() => { onUp?.(); }} />;
        return (
          <OptionRow
            {...common}
            {...(entry.name === fresh && { "data-fresh": "" })}
            icon={iconFor(entry)}
            label={entry.name}
            meta={metaFor(entry)}
            {...(place && { trailing: "chevron" as const })}
            disabled={place === null}
            onClick={() => { if (place) onOpen(place); }}
          />
        );
      })}
    </>
  );
}

export const rowId = (listId: string, at: number): string => `${listId}-${String(at)}`;

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
}

/** The folder's rows as the outline draws them with nothing expanded: one flat list. */
export function DirList({ pages, hidden, loading, fresh, onOpen, view: initial, onView, onKeyNavigate, onMore, onToggleHidden, onUp }: DirListProps) {
  const { entries, total, truncated } = pages;
  const [view, setView] = useState(initial);
  const { rows, selected } = outline({ root: pages.path, parent: onUp ? (pages.parent ?? null) : null, expanded: view.expanded, held: (path) => (path === pages.path ? pages : null), filter: "", selection: view.selection });
  const listId = useId();
  const listRef = useFocusRef("list");
  const idOf = (key: string | null): string | undefined => { const at = rows.findIndex((r) => r.key === key); return at < 0 ? undefined : rowId(listId, at); };
  const select = (selection: string | null): void => {
    const next = { ...view, selection };
    setView(next);
    onView(next);
  };
  useEffect(() => { const id = idOf(selected); if (id) document.getElementById(id)?.scrollIntoView({ block: "nearest" }); }, [selected]);

  const openRow = (key: string | null): void => {
    const row = rows.find((r) => r.key === key);
    if (!row?.place) return;
    onKeyNavigate();
    if (row.kind === "up") onUp?.();
    else onOpen(row.place);
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    const action = listKey(e);
    if (action === null) return;
    e.preventDefault();
    if (action === "open") openRow(selected);
    else if (action === "goUp") { if (onUp) { onKeyNavigate(); onUp(); } }
    else select(move(rows, selected, action).selection);
  };
  const upName = baseName(pages.parent ?? "");
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
      {entries.length === 0 && (
        <>
          {onUp && <UpRow label={upName} name={upName} onOpen={onUp} />}
          <EmptyState icon="folder" title="This folder is empty">{hidden ? undefined : "Hidden files are not shown."}</EmptyState>
        </>
      )}
      {entries.length > 0 && (
        <div ref={listRef} role="listbox" aria-label="Contents" tabIndex={0} aria-activedescendant={idOf(selected)} class={styles.list} onKeyDown={onKeyDown}>
          <RowList rows={rows} selected={selected} listId={listId} fresh={fresh} onOpen={onOpen} {...(onUp && { onUp })} />
        </div>
      )}
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
