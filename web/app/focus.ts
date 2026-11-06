// The focus controller (client-architecture.md §6.5): the only code that calls `.focus()` or
// `.blur()` (lint rule 2). Elements that can hold focus register here; a dialog's initial
// focus and its focus return run in the same dispatch that opened or closed it, because iOS
// raises the keyboard only for a focus made during a user gesture.
import type { Viewport } from "../platform/types";
import { TEXT_BOX, type FocusPort, type FocusTarget } from "../ui/focus";
import { Store } from "../ui/store";
import type { Screen } from "../workspace/state";

export type { FocusTarget };

/**
 * Who holds the keyboard on touch (§6.5): the terminal's input, the dock's line field, or
 * nothing. Owners follow DOM focus.
 */
export type Owner = "terminal" | "line" | "none";

/** How long a Files tab's path field has to mount and take the keyboard a tab switch kept. */
const KEEP_KEYBOARD_MS = 1_500;

interface FocusView {
  owner: Owner;
}

export class FocusController extends Store<FocusView> implements FocusPort {
  private readonly targets = new Map<FocusTarget, HTMLElement>();
  /** Stops following the focus of a `terminal` or `line` element. */
  private readonly following = new Map<HTMLElement, () => void>();
  /** The input that held the keyboard when the open dialog opened; it gets the keyboard back on a tap that closes the dialog. */
  private held: "terminal" | "line" | null = null;
  /** Captured before routing hides the opener's owner and consumed by the dialog that mounts. */
  private heldForNextDialog: "terminal" | "line" | null = null;
  private readonly openers = new Map<HTMLDialogElement, Element | null>();
  /** The control the next dialog is opened from. */
  private opener: Element | null = null;
  /** The keyboard was up when the user switched tabs: the next screen's input of this kind takes it (`keepKeyboardOn`). */
  private keeping: FocusTarget | null = null;

  constructor(private readonly viewport: () => Viewport) {
    super({ owner: "none" });
  }

  /** Starts watching the page's taps (`keepFocus`); returns the stop. */
  attach(): () => void {
    document.addEventListener("mousedown", this.keepFocus, true);
    return () => { document.removeEventListener("mousedown", this.keepFocus, true); };
  }

  /**
   * Only the keyboard control lowers the keyboard (plan.md "Keyboard"). On touch a tap reaches the page as
   * a mousedown after the touch ends, whose default moves focus off the field holding the keyboard and so
   * drops it; cancelling the pointerdown doesn't always stop it. So a tap on anything but another field
   * keeps focus where it is. The tap's handlers still run: only the focus change is cancelled.
   */
  private readonly keepFocus = (event: MouseEvent): void => {
    if (this.viewport().directInput === "xterm" || !document.activeElement?.matches(TEXT_BOX)) return;
    if (event.target instanceof Element && event.target.closest(`${TEXT_BOX}, select, label`)) return;
    event.preventDefault();
  };

  /**
   * A tab switch with the keyboard up (it is sticky): the input of `target` takes it. The terminal is mounted
   * already, so it is focused after the switch renders, inside the tap's task; a Files tab's path field mounts
   * with its screen and takes it when it registers. Leaving the terminal screen does not lower it meanwhile.
   */
  keepKeyboardOn(target: FocusTarget): void {
    this.keeping = target;
    // Two microtasks: the first runs before the render the switch queued next, the second after it.
    if (target === "terminal") queueMicrotask(() => { queueMicrotask(() => { this.keeping = null; this.focusTarget("terminal", true); }); });
    else setTimeout(() => { this.keeping = null; }, KEEP_KEYBOARD_MS);
  }

  /** An element that can hold focus announces itself on mount. */
  register(target: FocusTarget, element: HTMLElement): void {
    this.targets.set(target, element);
    if (this.keeping === target && target !== "terminal") {
      this.keeping = null;
      element.focus();
    }
    if (target !== "terminal" && target !== "line") return;
    const focused = (): void => { this.update({ owner: target }); };
    // A blur that hands focus to the other input is a change of owner, not a release: the focus event that follows names the new owner.
    // Reporting "none" in between would render the dock at rest, hiding the compose box before it can take the focus.
    const blurred = (event: FocusEvent): void => {
      const next = event.relatedTarget;
      if (next !== null && next !== element && (next === this.targets.get("terminal") || next === this.targets.get("line"))) return;
      if (this.snapshot.owner === target) this.update({ owner: "none" });
    };
    element.addEventListener("focus", focused);
    element.addEventListener("blur", blurred);
    this.following.set(element, () => {
      element.removeEventListener("focus", focused);
      element.removeEventListener("blur", blurred);
    });
    if (document.activeElement === element) focused();
  }

  /** An element withdraws on unmount. Only the registered element may: a replacement can mount before the old one unmounts. */
  withdraw(target: FocusTarget, element: HTMLElement): void {
    this.following.get(element)?.();
    this.following.delete(element);
    if (this.targets.get(target) !== element) return;
    this.targets.delete(target);
    if (this.snapshot.owner === target) this.update({ owner: "none" });
  }

  /** The toggle is the terminal opener and the closer for either target. */
  toggleKeyboard(): void {
    const { owner } = this.snapshot;
    if (owner === "none") this.focusTarget("terminal", true);
    else this.targets.get(owner)?.blur();
  }

  /** A Files tab's keyboard control: its field (the editor's or Search's while open, else the path field) takes the keyboard when it is down, and gives it up when it is up. */
  toggleFilesKeyboard(up: boolean): void {
    const field = this.targets.has("editor") ? "editor" : this.targets.has("search") ? "search" : "path";
    if (up) this.targets.get(field)?.blur();
    else this.focusTarget(field, true);
  }

  /**
   * Inside the tap that closes a dialog (a pill, a window row, the close icon, the
   * backdrop): if an input held the keyboard when the dialog opened, close the dialog now and
   * give the keyboard back, since iOS raises it only for a focus made during the gesture.
   * A close without a tap (Escape, the back gesture) leaves the keyboard down.
   */
  returnKeyboardInTap(from: Element): void {
    const dialog = from.closest("dialog");
    if (this.held !== null && dialog) this.closeDialog(dialog, true);
  }

  /** `keyboard` falling while an input still holds focus means the system lowered it without telling the page: let go of the input. */
  viewportChanged(before: Viewport, after: Viewport): void {
    if (!before.keyboard || after.keyboard) return;
    const box = document.activeElement;
    if (box instanceof HTMLElement && box.matches(TEXT_BOX)) box.blur();
  }

  /**
   * Focuses a registered element. Touch never focuses programmatically except
   * synchronously inside the tap that asked: callers pass `fromTap` from that handler.
   */
  focusTarget(target: FocusTarget, fromTap = false): boolean {
    if (this.viewport().density === "touch" && !fromTap) return false;
    const element = this.targets.get(target);
    if (!element) return false;
    element.focus();
    return true;
  }

  /** A field or control the user chose: focus it now, inside the handler that asked. */
  focusElement(element: HTMLElement): void {
    element.focus();
  }

  /**
   * The control that held focus was removed (a row deleted): `element` takes it, but only if
   * focus fell to the page; a focus the user has moved since stays where it is.
   */
  refocus(element: HTMLElement | null): void {
    const active = document.activeElement;
    if (element?.isConnected && (active === null || active === document.body)) element.focus();
  }

  /** A field the user is done with: let go of it now, which lowers the keyboard. */
  blurElement(element: HTMLElement): void {
    element.blur();
  }

  /** The tap that opens a dialog notes its control here: Safari leaves a clicked button unfocused, so `document.activeElement` is not it. */
  noteOpener(opener: Element | null): void {
    this.opener = opener;
    const owner = this.snapshot.owner;
    this.heldForNextDialog = this.viewport().density === "touch" && owner !== "none" ? owner : null;
  }

  /**
   * Shows a modal dialog and sets its initial focus: the field marked `data-initial-focus=""`
   * on a fine pointer, else the close button; in `touch` density not that field (the close
   * button), so opening Open session on a phone doesn't raise the keyboard. A dialog that
   * exists to be typed in marks its field `typing`, which takes focus on both.
   */
  openDialog(dialog: HTMLDialogElement): void {
    const { owner } = this.snapshot;
    this.held = this.heldForNextDialog ?? (this.viewport().density === "touch" && owner !== "none" ? owner : null);
    this.heldForNextDialog = null;
    this.openers.set(dialog, this.opener ?? document.activeElement);
    this.opener = null;
    if (!dialog.open) dialog.showModal();
    const mark = (value: string): HTMLElement | null => dialog.querySelector<HTMLElement>(`[data-initial-focus='${value}']`);
    const first = mark("typing") ?? (this.viewport().density === "touch" ? mark("touch") : (mark("") ?? mark("touch")));
    (first ?? dialog).focus();
  }

  /** Closes a dialog and returns focus to the exact control that opened it. `fromTap`: the keyboard goes back to the input that held it. */
  closeDialog(dialog: HTMLDialogElement, fromTap = false): void {
    const opener = this.openers.get(dialog) ?? null;
    this.openers.delete(dialog);
    const held = this.held === null ? undefined : this.targets.get(this.held);
    this.held = null;
    if (dialog.open) dialog.close();
    if (fromTap && held?.isConnected) {
      held.focus();
      return;
    }
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }

  /** Whenever the screen or overlay changes. Leaving the terminal screen lowers the keyboard (the dock is hidden there, which would drop it only later). */
  screenChanged(screen: Screen, overlay: boolean): void {
    const { owner } = this.snapshot;
    if ((screen !== "terminal" || overlay) && owner !== "none" && this.keeping === null) this.targets.get(owner)?.blur();
  }
}
