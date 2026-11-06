// How a tab's connection reads on its pill, in the status band and on the host label.
import { bellLook, type BellsState } from "../../sessions/bells";
import { initialState } from "../../tabs/connection";
import { describe, type HostLook, type Status, type Tone } from "../../tabs/status";
import type { Pill, PillTone } from "../../ui/primitives/TabStrip";
import { labelOf } from "../../workspace/labels";
import type { Tab, TerminalTab } from "../../workspace/state";
import type { TabStatus } from "./terminals";

export interface TabLook {
  tone: PillTone;
  /** The connection in words, so colour is never the only signal. */
  state: string;
  status: Status;
}

const PILL: Record<Tone, { tone: PillTone; state: string }> = {
  live: { tone: "live", state: "connected" },
  idle: { tone: "idle", state: "open" },
  connecting: { tone: "reconnecting", state: "connecting" },
  waiting: { tone: "reconnecting", state: "reconnecting" },
  halted: { tone: "error", state: "disconnected" },
  limited: { tone: "error", state: "session limit" },
  gone: { tone: "gone", state: "closed" },
};

/** `onScreen`: the active tab on the Terminal destination, the only one that watches. */
export function lookOf(tab: TerminalTab, status: TabStatus | undefined, host: HostLook, onScreen: boolean, now: number): TabLook {
  const known = status ?? { state: initialState, downSince: now, retryAt: null };
  const described = describe(known.state, known.downSince, known.retryAt, now, host, onScreen);
  // A restored tab is unproven until the daemon finds its session: reconnecting colour, "Checking…", no input.
  if (tab.restoring && known.state.kind !== "closed") {
    const checking = described.tone === "connecting" || described.tone === "idle" || described.tone === "live";
    return {
      tone: "reconnecting",
      state: "checking",
      status: checking ? { ...described, tone: "connecting", detail: onScreen && now - known.downSince >= 1_500 ? "Checking…" : null } : described,
    };
  }
  return { ...PILL[described.tone], status: described };
}

/** What a pill reads besides its tab: the workspace's home and the app's live state. */
export interface PillEnv {
  /** The workspace's server's home folder, if known. */
  home: string | null;
  statuses: Readonly<Record<string, TabStatus>>;
  host: (hostId: string) => HostLook;
  /** The terminal tab that is on screen, if any. */
  onScreen: string | null;
  now: number;
  bells: BellsState;
}

/** A tab as a pill. A Files tab has no connection of its own: it reads as open. */
export function pillOf(tab: Tab, env: PillEnv): Pill {
  const label = labelOf(tab, env.home);
  if (tab.kind === "files") return { id: tab.id, host: tab.host, kind: tab.kind, session: label.session, window: "", full: label.full, tone: "idle", state: "open", bell: false };
  const look = lookOf(tab, env.statuses[tab.id], env.host(tab.host), tab.id === env.onScreen, env.now);
  return { id: tab.id, host: tab.host, kind: tab.kind, session: label.session, window: label.window, full: label.full, tone: look.tone, state: look.state, bell: bellLook(env.bells, tab.id).ring };
}

/** A pill's connection as a list row says it, when it isn't fine: "Checking…", "Reconnecting…", "Disconnected". */
export function pillMeta({ tone, state }: Pill): string | undefined {
  if (tone === "live" || tone === "idle") return undefined;
  const word = state.charAt(0).toUpperCase() + state.slice(1);
  return tone === "reconnecting" ? `${word}…` : word;
}

/** The band's colour: halted and limited tabs are errors, a tab still trying is reconnecting. */
export function bandTone(tone: Tone): "reconnecting" | "error" {
  return tone === "halted" || tone === "limited" || tone === "gone" ? "error" : "reconnecting";
}
