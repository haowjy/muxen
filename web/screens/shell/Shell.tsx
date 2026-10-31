import { useApp, useAppView } from "../../app/context";
import { screenOf } from "../../workspace/state";
import { Spinner } from "../../ui/primitives/Spinner";
import { Enrol } from "../enrol/Enrol";
import { NoServers } from "../enrol/NoServers";
import { HostProblem } from "../enrol/HostProblem";
import { FilesScreen } from "../files/FilesScreen";
import { Home } from "../home/Home";
import { OpenSessionScreen } from "../sessions/OpenSessionScreen";
import { Overview } from "../overview/Overview";
import { Settings } from "../settings/Settings";
import { TerminalScreen } from "../terminal/TerminalScreen";
import { AppBanners } from "./AppBanners";
import { HostBanner } from "./HostBanner";
import { TabRow } from "./TabRow";
import styles from "./Shell.module.css";

/** The frame: the tab row on top where there is no dock, and the screen the route and the active tab show. Admission problems replace it. */
export function Shell() {
  const app = useApp();
  const layout = useAppView((v) => v.viewport.layout);
  // The tab list over a tab takes the tab's place; the tab stays mounted under it.
  const listed = useAppView((v) => v.entry.overlay?.screen === "overview");
  const screen = useAppView((v) => screenOf(v.workspace));
  const tabShown = !listed && (screen === "terminal" || screen === "files");
  // Touch input ends in the dock (phone and iPad); a mouse keeps the tab row on top, even in a narrow window. Home and the overview have none.
  const topRow = useAppView((v) => v.viewport.layout === "desktop" || v.viewport.directInput === "xterm");
  const hosts = useAppView((v) => v.hosts);
  // An app with no server yet has nothing to wait for: it offers to add one.
  const noServers = hosts.length === 0 && app.platform.manageHosts !== undefined;
  // The browser has one host; native may have several, each with its own banner.
  const blocking = hosts.find((h) => ["notEnrolled", "wrongOrigin", "originRefused", "nodeRefused", "incompatible"].includes(h.admission.kind) && h.entry.pageOrigin !== null);

  // The terminal stays mounted, hidden, under an admission screen: its buffer and watches outlive it (§6.5).
  return (
    <div class={styles.shell} data-layout={layout}>
      <div class={styles.column}>
        {!blocking && topRow && tabShown && <TabRow place="top" />}
        <div class={styles.banners}>
          <AppBanners />
          {/* Home's cards carry their own host's notice. */}
          {!blocking && screen !== "home" && hosts.map((h) => <HostBanner key={h.entry.handle} host={h} />)}
        </div>
        <main class={styles.screen}>
          {blocking ? (
            blocking.admission.kind === "notEnrolled" ? <Enrol host={blocking} /> : <HostProblem host={blocking} />
          ) : (
            <>
              {hosts.length === 0 && !noServers && <div class={styles.waiting}><Spinner label="Checking access" /></div>}
              {noServers && <NoServers />}
              {!noServers && screen === "home" && <Home />}
              {!noServers && (screen === "overview" || listed) && <Overview />}
              {!noServers && tabShown && screen === "files" && <FilesScreen />}
            </>
          )}
          <TerminalScreen active={!blocking && tabShown && screen === "terminal"} />
        </main>
      </div>
      {!blocking && (
        <>
          <OpenSessionScreen />
          <Settings />
        </>
      )}
    </div>
  );
}
