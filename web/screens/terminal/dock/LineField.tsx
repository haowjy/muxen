// The dock's line field: a plain text box the page owns.
import { useEffect, useRef } from "preact/hooks";
import { useApp } from "../../../app/context";
import { DockButton } from "../../../ui/primitives/DockButton";
import { LineInput } from "../../../ui/primitives/LineInput";
import { useStore } from "../../../ui/store";
import type { TerminalTab } from "../../../workspace/state";
import { readPaste } from "../paste";
import { terminalsOf } from "../terminals";
import { stepGrapheme } from "./caret";
import { lineDraftsOf } from "./lineDrafts";
import styles from "./Dock.module.css";

export type LocalNote = { tone: "error" | "info"; text: string };

interface LineFieldProps {
  tab: TerminalTab | null;
  label: string;
  onNote: (note: LocalNote | null) => void;
}

/** The line is one logical line. One trailing paste break is dropped; multiple lines go to tmux. */
const withoutTrailingBreak = (text: string): string => text.replace(/\r?\n$/, "").replace(/\r$/, "");
const hasInnerBreak = (text: string): boolean => /[\r\n]/.test(withoutTrailingBreak(text));

export function LineField({ tab, label, onNote }: LineFieldProps) {
  const app = useApp();
  const terminals = terminalsOf(app);
  const drafts = lineDraftsOf(app);
  const { modifiers } = terminals;
  const text = useStore(drafts, (state) => (tab ? (state.drafts[tab.id]?.text ?? "") : ""));
  const owner = useStore(app.focus, (state) => state.owner);
  const inputText = useRef(text);
  const suppressImeReturn = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Whether the textarea's IME is composing: the caret step and Send wait for it.
  const composing = useRef(false);
  // The key row edits this box through the controller.
  useEffect(() => {
    terminals.lineEditor = {
      insert: (value) => {
        const el = inputRef.current;
        if (!el) return;
        el.setRangeText(value, el.selectionStart, el.selectionEnd, "end");
        el.dispatchEvent(new Event("input", { bubbles: true }));
      },
      step: (step) => {
        const el = inputRef.current;
        // Moving the selection mid-composition commits or garbles it: the keyboard's until it commits.
        if (!el || composing.current) return;
        const { selectionStart: start, selectionEnd: end, value } = el;
        const to = start !== end ? (step < 0 ? start : end) : stepGrapheme(value, start, step);
        el.setSelectionRange(to, to);
      },
    };
    return () => { terminals.lineEditor = null; };
  }, [terminals]);
  inputText.current = text;

  const edit = (value: string, element: HTMLTextAreaElement): void => {
    if (!tab) return;
    if (/[\r\n]/.test(value)) {
      value = value.replace(/[\r\n]/g, "");
      element.value = value;
    }
    const result = drafts.edit(tab.key, value);
    if (result === "ok") {
      onNote(null);
      return;
    }
    element.value = text;
    onNote({ tone: "error", text: result === "tooLarge" ? "Draft too large: the limit is 64 KiB" : "Too many saved drafts: clear one" });
  };

  const send = (forTab: TerminalTab, value: string): void => {
    const result = drafts.send(forTab, value);
    onNote(result === "notConnected" ? { tone: "error", text: "Not connected" } : null);
  };

  // Acts as Return does, and takes no focus: the box keeps the keyboard (DockButton).
  const sendButton = owner === "line" && (
    <DockButton
      kind="control"
      class={styles.send}
      disabled={!tab}
      onClick={() => { if (tab && !composing.current) send(tab, inputText.current); }}
    >
      Send
    </DockButton>
  );

  return (
    <>
    <LineInput
      label={label}
      placeholder={tab ? "Type or dictate a line" : "Open a window to type"}
      value={text}
      disabled={!tab}
      focusTarget="line"
      inputRef={inputRef}
      onInput={edit}
      onKeyDown={(event) => {
        // Return confirming an IME candidate is the IME's, not a send. Safari reports it after
        // `compositionend`, as keyCode 229 with isComposing already false.
        if (event.key !== "Enter") return;
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        if (event.isComposing || event.keyCode === 229) {
          suppressImeReturn.current = true;
          setTimeout(() => { suppressImeReturn.current = false; }, 0);
          return;
        }
        event.preventDefault();
        if (tab) send(tab, inputText.current);
      }}
      onBeforeInput={(event) => {
        // Cancel only a real chord (sent to tmux); unchordable and multi-character inserts stay in the line.
        if (event.inputType === "insertText" && event.data && modifiers.route({ text: event.data }, "line").to === "terminal") {
          event.preventDefault();
        }
        if (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") {
          event.preventDefault();
          const imeReturn = event.isComposing || suppressImeReturn.current;
          suppressImeReturn.current = false;
          if (!imeReturn && tab) send(tab, inputText.current);
        }
      }}
      onCompositionStart={() => {
        composing.current = true;
        modifiers.disarm();
      }}
      onCompositionEnd={() => { composing.current = false; }}
      onPaste={(event) => {
        const pasted = readPaste(event.clipboardData);
        if (pasted.kind === "image" || (pasted.kind === "text" && hasInnerBreak(pasted.text))) {
          event.preventDefault();
          terminals.pastes.paste(pasted);
          app.notify(pasted.kind === "image" ? "Image sent to the terminal, not the line" : "Pasted text has several lines: sent to the terminal as one paste, without Enter");
        } else if (pasted.kind === "text" && /[\r\n]/.test(pasted.text)) {
          event.preventDefault();
          const field = event.currentTarget;
          const start = field.selectionStart;
          const end = field.selectionEnd;
          field.setRangeText(withoutTrailingBreak(pasted.text), start, end, "end");
          field.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }}
    />
    {sendButton}
    </>
  );
}
