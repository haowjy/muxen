import { useEffect, useRef, useState } from "preact/hooks";
import type { Entry, Listing } from "../../files/api";
import { formatSize } from "../../files/format";
import { outline, type OutlineRow } from "../../files/outline";
import { baseName } from "../../files/paths";
import type { FilesPlace } from "../../platform/types";
import { Button } from "../../ui/primitives/Button";
import { EmptyState } from "../../ui/primitives/EmptyState";
import type { IconName } from "../../ui/primitives/Icon";
import { useFocusRef } from "../../ui/focus";
import { OptionRow } from "../../ui/primitives/Row";
import { Spinner } from "../../ui/primitives/Spinner";
import type { OutlineView } from "./session";
import { useListbox } from "./useListbox";
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

interface RowListProps {
  rows: readonly OutlineRow[];
  selected: string | null;
  optionId: (key: string) => string;
  /** The entry just added by an upload or a paste: marked. */
  fresh?: string | null | undefined;
  /** The up row's text; the folder it goes to, by default. */
  upLabel?: string;
  onOpen: (place: FilesPlace) => void;
  onUp?: () => void;
}

/** The rows of a listbox, as options: the caller's container holds the focus and names the selected one by `optionId(selected)`. */
export function RowList({ rows, selected, optionId, fresh, upLabel, onOpen, onUp }: RowListProps) {
  const upName = baseName(rows[0]?.kind === "up" ? (rows[0].place?.path ?? "") : "");
  return (
    <>
      {rows.map((row) => {
        const { entry, place } = row;
        const common = { key: row.key, id: optionId(row.key), class: styles.item, selected: row.key === selected };
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
}

/** A folder's rows as the page's one focusable listbox, which stays when the folder has no rows, so the keys work there too. */
function FolderListbox({ rows, selected, fresh, onSelect, onOpen, onKeyNavigate, onUp }: FolderListboxProps) {
  const ref = useFocusRef("list");
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
    <div ref={ref} role="listbox" aria-label="Contents" tabIndex={0} aria-activedescendant={box.activeId} class={styles.list} onKeyDown={box.onKeyDown}>
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
}

/** The folder's rows as the outline draws them with nothing expanded: one flat list. */
export function DirList({ pages, hidden, loading, fresh, onOpen, view: initial, onView, onKeyNavigate, onMore, onToggleHidden, onUp }: DirListProps) {
  const { entries, total, truncated } = pages;
  const [view, setView] = useState(initial);
  const { rows, selected } = outline({ root: pages.path, parent: onUp ? (pages.parent ?? null) : null, expanded: view.expanded, held: (path) => (path === pages.path ? pages : null), filter: "", selection: view.selection });
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
      <FolderListbox rows={rows} selected={selected} fresh={fresh} onSelect={select} onOpen={onOpen} onKeyNavigate={onKeyNavigate} onUp={onUp} />
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
