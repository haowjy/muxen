import type { Reach } from "../net/host";
import { hostProblem, offlineWords } from "../ui/hostProblem";
import type { ConnectionState } from "./connection";

/** What a tab's words say of its server: the host registry's shown state, never decided here. */
export interface HostLook {
  name: string;
  shown: Reach | "noNetwork";
  /** The server admits this client by a native token (the iPhone app), not as a tailnet node. */
  byToken: boolean;
}

/** A first connect quicker than this shows no strip, so a normal switch doesn't flash one. */
const SLOW_CONNECT_MS = 1_500;

/** `idle`: a tab off screen whose host is up; only the tab on screen watches, so only it is "live". */
export type Tone = "live" | "idle" | "connecting" | "waiting" | "halted" | "gone" | "limited";

/** How a tab's connection reads on its pill and, when it is on screen, in the status strip. */
export interface Status {
  tone: Tone;
  /** The strip's headline; null shows no strip. */
  detail: string | null;
  /** The strip's second line. */
  hint: string | null;
  /** What a tap does, when it does something. */
  action: string | null;
}

/** `downSince`: when the tab stopped being live, or opened. `onScreen`: the active tab. */
export function describe(state: ConnectionState, downSince: number, retryAt: number | null, now: number, host: HostLook, onScreen: boolean): Status {
  // Off screen, a tab has no watch: it rests in whichever of these it was in when it left,
  // and a lost host moves it on to `reconnecting`.
  if (!onScreen && (state.kind === "live" || state.kind === "connecting")) {
    return { tone: "idle", detail: null, hint: null, action: null };
  }
  switch (state.kind) {
    case "live":
      return { tone: "live", detail: null, hint: null, action: null };
    case "connecting": {
      // No socket is trying for a host that isn't admitted (a browser's, offline): the server's state still says why.
      if (host.shown === "unreachable" || host.shown === "noNetwork") break;
      const slow = now - downSince >= SLOW_CONNECT_MS;
      return { tone: "connecting", detail: slow ? `Connecting to ${host.name}…` : null, hint: null, action: null };
    }
    case "closed":
      return {
        tone: "gone",
       
        detail: state.reason === "serverExited" ? "tmux server exited" : state.reason === "sessionClosed" ? "Session closed" : null,
        hint: null,
        action: null,
      };
    case "limited":
      return limitedStatus(state.message, host.name);
    case "reconnecting":
      break;
  }
  const halt = state.kind === "reconnecting" ? state.halt : null;
  const message = state.kind === "reconnecting" ? state.message : undefined;
  switch (halt) {
    case "unauthorized":
    case "incompatible": {
      const { title, hint } = hostProblem(halt, host.name);
      return { tone: "halted", detail: title, hint, action: "Retry" };
    }
    case "detached":
      return { tone: "waiting", detail: "Detached by another tmux client", hint: null, action: "Reattach" };
    case null:
      break;
  }
  // A failed watch on a live socket: the daemon's reason, not a network blame.
  if (message === undefined) {
    if (host.shown === "noNetwork") return { tone: "waiting", detail: offlineWords(host.byToken), hint: null, action: null };
    if (host.shown === "unreachable") {
      const { title, hint } = hostProblem("unreachable", host.name);
      return { tone: "waiting", detail: title, hint, action: "Retry now" };
    }
  }
  const seconds = Math.max(0, Math.ceil(((retryAt ?? now) - now) / 1000));
  return {
    tone: "waiting",
    detail: message ?? `Reconnecting to ${host.name}`,
    hint: seconds === 0 ? "Retrying now" : `Retrying in ${String(seconds)}s`,
    action: "Retry now",
  };
}

/**
 * A tab the daemon refused for its session limit (`watchEnded { reason: "limit" }`,
 * resource-limits.md §3.6): the error colour, the daemon's message, and what to do. Nothing is
 * closed for the user; Retry climbs the backoff.
 */
export function limitedStatus(message: string | undefined, host: string): Status {
  return {
    tone: "limited",
   
    detail: message ?? `muxen on ${host} is at its session limit`,
    hint: "Close tabs from other sessions, in this or another muxen window or the app, to open this one.",
    action: "Retry",
  };
}
