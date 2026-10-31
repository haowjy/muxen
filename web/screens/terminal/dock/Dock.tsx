// The phone dock (client-architecture.md §7.4), the bottom of Terminal on touch in the browser,
// the PWA and the app. Its one in-flow row is the tab row, the same height with the keyboard down or
// up, so showing the keyboard never resizes tmux. While an input holds the keyboard the compose box and
// the key row hang under the tab row and the whole dock rides the keyboard: it is anchored to the slot's
// bottom, so what hangs under it pushes the row up, and translated out of the slot by
// `--keyboard-inset` (Dock.module.css).
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useApp, useAppView } from "../../../app/context";
import { useStore } from "../../../ui/store";
import { labelOf } from "../../../workspace/labels";
import { activeTerminal } from "../../../workspace/state";
import { terminalsOf } from "../terminals";
import { TabRow } from "../../shell/TabRow";
import { KeyRow } from "./KeyRow";
import { LineField, type LocalNote } from "./LineField";
import { lineDraftsOf } from "./lineDrafts";
import { nativeLineOf } from "./nativeLine";
import styles from "./Dock.module.css";

/** A line unanswered this long shows "Sending…". */
const SLOW_SEND_MS = 2_000;

/** What the strip above the row says, from the field's own marks. */
function useNote(local: LocalNote | null, tabId: string | null): LocalNote | null {
  const app = useApp();
  const drafts = lineDraftsOf(app);
  const draft = useStore(drafts, (s) => (tabId ? s.drafts[tabId] : undefined));
  const pending = useStore(drafts, (s) => Object.values(s.pending).find((p) => p.id === tabId)?.at ?? null);
  const storageClosed = useAppView((v) => v.storageClosed);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (pending === null) return;
    const timer = setTimeout(() => { setSlow(true); }, Math.max(0, pending + SLOW_SEND_MS - Date.now()));
    return () => { clearTimeout(timer); };
  }, [pending]);

  if (local) return local;
  const note = draft?.note;
  if (note?.kind === "notSent") return { tone: "error", text: `Not sent: ${note.message}` };
  if (note?.kind === "maybeSent") return { tone: "error", text: `May not have been sent: ${note.message}` };
  if (note?.kind === "editedElsewhere") return { tone: "info", text: "Edited in another window" };
  if (slow) return { tone: "info", text: "Sending…" };
  if (storageClosed && draft?.text) return { tone: "info", text: "New drafts won't survive a reload: reload to finish updating" };
  return null;
}

export function Dock({ active }: { active: boolean }) {
  const app = useApp();
  const terminals = terminalsOf(app);
  const nativeLine = nativeLineOf(app);
  const workspace = useAppView((v) => v.workspace);
  const viewport = useAppView((v) => v.viewport);
  const owner = useStore(app.focus, (s) => s.owner);

  const above = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const under = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const lift = useRef<HTMLDivElement>(null);
  const [local, setLocal] = useState<LocalNote | null>(null);

  const tab = activeTerminal(workspace);
  const native = viewport.directInput === "native";
  const nativeNote = useStore(nativeLine, (state) => state.note);
  const note = useNote(native ? nativeNote : local, tab?.id ?? null);
  // The one derived value: no input holds the keyboard (resting), or one does (typing).
  const typing = owner !== "none";

  // A note belongs to the field it came from.
  useEffect(() => { setLocal(null); }, [tab?.id]);

  // The terminal pan ends above the tab row and its note.
  useLayoutEffect(() => {
    const strip = above.current;
    const bar = row.current;
    const hung = under.current;
    const box = slot.current;
    const lifted = lift.current;
    if (!active || !strip || !bar || !hung || !box || !lifted) {
      terminals.setPanArea(null);
      return;
    }
    const root = document.documentElement;
    const update = (): void => {
      const covered = strip.offsetHeight;
      root.style.setProperty("--dock-above-height", `${String(covered + hung.offsetHeight)}px`);
      if (!typing && viewport.keyboardInset === 0) {
        terminals.setPanArea(null);
        return;
      }
      // Where the row is going, not where it is: the lift may be part way through its slide with the
      // keyboard (Dock.module.css), and a box's client rect includes that. Offsets don't, so the row's
      // place in the slot less the lift's end value is its top once the keyboard is there.
      const rest = box.getBoundingClientRect().top + lifted.offsetTop + bar.offsetTop;
      const raised = Math.max(0, viewport.keyboardInset - parseFloat(getComputedStyle(lifted).bottom));
      terminals.setPanArea(Math.max(0, rest - raised - covered - terminals.element.getBoundingClientRect().top));
    };
    update();
    // Defer layout writes until after ResizeObserver delivery. Growing the line changes this
    // row's height; changing the terminal pan in that same delivery can otherwise trip the
    // browser's resize-loop guard while both boxes are being laid out.
    let frame = 0;
    const scheduleUpdate = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const watch = new ResizeObserver(scheduleUpdate);
    watch.observe(strip);
    watch.observe(hung);
    watch.observe(bar);
    return () => {
      watch.disconnect();
      cancelAnimationFrame(frame);
      root.style.removeProperty("--dock-above-height");
      terminals.setPanArea(null);
    };
  }, [active, typing, viewport.keyboardInset, viewport.visibleHeight, terminals]);

  return (
    <div class={styles.slot} ref={slot} data-keyboard={typing ? "" : undefined}>
      <div class={styles.lift} ref={lift}>
        <div class={styles.above} ref={above}>
          <p class={styles.note} data-tone={note?.tone} role="status">{note?.text}</p>
        </div>
        <div class={styles.row} ref={row}>
          <TabRow place="dock" />
        </div>
        {/* Mounted at rest too, so the draft and the field's refs outlive the keyboard; hidden, so nothing can focus it. */}
        <div class={styles.under} ref={under} hidden={!typing}>
          <div class={styles.compose}>
            <LineField tab={tab} label={tab ? `Line for ${labelOf(tab, null).full}` : "Line"} onNote={setLocal} />
          </div>
          <div class={styles.keyRow}>
            <KeyRow />
          </div>
        </div>
      </div>
    </div>
  );
}
