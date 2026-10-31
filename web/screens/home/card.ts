// What one server's row says on Home (browser-behaviors.md "Home"): its state, derived once from the host and
// its sessions cache. The body decides the status word, so a row can't read "live" over an offline body.
import type { HostClient } from "../../net/hosts";
import type { HostSessions } from "../../sessions/cache";

export type CardStatus = "live" | "checking" | "offline" | "attention";

/** What sits under the row: one per way a server can be that needs saying. */
export type CardBody =
  /** The host can't be reached; `reachedAt` is when this page last did, if it has. */
  | { kind: "offline"; reachedAt: number | null }
  /** Admission needs the user (the row's notice says what); nothing here acts on it. */
  | { kind: "attention" }
  /** Admission is being decided. */
  | { kind: "checking" }
  /** The listing failed and nothing older is held. */
  | { kind: "failed" }
  /** The daemon says no tmux server is running. tether never starts one, so the only action is looking again. */
  | { kind: "noTmux" }
  | { kind: "ok" };

export const STATUS: Record<CardBody["kind"], CardStatus> = {
  offline: "offline",
  attention: "attention",
  checking: "checking",
  failed: "live",
  noTmux: "live",
  ok: "live",
};

export function cardBody(host: HostClient, sessions: HostSessions | undefined): CardBody {
  switch (host.admission.kind) {
    case "unreachable":
      return { kind: "offline", reachedAt: sessions?.reachedAt ?? null };
    case "deciding":
      return { kind: "checking" };
    case "admitted":
      break;
    default:
      return { kind: "attention" };
  }
  const listing = sessions?.listing;
  if (listing === undefined) return sessions?.failure ? { kind: "failed" } : { kind: "ok" };
  return listing === null ? { kind: "noTmux" } : { kind: "ok" };
}
