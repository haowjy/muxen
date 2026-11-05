import { useEffect, useRef, useState } from "preact/hooks";
import { cx } from "../cx";
import { useFocusRef } from "../focus";
import { useLongPress } from "../longPress";
import { BellDot } from "./BellDot";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import styles from "./TabStrip.module.css";

/** How a pill's label is coloured: connection state, never selection. */
export type PillTone = "live" | "reconnecting" | "error" | "gone" | "idle";

export interface Pill {
  id: string;
  /** The host the tab is on, and what kind of tab it is. */
  host: string;
  kind: "terminal" | "files";
  /** Shown bold. */
  session: string;
  /** The window the tab shows, regular weight after the session, set apart by spacing alone. */
  window: string;
  /** The tooltip and the accessible name. */
  full: string;
  tone: PillTone;
  /** The connection state in words, so colour is never the only signal. */
  state: string;
  /** A bell rang in the tab's session since this device last showed it. */
  bell: boolean;
}

interface TabStripProps {
  pills: Pill[];
  active: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /** The pill's menu was asked for: a long press, a right click, Shift+F10 or the menu key. `anchor` is the pill's button. */
  onMenu: (id: string, anchor: HTMLElement) => void;
}

/**
 * The terminal's tabs: buttons marked with `aria-current`, a separate close button shown on the
 * active pill only (every pill keeps its slot, so selecting a tab never moves the others), horizontal scroll with the active pill scrolled into view and a fade
 * mask at an overflowing edge. Not an ARIA `tablist`: the pills carry their own close
 * buttons and share one panel. Selection is the fill; the connection colour is on the label.
 */
export function TabStrip({ pills, active, onSelect, onClose, onMenu }: TabStripProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = (): void => {
    const el = scroller.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  };

  useEffect(() => {
    // The pill, not its button: the button stops short of the ×, which would stay under the fade.
    scroller.current?.querySelector('[aria-current="true"]')?.parentElement?.scrollIntoView({ inline: "nearest", block: "nearest" });
    measure();
  }, [active, pills.length]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => { observer.disconnect(); };
  }, []);

  return (
    <div ref={scroller} class={styles.strip} data-start={edges.start || undefined} data-end={edges.end || undefined} onScroll={measure}>
      {pills.map((pill) => (
        <PillView key={pill.id} pill={pill} active={pill.id === active} onSelect={onSelect} onClose={onClose} onMenu={onMenu} />
      ))}
    </div>
  );
}

/** One pill. The active one's select button is the focus target `tabs`, where Ctrl+Shift+F leaves the terminal. */
function PillView({ pill, active, onSelect, onClose, onMenu }: { pill: Pill; active: boolean; onSelect: (id: string) => void; onClose: (id: string) => void; onMenu: TabStripProps["onMenu"] }) {
  const focusRef = useFocusRef(active ? "tabs" : undefined);
  const press = useLongPress<HTMLButtonElement>(({ anchor }) => { onMenu(pill.id, anchor); return true; });
  return (
    <div class={cx(styles.pill, active && styles.active)} data-tone={pill.tone}>
      <button
        type="button"
        ref={focusRef}
        class={styles.select}
        aria-current={active ? "true" : undefined}
        aria-haspopup="menu"
        aria-label={`${pill.full}, ${pill.state}${pill.bell ? ", bell rang" : ""}`}
        title={pill.full}
        onPointerDown={press.onPointerDown}
        onPointerMove={press.onPointerMove}
        onPointerUp={press.onPointerUp}
        onPointerCancel={press.onPointerCancel}
        onContextMenu={press.onContextMenu}
        onClick={() => { if (!press.swallowClick()) onSelect(pill.id); }}
      >
        <Icon name={pill.kind === "files" ? "folder" : "terminal"} size={16} class={styles.kind} />
        <span class={styles.session}>{pill.session}</span>
        {pill.window !== "" && <span class={styles.window}>{pill.window}</span>}
        {pill.bell && <BellDot class={styles.bell} />}
      </button>
      <IconButton icon="closeCircle" label={`Close ${pill.full}`} class={styles.close} onClick={() => { onClose(pill.id); }} />
    </div>
  );
}
