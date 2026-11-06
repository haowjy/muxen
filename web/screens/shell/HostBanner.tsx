import { useEffect, useState } from "preact/hooks";
import { useApp } from "../../app/context";
import { serverState, type HostClient } from "../../net/hosts";
import { admissionCopy, hostProblem, offlineWords } from "../../ui/hostProblem";
import { Banner } from "../../ui/primitives/Banner";

/** "Checking access…" appears only after the daemon has been undecided this long. */
const CHECKING_AFTER_MS = 10_000;

/**
 * What is wrong with one host, when it is something the rest of the app keeps working through
 * (browser-behaviors.md "Server banners"). `reach: false` on a terminal tab whose status strip says
 * the unreachable and no-network words itself.
 */
export function HostBanner({ host, reach = true }: { host: HostClient; reach?: boolean }) {
  const app = useApp();
  const [now, setNow] = useState(() => Date.now());
  const { admission } = host;

  useEffect(() => {
    if (admission.kind !== "deciding" || host.checkingSince === null) return;
    const timer = setTimeout(() => { setNow(Date.now()); }, Math.max(0, host.checkingSince + CHECKING_AFTER_MS - Date.now()) + 50);
    return () => { clearTimeout(timer); };
  }, [admission.kind, host.checkingSince]);

  const name = host.name ?? "the server";
  const byToken = host.entry.pageOrigin === null;
  const retry = { label: "Retry", onAction: () => { app.retryHost(host.entry.handle); } };
  const state = serverState(host);
  switch (state.kind) {
    case "attention": {
      const { admission: why } = state;
      if (why.kind === "notEnrolled" && byToken) {
        const copy = admissionCopy(why, name, true);
        const manage = app.platform.manageHosts;
        return copy && <Banner tone="error" title={copy.title} {...(manage && { action: { label: "Servers", onAction: manage } })}>{copy.hint}</Banner>;
      }
      if (why.kind === "incompatible") {
        const copy = admissionCopy(why, name, byToken);
        return copy && <Banner tone="error" title={copy.title} action={retry}>{copy.hint}</Banner>;
      }
      return null; // the rest replace the screen
    }
    case "noNetwork":
      return reach ? <Banner tone="warning" title={offlineWords(byToken)} /> : null;
    case "unreachable": {
      if (!reach) return null;
      const copy = hostProblem("unreachable", name);
      return <Banner tone="warning" title={copy.title} action={retry}>{copy.hint}</Banner>;
    }
    case "checking":
      return !state.connecting && host.checkingSince !== null && now - host.checkingSince >= CHECKING_AFTER_MS ? <Banner tone="info" title="Checking access…" /> : null;
    case "up": {
      if (state.refusing === null) return null;
      const copy = hostProblem(state.refusing, name);
      return <Banner tone="warning" title={copy.title} action={retry}>{copy.hint}</Banner>;
    }
  }
}
