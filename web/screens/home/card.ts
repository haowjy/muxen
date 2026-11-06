// What one server's row says on Home (browser-behaviors.md "Home"): its state, derived once from the host and
// its sessions cache. The body decides the status word, so a row can't read "live" over an offline body.
import { serverState, type HostClient } from "../../net/hosts";
import type { HostSessions } from "../../sessions/cache";

export type CardStatus = "live" | "checking" | "offline" | "attention";

/** What sits under the row: one per way a server can be that needs saying. */
export type CardBody =
  /** The shown state is unreachable, or `noNetwork`: the phone has none. `reachedAt` is when the server last answered, if ever known. */
  | { kind: "offline"; reachedAt: number | null; noNetwork: boolean }
  /** Admission needs the user (the row's notice says what); nothing here acts on it. */
  | { kind: "attention" }
  /** No answer yet (`connecting`), or the server answers and admission is undecided (the row's notice says so after 10 s). */
  | { kind: "checking"; connecting: boolean }
  /** The listing was refused and nothing older is held. */
  | { kind: "failed" }
  /** The daemon says no tmux server is running. muxen never starts one, so the only action is looking again. */
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

/** The status word's order is {@link serverState}'s (browser-behaviors.md "Home"); the listing decides only for a server that is up. */
export function cardBody(host: HostClient, sessions: HostSessions | undefined): CardBody {
  const state = serverState(host);
  switch (state.kind) {
    case "attention":
      return { kind: "attention" };
    case "noNetwork":
    case "unreachable":
      return { kind: "offline", reachedAt: host.reachedAt, noNetwork: state.kind === "noNetwork" };
    case "checking":
      return { kind: "checking", connecting: state.connecting };
    case "up": {
      const listing = sessions?.listing;
      if (listing === undefined) return sessions?.failure ? { kind: "failed" } : { kind: "ok" };
      return listing === null ? { kind: "noTmux" } : { kind: "ok" };
    }
  }
}
