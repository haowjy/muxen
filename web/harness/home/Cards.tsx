// Every state of a Home workspace row on one page, for design review: the states a real host reaches
// only with a dead socket, a stopped tmux or an admission problem. Real flows are the fixtures.
import { WorkspaceCard, type WorkspaceCardProps } from "../../screens/home/WorkspaceCard";

const NO_OP = (): void => undefined;
const base = { byToken: false, bell: false, bellsUnavailable: false, notice: null, onRetry: NO_OP, onOpen: NO_OP };

const CARDS: WorkspaceCardProps[] = [
  { ...base, name: "pop-os", tabs: 5, body: { kind: "ok" } },
  { ...base, name: "pop-os (a bell rang in notes)", tabs: 2, bell: true, body: { kind: "ok" } },
  { ...base, name: "pop-os (bell tracking unavailable)", tabs: 1, bellsUnavailable: true, body: { kind: "ok" } },
  { ...base, name: "pop-os (no tabs)", tabs: 0, body: { kind: "ok" } },
  { ...base, name: "pop-os (list failed)", tabs: 0, body: { kind: "failed" } },
  { ...base, name: "dev-box-2", tabs: 1, body: { kind: "noTmux" } },
  { ...base, name: "jimmys-macbook-air", tabs: 1, body: { kind: "offline", reachedAt: Date.now() - 2 * 3_600_000, noNetwork: false } },
  { ...base, name: "offline, never reached", tabs: 0, body: { kind: "offline", reachedAt: null, noNetwork: false } },
  { ...base, name: "this device has no network", tabs: 1, body: { kind: "offline", reachedAt: Date.now() - 60_000, noNetwork: true } },
  { ...base, name: "this iPhone has no network", tabs: 1, byToken: true, body: { kind: "offline", reachedAt: null, noNetwork: true } },
  { ...base, name: "connecting", tabs: 1, body: { kind: "checking", connecting: true } },
  { ...base, name: "checking access", tabs: 1, body: { kind: "checking", connecting: false } },
  { ...base, name: "needs the user", tabs: 0, body: { kind: "attention" } },
  { ...base, name: "no workspace yet", tabs: 0, onOpen: undefined, body: { kind: "checking", connecting: true } },
];

export function Cards() {
  return (
    <main style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "16px", maxWidth: "720px", margin: "0 auto", overflowY: "auto", height: "100%" }}>
      <h1>Workspace row states</h1>
      {CARDS.map((c) => <WorkspaceCard key={c.name} {...c} />)}
    </main>
  );
}
