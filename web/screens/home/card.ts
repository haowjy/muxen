// What one server's row says on Home (browser-behaviors.md "Home"): its state, derived once from the host and
// its sessions cache. The body decides the status word, so a row can't read "live" over an offline body.
import type { HostClient } from "../../net/hosts";
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

/** The status word's order (browser-behaviors.md "Home"): admission that needs the user, then what the shown state says, then undecided admission. */
export function cardBody(host: HostClient, sessions: HostSessions | undefined): CardBody {
  const { admission, shown } = host;
  if (admission.kind !== "admitted" && admission.kind !== "deciding") return { kind: "attention" };
  if (shown === "unreachable" || shown === "noNetwork") return { kind: "offline", reachedAt: host.reachedAt, noNetwork: shown === "noNetwork" };
  if (shown === "checking") return { kind: "checking", connecting: true };
  if (admission.kind === "deciding") return { kind: "checking", connecting: false };
  const listing = sessions?.listing;
  if (listing === undefined) return sessions?.failure ? { kind: "failed" } : { kind: "ok" };
  return listing === null ? { kind: "noTmux" } : { kind: "ok" };
}
