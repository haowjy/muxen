// Test doubles for the host layer: a socket that records what is sent and lets a test
// say what the daemon says.
import type { Frame } from "../../proto/frames";
import type { ClientMsg, ServerMsg } from "../../proto/generated/messages";
import type { LinkClose, LinkHandlers } from "../../proto/link";
import { Host, type Link } from "../../net/host";

export class FakeLink implements Link {
  ready = false;
  lastRecv: number | null = null;
  sent: ClientMsg[] = [];
  closed = false;
  constructor(readonly handlers: LinkHandlers) {}
  send(msg: ClientMsg): void { this.sent.push(msg); }
  close(): void { this.closed = true; this.ready = false; }
  types(): string[] { return this.sent.map((m) => m.type); }
  welcome(): void {
    this.ready = true;
    this.lastRecv = Date.now();
    this.handlers.welcome({ protocol: 2, daemon: { version: "0", completion: true }, host: { id: "h", name: "n" } });
  }
  say(msg: ServerMsg): void { this.lastRecv = Date.now(); this.handlers.message(msg); }
  frame(frame: Frame): void { this.lastRecv = Date.now(); this.handlers.frame(frame); }
  output(watch: number, text: string): void { this.frame({ kind: "output", watch, bytes: new TextEncoder().encode(text) }); }
  snapshot(watch: number, text: string, cols = 80, rows = 24): void {
    this.frame({ kind: "snapshot", watch, cols, rows, restore: new TextEncoder().encode(text) });
  }
  drop(code = 1006, cause?: LinkClose["cause"]): void {
    this.ready = false;
    this.handlers.close({ code, retry: code !== 4401 && code !== 4001, ...(cause && { cause }) });
  }
}

export function makeHost() {
  const links: FakeLink[] = [];
  const events: string[] = [];
  /** What the socket reported through `onReach`, as `reach` or `reach@reachedAt`; `network.online` is the phone's. */
  const reaches: string[] = [];
  /** The connect limit each socket was opened with. */
  const limits: number[] = [];
  const network = { online: true };
  const stuck = { calls: 0 };
  const host: Host = new Host({
    open: (h, limit) => { const l = new FakeLink(h); links.push(l); limits.push(limit); return l; },
    onRefused: (code) => events.push(`refused ${String(code)}`),
    onStuck: () => { stuck.calls++; events.push("stuck"); },
    onRefusing: (refusing) => events.push(refusing === "overCap" ? "capped" : refusing === "authUnavailable" ? "unavailable" : "uncapped"),
    onReach: () => reaches.push(host.reach),
    online: () => network.online,
    random: () => 0.5, // exact backoff base
  });
  const link = (): FakeLink => links[links.length - 1] as FakeLink;
  return { host, links, link, events, reaches, limits, network, stuck };
}
