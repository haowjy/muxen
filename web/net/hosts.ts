import { httpFsApi, type FsApi } from "../files/api";
import { httpSettingsApi, SettingsClient } from "./settings";
import type { HostEntry, Lifecycle, Transport } from "../platform/types";
import { CloseCode } from "../proto/generated/messages";
import { backoffMs } from "../tabs/connection";
import {
  enrolResult,
  fromClose,
  fromInfo,
  fromSession,
  TOKEN_REFUSED,
  type Admission,
  type AuthInfo,
  type EnrolResult,
  type SessionReply,
} from "./admission";
import { Host, type Reach, type Refusing } from "./host";

/** The admission check gives up on a request after this long (plan.md "Reachability"). */
const CHECK_LIMIT_MS = 5_000;

/** A host's admission state and everything that talks to it. */
export interface HostClient {
  readonly entry: HostEntry;
  /** The daemon's `hostId`; null until `/auth/info`, the saved list or `welcome` says. */
  readonly hostId: string | null;
  /** The host's name for copy ("pop-os"); falls back to the entry's. */
  readonly name: string | null;
  readonly admission: Admission;
  /** The daemon is turning sockets away (its connection cap, or it can't decide now): the host banner says so until a socket is welcomed. */
  readonly refusing: Refusing | null;
  /**
   * Whether the daemon is answering, or `noNetwork` whenever the phone reports none. What every view
   * reads (plan.md "Reachability"); none decides it for itself.
   */
  readonly shown: Reach | "noNetwork";
  /** When the daemon last answered; null if this page never knew. */
  readonly reachedAt: number | null;
  /** When the current check began, for "Checking access…" after 10 s. */
  readonly checkingSince: number | null;
  /** The one WebSocket all its tabs share. */
  readonly socket: Host;
  readonly fs: FsApi;
  /** Its config.toml's live keys and the queue that changes them (Settings' section for this server). */
  readonly settings: SettingsClient;
}

/**
 * What every view reads of one server, in the order they all agree on: admission that needs the user, then the
 * network, then what the daemon's answers say, then undecided admission. Derived, never stored; each view keeps
 * its own words (plan.md "Reachability"), and a new state is a compile error in each.
 */
export type ServerState =
  | { kind: "attention"; admission: Admission }
  | { kind: "noNetwork" }
  | { kind: "unreachable" }
  /** No answer yet (`connecting`), or the server answers and admission is undecided. */
  | { kind: "checking"; connecting: boolean }
  | { kind: "up"; refusing: Refusing | null };

export function serverState({ admission, shown, refusing }: Pick<HostClient, "admission" | "shown" | "refusing">): ServerState {
  if (admission.kind !== "admitted" && admission.kind !== "deciding") return { kind: "attention", admission };
  if (shown === "noNetwork" || shown === "unreachable") return { kind: shown };
  if (shown === "checking") return { kind: "checking", connecting: true };
  if (admission.kind === "deciding") return { kind: "checking", connecting: false };
  return { kind: "up", refusing };
}

/** The host a saved id names. A lone host whose id isn't known yet (a browser launched offline) stands for the saved workspace's. */
export function hostById(hosts: readonly HostClient[], hostId: string): HostClient | undefined {
  return hosts.find((h) => h.hostId === hostId) ?? (hosts.length === 1 && hosts[0]?.hostId === null ? hosts[0] : undefined);
}

export interface HostsOptions {
  transport: Transport;
  /** Sockets time out while HTTP answers: the app reloads its page (the caller limits how often). */
  onStuck: () => void;
  /** When a server was last reached, from the saved workspace. */
  reachedAt?: (entry: HostEntry) => number | null;
  /** Injectable for tests. */
  fetchFn?: typeof fetch;
  random?: () => number;
  now?: () => number;
}

type HostLifecycle = Pick<Lifecycle, "visible" | "online" | "locked">;

interface Slot {
  client: HostClient;
  attempt: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped by every check, so a slow answer to an older one is dropped. */
  generation: number;
  /** Every GET and HEAD for fs and settings carries its signal, so all of them end when the host turns unreachable; replaced at that edge. */
  abort: AbortController;
  /** Views whose last load failed as `network`, told when the host answers again. */
  recovery: Set<() => void>;
  /** A stuck-socket probe is in flight. */
  probing: boolean;
}

/** The text of a JSON error body, if it is one. */
async function readReply(res: Response): Promise<SessionReply> {
  const body = (await res.json().catch(() => null)) as { error?: unknown; reason?: unknown; deviceName?: unknown; node?: { name?: unknown } } | null;
  return {
    status: res.status,
    ...(typeof body?.error === "string" && { error: body.error }),
    ...(typeof body?.reason === "string" && { reason: body.reason }),
    ...(typeof body?.node?.name === "string" && { nodeName: body.node.name }),
    ...(typeof body?.deviceName === "string" && { deviceName: body.deviceName }),
  };
}

/**
 * The hosts the platform knows, each with its admission state and {@link HostClient}.
 * Admission is read from the daemon at every launch (nothing about enrolment is stored in
 * the browser): `/auth/info`, the page origin against `browserOrigin`, then
 * `/auth/node/session`. The sockets run only while the host is admitted, the page is
 * visible and the app unlocked.
 */
export class HostRegistry {
  private readonly slots = new Map<string, Slot>();
  private readonly listeners = new Set<() => void>();
  private lifecycle: HostLifecycle = { visible: true, online: true, locked: false };
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: HostsOptions) {
    this.fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));
  }

  /** In the platform's order. */
  all(): HostClient[] {
    return [...this.slots.values()].map((s) => s.client);
  }

  get(handle: string): HostClient | undefined {
    return this.slots.get(handle)?.client;
  }

  /** Calls `listener` after every change to a host's state. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** The platform's host list: add new hosts, drop those no longer listed, check admission. */
  set(entries: HostEntry[]): void {
    for (const entry of entries) {
      const slot = this.slots.get(entry.handle);
      // A refused token may have been replaced: the republished host tries again, and is refused again if not.
      if (slot) this.patch(slot, entry.pageOrigin === null && slot.client.admission === TOKEN_REFUSED ? { entry, admission: { kind: "admitted" } } : { entry });
      else this.create(entry);
    }
    const handles = new Set(entries.map((e) => e.handle));
    for (const [handle, slot] of this.slots) {
      if (handles.has(handle)) continue;
      clearTimeout(slot.timer);
      slot.client.socket.background();
      this.slots.delete(handle);
    }
    this.emit();
  }

  setLifecycle(lifecycle: HostLifecycle): void {
    const before = this.lifecycle;
    this.lifecycle = lifecycle;
    // A check in flight when the page hides or locks is dropped: it decides nothing.
    if (!this.running()) for (const slot of this.slots.values()) slot.generation++;
    this.applyRunning();
    if (lifecycle.online && !before.online) for (const { client } of this.slots.values()) client.socket.clearTrouble();
    for (const slot of this.slots.values()) this.reflect(slot);
    if ((lifecycle.online && !before.online) || (lifecycle.visible && !before.visible)) this.nudge();
  }

  /** The network came back or the page was shown: retry what waits, now. */
  nudge(): void {
    for (const slot of this.slots.values()) {
      if (slot.client.admission.kind === "deciding") {
        slot.attempt = 0;
        void this.check(slot);
      } else {
        slot.client.socket.nudge();
      }
    }
  }

  /** Check admission again: after enrolment or removal, which change what the check would answer, and from `retry`. */
  recheck(handle: string): void {
    const slot = this.slots.get(handle);
    if (!slot) return;
    slot.attempt = 0;
    void this.check(slot);
  }

  /**
   * The user's Retry (the controller adds a fresh listing): reset the backoff and connect the
   * socket if it isn't already, check admission if it is undecided. A native host the daemon
   * called incompatible is tried again, since only a new daemon can have changed that.
   * Shows checking over an unreachable server when an attempt began or is in flight.
   */
  retry(handle: string): void {
    const slot = this.slots.get(handle);
    if (!slot) return;
    if (slot.client.entry.pageOrigin === null && slot.client.admission.kind === "incompatible") this.patch(slot, { admission: { kind: "admitted" } });
    const undecided = slot.client.admission.kind === "deciding";
    if (undecided) this.recheck(handle);
    if (undecided || slot.client.socket.nudge()) slot.client.socket.retrying();
  }

  /**
   * Calls `listener` when `handle`'s server answers again (it shows reachable, or a new socket was
   * welcomed while it did): the views whose last load failed as `network` load again. Returns the way to stop.
   */
  recovered(handle: string, listener: () => void): () => void {
    const recovery = this.slots.get(handle)?.recovery;
    recovery?.add(listener);
    return () => { recovery?.delete(listener); };
  }

  /** `POST /auth/node/enroll`, then reads admission again. */
  async enrol(handle: string, code: string, deviceName: string): Promise<EnrolResult> {
    const reply = await this.post(handle, "/auth/node/enroll", { code, deviceName });
    const result = enrolResult(reply);
    if (result.kind === "enrolled") this.recheck(handle);
    else if (result.kind === "nodeRefused") {
      const slot = this.slots.get(handle);
      if (slot) this.patch(slot, { admission: { kind: "nodeRefused", reason: result.reason } });
    }
    return result;
  }

  /** `POST /auth/node/remove`: this node loses access; its sockets close first. */
  async removeDevice(handle: string): Promise<boolean> {
    const slot = this.slots.get(handle);
    if (!slot) return false;
    slot.client.socket.background();
    const reply = await this.post(handle, "/auth/node/remove", {});
    this.recheck(handle);
    return reply.status === 204 || reply.status === 200;
  }

  private create(entry: HostEntry): void {
    const { handle } = entry;
    const socket = new Host({
      open: (handlers, connectTimeoutMs) => this.opts.transport.openSocket(handle, handlers, connectTimeoutMs),
      onRefused: (code) => { this.onRefused(handle, code); },
      onWelcome: (welcome) => { this.learnHostId(handle, welcome.host.id); },
      onReach: () => { const slot = this.slots.get(handle); if (slot) this.reflect(slot); },
      online: () => this.lifecycle.online,
      onStuck: () => { const slot = this.slots.get(handle); if (slot) void this.stuck(slot); },
      reachedAt: this.opts.reachedAt?.(entry) ?? null,
      ...(this.opts.now && { now: this.opts.now }),
      ...(this.opts.random && { random: this.opts.random }),
    });
    const slot: Slot = {
      client: {
        entry,
        hostId: entry.hostId,
        name: entry.name,
        // A token-admitted host is admitted until the transport reports a refusal.
        admission: entry.pageOrigin === null ? { kind: "admitted" } : { kind: "deciding" },
        refusing: null,
        shown: this.lifecycle.online ? socket.reach : "noNetwork",
        reachedAt: socket.reachedAt,
        checkingSince: entry.pageOrigin === null ? null : this.now(),
        socket,
        fs: httpFsApi(this.opts.transport.httpBase(handle), (input, init) => this.guarded(handle, input, init)),
        settings: new SettingsClient(httpSettingsApi(this.opts.transport.httpBase(handle), (input, init) => this.guarded(handle, input, init))),
      },
      attempt: 0,
      timer: undefined,
      generation: 0,
      abort: new AbortController(),
      recovery: new Set(),
      probing: false,
    };
    this.slots.set(handle, slot);
    socket.background(); // closed until admitted
    if (entry.pageOrigin === null) this.applyRunning();
    else void this.check(slot);
  }

  /**
   * `fetch` for a host's file and settings requests. A GET or HEAD is not sent while the host shows
   * unreachable or no network (the socket is already retrying), and one still waiting for its answer or body is aborted the
   * moment it turns so. Other methods are always sent and never aborted. The caller's own abort
   * still reaches the request, and `http.send` still tells it apart from this one.
   */
  private guarded(handle: string, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const slot = this.slots.get(handle);
    const method = init?.method?.toUpperCase();
    if (!slot || (method !== undefined && method !== "GET" && method !== "HEAD")) return this.fetchFn(input, init);
    if (slot.client.shown === "unreachable" || slot.client.shown === "noNetwork") return Promise.reject(new TypeError("network"));
    const signal = init?.signal ? AbortSignal.any([slot.abort.signal, init.signal]) : slot.abort.signal;
    return this.fetchFn(input, { ...init, signal });
  }

  /** Copies the socket's reachability and refusal, with the phone's network, onto the client, and acts on the edges. */
  private reflect(slot: Slot): void {
    const { client } = slot;
    const shown = this.lifecycle.online ? client.socket.reach : "noNetwork";
    const { reachedAt, refusing } = client.socket;
    if (shown === client.shown && reachedAt === client.reachedAt && refusing === client.refusing) return;
    slot.client = { ...client, shown, reachedAt, refusing };
    if (shown !== client.shown) {
      if (shown === "unreachable" || shown === "noNetwork") {
        slot.abort.abort();
        slot.abort = new AbortController();
      }
    }
    // Reachable again, or a socket was welcomed while it was: what failed as `network` can load.
    const answered = shown === "reachable" && (client.shown !== "reachable" || (client.socket.ready && reachedAt !== null && reachedAt > (client.reachedAt ?? 0)));
    if (answered) for (const listener of [...slot.recovery]) listener();
    this.emit();
  }

  /** Sockets time out. If HTTP answers where sockets don't, this page's sockets are stuck: ask for a fresh one. */
  private async stuck(slot: Slot): Promise<void> {
    if (slot.probing) return;
    slot.probing = true;
    try {
      const { answered } = await this.probeInfo(slot.client.entry.handle);
      const { handle } = slot.client.entry;
      // A welcome meanwhile resets the count; another server's open socket shows sockets work.
      if (answered && slot.client.socket.stuck && !this.all().some((c) => c.entry.handle !== handle && c.socket.ready)) this.opts.onStuck();
    } finally {
      slot.probing = false;
    }
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  private patch(slot: Slot, change: Partial<Omit<HostClient, "socket" | "fs" | "settings">>): void {
    slot.client = { ...slot.client, ...change };
    this.applyRunning();
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** The page is visible and the app unlocked: sockets and the admission check run. */
  private running(): boolean {
    return this.lifecycle.visible && !this.lifecycle.locked;
  }

  /** Sockets run while a host is admitted, the page visible and the app unlocked. */
  private applyRunning(): void {
    const running = this.running();
    for (const { client } of this.slots.values()) {
      if (client.admission.kind === "admitted" && running) client.socket.foreground();
      else {
        client.socket.background(); // runs on every patch: only a real pause clears trouble
        // A browser host's check pauses with the page, which decides nothing about the server.
        if (!running) client.socket.clearTrouble();
      }
    }
  }

  /** The daemon's id can arrive late (browser) or differ from the saved one (native). */
  private learnHostId(handle: string, hostId: string): void {
    const slot = this.slots.get(handle);
    if (slot && slot.client.hostId !== hostId) this.patch(slot, { hostId });
  }

  private onRefused(handle: string, code: typeof CloseCode.BadToken | typeof CloseCode.AuthUnavailable | typeof CloseCode.Incompatible): void {
    const slot = this.slots.get(handle);
    if (!slot) return;
    if (slot.client.entry.pageOrigin === null) {
      // A token host keeps its socket's backoff through a 4503; a refused token or version is admission's.
      if (code === CloseCode.BadToken) this.patch(slot, { admission: TOKEN_REFUSED });
      else if (code === CloseCode.Incompatible) this.patch(slot, { admission: { kind: "incompatible" } });
      return;
    }
    const verdict = fromClose(code);
    if (verdict === "recheck") void this.check(slot);
    else if (verdict) this.settle(slot, verdict);
  }

  /**
   * `/auth/info`, then (if the origin matches) `/auth/node/session`, each given up after 5 s. The
   * socket's reachability hears how the first ended (this check is the attempt of a host with no
   * socket). A deciding answer schedules another check. Nothing is sent while the page is hidden or locked.
   */
  private async check(slot: Slot): Promise<void> {
    const { entry } = slot.client;
    if (entry.pageOrigin === null || !this.running()) return;
    clearTimeout(slot.timer);
    const generation = ++slot.generation;
    const current = (): boolean => slot.generation === generation && this.slots.get(entry.handle) === slot;

    const startedAt = this.now();
    const probe = await this.probeInfo(entry.handle);
    if (!current()) return;
    slot.client.socket.attemptEnded(probe.answered, startedAt);
    let admission: Admission;
    const { info } = probe;
    if (!info) {
      admission = { kind: "deciding" };
    } else {
      if (info.hostId !== slot.client.hostId || info.name !== slot.client.name) this.patch(slot, { hostId: info.hostId, name: info.name });
      const step = fromInfo(info, entry.pageOrigin);
      if ("admission" in step) {
        admission = step.admission;
      } else {
        const session = await this.limited(`${this.opts.transport.httpBase(entry.handle)}/auth/node/session`, readReply);
        if (!current()) return;
        admission = fromSession(session ?? { status: 0 });
      }
    }
    this.settle(slot, admission);
  }

  /** Records an answer; a deciding one schedules the next check with the host's backoff. */
  private settle(slot: Slot, admission: Admission): void {
    const deciding = admission.kind === "deciding";
    this.patch(slot, { admission, checkingSince: deciding ? (slot.client.checkingSince ?? this.now()) : null });
    if (!deciding) {
      slot.attempt = 0;
      return;
    }
    const delay = backoffMs(slot.attempt++, (this.opts.random ?? Math.random)());
    slot.timer = setTimeout(() => { void this.check(slot); }, delay);
  }

  /** One GET of the admission check, with its body, given up after 5 s; null when it got no answer. */
  private async limited<T>(url: string, read: (res: Response) => Promise<T>): Promise<T | null> {
    const abort = new AbortController();
    const timer = setTimeout(() => { abort.abort(); }, CHECK_LIMIT_MS);
    try {
      return await read(await this.fetchFn(url, { cache: "no-store", signal: abort.signal }));
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * `GET /auth/info`. `answered`: the daemon replied: a 200 with a `hostId`, or its 503
   * `identity_unavailable`. Anything else (a proxy's 502, a 404, no reply, 5 s) is not. `info` is
   * the full body when it is a usable one.
   */
  private async probeInfo(handle: string): Promise<{ answered: boolean; info: AuthInfo | null }> {
    const read = async (res: Response): Promise<{ answered: boolean; info: AuthInfo | null }> => {
      const body = (await res.json().catch(() => null)) as (Partial<AuthInfo> & { error?: unknown }) | null;
      if (res.ok && typeof body?.hostId === "string") {
        const { hostId, name, protocol } = body;
        return { answered: true, info: typeof name === "string" && protocol ? { hostId, name, protocol, browserOrigin: body.browserOrigin ?? null, browserRefused: body.browserRefused ?? null } : null };
      }
      return { answered: res.status === 503 && body?.error === "identity_unavailable", info: null };
    };
    return (await this.limited(`${this.opts.transport.httpBase(handle)}/auth/info`, read)) ?? { answered: false, info: null };
  }

  private async post(handle: string, path: string, body: object): Promise<SessionReply> {
    const res = await this.fetchFn(`${this.opts.transport.httpBase(handle)}${path}`, {
      cache: "no-store",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    return res ? readReply(res) : { status: 0 };
  }
}
