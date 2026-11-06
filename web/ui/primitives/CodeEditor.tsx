import { useEffect, useRef, useState } from "preact/hooks";
import { useFocus } from "../focus";
import type { EditorKey, EditorStart, EditorState, EditorView } from "./editorView";
import { Spinner } from "./Spinner";
import styles from "./CodeEditor.module.css";

/** What an editing screen asks of the editor once it is up. */
export interface EditorHandle {
  /** The text as the file will hold it, in its own line ending. */
  text: () => string;
  /** Whether the key means something here. */
  presses: (key: EditorKey) => boolean;
  press: (key: EditorKey) => void;
  replace: (text: string) => void;
}

interface Props {
  /** The state an earlier editor left, with its undo and selection, or the text to start from. Asked once the last editor has gone and handed back its state. */
  start: () => EditorState | EditorStart;
  wrap: boolean;
  /** Takes the keyboard as it comes up. */
  takeKeyboard: boolean;
  /** Runs per edit: it must stay cheap. */
  onChange: () => void;
  onSave: () => void;
  onReady: (handle: EditorHandle) => void;
  /** Hands back the state as it unmounts. */
  onLeave: (handle: EditorHandle, state: EditorState) => void;
}

/**
 * The one contenteditable (plan.md rule 1): CodeMirror, loaded on demand, in a box that fills its parent. It registers as
 * the `editor` focus target. What it calls lives on the view, not in the state, because a state outlives its view.
 */
export function CodeEditor({ start, wrap, takeKeyboard, onChange, onSave, onReady, onLeave }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [up, setUp] = useState<boolean | "failed">(false);
  const latest = useRef({ onChange, onReady, onLeave, start });
  latest.current = { onChange, onReady, onLeave, start };
  const focus = useFocus();
  useEffect(() => {
    let live = true;
    let stop = (): void => undefined;
    void import("./editorView").then(({ EditorView: View, pressKey, pressable, replaceText, startState }) => {
      const parent = box.current;
      if (!live || !parent) return;
      const from = latest.current.start();
      const view: EditorView = new View({
        parent,
        state: "doc" in from ? from : startState(from, wrap),
        dispatchTransactions: (changes, on) => {
          on.update(changes);
          if (changes.some((change) => change.docChanged)) latest.current.onChange();
        },
      });
      focus.register("editor", view.contentDOM);
      if (takeKeyboard) focus.focusElement(view.contentDOM);
      setUp(true);
      const handle: EditorHandle = {
        text: () => view.state.sliceDoc(),
        presses: pressable,
        press: (key) => { pressKey(view, key); },
        replace: (text) => { replaceText(view, text); },
      };
      latest.current.onReady(handle);
      stop = () => {
        latest.current.onLeave(handle, view.state);
        focus.withdraw("editor", view.contentDOM);
        view.destroy();
      };
    }).catch(() => { if (live) setUp("failed"); });
    return () => { live = false; stop(); };
    // One editor per mount: the rest of the props are where it begins.
  }, [focus]);
  return (
    <div
      class={styles.box}
      ref={box}
      onKeyDown={(e) => {
        if (!(e.metaKey || e.ctrlKey) || e.key !== "s") return;
        e.preventDefault();
        onSave();
      }}
    >
      {up === false && <div class={styles.loading}><Spinner label="Loading the editor" /></div>}
      {up === "failed" && <p class={styles.loading} role="alert">The editor didn't load. Open the file again to retry.</p>}
    </div>
  );
}
