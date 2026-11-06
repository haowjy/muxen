import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPlatform, type TestPlatform } from "../platform/test";
import { FakeLink } from "../platform/test/host";
import type { HostEntry } from "../platform/types";
import { TabDriver } from "../tabs/driver";
import type { TabPort } from "./host";
import { HostRegistry } from "./hosts";

const port: TabPort = { linkUp: () => undefined, linkLost: () => undefined, paused: () => undefined, message: () => undefined, frame: () => undefined };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

async function boot(
  edit: (p: TestPlatform) => void = () => undefined,
  options: Parameters<typeof createTestPlatform>[0] = {},
  wrap: (inner: typeof fetch) => typeof fetch = (inner) => inner,
  extra: Partial<ConstructorParameters<typeof HostRegistry>[0]> = {},
) {
  const platform = createTestPlatform(options);
  edit(platform);
  const stuck: string[] = [];
  const registry = new HostRegistry({ transport: platform.transport, fetchFn: wrap(platform.fetch), onStuck: () => stuck.push("stuck"), random: () => 0.5, ...extra });
  const { hosts, lifecycle } = await platform.boot();
  registry.setLifecycle(lifecycle);
  registry.set(hosts);
  await vi.advanceTimersByTimeAsync(0);
  const host = () => registry.all()[0];
  return { platform, registry, host, stuck };
}

describe("admission, read from the daemon at launch", () => {
  it("admits an enrolled node and learns the host id", async () => {
    const t = await boot();
    expect(t.host()?.admission).toEqual({ kind: "admitted", deviceName: "laptop" });
    expect(t.host()).toMatchObject({ hostId: "h-pop", name: "pop-os" });
    expect(t.platform.daemon.requests).toEqual(["GET /auth/info", "GET /auth/node/session"]);
  });

  it("opens a socket only for an admitted host", async () => {
    const t = await boot();
    t.host()?.socket.join(port);
    expect(t.platform.links).toHaveLength(1);
    const refused = await boot((p) => { if (p.daemon.info !== "down") p.daemon.info = { ...p.daemon.info, browserOrigin: "https://elsewhere" }; });
    refused.host()?.socket.join(port);
    expect(refused.host()?.admission).toEqual({ kind: "wrongOrigin", origin: "https://elsewhere" });
    expect(refused.platform.links).toHaveLength(0);
    expect(refused.platform.daemon.requests).toEqual(["GET /auth/info"]);
  });

  it("never retries a node the daemon refuses", async () => {
    const t = await boot((p) => { p.daemon.node = "refused"; p.daemon.refusedReason = "shared"; });
    expect(t.host()?.admission).toEqual({ kind: "nodeRefused", reason: "shared" });
    const seen = t.platform.daemon.requests.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.platform.daemon.requests).toHaveLength(seen);
  });

  it("keeps deciding with the host's backoff until the daemon can answer", async () => {
    const t = await boot((p) => { p.daemon.node = "busy"; });
    expect(t.host()?.admission).toEqual({ kind: "deciding" });
    expect(t.host()?.checkingSince).not.toBeNull();
    t.platform.daemon.node = "enrolled";
    await vi.advanceTimersByTimeAsync(500);
    expect(t.host()?.admission).toEqual({ kind: "admitted", deviceName: "laptop" });
    expect(t.host()?.checkingSince).toBeNull();
  });

  it("keeps an unanswered host deciding, reads unreachable at the 10 s rule, and admits it when it answers", async () => {
    const t = await boot((p) => { p.daemon.info = "down"; });
    expect(t.host()?.admission).toEqual({ kind: "deciding" });
    expect(t.host()?.shown).toBe("checking");
    await vi.advanceTimersByTimeAsync(16_000);
    expect(t.host()?.shown).toBe("unreachable");
    expect(t.host()?.admission).toEqual({ kind: "deciding" });
    t.platform.daemon.info = defaultInfo();
    t.registry.setLifecycle({ visible: true, online: false, locked: false });
    t.registry.setLifecycle({ visible: true, online: true, locked: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.host()?.admission).toEqual({ kind: "admitted", deviceName: "laptop" });
    expect(t.host()?.shown).toBe("reachable");
  });

  it("calls a protocol outside the daemon's range incompatible, and stays", async () => {
    const t = await boot((p) => { if (p.daemon.info !== "down") p.daemon.info = { ...p.daemon.info, protocol: { min: 3, max: 3 } }; });
    expect(t.host()?.admission).toEqual({ kind: "incompatible" });
  });
});

function defaultInfo() {
  return createTestPlatform().daemon.info;
}

describe("enrolment", () => {
  it("takes the Enrol screen's code, refuses a wrong one, and admits after the right one", async () => {
    const t = await boot((p) => { p.daemon.node = "notEnrolled"; p.daemon.nodeName = "laptop"; });
    expect(t.host()?.admission).toEqual({ kind: "notEnrolled", nodeName: "laptop" });
    expect(await t.registry.enrol("h1", "000000", "laptop")).toEqual({ kind: "badCode" });
    expect(t.host()?.admission.kind).toBe("notEnrolled");
    expect(await t.registry.enrol("h1", "7KQ4XM2P", "my laptop")).toEqual({ kind: "enrolled" });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.host()?.admission).toEqual({ kind: "admitted", deviceName: "laptop" });
  });

  it("removes this device: sockets close, and admission reads notEnrolled", async () => {
    const t = await boot();
    t.host()?.socket.join(port);
    expect(await t.registry.removeDevice("h1")).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.platform.links[0]?.closed).toBe(true);
    expect(t.host()?.admission).toEqual({ kind: "notEnrolled", nodeName: "laptop" });
  });
});

describe("a socket closing with 4401", () => {
  it("asks the session route why instead of assuming notEnrolled", async () => {
    const t = await boot();
    t.host()?.socket.join(port);
    t.platform.daemon.node = "refused";
    t.platform.links[0]?.drop(4401);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.host()?.admission).toEqual({ kind: "nodeRefused", reason: "routes" });
  });

  it("is a refused token for a host with no page origin", async () => {
    const t = await boot(undefined, { hosts: [{ handle: "h1", hostId: "h-pop", name: "pop-os", pageOrigin: null }] });
    expect(t.host()?.admission).toEqual({ kind: "admitted" });
    expect(t.platform.daemon.requests).toEqual([]);
    t.host()?.socket.join(port);
    t.platform.links[0]?.drop(4401);
    expect(t.host()?.admission).toEqual({ kind: "notEnrolled", nodeName: null });
  });
});

describe("sockets follow the lifecycle", () => {
  it.each([
    ["hidden", { visible: false, online: true, locked: false }],
    ["locked", { visible: true, online: true, locked: true }],
  ])("close while %s and reconnect when they come back", async (_name, away) => {
    const t = await boot();
    t.host()?.socket.join(port);
    await vi.advanceTimersByTimeAsync(0);
    t.registry.setLifecycle(away);
    expect(t.platform.links[0]?.closed).toBe(true);
    t.registry.setLifecycle({ visible: true, online: true, locked: false });
    expect(t.platform.links).toHaveLength(2);
  });
});

/** A fetch that never answers `/auth/info` until released, ending on its caller's abort. */
function holding(inner: typeof fetch, hold: { on: boolean; sent: string[] }): typeof fetch {
  return (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    hold.sent.push(`${init?.method ?? "GET"} ${url}`);
    if (!hold.on || url.includes("/auth/")) return inner(input, init);
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { reject(new DOMException("aborted", "AbortError")); });
    });
  };
}

const reply = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("the admission check as reachability's attempt", () => {
  const info = defaultInfo();

  it.each([
    ["a 200 with a host id", () => Promise.resolve(reply(200, info)), true],
    ["the daemon's 503 identity_unavailable", () => Promise.resolve(reply(503, { error: "identity_unavailable" })), true],
    ["a proxy's 502", () => Promise.resolve(reply(502, { error: "bad_gateway" })), false],
    ["a 404 without a host id", () => Promise.resolve(reply(404, { error: "not_found" })), false],
    ["a network error", () => Promise.reject(new TypeError("network")), false],
    ["no reply in 5 s", () => new Promise<Response>(() => undefined), false],
  ])("%s", async (_name, answer, answered) => {
    const t = await boot(undefined, {}, () => (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/auth/info")) return Promise.resolve(reply(200, { deviceName: "laptop" }));
      return Promise.race([answer(), new Promise<Response>((_r, reject) => { init?.signal?.addEventListener("abort", () => { reject(new DOMException("aborted", "AbortError")); }); })]);
    });
    await vi.advanceTimersByTimeAsync(5_100);
    expect(t.host()?.shown).toBe(answered ? "reachable" : "checking");
  });

  it("last reached carries across admission, from the saved value to the answer", async () => {
    const t = await boot((p) => { p.daemon.info = "down"; }, {}, undefined, { reachedAt: () => 1234 });
    expect(t.host()).toMatchObject({ shown: "checking", reachedAt: 1234 });
    t.platform.daemon.info = defaultInfo();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.host()?.reachedAt).toBeGreaterThan(1234);
  });

  it("a 4503 stops the socket and the check takes over: no socket opens while it runs", async () => {
    const hold = { on: false, sent: [] as string[] };
    const t = await boot(undefined, {}, (inner) => holding(inner, hold));
    t.host()?.socket.join(port);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.platform.links).toHaveLength(1);
    t.platform.links[0]?.drop(4503);
    expect(t.host()?.admission).toEqual({ kind: "deciding" });
    expect(t.platform.links).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.platform.links).toHaveLength(1); // the check is under way
    await vi.advanceTimersByTimeAsync(2_000);
    expect(t.host()?.admission.kind).toBe("admitted"); // it answered, and the socket came back
    expect(t.platform.links).toHaveLength(2);
  });

  it("sends nothing while hidden or locked, and the page shown again sends the check", async () => {
    const hold = { on: false, sent: [] as string[] };
    const t = await boot((p) => { p.daemon.node = "busy"; }, {}, (inner) => holding(inner, hold));
    t.registry.setLifecycle({ visible: false, online: true, locked: false });
    const seen = hold.sent.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(hold.sent).toHaveLength(seen);
    t.registry.setLifecycle({ visible: true, online: true, locked: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(hold.sent.length).toBeGreaterThan(seen);
  });

  it("pausing the check decides nothing about the server", async () => {
    const t = await boot((p) => { p.daemon.info = "down"; });
    await vi.advanceTimersByTimeAsync(9_000);
    t.registry.setLifecycle({ visible: false, online: true, locked: false });
    t.registry.setLifecycle({ visible: true, online: true, locked: false });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.host()?.shown).not.toBe("unreachable"); // the first attempt after the pause begins a new outage
    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.host()?.shown).toBe("unreachable");
  });
});

describe("requests to an unreachable server", () => {
  /** A server whose file requests hang until aborted; the socket is welcomed by the test platform. */
  async function connected() {
    const hold = { on: true, sent: [] as string[] };
    const t = await boot(undefined, {}, (inner) => holding(inner, hold));
    t.host()?.socket.join(port);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.host()?.shown).toBe("reachable");
    return { ...t, hold, fs: () => t.host()?.fs, link: () => t.platform.links.at(-1) as FakeLink };
  }
  const fileGets = (hold: { sent: string[] }): string[] => hold.sent.filter((s) => s.includes("/fs/"));

  it("a GET in flight fails as network the moment the host turns unreachable, and survives past 10 s while the socket is open", async () => {
    const t = await connected();
    const outcome: unknown[] = [];
    void t.fs()?.list("/", 0, false).then(() => outcome.push("ok"), (e: unknown) => outcome.push(e));
    await vi.advanceTimersByTimeAsync(40_000);
    expect(outcome).toEqual([]);
    t.link().drop(1006, "idle");
    await vi.advanceTimersByTimeAsync(0);
    expect(t.host()?.shown).toBe("unreachable");
    expect(outcome).toMatchObject([{ code: "network" }]);
  });

  it("a GET past its headers is aborted too: a body that stalls ends as network when the host turns unreachable", async () => {
    const hold = { on: false, sent: [] as string[] };
    // Headers arrive at once; the body never finishes and errors when its request is aborted.
    const stalling = (inner: typeof fetch): typeof fetch => (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/fs/")) return inner(input, init);
      const body = new ReadableStream<Uint8Array>({
        start(controller) { init?.signal?.addEventListener("abort", () => { controller.error(new DOMException("aborted", "AbortError")); }); },
      });
      return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }));
    };
    const t = await boot(undefined, {}, (inner) => stalling(holding(inner, hold)));
    t.host()?.socket.join(port);
    await vi.advanceTimersByTimeAsync(0);
    const outcome: unknown[] = [];
    void t.host()?.fs.list("/", 0, false).then(() => outcome.push("ok"), (e: unknown) => outcome.push(e));
    await vi.advanceTimersByTimeAsync(40_000);
    expect(outcome).toEqual([]);
    (t.platform.links.at(-1) as FakeLink).drop(1006, "idle");
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toMatchObject([{ code: "network" }]);
    // The slot's signal was replaced at the edge: the next GET, once reachable, is not born aborted.
    await vi.advanceTimersByTimeAsync(40_000);
    expect(t.host()?.shown).toBe("reachable");
    const next: unknown[] = [];
    void t.host()?.fs.list("/", 0, false).then(() => next.push("ok"), (e: unknown) => next.push(e));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(next).toEqual([]); // waiting on its body, not rejected
  });

  it("a GET made while unreachable is not sent, the admission check still is, and a POST is never aborted", async () => {
    const t = await connected();
    t.link().drop(1006, "idle");
    const before = fileGets(t.hold).length;
    await expect(t.fs()?.list("/", 0, false)).rejects.toMatchObject({ code: "network" });
    expect(fileGets(t.hold)).toHaveLength(before);
    const post = t.host()?.fs.create("/", "a", "file");
    const settled: string[] = [];
    void post?.then(() => settled.push("ok"), () => settled.push("failed"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fileGets(t.hold)).toHaveLength(before + 1);
    expect(t.hold.sent.at(-1)).toMatch(/^POST /);
    t.link().drop(1006, "idle"); // a second loss changes nothing: the host is unreachable already
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toEqual([]);
    t.registry.recheck("h1");
    await vi.advanceTimersByTimeAsync(0);
    expect(t.hold.sent.some((s) => s.endsWith("/auth/info"))).toBe(true);
  });

  it("the caller's own abort still aborts a GET, and reads as an abort", async () => {
    const t = await connected();
    const ctrl = new AbortController();
    const result = t.fs()?.search("/", "q", false, ctrl.signal);
    ctrl.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("phone offline: every host is no network, waiting GETs fail, and none is sent", async () => {
    const t = await connected();
    const outcome: unknown[] = [];
    void t.fs()?.list("/", 0, false).then(() => outcome.push("ok"), (e: unknown) => outcome.push(e));
    t.registry.setLifecycle({ visible: true, online: false, locked: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.host()?.shown).toBe("noNetwork");
    expect(outcome).toMatchObject([{ code: "network" }]);
    const before = fileGets(t.hold).length;
    await expect(t.fs()?.list("/", 0, false)).rejects.toMatchObject({ code: "network" });
    expect(fileGets(t.hold)).toHaveLength(before);
    t.registry.setLifecycle({ visible: true, online: true, locked: false });
    expect(t.host()?.shown).toBe("reachable");
  });

  it("a no-network blip over an open socket tells views that failed as network", async () => {
    const t = await connected();
    const calls: string[] = [];
    t.registry.recovered("h1", () => calls.push("recovered"));
    t.registry.setLifecycle({ visible: true, online: false, locked: false });
    expect(t.host()?.shown).toBe("noNetwork");
    t.registry.setLifecycle({ visible: true, online: true, locked: false });
    expect(t.host()?.shown).toBe("reachable");
    expect(calls).toEqual(["recovered"]);
  });

  it("tells views that failed as network when the server answers again, and not on a socket's ordinary close", async () => {
    const t = await connected();
    const calls: string[] = [];
    t.registry.recovered("h1", () => calls.push("recovered"));
    t.link().drop(1006); // an ordinary close while reachable: nothing failed
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000); // the backoff's socket is welcomed while reachable
    expect(calls).toEqual(["recovered"]);
    t.platform.links.at(-1)?.drop(1006, "idle");
    expect(t.host()?.shown).toBe("unreachable");
    calls.length = 0;
    await vi.advanceTimersByTimeAsync(40_000);
    expect(t.host()?.shown).toBe("reachable");
    expect(calls).toEqual(["recovered"]);
  });
});

describe("a stuck socket", () => {
  /** Sockets that open only when the test says; `answer` is whether HTTP answers. */
  async function stuckSetup(hosts: HostEntry[] = [{ handle: "h1", hostId: "h-pop", name: "pop-os", pageOrigin: null }], answer = true) {
    const links: Record<string, FakeLink[]> = {};
    const gate = { open: (): void => undefined, wait: Promise.resolve() };
    const t = await boot(
      (p) => {
        p.transport.openSocket = (handle, handlers) => {
          const link = new FakeLink(handlers);
          (links[handle] ??= []).push(link);
          return link;
        };
      },
      { hosts },
      (inner) => async (input, init) => {
        await gate.wait;
        return answer ? inner(input, init) : Promise.reject(new TypeError("network"));
      },
    );
    /** Holds every request until `release`. */
    const hold = (): void => { gate.wait = new Promise<void>((resolve) => { gate.open = resolve; }); };
    const last = (handle: string): FakeLink => links[handle]?.at(-1) as FakeLink;
    /** `n` connect timeouts in a row; the backoff's socket opens between them. */
    const timeouts = (handle: string, n: number) => {
      for (let i = 0; i < n; i++) {
        if (i > 0) vi.advanceTimersByTime(5_000);
        last(handle).drop(1006, "connectTimeout");
      }
    };
    return { ...t, links, last, timeouts, hold, release: () => { gate.open(); } };
  }

  it("asks for a fresh web view when HTTP answers", async () => {
    const t = await stuckSetup();
    t.host()?.socket.join(port);
    t.timeouts("h1", 3);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.stuck).toEqual(["stuck"]);
  });

  it("does not when the probe gets no answer: an off server never causes a reload", async () => {
    const t = await stuckSetup(undefined, false);
    t.host()?.socket.join(port);
    t.timeouts("h1", 3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.stuck).toEqual([]);
  });

  it("does not when a welcome came meanwhile", async () => {
    const t = await stuckSetup();
    t.host()?.socket.join(port);
    t.hold();
    t.timeouts("h1", 3);
    await vi.advanceTimersByTimeAsync(2_000); // the backoff's socket opens, and is welcomed while the probe waits
    t.last("h1").welcome();
    t.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.stuck).toEqual([]);
  });

  it("does not when another server's socket is open", async () => {
    const t = await stuckSetup([
      { handle: "h1", hostId: "h-pop", name: "pop-os", pageOrigin: null },
      { handle: "h2", hostId: "h-mac", name: "mac", pageOrigin: null },
    ]);
    t.registry.all().forEach((c) => { c.socket.join(port); });
    t.last("h2").welcome();
    t.timeouts("h1", 3);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.stuck).toEqual([]);
  });
});

describe("Retry", () => {
  const tokenHost: HostEntry = { handle: "h1", hostId: "h-pop", name: "pop-os", pageOrigin: null };

  it("connects a waiting socket now and shows checking over an unreachable server", async () => {
    const t = await boot();
    t.host()?.socket.join(port);
    await vi.advanceTimersByTimeAsync(0);
    t.platform.links.at(-1)?.drop(1006, "idle");
    expect(t.host()?.shown).toBe("unreachable");
    const before = t.platform.links.length;
    t.registry.retry("h1");
    expect(t.platform.links.length).toBeGreaterThan(before);
    expect(t.host()?.shown).toBe("checking");
  });

  it("changes nothing while the socket is open, and nothing for a handle that isn't listed", async () => {
    const t = await boot();
    t.host()?.socket.join(port);
    await vi.advanceTimersByTimeAsync(0);
    const links = t.platform.links.length;
    t.registry.retry("h1");
    t.registry.retry("nope");
    expect(t.platform.links).toHaveLength(links);
    expect(t.host()?.shown).toBe("reachable");
  });

  it("checks admission again for a host that is still undecided", async () => {
    const t = await boot((p) => { p.daemon.node = "busy"; });
    expect(t.host()?.admission).toEqual({ kind: "deciding" });
    t.platform.daemon.node = "enrolled";
    t.registry.retry("h1");
    await vi.advanceTimersByTimeAsync(0);
    expect(t.host()?.admission).toEqual({ kind: "admitted", deviceName: "laptop" });
  });

  it("admits a native host called incompatible again, and opens its socket", async () => {
    const t = await boot(undefined, { hosts: [tokenHost] });
    t.host()?.socket.join(port);
    t.platform.links[0]?.drop(4001);
    expect(t.host()?.admission).toEqual({ kind: "incompatible" });
    const links = t.platform.links.length;
    t.registry.retry("h1");
    expect(t.host()?.admission).toEqual({ kind: "admitted" });
    expect(t.platform.links.length).toBeGreaterThan(links);
  });

  it("a refused tab moves on after Retry only because the server went first", async () => {
    const t = await boot(undefined, { hosts: [tokenHost] });
    const states: string[] = [];
    const host = t.host();
    if (!host) throw new Error("no host");
    const tab = new TabDriver({
      session: { server: "main:1-2", session: 1 },
      model: { output: () => undefined, snapshot: () => Promise.resolve() },
      host: host.socket,
      size: () => ({ cols: 80, rows: 24 }),
      onState: (s) => states.push(s.kind),
      onNotice: () => undefined,
      random: () => 0.5,
    });
    t.platform.links[0]?.drop(4001);
    expect(states.at(-1)).toBe("reconnecting");
    // The tab's own nudge, with the host stopped (refused): it has nothing to connect to, so the tab stays as it is.
    tab.nudge();
    expect(states.at(-1)).toBe("reconnecting");
    // The server's Retry first: it admits the host again and its socket opens; then the tab's nudge goes on.
    t.registry.retry("h1");
    tab.nudge();
    expect(states.at(-1)).toBe("connecting");
    t.platform.links.at(-1)?.welcome();
    expect(t.platform.links.at(-1)?.types()).toContain("watch");
  });
});

describe("a refusal", () => {
  const tokenHost: HostEntry = { handle: "h1", hostId: "h-pop", name: "pop-os", pageOrigin: null };

  it("fails a request with the halt reason, not the background's", async () => {
    const t = await boot(undefined, { hosts: [tokenHost] });
    const host = t.host();
    host?.socket.join(port);
    const answer = host?.socket.request((req) => ({ type: "listSessions", data: { req } }) as never, () => undefined);
    const outcome = answer?.catch((e: unknown) => (e as { reason: string }).reason);
    t.platform.links[0]?.drop(4401);
    expect(await outcome).toBe("unauthorized");
  });

  it("a welcome on a refused tab clears its refusal, and a detach is kept", async () => {
    const { reduce } = await import("../tabs/connection");
    const refused = { kind: "reconnecting", attempt: 1, retryInMs: null, halt: "unauthorized" } as const;
    expect(reduce(refused, { type: "linkUp" }).kind).toBe("connecting");
    expect(reduce({ ...refused, halt: "incompatible" }, { type: "linkUp" }).kind).toBe("connecting");
    expect(reduce({ ...refused, halt: "detached" }, { type: "linkUp" }).kind).toBe("reconnecting");
  });
});

describe("a host removed from the list", () => {
  it("closes its socket and keeps its last message as last reached; a host being stopped is not started again", async () => {
    const t = await boot();
    const host = t.host();
    host?.socket.join(port);
    await vi.advanceTimersByTimeAsync(0);
    const link = t.platform.links[0] as FakeLink;
    await vi.advanceTimersByTimeAsync(20_000);
    link.say({ type: "pong", data: { t: 0 } });
    const last = Date.now();
    await vi.advanceTimersByTimeAsync(5_000);
    const links = t.platform.links.length;
    t.registry.set([]);
    expect(link.closed).toBe(true);
    expect(host?.socket.reachedAt).toBe(last);
    expect(t.registry.all()).toHaveLength(0);
    expect(t.platform.links).toHaveLength(links);
  });

  it("a stopping socket's refusing update does not foreground the host", async () => {
    const t = await boot();
    const host = t.host();
    host?.socket.join(port);
    await vi.advanceTimersByTimeAsync(0);
    t.platform.links[0]?.drop(4005);
    expect(t.host()?.refusing).toBe("overCap");
    // Removing the host stops its socket, which reports "not refusing"; that must not start it again.
    const links = t.platform.links.length;
    t.registry.set([]);
    expect(t.platform.links).toHaveLength(links);
  });
});

describe("a request with its own signal", () => {
  it("ends when either signal fires, with no AbortSignal.any", async () => {
    const original = Object.getOwnPropertyDescriptor(AbortSignal, "any");
    // @ts-expect-error iOS 17.0 has no AbortSignal.any
    delete AbortSignal.any;
    try {
      const hold = { on: true, sent: [] as string[] };
      const t = await boot(undefined, {}, (inner) => holding(inner, hold));
      t.host()?.socket.join(port);
      await vi.advanceTimersByTimeAsync(0);
      const own = new AbortController();
      const fs = t.host()?.fs;
      const caught = fs?.search("/", "x", false, own.signal).catch((e: unknown) => e);
      own.abort();
      expect(await caught).toMatchObject({ name: "AbortError" });
      const other = fs?.search("/", "y", false, new AbortController().signal).catch((e: unknown) => e);
      t.platform.links.at(-1)?.drop(1006, "idle"); // the host turns unreachable: its own signal fires
      expect(await other).toMatchObject({ code: "network" });
    } finally {
      if (original) Object.defineProperty(AbortSignal, "any", original);
    }
  });
});
