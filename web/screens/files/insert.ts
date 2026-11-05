// Insert path (client-architecture.md §7.5): the quoted absolute path goes into one tab,
// captured when the action began, with no Enter. If that tab is gone, nothing is sent
// anywhere else. The terminal lane decides whether the tab takes it (`Terminals.insertPath`).
import type { AppController } from "../../app/controller";
import { useApp, useAppView } from "../../app/context";
import { hasControlChars } from "../../tabs/input";
import { useStore } from "../../ui/store";
import { labelOf } from "../../workspace/labels";
import type { MenuSection } from "../../ui/primitives/Menu";
import { routeWorkspace, type Workspace } from "../../workspace/state";
import { terminalsOf } from "../terminal/terminals";

/** A terminal tab Insert can offer: what it is called, and why it can't take a path now (still restoring, not connected). */
export interface InsertChoice {
  id: string;
  label: string;
  blocked: string | null;
}

/**
 * The terminal tabs of `workspace` a path can go to: `first` (the tab the offer is for, else the workspace's last
 * terminal tab) leads, then the others in tab order. The first is the default, where Cmd/Ctrl+I sends it.
 */
function insertChoices(app: AppController, workspace: Workspace | null, first: string | null): InsertChoice[] {
  if (!workspace) return [];
  const lead = first ?? workspace.lastTerminal;
  const terminals = terminalsOf(app);
  const tabs = workspace.tabs.flatMap((t) => (t.kind === "terminal" ? [t] : []));
  const ordered = [...tabs.filter((t) => t.id === lead), ...tabs.filter((t) => t.id !== lead)];
  return ordered.map((tab) => ({
    id: tab.id,
    label: labelOf(tab, null).full,
    blocked: tab.restoring ? "Restoring" : terminals.canInsert(tab.id) ? null : "Not connected",
  }));
}

/**
 * The terminal tabs `path` can go to from the screen's server, `first` leading (else its last terminal tab), re-read
 * when the tabs or a tab's connection change; and the insert into one of them.
 */
export function useInsert(path: string, first: string | null, onInserted?: () => void): { choices: InsertChoice[]; insert: (id: string) => void } {
  const app = useApp();
  const workspace = useAppView((v) => routeWorkspace(v.workspace));
  const terminals = terminalsOf(app);
  const ids = workspace?.tabs.flatMap((t) => (t.kind === "terminal" ? [t.id] : [])) ?? [];
  // Redrawn when a tab's eligibility changes, not on every change the terminals make.
  useStore(terminals, () => ids.map((id) => (terminals.canInsert(id) ? "1" : "0")).join(""));
  return { choices: insertChoices(app, workspace, first), insert: (id) => { if (insertPath(app, id, path)) onInserted?.(); } };
}

/** The Insert menu's rows: each terminal tab, the default (first) with `shortcut`, where the control has one; a tab that can't take a path is disabled and says why. */
export function insertSection(choices: readonly InsertChoice[], insert: (id: string) => void, shortcut: string | null): MenuSection {
  if (choices.length === 0) return { title: "Insert path into", items: [{ label: "Open a terminal tab first", disabled: true, onSelect: () => undefined }] };
  return {
    title: "Insert path into",
    items: choices.map((c, i) => ({
      label: c.label,
      icon: "terminal" as const,
      disabled: c.blocked !== null,
      ...(c.blocked !== null ? { hint: c.blocked } : i === 0 && shortcut !== null ? { hint: shortcut } : {}),
      onSelect: () => { insert(c.id); },
    })),
  };
}

/** Sends `path` to the tab `id` and shows it. When the tab can't take it, the terminal lane says why and nothing is sent. */
function insertPath(app: AppController, id: string, path: string): boolean {
  if (hasControlChars(path)) {
    app.notify("This name has control characters, so its path wasn't inserted. Open it in the terminal instead.");
    return false;
  }
  if (terminalsOf(app).pastes.insertPath(id, path) === "refused") return false;
  // Activating a tab opens Terminal on it.
  app.dispatch({ type: "activated", id });
  return true;
}
