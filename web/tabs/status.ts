import type { ServerState } from "../net/hosts";
import { hostProblem, offlineWords } from "../ui/hostProblem";
import type { ConnectionState } from "./connection";

/** What a tab's words say of its server: its {@link ServerState}, never decided here. */
export interface HostLook {
  name: string;
  server: ServerState;
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
  /** The headline is the server's unreachable or offline words, which its banner would repeat. */
  server: boolean;
}

const quiet = (tone: Tone): Status => ({ tone, detail: null, hint: null, action: null, server: false });

/**
 * `downSince`: when the tab stopped being live, or opened. `onScreen`: the active tab. The tab's own states
 * (closed, limited, detached, a failed watch) come first; otherwise the server's state says why it waits.
 */
export function describe(state: ConnectionState, downSince: number, retryAt: number | null, now: number, host: HostLook, onScreen: boolean): Status {
  const message = state.kind === "reconnecting" ? state.message : undefined;
  switch (state.kind) {
    case "live":
      if (onScreen) return quiet("live");
      break;
    case "closed":
      return {
        ...quiet("gone"),
        detail: state.reason === "serverExited" ? "tmux server exited" : state.reason === "sessionClosed" ? "Session closed" : null,
      };
    case "limited":
      return limitedStatus(state.message, host.name);
    case "connecting":
    case "reconnecting":
      break;
  }
  if (state.kind === "reconnecting" && state.halt === "detached") {
    return { ...quiet("waiting"), detail: "Detached by another tmux client", action: "Reattach" };
  }
  const { server } = host;
  switch (server.kind) {
    // The banner says what the user must do, once; a tab joined after it is as halted as the rest.
    case "attention":
      return quiet("halted");
    // A failed watch on a live socket says the daemon's reason, not a network blame.
    case "noNetwork":
      if (message === undefined) return { ...quiet("waiting"), detail: offlineWords(host.byToken), server: true };
      break;
    case "unreachable":
      if (message === undefined) {
        const { title, hint } = hostProblem("unreachable", host.name);
        return { ...quiet("waiting"), detail: title, hint, action: "Retry now", server: true };
      }
      break;
    case "checking":
    case "up":
      break;
  }
  if (state.kind !== "reconnecting") {
    // Off screen a tab has no watch: it rests as open.
    if (!onScreen) return quiet("idle");
    const slow = now - downSince >= SLOW_CONNECT_MS;
    return { ...quiet("connecting"), detail: slow ? `Connecting to ${host.name}…` : null };
  }
  const seconds = Math.max(0, Math.ceil(((retryAt ?? now) - now) / 1000));
  return {
    ...quiet("waiting"),
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
    server: false,
    detail: message ?? `muxen on ${host} is at its session limit`,
    hint: "Close tabs from other sessions, in this or another muxen window or the app, to open this one.",
    action: "Retry",
  };
}
