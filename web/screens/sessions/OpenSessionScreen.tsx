// Open session (browser-behaviors.md "Adding tabs"): one screen, "new or attach". A name field heads this
// server's sessions that are not open in the workspace; typing filters them locally; a tap attaches; the last
// row creates. The router overlay `{ screen: "sessions", name: "open", params: { workspace } }`, so Back, Escape
// and the opener's focus return are the overlay machinery's.
import { useState } from "preact/hooks";
import { useApp, useAppView, useBells, useOverlay } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import { tabId } from "../../platform/tabKey";
import { bellLook } from "../../sessions/bells";
import { ago, matching, windowCount } from "../../sessions/groups";
import type { SessionListing, TmuxListing } from "../../proto/generated/messages";
import { BellDot } from "../../ui/primitives/BellDot";
import { Button } from "../../ui/primitives/Button";
import { Dialog } from "../../ui/primitives/Dialog";
import { PageBar } from "../../ui/primitives/DialogBars";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { Row } from "../../ui/primitives/Row";
import { Spinner } from "../../ui/primitives/Spinner";
import { TextField } from "../../ui/primitives/TextField";
import { useStore } from "../../ui/store";
import type { Workspace } from "../../workspace/state";
import { openOrCreate, openSession } from "./createSession";
import styles from "./OpenSessionScreen.module.css";

export function OpenSessionScreen() {
  const { open, params, close } = useOverlay("sessions", "open");
  const workspace = useAppView((v) => v.workspace.workspaces.find((w) => w.id === params?.["workspace"]) ?? null);
  const host = useAppView((v) => v.hosts.find((h) => h.hostId === workspace?.host));
  return (
    <Dialog open={open} title="Open session" variant="page" onClose={close} header={<PageBar back="Back" onBack={close} title="Open session" />}>
      {open && workspace && host && <Body host={host} workspace={workspace} />}
    </Dialog>
  );
}

/** Why nothing can be created on `host`, if so. */
function blockedBy(host: HostClient): string | undefined {
  return host.admission.kind === "unreachable" ? `${host.name ?? "The server"} can't be reached` : host.hostId === null ? "Checking access" : undefined;
}

const lastActivity = (s: SessionListing): number => Math.max(0, ...s.windows.map((w) => w.activity));

function Body({ host, workspace }: { host: HostClient; workspace: Workspace }) {
  const app = useApp();
  const handle = host.entry.handle;
  const sessions = useStore(app.sessions, (s) => s.hosts[handle]);
  const bells = useBells();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = host.name ?? "the server";
  const listing = sessions?.listing;
  const failure = sessions?.failure ?? null;
  const typed = query.trim();
  const retry = <Button variant="secondary" icon="refresh" onClick={() => { app.retryHost(handle); }}>Retry</Button>;

  const idOf = (l: TmuxListing, s: SessionListing): string => tabId({ host: host.hostId ?? "", session: { server: l.server, session: s.id } });
  // Sessions already open here are not offered; typing one's name goes to its tab.
  const offered = listing ? matching(listing, query).filter((s) => !workspace.tabs.some((t) => t.id === idOf(listing, s))) : [];
  const exact = listing?.sessions.find((s) => s.name === typed);
  const create = typed === "" ? "New session" : exact ? `Go to “${typed}”` : `Create “${typed}”`;
  const blocked = blockedBy(host);

  const attach = (l: TmuxListing, s: SessionListing): void => {
    app.router.closeOverlay(() => { openSession(app, workspace, host, l, s); });
  };
  const commit = async (): Promise<void> => {
    if (busy || blocked !== undefined) return;
    setBusy(true);
    setError(null);
    const result = await openOrCreate(app, workspace, host, typed);
    setBusy(false);
    if ("error" in result) setError(result.error);
  };
  // Return does what the first row does.
  const submit = (e: Event): void => {
    e.preventDefault();
    const first = offered[0];
    if (listing && first && !exact) attach(listing, first);
    else if (listing !== null) void commit();
  };

  let list;
  if (listing === undefined) {
    list = blocked === undefined && failure === null
      ? <div class={styles.loading}><Spinner label="Loading sessions" /><span>Loading sessions</span></div>
      : <EmptyState icon="alert" title={failure === null ? `${name} can't be reached` : failure === "offline" ? "Couldn't load sessions" : `${name} refused the request`} action={retry}>Your open tabs and drafts are kept.</EmptyState>;
  } else if (listing === null) {
    list = <EmptyState icon="terminal" title={`No tmux server is running on ${name}`} action={retry}>tether never starts one. Start tmux on the server, then retry.</EmptyState>;
  } else {
    list = (
      <ul class={styles.list} aria-label={`Sessions on ${name}`}>
        {offered.map((s) => (
          <li key={s.id}>
            <Row
              icon="terminal"
              label={s.name}
              mark={bellLook(bells, idOf(listing, s)).ring ? <BellDot /> : undefined}
              meta={<>{windowCount(s.windows.length)}{lastActivity(s) > 0 && <span class={styles.since}>{ago(lastActivity(s) * 1000)}</span>}</>}
              trailing="chevron"
              onClick={() => { attach(listing, s); }}
            />
          </li>
        ))}
        <li>
          <Row icon={exact ? "terminal" : "plus"} label={busy ? "Opening…" : create} disabled={busy || blocked !== undefined} onClick={() => { void commit(); }} />
          {blocked !== undefined && <p class={styles.note}>{blocked}</p>}
        </li>
      </ul>
    );
  }

  return (
    <form class={styles.page} onSubmit={submit}>
      <TextField label="Session name" value={query} onInput={(v) => { setQuery(v); setError(null); }} error={error} data-initial-focus="" />
      {list}
    </form>
  );
}
