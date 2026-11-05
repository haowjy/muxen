// The tab row's two menus, over their anchors: + (Open session, Open files) and a pill's long-press
// menu. Each is a list of sections, so Rename session, Kill window and Kill session slot in when the
// daemon's side is settled (daemon-core.md "The tab's tmux commands (open)"): rename after Windows,
// the kills last in a danger section behind a confirmation.
import { useEffect } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { findSession } from "../../sessions/groups";
import { Menu, type MenuSection } from "../../ui/primitives/Menu";
import { useStore } from "../../ui/store";
import { activeTab, type Workspace } from "../../workspace/state";
import { baseName } from "../../files/paths";
import { terminalsOf } from "../terminal/terminals";
import { copyPath } from "../files/copy";

/** What is open: the + menu, or a pill's menu. */
export type MenuTarget = { kind: "add"; anchor: HTMLElement } | { kind: "tab"; id: string; anchor: HTMLElement };

/** Open session and Open files for `workspace`: the + menu's rows, and the overview's buttons. */
export function useAddActions(workspace: Workspace): { openSession: (opener?: Element) => void; openFiles: () => void } {
  const app = useApp();
  return {
    openSession: (opener) => { app.openOverlay({ screen: "sessions", name: "open", params: { workspace: workspace.id } }, opener); },
    openFiles: () => { app.openFiles(workspace.id, { kind: "dir", path: "~" }); },
  };
}

export function TabMenus({ target, workspace, onClose }: { target: MenuTarget | null; workspace: Workspace; onClose: () => void }) {
  if (!target) return null;
  return target.kind === "add" ? <AddMenu anchor={target.anchor} workspace={workspace} onClose={onClose} /> : <TabMenu id={target.id} anchor={target.anchor} workspace={workspace} onClose={onClose} />;
}

function useFocusFirst(): boolean {
  return useAppView((v) => v.viewport.density !== "touch");
}

function AddMenu({ anchor, workspace, onClose }: { anchor: HTMLElement; workspace: Workspace; onClose: () => void }) {
  const add = useAddActions(workspace);
  const sections: MenuSection[] = [{
    items: [
      { label: "Open session", icon: "terminal", onSelect: () => { add.openSession(anchor); } },
      { label: "Open files", icon: "folder", onSelect: add.openFiles },
    ],
  }];
  return <Menu anchor={anchor} label="Add a tab" sections={sections} onClose={onClose} focusFirst={useFocusFirst()} />;
}

function TabMenu({ id, anchor, workspace, onClose }: { id: string; anchor: HTMLElement; workspace: Workspace; onClose: () => void }) {
  const app = useApp();
  const terminals = terminalsOf(app);
  const tab = workspace.tabs.find((t) => t.id === id);
  const host = useAppView((v) => v.hosts.find((h) => h.hostId === tab?.host));
  const listing = useStore(app.sessions, (s) => (host ? s.hosts[host.entry.handle]?.listing : undefined));
  const shown = useStore(terminals, (s) => s.tabs[id]?.shown?.id ?? null);
  const active = useAppView((v) => activeTab(v.workspace)?.id === id);
  const focusFirst = useFocusFirst();
  // The windows are asked for when the menu opens, unless a listing newer than the last change is in.
  useEffect(() => { if (host) app.listing.refreshIfStale(host.entry.handle); }, [host]);
  if (!tab) return null;

  const at = workspace.tabs.findIndex((t) => t.id === id);
  const last = workspace.tabs.length - 1;
  const sections: MenuSection[] = [];
  if (tab.kind === "terminal") {
    const windows = listing ? (findSession(listing, tab.key.session)?.windows ?? []) : [];
    sections.push({
      // Select-window rides the tab's watch, which only the shown tab has.
      title: "Windows",
      items: [
        ...(active && windows.length > 1 ? windows.map((w) => ({ label: `${String(w.index)}: ${w.name}`, icon: "sessions" as const, selected: w.id === shown, onSelect: () => { if (w.id !== shown) terminals.selectWindow(id, w.id); } })) : []),
        { label: "New window", icon: "plus" as const, onSelect: () => { void terminals.newWindow(id); } },
      ],
    });
  } else {
    sections.push({ items: [{ label: "Copy path", icon: "copy", onSelect: () => { void copyPath(app, tab.place.path, workspace.home); } }] });
  }
  sections.push({
    items: [
      ...(at > 0 ? [{ label: "Move to start", icon: "back" as const, onSelect: () => { app.dispatch({ type: "moved", id, to: 0 }); } }] : []),
      ...(at < last ? [{ label: "Move to end", icon: "chevron" as const, onSelect: () => { app.dispatch({ type: "moved", id, to: last }); } }] : []),
      { label: "Close tab", icon: "close" as const, onSelect: () => { app.dispatch({ type: "closed", id }); } },
    ],
  });
  const label = tab.kind === "terminal" ? tab.session : baseName(tab.place.path);
  return <Menu anchor={anchor} label={`${label} tab`} sections={sections} onClose={onClose} focusFirst={focusFirst} />;
}
