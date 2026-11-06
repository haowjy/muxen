// The files being edited on one host, from Edit to Done: what stays when the editor's view goes (a tab switch, Back, the
// page hidden). An answer that lands after the view left finds the edit here by path, never through a view it captured.
import type { UnsavedEdit } from "../../app/viewMemory";
import { TEXT_LIMIT, type FsApi, type TextPreview } from "../../files/api";
import { moved, within } from "../../files/paths";
import { HttpRefusal } from "../../net/http";
import type { EditorHandle } from "../../ui/primitives/CodeEditor";
import type { EditorState } from "../../ui/primitives/editorView";
import { Store } from "../../ui/store";

export interface Edit extends UnsavedEdit {
  /** The last editor's, with its undo and selection; without one an editor starts from `text`. */
  state: EditorState | null;
  /** It differs from the file, as far as anyone has asked. */
  changed: boolean;
  /** The last save found the file changed elsewhere. */
  conflict: boolean;
}

interface Live {
  path: string;
  editor: EditorHandle;
}

interface Host {
  api: Pick<FsApi, "save" | "text">;
  /** Writes what outlives the page: the edit to keep, or none. */
  remember: (edit: UnsavedEdit | null) => void;
  saved: (path: string) => void;
}

export class Edits extends Store<{ open: ReadonlyMap<string, Edit>; live: Live | null }> {
  /** The remembered edit is this page's: pages share the store, and one must not remove what another wrote. */
  private remembers = false;

  constructor(private readonly host: Host) {
    super({ open: new Map(), live: null });
  }

  /** Editing `start.path`, unless it already is: an edit left in the Preview panel picks up where it was. */
  begin(start: UnsavedEdit, changed: boolean): void {
    if (this.snapshot.open.has(start.path)) return;
    this.put({ ...start, state: null, changed, conflict: false });
    this.remembers ||= changed;
  }

  /** Runs per keystroke, and tells no one but the first. */
  typed(path: string): void {
    const edit = this.snapshot.open.get(path);
    if (edit && !edit.changed) this.put({ ...edit, changed: true });
  }

  /** The editor showing `path`, whose edit is now the latest. */
  attach(path: string, editor: EditorHandle): void {
    this.update({ live: { path, editor } });
    const edit = this.snapshot.open.get(path);
    if (edit) this.put(edit);
  }

  /** `editor` went, leaving `state`. */
  detach(editor: EditorHandle, state: EditorState): void {
    const { live } = this.snapshot;
    if (live?.editor !== editor) return;
    this.update({ live: null });
    const edit = this.snapshot.open.get(live.path);
    if (edit) this.put({ ...edit, state });
  }

  /** The new file as the viewer should show it, or null when it wasn't saved (`conflict` says why). Other refusals reject, and the text stays. */
  async save(path: string, overwrite: boolean): Promise<TextPreview | null> {
    const edit = this.snapshot.open.get(path);
    if (!edit) return null;
    const text = this.textOf(edit);
    this.put({ ...edit, conflict: false });
    let etag: string;
    try {
      etag = await this.host.api.save(path, text, overwrite ? "*" : edit.etag);
    } catch (refused) {
      const now = this.snapshot.open.get(path);
      if (!(refused instanceof HttpRefusal && refused.code === "changed")) throw refused;
      if (now) this.put({ ...now, conflict: true });
      return null;
    }
    this.host.saved(path);
    const now = this.snapshot.open.get(path);
    if (now) this.put({ ...now, etag, changed: this.textOf(now) !== text });
    return { text, size: null, truncated: false, editable: { etag, ending: edit.ending } };
  }

  /** Replaces the text with the file's, or answers null when an edit can no longer keep the file as it is. */
  async reload(path: string): Promise<TextPreview | null> {
    const fresh = await this.host.api.text(path, TEXT_LIMIT);
    const edit = this.snapshot.open.get(path);
    if (!edit || fresh.editable?.ending !== edit.ending) return null;
    const { live } = this.snapshot;
    if (live?.path === path) live.editor.replace(fresh.text);
    const now = this.snapshot.open.get(path) ?? edit;
    this.put({ ...now, etag: fresh.editable.etag, text: fresh.text, state: null, changed: false, conflict: false });
    return fresh;
  }

  end(path: string): void {
    const open = new Map(this.snapshot.open);
    open.delete(path);
    this.update({ open });
  }

  /** What was at `path` went to `to`, or for good. A rename keeps the ETag, which is of the inode and its contents' stamp. */
  left(path: string, to: string | null): void {
    const { live } = this.snapshot;
    const open = new Map<string, Edit>();
    const staying = [...this.snapshot.open.values()].filter((edit) => !within(edit.path, path));
    // First, so a moved edit replaces a stale one at its new path. `changedWithin` has kept a changed one from being there.
    for (const edit of staying) open.set(edit.path, edit);
    for (const edit of this.snapshot.open.values()) {
      if (to !== null && within(edit.path, path)) {
        const at = moved(edit.path, path, to);
        open.set(at, { ...edit, path: at });
      }
    }
    this.update({ open, live: live && to !== null && within(live.path, path) ? { ...live, path: moved(live.path, path, to) } : live });
  }

  clear(): void {
    this.remembers = false;
    this.update({ open: new Map() });
  }

  /** The paths at or below `path` with unsaved text. */
  changedWithin(path: string): string[] {
    return [...this.snapshot.open.values()].filter((edit) => edit.changed && within(edit.path, path)).map((edit) => edit.path);
  }

  /** As the page goes away, and only then: a MiB of text is no per-keystroke write. The one writer of what is remembered. */
  flush(): void {
    const { open, live } = this.snapshot;
    const typing = live && open.get(live.path);
    const latest = typing?.changed ? typing : [...open.values()].findLast((edit) => edit.changed);
    if (!latest) {
      if (this.remembers) this.host.remember(null);
      this.remembers = false;
      return;
    }
    this.remembers = true;
    const { path, etag, ending } = latest;
    this.host.remember({ path, etag, ending, text: this.textOf(latest) });
  }

  /** The edit's text now, from the editor showing it or the one it last had. */
  private textOf(edit: Edit): string {
    const { live } = this.snapshot;
    if (live?.path === edit.path) return live.editor.text();
    return edit.state?.sliceDoc() ?? edit.text;
  }

  /** Always goes last: the latest changed is the one a page going away keeps. */
  private put(edit: Edit): void {
    const open = new Map(this.snapshot.open);
    open.delete(edit.path);
    open.set(edit.path, edit);
    this.update({ open });
  }
}
