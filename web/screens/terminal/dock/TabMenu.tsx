// The chip's tab menu while typing: the open tabs and "Add new tab", over the terminal above the
// chip. Not a <dialog>: a modal would take focus and drop the keyboard. Every row cancels its
// pointerdown, like a dock control, so switching tabs leaves the line field holding the keyboard.
import { useEffect, useRef } from "preact/hooks";
import { useApp, useAppView, useBells, useHostName } from "../../../app/context";
import { Row } from "../../../ui/primitives/Row";
import { useStore } from "../../../ui/store";
import { listClass } from "../../sessions/PickRows";
import { tabPills } from "../tabView";
import { terminalsOf } from "../terminals";
import styles from "./TabMenu.module.css";

const keep = (e: PointerEvent): void => { e.preventDefault(); };

export function TabMenu({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const terminals = terminalsOf(app);
  const workspace = useAppView((v) => v.workspace);
  const statuses = useStore(terminals, (s) => s.tabs);
  const hostName = useHostName();
  const bells = useBells();
  const pills = tabPills(workspace.tabs, statuses, hostName, null, Date.now(), bells);
  const menu = useRef<HTMLDivElement>(null);

  // A press outside (the chip toggles itself) or Escape closes it.
  useEffect(() => {
    const away = (e: PointerEvent): void => {
      const target = e.target as Element | null;
      if (menu.current?.contains(target) || target?.closest("[aria-haspopup]")) return;
      onClose();
    };
    const esc = (e: KeyboardEvent): void => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", esc, true);
    };
  }, [onClose]);

  return (
    <div class={styles.menu} ref={menu} role="dialog" aria-label="Open tabs">
      <div class={listClass}>
        {pills.map((pill) => (
          <Row
            key={pill.id}
            icon={pill.kind === "files" ? "folder" : "terminal"}
            label={pill.full}
            selected={pill.id === workspace.active}
            onPointerDown={keep}
            onClick={() => { terminals.activate(pill.id); onClose(); }}
          />
        ))}
        <Row
          icon="plus"
          label="Add new tab"
          trailing="chevron"
          onPointerDown={keep}
          onClick={(e) => {
            onClose();
            app.openOverlay({ screen: "sessions", name: "sheet", params: { add: "choose" } }, e.currentTarget);
          }}
        />
      </div>
    </div>
  );
}
