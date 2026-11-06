// CodeMirror, loaded on demand: the only file that imports it, so the editor's weight lands on who edits.
import { cursorCharLeft, cursorCharRight, cursorLineDown, cursorLineUp, defaultKeymap, history, historyKeymap, indentLess, indentWithTab, insertTab } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { FIELD_SETTINGS } from "./fieldSettings";

export interface EditorStart {
  text: string;
  /** The file's own line ending: what it read with, it saves with. */
  ending: string;
}

export type EditorKey = { name: string } | { text: string };

const THEME = EditorView.theme({
  "&": { flex: "1", minHeight: "0", background: "var(--color-bg)", color: "var(--color-text)", fontSize: "var(--editor-text)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)", lineHeight: "1.5" },
  ".cm-gutters": { background: "var(--color-bg)", color: "var(--color-text-faint)", border: "none" },
  ".cm-cursor": { borderLeftColor: "var(--color-text)" },
});

export function startState({ text, ending }: EditorStart, wrap: boolean): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      EditorState.lineSeparator.of(ending),
      // A separator set here splits on it alone, so pasted lines would keep their own ending and mix the file's.
      EditorView.clipboardInputFilter.of((pasted) => pasted.replace(/\r\n?|\n/g, ending)),
      lineNumbers(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      THEME,
      // A text box here holds code, never prose. Attributes for the reason `applyFieldSettings` gives.
      EditorView.contentAttributes.of({ ...FIELD_SETTINGS }),
      ...(wrap ? [EditorView.lineWrapping] : []),
    ],
  });
}

const COMMANDS: Record<string, (view: EditorView) => boolean> = { Left: cursorCharLeft, Right: cursorCharRight, Up: cursorLineUp, Down: cursorLineDown, Tab: insertTab, BTab: indentLess };

/** Whether the key means something here. */
export const pressable = (key: EditorKey): boolean => "text" in key || key.name in COMMANDS;

/** A key from the key row. Nothing while an IME composes: it would land in the candidate. */
export function pressKey(view: EditorView, key: EditorKey): void {
  if (view.composing) return;
  if ("text" in key) view.dispatch(view.state.replaceSelection(key.text), { scrollIntoView: true, userEvent: "input.type" });
  else COMMANDS[key.name]?.(view);
}

export function replaceText(view: EditorView, text: string): void {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: view.state.toText(text) } });
}

export { EditorView };
export type { EditorState };
