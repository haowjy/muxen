import { describeError } from "../../files/browser";
import { shorten } from "../../files/format";
import type { FieldView } from "../../files/pathfield";
import type { FilesPlace } from "../../platform/types";
import { Button } from "../../ui/primitives/Button";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { Spinner } from "../../ui/primitives/Spinner";
import { RowList } from "./FolderList";
import type { Listbox } from "./useListbox";
import styles from "./FolderList.module.css";
import find from "./PathField.module.css";

interface Props {
  view: FieldView;
  home: string;
  hostName: string;
  box: Listbox;
  /** The rest of a folder's pages is being asked for. */
  loadingRest: boolean;
  /** A tap on a row opens it. */
  onOpen: (place: FilesPlace) => void;
  /** A tap on the up row: the field steps to this text. */
  onUp: (text: string) => void;
  onRetry: () => void;
  onLoadRest: () => void;
}

/**
 * What the list shows while the path field is being edited: the rows of the typed folder that the
 * typed name narrows to (folders and files), each a tap to open. Rows take the tap without taking
 * focus from the field, which keeps the keyboard up until the place opens. When the folder is not held
 * in full the list says its matches come from the pages loaded, and offers the rest.
 */
export function NarrowedList({ view, home, hostName, box, loadingRest, onOpen, onUp, onRetry, onLoadRest }: Props) {
  const { typed, record, out, up } = view;
  if (!typed) return <p class={find.note}>Type a path that starts with ~ or /.</p>;
  if (record?.error) {
    return <EmptyState icon="alert" title={describeError(record.error, hostName)} action={<Button onClick={onRetry}>Try again</Button>} />;
  }
  const listing = record?.listing ?? null;
  const where = shorten(typed.parent, home);
  const matches = out.rows.filter((row) => row.kind !== "up").length;
  const unseen = listing !== null && out.rootLoaded === "some";
  const cut = listing !== null && listing.truncated;
  return (
    <div class={styles.wrap} aria-busy={listing === null}>
      {listing === null && <p class={find.where}><Spinner label="Loading the folder" /><span>Loading</span></p>}
      {out.rows.length > 0 && (
        // Taken without taking focus from the field, so the keyboard doesn't drop before the open.
        <div id={box.id} role="listbox" aria-label="Matches" class={styles.list} onMouseDown={(e) => { e.preventDefault(); }}>
          <RowList rows={out.rows} selected={out.selected} optionId={box.optionId} upLabel=".." onOpen={onOpen} onUp={() => { if (up !== null) onUp(up); }} />
        </div>
      )}
      {listing !== null && matches === 0 && (
        <p class={find.note}>{typed.segment === "" ? `Nothing in ${where}` : `Nothing in ${where} matches ${typed.segment}`}</p>
      )}
      {unseen && cut && <p class={styles.note}>This folder is too big to list in full. Matches are from what was listed.</p>}
      {unseen && !cut && (
        <p class={styles.note}>
          Matches are from the first {listing.entries.length.toLocaleString()} of {listing.total.toLocaleString()} entries.{" "}
          <Button variant="quiet" busy={loadingRest} onMouseDown={(e) => { e.preventDefault(); }} onClick={onLoadRest}>Load the rest</Button>
        </p>
      )}
    </div>
  );
}
