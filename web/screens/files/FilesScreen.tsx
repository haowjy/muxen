// Files: the screen of the active Files tab (its folder or preview), on every layout. On touch the
// tab row is its bottom bar, with a keyboard control for the path field.
import { useApp, useAppView } from "../../app/context";
import { hostById } from "../../net/hosts";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { Spinner } from "../../ui/primitives/Spinner";
import { activeTab } from "../../workspace/state";
import { TabRow } from "../shell/TabRow";
import { FilesPane } from "./FilesPane";
import { filesSession, type KnownHost } from "./session";
import styles from "./FilesScreen.module.css";

export function FilesScreen() {
  const app = useApp();
  const tab = useAppView((v) => { const t = activeTab(v.workspace); return t?.kind === "files" ? t : null; });
  const host = useAppView((v) => v.hosts.find((h): h is KnownHost => h.hostId === tab?.host));
  // A browser launched while its server is off knows the host but not its id: it waits for the server.
  const waitingOn = useAppView((v) => (tab && !v.hosts.some((h) => h.hostId === tab.host) ? hostById(v.hosts, tab.host) : undefined));
  const dock = useAppView((v) => v.viewport.directInput !== "xterm");
  if (!tab) return null;
  return (
    <div class={styles.screen}>
      {host ? <FilesPane key={tab.id} session={filesSession(app, host)} tab={tab} /> : waitingOn ? <EmptyState icon="alert" title={`Waiting for ${waitingOn.name ?? "the server"}`} /> : <Spinner label="Checking access" />}
      {dock && <div class={styles.dock}><TabRow place="dock" /></div>}
    </div>
  );
}
