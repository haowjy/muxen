// The tab overview (browser-behaviors.md "Tab overview"): one workspace's page, reached by the tab row's ‹
// or from Home. One row per tab in workspace order, which is the tab row's order; Open session and Open
// files under them. Rows, never previews: a preview would stream every tab's screen.
import type { TargetedPointerEvent } from "preact";
import { useRef, useState } from "preact/hooks";
import { useApp, useAppView, useBells, useHostName } from "../../app/context";
import { shorten } from "../../files/format";
import { bellsUnavailable } from "../../sessions/bells";
import { ago, findSession } from "../../sessions/groups";
import { Button } from "../../ui/primitives/Button";
import { DragHandle } from "../../ui/primitives/DragHandle";
import { SwipeToClose } from "../../ui/primitives/SwipeToClose";
import { Row } from "../../ui/primitives/Row";
import { BellDot } from "../../ui/primitives/BellDot";
import { useStore } from "../../ui/store";
import { routeWorkspace, type Tab, type Workspace } from "../../workspace/state";
import { pillMeta, pillOf } from "../terminal/tabView";
import { terminalsOf } from "../terminal/terminals";
import { useAddActions } from "../shell/tabMenus";
import styles from "./Overview.module.css";

export function Overview() {
  const workspace = useAppView((v) => routeWorkspace(v.workspace));
  if (!workspace) return null;
  return <WorkspacePage workspace={workspace} />;
}

function WorkspacePage({ workspace }: { workspace: Workspace }) {
  const app = useApp();
  const terminals = terminalsOf(app);
  const host = useAppView((v) => v.hosts.find((h) => h.hostId === workspace.host));
  const sessions = useStore(app.sessions, (s) => (host ? s.hosts[host.entry.handle] : undefined));
  const statuses = useStore(terminals, (s) => s.tabs);
  const hostName = useHostName();
  const bells = useBells();
  const add = useAddActions(workspace);
  const env = { home: workspace.home, statuses, hostName, onScreen: null, now: Date.now(), bells };
  const name = hostName(workspace.host);
  const listing = sessions?.listing ?? null;

  // The row being dragged by its handle, and how far it has moved from where it started.
  const [drag, setDrag] = useState<{ id: string; from: number; to: number; dy: number; pitch: number } | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());

  // A Files row's label is its folder's name: the path, shortened under home, goes under it only when that adds something.
  const detail = (tab: Tab, label: string): string => {
    if (tab.kind !== "files") return "";
    const path = shorten(tab.place.path, workspace.home);
    return path === label ? "" : path;
  };
  const terminalDetail = (tab: Tab): { window: string; since: string; hidden: boolean } | null => {
    if (tab.kind !== "terminal" || !listing) return null;
    const session = findSession(listing, tab.key.session);
    const current = session?.windows.find((w) => w.active);
    if (!session || !current) return null;
    return { window: `window ${String(current.index)}: ${current.name}`, since: current.activity > 0 ? ago(current.activity * 1000) : "", hidden: !session.bell.covered };
  };

  const startDrag = (id: string, e: TargetedPointerEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const start = e.clientY;
    // A row's height and the gap between rows: how far a row moves to make room.
    const el = rows.current.get(id);
    const pitch = el ? el.offsetHeight + parseFloat(getComputedStyle(el.parentElement as HTMLElement).rowGap) : 0;
    const from = workspace.tabs.findIndex((t) => t.id === id);
    let to = from;
    setDrag({ id, from, to, dy: 0, pitch });
    const move = (m: PointerEvent): void => {
      const dy = m.clientY - start;
      to = Math.max(0, Math.min(workspace.tabs.length - 1, from + Math.round(dy / pitch)));
      setDrag({ id, from, to, dy, pitch });
    };
    const end = (): void => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setDrag(null);
      if (to !== from) app.dispatch({ type: "moved", id, to });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  return (
    <div class={styles.page}>
      <header class={styles.header}>
        <div class={styles.bar}>
          <Button variant="quiet" icon="back" onClick={() => { app.router.toHome(); }}>Home</Button>
          <h1 class={styles.title}>{name}</h1>
        </div>
      </header>
      <div class={styles.body}>
        <div class={styles.column}>
          {bellsUnavailable(bells, workspace.host) && <p class={styles.note}>Bell tracking unavailable on this host</p>}
          {workspace.tabs.length === 0 ? (
            <p class={styles.note}>No tabs open.</p>
          ) : (
            <ul class={styles.list} aria-label={`Tabs in ${name}`}>
              {workspace.tabs.map((tab, i) => {
                const pill = pillOf(tab, env);
                const terminal = terminalDetail(tab);
                // The dragged row follows the finger; the rows it passes make room.
                const shift = drag === null ? 0 : pill.id === drag.id ? drag.dy : (i > drag.from && i <= drag.to ? -drag.pitch : i < drag.from && i >= drag.to ? drag.pitch : 0);
                const meta = pillMeta(pill);
                const path = detail(tab, pill.session);
                return (
                  <li
                    key={pill.id}
                    ref={(el) => { if (el) rows.current.set(pill.id, el); else rows.current.delete(pill.id); }}
                    class={styles.item}
                    data-dragging={drag?.id === pill.id ? "" : undefined}
                    data-selected={pill.id === workspace.last ? "" : undefined}
                    style={shift === 0 ? undefined : { transform: `translateY(${String(shift)}px)` }}
                  >
                    <SwipeToClose label={`Close ${pill.full}`} onClose={() => { app.dispatch({ type: "closed", id: pill.id }); }}>
                      <Row
                        class={styles.row}
                        icon={pill.kind === "files" ? "folder" : "terminal"}
                        selected={pill.id === workspace.last}
                        mark={pill.bell ? <BellDot /> : undefined}
                        meta={meta}
                        label={
                          <span class={styles.text}>
                            <span class={styles.name}>{pill.session}</span>
                            {(terminal || path) && (
                              <span class={styles.detail}>
                                {terminal ? <><span>{terminal.window}</span>{terminal.since && <span>{terminal.since}</span>}</> : <span>{path}</span>}
                              </span>
                            )}
                            {terminal?.hidden && <span class={styles.detail}>tmux settings hide bells in this session</span>}
                          </span>
                        }
                        onClick={() => { terminals.activate(pill.id); }}
                      />
                      <DragHandle label={`Reorder ${pill.full}`} onDragStart={(e) => { startDrag(pill.id, e); }} onNudge={(step) => { app.dispatch({ type: "moved", id: pill.id, to: i + step }); }} />
                    </SwipeToClose>
                  </li>
                );
              })}
            </ul>
          )}
          <div class={styles.add}>
            <Button icon="terminal" onClick={(e) => { add.openSession(e.currentTarget); }}>Open session</Button>
            <Button icon="folder" onClick={add.openFiles}>Open files</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
