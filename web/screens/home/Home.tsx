// Home (browser-behaviors.md "Home"): one row per workspace, which today is
// one per server: its name, status and tab count. A row opens the workspace on the tab it last showed, or on
// its overview when it has none. Server-first: one server is not opened for you. The gear in the header opens
// Settings, on every layout: Home has no Back, so it has no bottom bar.
// Add server exists only where the platform manages servers (the app); the browser has its one page origin.
import { useApp, useAppView, useBells } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import { bellLook, bellsUnavailable } from "../../sessions/bells";
import { Button } from "../../ui/primitives/Button";
import { IconButton } from "../../ui/primitives/IconButton";
import { ScreenBar } from "../../ui/primitives/ScreenBar";
import { useStore } from "../../ui/store";
import { workspaceOfHost, type Workspace, type WorkspaceState } from "../../workspace/state";
import { HostBanner } from "../shell/HostBanner";
import { cardBody } from "./card";
import { Install } from "./Install";
import { WorkspaceCard } from "./WorkspaceCard";
import styles from "./Home.module.css";

/** The workspace a host's row opens. A lone host whose id is still unknown (offline at launch) stands for the saved workspace's (§9.4: offline tabs read as reconnecting). */
function workspaceOf(state: WorkspaceState, host: HostClient, hosts: HostClient[]): Workspace | null {
  return workspaceOfHost(state, host.hostId) ?? (hosts.length === 1 && host.hostId === null ? (state.workspaces[0] ?? null) : null);
}

function Row({ host }: { host: HostClient }) {
  const app = useApp();
  const handle = host.entry.handle;
  const sessions = useStore(app.sessions, (s) => s.hosts[handle]);
  const workspace = useAppView((v) => workspaceOf(v.workspace, host, v.hosts));
  const bells = useBells();
  const body = cardBody(host, sessions);
  return (
    <WorkspaceCard
      name={host.name ?? "the server"}
      tabs={workspace?.tabs.length ?? 0}
      bell={workspace?.tabs.some((t) => bellLook(bells, t.id).ring) ?? false}
      body={body}
      bellsUnavailable={bellsUnavailable(bells, host.hostId)}
      notice={body.kind !== "offline" && <HostBanner host={host} />}
      onRetry={() => { app.retryHost(handle); }}
      onOpen={workspace ? () => {
        if (workspace.last) app.dispatch({ type: "activated", id: workspace.last });
        else app.router.toOverview(workspace.id);
      } : undefined}
    />
  );
}

export function Home() {
  const app = useApp();
  const hosts = useAppView((v) => v.hosts);
  const manageHosts = app.platform.manageHosts;
  const openSettings = (opener: Element): void => { app.openOverlay({ screen: "settings", name: "settings" }, opener); };

  return (
    <div class={styles.home}>
      <ScreenBar title="muxen">
        <IconButton icon="settings" label="Settings" onClick={(e) => { openSettings(e.currentTarget); }} />
      </ScreenBar>
      <div class={styles.body}>
        <div class={styles.column}>
          {hosts.map((h) => <Row key={h.entry.handle} host={h} />)}
          {manageHosts && <Button variant="quiet" icon="plus" class={styles.add} onClick={manageHosts}>Add server</Button>}
          <Install />
        </div>
      </div>
    </div>
  );
}
