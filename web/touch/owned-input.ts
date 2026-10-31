// The phone browser's terminal input (client-architecture.md §7.3): a textarea muxen owns,
// because xterm's diffs its own value and relies on composition events iOS and Android
// keyboards don't always send. `beforeinput` decides what each edit means and cancels what it
// doesn't map, so the element only ever holds a sentinel and never committed text. Hardware keys
// (chords, Escape, Tab, arrows) fire keydown and no beforeinput: `Terminals.hardwareKey` routes them.
import type { InputEvent } from "../platform/types";
import { applyFieldSettings } from "../ui/primitives/fieldSettings";

/** Two spaces with the caret at the end: a delete always has a target, and the OS repeats it while Backspace is held. */
const SENTINEL = "  ";

/**
 * Builds the element. `input` receives what the user typed, as events for the tab on screen.
 * The caller mounts it inside the terminal surface (an off-screen or `pointer-events: none`
 * input may not raise the iOS keyboard) and registers it with the focus controller.
 */
export function createOwnedInput(input: (events: InputEvent[]) => void): HTMLTextAreaElement {
  const el = document.createElement("textarea");
  applyFieldSettings(el);
  // Not in Safari's form bar order (its up and down arrows would jump between this and the line field), and no enterkeyhint: the plain Return is a focus cue.
  el.tabIndex = -1;
  el.setAttribute("aria-label", "Terminal keyboard");
  el.rows = 1;
  Object.assign(el.style, {
    position: "absolute",
    left: "0",
    top: "0",
    width: "1px",
    height: "1px",
    margin: "0",
    padding: "0",
    border: "0",
    opacity: "0",
    // 16px: Safari zooms into a focused field set smaller.
    fontSize: "16px",
    caretColor: "transparent",
    resize: "none",
    pointerEvents: "none",
  });

  const restore = (): void => {
    el.value = SENTINEL;
    el.setSelectionRange(SENTINEL.length, SENTINEL.length);
  };
  restore();

  let composing = false;
  el.addEventListener("compositionstart", () => { composing = true; });
  el.addEventListener("compositionend", (event) => {
    composing = false;
    if (event.data) input([{ text: event.data }]);
    restore();
  });

  el.addEventListener("beforeinput", (event) => {
    // The IME owns the element while it composes, its own deletes included: never cancel.
    if (composing || event.isComposing) return;
    event.preventDefault();
    switch (event.inputType) {
      case "insertText":
        if (event.data) input([{ text: event.data }]);
        break;
      case "insertLineBreak":
      case "insertParagraph":
        input([{ key: "Enter" }]);
        break;
      case "deleteContentBackward":
        input([{ key: "BSpace" }]);
        break;
      case "deleteWordBackward":
        input([{ key: "C-w" }]);
        break;
      case "deleteContentForward":
        input([{ key: "DC" }]);
        break;
      default:
        // insertReplacementText (nothing committed to replace), insertFromPaste and insertFromDrop (the capture-phase paste listener has routed them), undo and the rest.
        break;
    }
    restore();
  });

  return el;
}
