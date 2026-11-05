// The phone's pull to refresh on a folder's list. It reads touches without cancelling any, so iOS's rubber band
// stays the scroller's own: the list bounces as it always does and a round chip comes down over its top edge.
import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "../../ui/primitives/Icon";
import { Spinner } from "../../ui/primitives/Spinner";
import styles from "./PullToRefresh.module.css";

/** The finger moves this much further than the chip. */
const RESISTANCE = 0.5;
/** A chip pulled this far down refreshes on release. */
const THRESHOLD = 64;
/** The chip comes no further down than this. */
const MAX = 96;

type Pull = { kind: "idle" } | { kind: "pulling"; by: number; top: number } | { kind: "refreshing"; top: number };

/** Mounted with its scroller (one per folder): a pull starts only from a touch that lands with the list at its top. */
export function PullToRefresh({ scroller, onRefresh }: { scroller: RefObject<HTMLElement | null>; onRefresh: () => Promise<void> }) {
  const [pull, setPull] = useState<Pull>({ kind: "idle" });
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    let start: number | null = null;
    let by = 0;
    let busy = false;
    const down = (e: TouchEvent): void => {
      start = !busy && e.touches.length === 1 && el.scrollTop <= 0 ? (e.touches[0]?.clientY ?? null) : null;
      by = 0;
    };
    const move = (e: TouchEvent): void => {
      const touch = e.touches[0];
      if (start === null || !touch) return;
      // A finger that went up first is scrolling the list: this touch never pulls.
      if (touch.clientY < start && by === 0) { start = null; return; }
      by = Math.min(MAX, Math.max(0, (touch.clientY - start) * RESISTANCE));
      setPull({ kind: "pulling", by, top: el.offsetTop });
    };
    const up = (): void => {
      if (start === null) return;
      start = null;
      if (by < THRESHOLD) { setPull({ kind: "idle" }); return; }
      busy = true;
      setPull({ kind: "refreshing", top: el.offsetTop });
      void refresh.current().finally(() => { busy = false; setPull({ kind: "idle" }); });
    };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchmove", move, { passive: true });
    el.addEventListener("touchend", up);
    el.addEventListener("touchcancel", up);
    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", up);
      el.removeEventListener("touchcancel", up);
    };
  }, [scroller]);

  if (pull.kind === "idle") return null;
  const by = pull.kind === "refreshing" ? THRESHOLD : pull.by;
  const ready = pull.kind === "refreshing" || pull.by >= THRESHOLD;
  return (
    <div class={styles.chip} style={{ top: `${String(pull.top)}px`, translate: `-50% ${String(by - 40)}px`, opacity: Math.min(1, by / THRESHOLD) }} data-ready={ready || undefined}>
      {pull.kind === "refreshing"
        ? <Spinner label="Refreshing" />
        : <span class={styles.arrow} style={{ rotate: `${String((by / THRESHOLD) * 270)}deg` }}><Icon name="refresh" size={16} /></span>}
    </div>
  );
}
