// The files being edited on one host: what stays when the editor's view goes (a tab switch, Back, the page hidden).
import type { EditorState } from "../ui/primitives/editorView";
import type { EditorHandle } from "../ui/primitives/CodeEditor";
import { Store } from "../ui/store";

export interface Edit {
  path: string;
  /** Of the file as last read or saved: a save with it can't replace a change made elsewhere. */
  etag: string;
  ending: "\n" | "\r\n";
  /** Where an editor starts when there is no `state`. */
  text: string;
  /** The last editor's, with its undo and selection. Gone after a reload. */
  state: EditorState | null;
  /** It differs from the file, as far as anyone has asked. */
  changed: boolean;
}

interface Live {
  path: string;
  editor: EditorHandle;
}

export class Edits extends Store<{ open: ReadonlyMap<string, Edit>; live: Live | null }> {
  constructor() {
    super({ open: new Map(), live: null });
  }

  /** Editing `start.path`, unless it already is: an edit left in the Preview panel picks up where it was. */
  begin(start: Pick<Edit, "path" | "etag" | "ending" | "text">, changed: boolean): void {
    if (this.snapshot.open.has(start.path)) return;
    this.put({ ...start, state: null, changed });
  }

  keep(path: string, patch: Partial<Pick<Edit, "etag" | "state" | "changed">>): void {
    const edit = this.snapshot.open.get(path);
    if (edit) this.put({ ...edit, ...patch });
  }

  end(path: string): void {
    const open = new Map(this.snapshot.open);
    open.delete(path);
    this.update({ open });
  }

  clear(): void {
    this.update({ open: new Map() });
  }

  /** The editor on screen; null when it goes. */
  attach(live: Live | null): void {
    this.update({ live });
  }

  /** The edit's text now, from the editor showing it or the one it last had. */
  textOf(edit: Edit): string {
    const { live } = this.snapshot;
    if (live?.path === edit.path) return live.editor.text();
    return edit.state?.sliceDoc() ?? edit.text;
  }

  /** The latest changed goes last: a page going away keeps that one. */
  private put(edit: Edit): void {
    const open = new Map(this.snapshot.open);
    open.delete(edit.path);
    open.set(edit.path, edit);
    this.update({ open });
  }
}
