// Every state of a server's banner on one page, for design review: the ones a real host reaches only with a
// dead socket, a full connection cap or a daemon that can't decide. A terminal tab shows the first two on its
// status strip instead (`offlineTabs`). Real flows are the fixtures.
import { useAppView } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import { HostBanner } from "../../screens/shell/HostBanner";

const STATES: Array<[string, Partial<HostClient>]> = [
  ["unreachable", { shown: "unreachable" }],
  ["the phone has no network", { shown: "noNetwork" }],
  ["over the connection cap", { refusing: "overCap" }],
  ["the daemon can't decide right now", { refusing: "authUnavailable" }],
  ["undecided for 10 s", { admission: { kind: "deciding" }, checkingSince: Date.now() - 11_000 }],
];

export function Banners() {
  const host = useAppView((v) => v.hosts[0]);
  if (!host) return null;
  return (
    <main style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "16px", maxWidth: "720px", margin: "0 auto", overflowY: "auto", height: "100%" }}>
      <h1>Server banner states</h1>
      {STATES.map(([name, change]) => (
        <section key={name}>
          <h2>{name}</h2>
          <HostBanner host={{ ...host, ...change }} />
        </section>
      ))}
    </main>
  );
}
