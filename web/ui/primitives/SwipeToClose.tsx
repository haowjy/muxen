// One open-tab row of the tab overview, iOS style: a touch drag left reveals Close behind it,
// past half the row it closes on release, and a tap on the revealed Close closes too. On a
// pointer that hovers there is no swipe; × shows at the row's end instead. Close is always in
// the DOM and named, so assistive tech reaches it without swiping.
import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import styles from "./SwipeToClose.module.css";

/** How far an open row stays slid to show Close. */
const REVEAL = 88;
/** A drag this far starts the swipe; less is a tap or a scroll. */
const SLOP = 8;

export function SwipeToClose({ label, onClose, children }: { label: string; onClose: () => void; children: ComponentChildren }) {
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; base: number; swiping: boolean; moved: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const end = (): void => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d?.swiping) return;
    const width = box.current?.offsetWidth ?? 300;
    if (-x > width / 2) { onClose(); return; }
    setX(-x > REVEAL / 2 ? -REVEAL : 0);
  };

  return (
    <div class={styles.box} ref={box}>
      <button type="button" class={styles.close} aria-label={label} onClick={onClose} tabIndex={x === 0 ? -1 : 0}>Close</button>
      <div
        class={styles.front}
        data-dragging={dragging ? "" : undefined}
        style={{ transform: `translateX(${String(x)}px)` }}
        onPointerDown={(e) => {
          if (e.pointerType !== "touch") return;
          drag.current = { x: e.clientX, y: e.clientY, base: x, swiping: false, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (!d.swiping) {
            if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) { drag.current = null; return; }
            if (Math.abs(dx) < SLOP) return;
            d.swiping = true;
            d.moved = true;
            setDragging(true);
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          setX(Math.min(0, d.base + dx));
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={() => { if (drag.current) end(); }}
        onClickCapture={(e) => {
          // A swipe or a tap on a slid row is not a pick: it settles the row.
          if (dragging || x !== 0) { e.stopPropagation(); e.preventDefault(); setX(0); }
        }}
      >
        {children}
        <button type="button" class={styles.x} aria-hidden="true" tabIndex={-1} onClick={(e) => { e.stopPropagation(); onClose(); }}>×</button>
      </div>
    </div>
  );
}
