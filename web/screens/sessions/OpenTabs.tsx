// The phone sheet's first view: the open tabs of both kinds, in order, then one way to add more.
// A tap switches to the tab and closes the sheet; a swipe left (× on desktop) closes the tab (detaches, never touches tmux).
// "Add new tab" steps into the add view, where every tmux session and folder lives.
import { useApp, useAppView, useBells, useHostName } from "../../app/context";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { Row } from "../../ui/primitives/Row";
import { useStore } from "../../ui/store";
import { tabPills } from "../terminal/tabView";
import { terminalsOf } from "../terminal/terminals";
import { listClass } from "./PickRows";
import { SwipeToClose } from "../../ui/primitives/SwipeToClose";

export function OpenTabs({ onAdd, onPick }: { onAdd: () => void; onPick: () => void }) {
  const app = useApp();
  const terminals = terminalsOf(app);
  const workspace = useAppView((v) => v.workspace);
  const statuses = useStore(terminals, (s) => s.tabs);
  const hostName = useHostName();
  const bells = useBells();
  const pills = tabPills(workspace.tabs, statuses, hostName, null, Date.now(), bells);
  return (
    <div class={listClass}>
      {pills.length === 0 && <EmptyState icon="terminal" title="No open tabs">Add a session or a folder to start.</EmptyState>}
      {pills.map((pill) => (
        <SwipeToClose key={pill.id} label={`Close ${pill.full}`} onClose={() => { app.dispatch({ type: "closed", id: pill.id }); }}>
          <Row
            icon={pill.kind === "files" ? "folder" : "terminal"}
            label={pill.full}
            selected={pill.id === workspace.active}
            onClick={() => { terminals.activate(pill.id); onPick(); }}
          />
        </SwipeToClose>
      ))}
      <Row icon="plus" label="Add new tab" trailing="chevron" onClick={onAdd} />
    </div>
  );
}
