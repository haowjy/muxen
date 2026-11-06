import { useEffect, useLayoutEffect, useMemo, useRef } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import type { OutlineRow } from "../../files/outline";
import { baseName } from "../../files/paths";
import { isGlob, marked, tooLong, type FileSearch, type Found } from "../../files/search";
import type { FilesPlace } from "../../platform/types";
import type { Stopped } from "../../proto/generated/messages";
import { cx } from "../../ui/cx";
import { Button } from "../../ui/primitives/Button";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { PathInput } from "../../ui/primitives/PathInput";
import { Spinner } from "../../ui/primitives/Spinner";
import { useStore } from "../../ui/store";
import { useFailure } from "./failure";
import { EntryCells, whyNot } from "./FolderList";
import { SEARCH, SEARCH_SLASH, SHOW_HIDDEN_IN_SEARCH, useFilesKey, type Chord } from "./keymap";
import type { FilesSession } from "./session";
import { useListbox } from "./useListbox";
import list from "./FolderList.module.css";
import pane from "./FilesScreen.module.css";
import find from "./PathField.module.css";
import styles from "./Search.module.css";

/** Closes Search with the keys outside its field (a row clicked, the Preview panel). */
const CLOSE: Chord = { key: "escape" };

interface Props {
  session: FilesSession;
  search: FileSearch;
  /** The searched folder as the path line says it (`~/repos/muxen`). */
  where: string;
  /** A tap on the phone: a folder is entered, a file opened full screen, over the results. */
  onOpen: (place: FilesPlace) => void;
  /** Enter or a double-click on a desktop: Search closes and the outline shows the row. */
  onReveal: (found: Found) => void;
  /** Cancel, Escape: Search's history entry is left. */
  onClose: () => void;
}

const placeOf = ({ path, entry }: Found): FilesPlace | null => {
  if (entry.utf8 === false) return null;
  return entry.kind === "dir" ? { kind: "dir", path } : entry.kind === "file" ? { kind: "file", path } : null;
};

/** The walk stopped at a cap: what it covered, and the way to the rest. */
function stoppedWords(stopped: Stopped): string {
  const covered = stopped === "entries" ? "Searched the first 100,000 entries."
    : stopped === "time" ? "Search stopped after half a second."
    : "Search stopped: too many folders to keep track of.";
  return `${covered} Search from a deeper folder to see the rest.`;
}

/**
 * Files' Search (browser-behaviors.md "Files", Search): the field on the header line, and below it the files opened
 * recently (field empty) or the daemon's best matches, the letters it matched marked. The field keeps the keys: ↑ and
 * ↓ move the selection, Enter acts on it. A desktop's Preview panel follows the selection (FilesPane reads it).
 */
export function Search({ session, search, where, onOpen, onReveal, onClose: close }: Props) {
  const app = useApp();
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const view = useStore(search, (s) => s);
  const hidden = useStore(session.browser, (s) => s.hidden);
  const recoveries = useStore(session.browser, (s) => s.recoveries);
  const failure = useFailure(session);
  const { text, shown, asking, error } = view;
  const query = text.trim() !== "";
  const scroller = useRef<HTMLDivElement>(null);
  /** Enter came while an answer was on its way: it acts on the answer. */
  const waiting = useRef(false);

  const rows = useMemo(() => shown.rows.map((f): OutlineRow => ({
    key: f.path, kind: f.entry.kind, name: f.entry.name, depth: 0, entry: f.entry, place: placeOf(f), expanded: false, loaded: "none",
  })), [shown.rows]);
  // The phone shows no selection over the recents: a tap is the way in.
  const selected = phone && !query ? null : view.selected;
  const box = useListbox({ rows, selected, onSelect: (key) => { search.select(key); }, keys: "arrows" });

  /** Opens (phone) or reveals (desktop) a row of the rows as they are now, which a render may not have drawn yet. */
  const act = (key: string | null): void => {
    const row = search.snapshot.shown.rows.find((f) => f.path === key);
    const place = row && placeOf(row);
    if (!place) return;
    // Selected too, so Back to the results finds the row tapped, where it was.
    search.select(place.path);
    if (phone) onOpen(place);
    else {
      // Enter opens it, as full width would: the recents list it first.
      if (row.entry.kind === "file") session.opened({ path: row.path, mime: row.entry.mime ?? null });
      onReveal(row);
    }
  };
  useFilesKey(CLOSE, close);
  // Search is open already: its keys, pressed outside the field (a row clicked, the Preview panel), go back to it.
  const refocus = (): void => { app.focus.focusTarget("search"); };
  useFilesKey(SEARCH, refocus);
  useFilesKey(SEARCH_SLASH, refocus);
  // The folder's toggle is under Search's rows: its keys still reach it, and search again.
  useFilesKey(SHOW_HIDDEN_IN_SEARCH, () => { void session.browser.toggleHidden(); });

  useEffect(() => {
    search.resume();
    return () => { search.stop(); };
  }, [search]);
  useEffect(() => { search.setHidden(hidden); }, [search, hidden]);
  // The server answers again after a search failed for want of it.
  useEffect(() => { if (search.snapshot.error?.code === "network") search.resume(); }, [search, recoveries]);
  useEffect(() => {
    if (asking || !waiting.current) return;
    waiting.current = false;
    if (!error) act(search.snapshot.selected);
  }, [asking]);
  // Back from a file opened from the results finds them scrolled where they were.
  useLayoutEffect(() => { if (scroller.current) scroller.current.scrollTop = search.scroll; }, [search]);

  const glob = isGlob(text);
  const now = useMemo(() => Date.now(), [shown]);
  const rootName = baseName(search.root);
  const found = shown.rows.length;

  const label = asking ? null
    : !query ? (found > 0 ? "Opened recently" : null)
    : found === 0 ? null
    : found >= 50 ? "The best 50 matches" : found === 1 ? "1 match" : `${String(found)} matches`;

  return (
    <>
      <div class={find.find}>
        <PathInput
          search
          label={`Search below ${where}`}
          placeholder={`Search ${where}`}
          value={text}
          focusTarget="search"
          listId={rows.length > 0 ? box.id : undefined}
          activeId={box.activeId}
          end={query ? <span class={cx(styles.mode, glob && styles.glob)}>{glob ? "Glob" : "Fuzzy"}</span> : undefined}
          onInput={(value) => { waiting.current = false; search.type(value); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close();
            } else if (e.key.toLowerCase() === "p" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
              // Cmd/Ctrl+P in the field it opens: it stays, and never prints.
              e.preventDefault();
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (search.snapshot.asking) waiting.current = true;
              else if (!phone || query) act(search.snapshot.selected);
            } else box.onKeyDown(e);
          }}
        />
        <Button variant="quiet" onMouseDown={(e) => { e.preventDefault(); }} onClick={close}>Cancel</Button>
      </div>
      <div ref={scroller} class={pane.scroll} onScroll={(e) => { search.scroll = e.currentTarget.scrollTop; }}>
        {error ? (
          <EmptyState icon="alert" title={failure.describe(error)} action={failure.waiting(error) ? undefined : <Button onClick={() => { search.resume(); }}>Try again</Button>} />
        ) : (
          <div class={list.wrap} aria-busy={asking}>
            {asking && <p class={styles.label}><Spinner label="Searching" /><span>Searching</span></p>}
            {label && <p class={styles.label}>{label}</p>}
            {rows.length > 0 && (
              // Taken without taking focus from the field, so the keyboard stays up until a row opens.
              <div
                id={box.id}
                role="listbox"
                aria-label={query ? "Matches" : "Opened recently"}
                class={cx(list.list, list.keyed, asking && styles.quiet)}
                onMouseDown={(e) => { e.preventDefault(); }}
              >
                {shown.rows.map((f) => (
                  <FoundRow
                    key={f.path}
                    found={f}
                    id={box.optionId(f.path)}
                    selected={f.path === selected}
                    folderLine={phone ? rootName : null}
                    now={now}
                    onPress={() => { if (phone) act(f.path); else search.select(f.path); }}
                    onDouble={() => { if (!phone) act(f.path); }}
                  />
                ))}
              </div>
            )}
            {!asking && !query && found === 0 && <p class={styles.note}>Files you open show here.</p>}
            {query && tooLong(text) && <p class={styles.note}>A search can be at most 256 bytes long.</p>}
            {!asking && query && !tooLong(text) && found === 0 && (
              <p class={styles.note}>{shown.stopped ? `Nothing matches ${text} in what was searched.` : `Nothing below ${where} matches ${text}`}</p>
            )}
            {!asking && query && shown.stopped && <p class={styles.note}>{stoppedWords(shown.stopped)}</p>}
          </div>
        )}
      </div>
    </>
  );
}

interface RowProps {
  found: Found;
  id: string;
  selected: boolean;
  /** The phone's second line for a row in the searched folder itself: that folder's name. Null: no line. */
  folderLine: string | null;
  now: number;
  onPress: () => void;
  onDouble: () => void;
}

/** One result: its icon, its name, then the folder it is in below the searched one, in mono and quiet, matched letters marked in both. */
function FoundRow({ found, id, selected, folderLine, now, onPress, onDouble }: RowProps) {
  const { entry, rel, hits, opened } = found;
  const cut = rel.lastIndexOf("/");
  const dir = entry.kind === "dir";
  const runs = (from: number, to: number) => marked(rel, hits, from, to).map((r, i) => (r.hit ? <mark key={i} class={styles.hit}>{r.text}</mark> : r.text));
  const folder = cut > 0 ? runs(0, cut) : folderLine;
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      aria-disabled={placeOf(found) === null || undefined}
      data-kind={dir ? "dir" : "file"}
      class={cx(list.row, styles.found, dir && list.dir, entry.name.startsWith(".") && list.dotted, whyNot(entry) !== null && list.disabled, selected && list.selected)}
      onClick={onPress}
      onDblClick={onDouble}
    >
      <EntryCells entry={entry} now={now} opened={opened} sizeClass={styles.size} ageClass={styles.age}>
        <span class={styles.text}>
          <span class={styles.name}>{runs(cut + 1, rel.length)}</span>
          {folder !== null && <span class={styles.dir}>{folder}</span>}
        </span>
      </EntryCells>
    </div>
  );
}
