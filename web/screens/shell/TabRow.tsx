import { useCallback, useState } from "preact/hooks";
import { useApp, useAppView, useBells, useHostName } from "../../app/context";
import { cx } from "../../ui/cx";
import { DockButton } from "../../ui/primitives/DockButton";
import { Icon } from "../../ui/primitives/Icon";
import { TabStrip } from "../../ui/primitives/TabStrip";
import { useStore } from "../../ui/store";
import { activeTab, routeWorkspace, screenOf } from "../../workspace/state";
import { pillOf } from "../terminal/tabView";
import { terminalsOf } from "../terminal/terminals";
import { useNow } from "../terminal/useNow";
import { TabMenus, type MenuTarget } from "./tabMenus";
import styles from "./TabRow.module.css";

/**
 * The tab row (browser-behaviors.md "Tab row"), on every surface: ‹ to the workspace's tab overview, the
 * workspace's tabs as pills (the strip is the desktop's and the phone's alike), + for Open session and Open
 * files, and on touch the keyboard control, which stays at the row's end with the keyboard up or down. On the
 * desktop it is the top row; on the phone it is the dock's bottom row, which the dock keeps in place with the keyboard up.
 */
export function TabRow({ place }: { place: "top" | "dock" }) {
  const app = useApp();
  const terminals = terminalsOf(app);
  const workspace = useAppView((v) => v.workspace);
  const keyboard = useAppView((v) => v.viewport.keyboard);
  // Touch input ends in the dock (phone and iPad): a press on the row must not take the keyboard's focus from the input holding it.
  const touchInput = useAppView((v) => v.viewport.directInput !== "xterm");
  const owner = useStore(app.focus, (s) => s.owner);
  const statuses = useStore(terminals, (s) => s.tabs);
  const hostName = useHostName();
  const bells = useBells();
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const closeMenu = useCallback(() => { setMenu(null); }, []);
  const screen = screenOf(workspace);
  const space = routeWorkspace(workspace);
  const active = activeTab(workspace)?.id ?? null;
  const running = screen === "terminal" && statuses[active ?? ""]?.state.kind !== "live";
  const now = useNow(running);
  if (!space) return null;
  const env = { home: space.home, statuses, hostName, onScreen: screen === "terminal" ? active : null, now, bells };
  const pills = space.tabs.map((tab) => pillOf(tab, env));
  const files = screen === "files";
  // A Files tab has no terminal input to raise: its keyboard control is its path field, which lowers with its keyboard.
  const up = files ? keyboard : owner !== "none";

  return (
    <nav class={styles.row} data-place={place} aria-label="Tabs" onPointerDown={(e) => { if (touchInput) e.preventDefault(); }}>
      <DockButton kind="control" class={styles.control} aria-label="Back to the tab overview" onClick={() => { app.router.toOverview(space.id); }}>
        <Icon name="back" size={20} />
      </DockButton>
      <div class={styles.strip}>
        <TabStrip
          pills={pills}
          active={active}
          onSelect={(id) => { terminals.activate(id); }}
          onClose={(id) => { app.dispatch({ type: "closed", id }); }}
          onMenu={(id, anchor) => { setMenu({ kind: "tab", id, anchor }); }}
        />
      </div>
      <DockButton
        kind="control"
        class={styles.control}
        aria-label="Add a tab"
        aria-haspopup="menu"
        aria-expanded={menu?.kind === "add"}
        pressed={menu?.kind === "add"}
        onClick={(e) => { const anchor = e.currentTarget; setMenu((m) => (m?.kind === "add" ? null : { kind: "add", anchor })); }}
      >
        <Icon name="plus" size={20} />
      </DockButton>
      {place === "dock" && (
        <DockButton
          kind="control"
          class={cx(styles.control, styles.keyboard)}
          aria-label={up ? "Hide keyboard" : "Show keyboard"}
          onClick={() => { if (files) app.focus.toggleFilesKeyboard(keyboard); else app.focus.toggleKeyboard(); }}
        >
          <Icon name={up ? "keyboardHide" : "keyboard"} size={20} />
        </DockButton>
      )}
      <TabMenus target={menu} workspace={space} onClose={closeMenu} />
    </nav>
  );
}
