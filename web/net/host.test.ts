import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientMsg, ServerMsg, SessionRef, TmuxListing } from "../proto/generated/messages";
import type { ConnectionState } from "../tabs/connection";
import { TabDriver, type TabOptions } from "../tabs/driver";
import { makeHost } from "../platform/test/host";
import { RequestError, type TabPort } from "./host";

const server = "main:1-2";
const sesA: SessionRef = { server, session: 3 };
const sesB: SessionRef = { server, session: 4 };

function setup() {
  const h = makeHost();
  const painted: string[] = [];
  const dec = new TextDecoder();
  const tab = (name: string, session: SessionRef) => {
    const states: ConnectionState[] = [];
    const model: TabOptions["model"] = {
      output: (b) => painted.push(`${name}:o:${dec.decode(b)}`),
      snapshot: (s) => { painted.push(`${name}:s:${dec.decode(s.restore)}`); return Promise.resolve(); },
    };
    const driver = new TabDriver({ session, model, host: h.host, size: () => ({ cols: 80, rows: 24 }), onState: (s) => states.push(s), onNotice: () => undefined, random: () => 0.5 });
    return { driver, state: (): ConnectionState => states[states.length - 1] as ConnectionState };
  };
  const watching = (watch: number, session: SessionRef): ServerMsg => ({
    type: "watching",
    data: { watch, window: { id: 1, index: 0, name: "w", size: { cols: 80, rows: 24 } }, session, pane: 1, cwd: null },
  });
  return { ...h, tab, painted, watching };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("one socket per host", () => {
  it("shares one link, gives each tab its own watch, and routes frames by watch id", () => {
    const t = setup();
    const a = t.tab("a", sesA);
    const b = t.tab("b", sesB);
    expect(t.links).toHaveLength(1);
    t.link().welcome();
    expect(t.link().sent.map((m) => m.type === "watch" && [m.data.watch, m.data.session.session])).toEqual([[1, 3], [2, 4]]);
    t.link().say(t.watching(1, sesA));
    t.link().say(t.watching(2, sesB));
    t.link().snapshot(1, "A");
    t.link().output(2, "B");
    expect(t.painted).toEqual(["a:s:A", "b:o:B"]);
    expect(a.state().kind).toBe("live");
    expect(b.state().kind).toBe("live");
  });

  it("closes one tab on its sessionClosed and the socket with the last tab", () => {
    const t = setup();
    const a = t.tab("a", sesA);
    const b = t.tab("b", sesB);
    t.link().welcome();
    t.link().say(t.watching(2, sesB));
    t.link().say({ type: "sessionClosed", data: { session: sesA } });
    expect(a.state().kind).toBe("closed");
    expect(b.state().kind).toBe("live");
    expect(t.link().closed).toBe(false);
    t.link().say({ type: "serverExited", data: { server } });
    expect(b.state().kind).toBe("closed");
    expect(t.link().closed).toBe(true);
  });
});

const tmux: TmuxListing = { server, version: "3.4", sessions: [] };
const list = (h: ReturnType<typeof makeHost>) =>
  h.host.request((req): ClientMsg => ({ type: "listSessions", data: { req } }), (reply) => (reply.type === "sessions" ? reply.data.tmux : undefined));
const reqOf = (msg: ClientMsg | undefined): number => (msg && "req" in msg.data ? msg.data.req : -1);

describe("requests", () => {
  it("opens the socket for a request, sends it on welcome, and closes the socket once answered", async () => {
    const h = makeHost();
    const answer = list(h);
    expect(h.links).toHaveLength(1);
    expect(h.link().sent).toEqual([]);
    h.link().welcome();
    expect(h.link().types()).toEqual(["listSessions"]);
    h.link().say({ type: "sessions", data: { req: reqOf(h.link().sent[0]), tmux } });
    await expect(answer).resolves.toEqual(tmux);
    expect(h.link().closed).toBe(true);
  });

  it("answers each request by its id, a refusal included, and ignores answers nobody waits for", async () => {
    const t = setup();
    t.tab("a", sesA);
    t.link().welcome();
    const first = list(t);
    const second = list(t);
    const [one, two] = t.link().sent.filter((m) => m.type === "listSessions").map(reqOf);
    t.link().say({ type: "sessions", data: { req: 99, tmux: null } });
    t.link().say({ type: "error", data: { req: two ?? -1, code: "noServer", message: "no tmux" } });
    t.link().say({ type: "sessions", data: { req: one ?? -1, tmux } });
    await expect(first).resolves.toEqual(tmux);
    await expect(second).rejects.toMatchObject({ reason: "noServer", message: "no tmux" });
    expect(t.link().closed).toBe(false); // the tab still holds it
  });

  it("fails on a dropped socket without sending again, on a halt, on background, and after a timeout", async () => {
    const t = setup();
    t.tab("a", sesA);
    t.link().welcome();
    const dropped = list(t);
    t.link().drop();
    await expect(dropped).rejects.toBeInstanceOf(RequestError);
    await expect(dropped).rejects.toMatchObject({ reason: "lost" });
    vi.advanceTimersByTime(500);
    t.link().welcome();
    expect(t.link().types()).toEqual(["watch"]);

    const halted = list(t);
    t.link().drop(4001);
    await expect(halted).rejects.toMatchObject({ reason: "incompatible" });

    const slow = list(t);
    expect(t.links).toHaveLength(3); // a request tries a halted host again
    vi.advanceTimersByTime(5_000);
    await expect(slow).rejects.toMatchObject({ reason: "timeout" });

    t.link().welcome();
    // Once sent, a request waits for its reply, not for the socket: 5 s of a slow daemon is no failure.
    const sent = list(t);
    vi.advanceTimersByTime(29_000);
    t.link().say({ type: "sessions", data: { req: t.link().sent.length > 0 ? (t.link().sent.at(-1) as { data: { req: number } }).data.req : 0, tmux: null } });
    await expect(sent).resolves.toBeNull();
    const silent = list(t);
    vi.advanceTimersByTime(30_000);
    await expect(silent).rejects.toMatchObject({ reason: "timeout" });

    const paused = list(t);
    t.host.background();
    await expect(paused).rejects.toMatchObject({ reason: "background" });
    await expect(list(t)).rejects.toMatchObject({ reason: "background" });
  });
});

describe("reconnect is per host", () => {
  it("backs off once for all tabs, then re-watches each on the new socket", () => {
    const t = setup();
    const a = t.tab("a", sesA);
    const b = t.tab("b", sesB);
    t.link().welcome();
    t.link().say(t.watching(1, sesA));
    t.link().say(t.watching(2, sesB));
    t.link().drop();
    expect(a.state()).toMatchObject({ kind: "reconnecting", retryInMs: 500 });
    expect(b.state()).toMatchObject({ kind: "reconnecting", retryInMs: 500 });
    vi.advanceTimersByTime(499);
    expect(t.links).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(t.links).toHaveLength(2);
    t.link().drop();
    expect(a.state()).toMatchObject({ retryInMs: 1000 });
    vi.advanceTimersByTime(1000);
    t.link().welcome();
    expect(t.link().sent.map((m) => m.type === "watch" && m.data.watch)).toEqual([3, 4]);
  });

  it("on 4401 tells native, stops retrying, and a tap tries again", () => {
    const t = setup();
    const a = t.tab("a", sesA);
    t.link().drop(4401);
    expect(t.events).toEqual(["refused 4401"]);
    expect(a.state()).toMatchObject({ halt: "unauthorized", retryInMs: null });
    vi.advanceTimersByTime(120_000);
    expect(t.links).toHaveLength(1);
    a.driver.nudge();
    expect(t.links).toHaveLength(2);
  });
});

describe("the socket cap", () => {
  it("reports a 4005 close as a host problem until a socket is welcomed, and keeps retrying", () => {
    const t = setup();
    const a = t.tab("a", sesA);
    t.link().welcome();
    t.link().drop(4005);
    expect(t.events).toEqual(["capped"]);
    expect(a.state()).toMatchObject({ kind: "reconnecting", halt: null });
    vi.advanceTimersByTime(500);
    expect(t.links).toHaveLength(2);
    t.link().drop(4005);
    expect(t.events).toEqual(["capped"]); // told once
    vi.advanceTimersByTime(1000);
    t.link().welcome();
    expect(t.events).toEqual(["capped", "uncapped"]);
  });

  it("is not reported once nothing is trying", () => {
    const t = setup();
    t.tab("a", sesA);
    t.link().welcome();
    t.link().drop(4005);
    t.host.background();
    expect(t.events).toEqual(["capped", "uncapped"]);
  });
});

describe("lifecycle", () => {
  it("closes the socket on background without counting a loss, and reconnects at once on foreground", () => {
    const t = setup();
    const a = t.tab("a", sesA);
    t.link().welcome();
    t.link().say(t.watching(1, sesA));
    t.host.background();
    expect(t.link().closed).toBe(true);
    expect(t.events).toEqual([]);
    expect(a.state()).toEqual({ kind: "connecting", attempt: 0 });
    vi.advanceTimersByTime(120_000);
    expect(t.links).toHaveLength(1);
    t.host.nudge(); // network signals do nothing while in the background
    expect(t.links).toHaveLength(1);
    t.host.foreground();
    expect(t.links).toHaveLength(2);
    t.link().welcome();
    expect(t.link().sent.at(-1)).toMatchObject({ type: "watch", data: { watch: 2 } });
  });

  it("foreground resets a backoff that was running", () => {
    const t = setup();
    t.tab("a", sesA);
    t.link().drop();
    t.host.background();
    vi.advanceTimersByTime(60_000);
    expect(t.links).toHaveLength(1);
    t.host.foreground();
    expect(t.links).toHaveLength(2);
  });

  it("a network nudge reconnects a waiting host now, and leaves a live socket alone", () => {
    const t = setup();
    t.tab("a", sesA);
    t.link().welcome();
    t.host.nudge();
    expect(t.links).toHaveLength(1);
    t.link().drop();
    t.host.nudge();
    expect(t.links).toHaveLength(2);
    vi.advanceTimersByTime(60_000);
    expect(t.links).toHaveLength(2); // the cancelled backoff timer did not open a third
  });
});

describe("connect timeout", () => {
  it("tries one new socket at once, backs off the second, and asks from the third", () => {
    const t = setup();
    const a = t.tab("a", sesA);
    t.link().drop(1006, "connectTimeout");
    expect(t.links).toHaveLength(2);
    t.link().drop(1006, "connectTimeout");
    expect(t.links).toHaveLength(2);
    expect(t.events).toEqual([]);
    vi.advanceTimersByTime(60_000);
    expect(t.links).toHaveLength(3);
    t.link().drop(1006, "connectTimeout");
    expect(t.events).toEqual(["stuck"]);
    expect(a.state().kind).toBe("reconnecting");
  });

  it("forgives one timeout once a socket gets through", () => {
    const t = setup();
    t.tab("a", sesA);
    t.link().drop(1006, "connectTimeout");
    t.link().welcome();
    t.link().drop();
    vi.advanceTimersByTime(500);
    t.link().drop(1006, "connectTimeout");
    expect(t.events).toEqual([]);
  });
});

// Reachability (plan.md "Reachability"): the table's rows, and the sequences around them.
describe("reachability", () => {
  const port: TabPort = { linkUp: () => undefined, linkLost: () => undefined, paused: () => undefined, message: () => undefined, frame: () => undefined };
  const at = (seconds: number): void => { vi.advanceTimersByTime(seconds * 1000); };
  /** The socket in CONNECTING gives up after its limit, `seconds` after it began. */
  const timesOut = (t: ReturnType<typeof makeHost>, seconds = 5): void => { at(seconds); t.link().drop(1006, "connectTimeout"); };

  /** A host with a tab joined and a welcomed socket: reachable. */
  function reachable() {
    const t = makeHost();
    t.host.join(port);
    t.link().welcome();
    return t;
  }

  it("a welcome is reachable, last reached now", () => {
    const t = makeHost();
    t.host.join(port);
    expect(t.host.reach).toBe("checking");
    at(1);
    t.link().welcome();
    expect(t.host.reach).toBe("reachable");
    expect(t.host.reachedAt).toBe(Date.now());
  });

  it.each([[4401, "halted"], [4001, "halted"], [4005, "waiting"], [4503, "waiting"]])("a server's %i close is an answer: reachable, trouble cleared", (code) => {
    const t = makeHost();
    t.host.join(port);
    t.link().drop(1006, "connectTimeout"); // trouble began
    at(5);
    t.link().drop(code);
    expect(t.host.reach).toBe("reachable");
    expect(t.host.reachedAt).toBe(Date.now());
    t.link().drop(1006); // a fresh outage begins at its own attempt
    expect(t.host.reach).toBe("reachable");
  });

  it("4401 and 4001 halt the socket for the tabs, and 4005 backs off", () => {
    const notices: unknown[] = [];
    const t = makeHost();
    t.host.join({ ...port, linkLost: (info) => notices.push(info) });
    t.link().drop(4401);
    // The halted host opens nothing by itself.
    at(60);
    expect(t.links).toHaveLength(1);
    expect(notices).toEqual([{ retryInMs: null, halt: "unauthorized" }]);
    t.host.nudge();
    t.link().drop(4005);
    expect(notices.at(-1)).toEqual({ retryInMs: 500 });
  });

  it("an off server reads checking at 5 s and unreachable at about 10 s", () => {
    const t = reachable();
    t.link().drop(1006); // the open socket closes: the outage begins here
    expect(t.host.reach).toBe("reachable");
    at(0.5);
    expect(t.links).toHaveLength(2);
    timesOut(t);
    expect(t.host.reach).toBe("checking");
    expect(t.links).toHaveLength(3); // the first timeout reconnects at once
    timesOut(t);
    expect(t.host.reach).toBe("unreachable");
    expect(t.reaches.filter((r) => r !== "reachable")).toEqual(["checking", "unreachable"]);
  });

  it("a quick failure and a welcome inside 1.5 s never read checking", () => {
    const t = reachable();
    at(10);
    t.link().drop(1006);
    at(0.5);
    t.link().drop(1006); // the backoff's socket fails too, 0.5 s in
    at(1);
    t.link().welcome();
    expect(t.reaches).not.toContain("checking");
    expect(t.host.reach).toBe("reachable");
  });

  it("a failure that ends under 10 s into an outage from unreachable leaves it unreachable", () => {
    const t = reachable();
    t.link().drop(1006);
    at(0.5);
    timesOut(t);
    timesOut(t);
    expect(t.host.reach).toBe("unreachable");
    at(0.5);
    at(2);
    t.link().drop(1006); // a quick failure, 2 s into an attempt
    expect(t.host.reach).toBe("unreachable");
  });

  it("an open socket's idle close is unreachable at once, last reached its last message", () => {
    const t = reachable();
    at(20);
    const last = Date.now();
    t.link().say({ type: "pong", data: { t: 0 } });
    at(30);
    t.link().drop(1006, "idle");
    expect(t.host.reach).toBe("unreachable");
    expect(t.host.reachedAt).toBe(last);
  });

  describe("an ask with no answer", () => {
    const watch = (t: ReturnType<typeof makeHost>): void => {
      t.host.send(port, { type: "watch", data: { watch: t.host.nextWatch(), session: sesA, size: { cols: 80, rows: 24 } } });
    };

    it("reads checking after 3 s of silence and reachable again on any message or frame", () => {
      const arrivals = [
        (t: ReturnType<typeof makeHost>): void => { t.link().say({ type: "pong", data: { t: 0 } }); },
        (t: ReturnType<typeof makeHost>): void => { t.link().output(1, "x"); },
      ];
      for (const arrival of arrivals) {
        const t = reachable();
        watch(t);
        at(2.9);
        expect(t.host.reach).toBe("reachable");
        at(0.2);
        expect(t.host.reach).toBe("checking");
        arrival(t);
        expect(t.host.reach).toBe("reachable");
      }
    });

    it("stays reachable when something arrives inside the 3 s, however slow the reply", () => {
      const t = reachable();
      watch(t);
      at(2);
      t.link().say({ type: "pong", data: { t: 0 } });
      at(5);
      expect(t.host.reach).toBe("reachable");
    });

    it("times a request sent, including one queued before the socket opened; keystrokes are no ask", () => {
      const queued = makeHost();
      void list(queued).catch(() => undefined);
      queued.link().welcome();
      at(3);
      expect(queued.host.reach).toBe("checking");
      const t = reachable();
      t.host.send(port, { type: "input", data: { watch: 1, bytes: "x" } } as unknown as ClientMsg);
      at(10);
      expect(t.host.reach).toBe("reachable");
    });

    it("goes on to unreachable at the idle close, and a close from the server is an answer", () => {
      const t = reachable();
      watch(t);
      at(4);
      t.link().drop(1006, "idle");
      expect(t.host.reach).toBe("unreachable");
      const u = reachable();
      watch(u);
      at(4);
      u.link().drop(4005);
      expect(u.host.reach).toBe("reachable");
    });

    it("is undone when the last tab leaves, so Home does not read connecting for good", () => {
      const t = reachable();
      watch(t);
      at(4);
      expect(t.host.reach).toBe("checking");
      t.host.leave(port);
      expect(t.host.reach).toBe("reachable");
      at(10);
      expect(t.host.reach).toBe("reachable");
    });

    it("is undone by the background, and no timer fires across sockets", () => {
      const t = reachable();
      watch(t);
      at(4);
      t.host.background();
      expect(t.host.reach).toBe("reachable");
      const u = reachable();
      watch(u);
      at(2);
      u.host.leave(port);
      at(5);
      expect(u.host.reach).toBe("reachable");
    });
  });

  it("a 1006 on a socket open for minutes is still reachable: the outage starts at the close", () => {
    const t = reachable();
    at(600);
    t.link().drop(1006);
    expect(t.host.reach).toBe("reachable");
    at(0.5);
    timesOut(t);
    expect(t.host.reach).toBe("checking");
  });

  it("stop mid-outage clears the trouble: a new connect failing at 5 s is not unreachable", () => {
    const t = reachable();
    t.link().drop(1006);
    at(0.5);
    timesOut(t);
    expect(t.host.reach).toBe("checking");
    t.host.background();
    t.host.foreground();
    timesOut(t);
    expect(t.host.reach).toBe("checking");
  });

  it("stop on an open socket sets last reached to its last message", () => {
    const t = reachable();
    at(20);
    t.link().say({ type: "pong", data: { t: 0 } });
    const last = Date.now();
    at(5);
    t.host.background();
    expect(t.host.reachedAt).toBe(last);
  });

  it("an unanswered attempt ending without a network changes nothing, but an answer still counts", () => {
    const t = reachable();
    t.network.online = false;
    t.link().drop(1006);
    at(0.5);
    timesOut(t);
    timesOut(t);
    expect(t.host.reach).toBe("reachable");
    at(60);
    t.host.nudge();
    t.link().drop(4005);
    expect(t.host.reach).toBe("reachable");
    expect(t.host.reachedAt).toBe(Date.now());
  });

  it("an idle close without a network changes nothing but last reached", () => {
    const t = reachable();
    at(20);
    t.link().say({ type: "pong", data: { t: 0 } });
    const last = Date.now();
    at(30);
    t.network.online = false;
    t.link().drop(1006, "idle");
    expect(t.host.reach).toBe("reachable");
    expect(t.host.reachedAt).toBe(last);
  });

  it("a socket that opened and got no welcome is unanswered and not stuck", () => {
    const t = makeHost();
    t.host.join(port);
    t.link().drop(1006, "welcomeTimeout");
    at(1);
    t.link().drop(1006, "welcomeTimeout");
    at(2);
    t.link().drop(1006, "welcomeTimeout");
    expect(t.stuck.calls).toBe(0);
  });

  it("an idle close starts the trouble at the close, so a Retry's attempt failing 10 s after it is unreachable", () => {
    const t = reachable();
    at(20);
    t.link().say({ type: "pong", data: { t: 0 } });
    at(30);
    t.link().drop(1006, "idle");
    t.host.retrying();
    expect(t.host.reach).toBe("checking");
    at(0.5); // the backoff step: a new attempt starts here, half a second after the close
    at(9.7);
    t.link().drop(1006, "connectTimeout");
    expect(t.host.reach).toBe("unreachable");
  });

  it.each([
    ["a clean close, 1000", 1000, undefined],
    ["a clean close, 1001", 1001, undefined],
    ["the link's own 4003", 4003, "protocol"],
    ["native opening no socket, 1006", 1006, undefined],
  ] as const)("%s is no answer: last reached stays its last message", (_name, code, cause) => {
    const t = reachable();
    const last = Date.now();
    at(20);
    t.link().drop(code, cause);
    expect(t.host.reachedAt).toBe(last);
    expect(t.host.reach).toBe("reachable"); // under 1.5 s into an unanswered attempt nothing reads checking
  });

  it("native's 4401 with no token is no answer, yet halts the tabs and refuses", () => {
    const t = makeHost();
    const lost: unknown[] = [];
    t.host.join({ ...port, linkLost: (info) => lost.push(info) });
    at(10);
    t.link().drop(4401, "notEnrolled");
    expect(t.host.reachedAt).toBeNull();
    expect(t.host.reach).toBe("unreachable");
    expect(t.events).toContain("refused 4401");
    expect(lost).toEqual([{ retryInMs: null, halt: "unauthorized" }]);
  });

  it("a socket that opened and got no welcome reads unreachable at 10 s, never reachable", () => {
    const t = makeHost();
    t.host.join(port);
    t.link().drop(1006, "welcomeTimeout");
    at(11);
    t.link().drop(1006, "welcomeTimeout");
    expect(t.host.reach).toBe("unreachable");
    expect(t.host.reachedAt).toBeNull();
  });

  it.each([["drops", (t: ReturnType<typeof makeHost>) => { t.link().drop(1006); }], ["stops with nothing needing it", (t: ReturnType<typeof makeHost>) => { t.host.leave(port); }]])("a socket that was open sets last reached to its last message when it %s", (_name, end) => {
    const t = reachable();
    at(20);
    t.link().say({ type: "pong", data: { t: 0 } });
    const last = Date.now();
    at(5);
    end(t);
    expect(t.host.reachedAt).toBe(last);
  });

  describe("Retry", () => {
    it("keeps a connect under 5 s old and gives it the backoff reset", () => {
      const t = makeHost();
      t.host.join(port);
      at(4.9);
      expect(t.host.nudge()).toBe(true);
      expect(t.links).toHaveLength(1);
      expect(t.link().closed).toBe(false);
    });

    it("replaces a connect 5 s old or more, and the old link's late handlers do nothing", () => {
      const t = makeHost();
      t.host.join(port);
      const old = t.link();
      at(6);
      expect(t.host.nudge()).toBe(true);
      expect(t.links).toHaveLength(2);
      expect(old.closed).toBe(true);
      const reaches = t.reaches.length;
      old.welcome();
      old.drop(1006, "connectTimeout");
      expect(t.host.ready).toBe(false);
      expect(t.links).toHaveLength(2);
      expect(t.reaches).toHaveLength(reaches);
      expect(t.host.reach).toBe("checking");
      t.link().welcome();
      expect(t.host.reach).toBe("reachable");
    });
  });

  describe("the connect limit", () => {
    it("is 5 s for the first two attempts of an outage and 15 s once unreachable; the backoff advances from the second timeout", () => {
      const t = makeHost();
      t.host.join(port);
      const started: number[] = [];
      const t0 = Date.now();
      const note = (): void => { started.push(Math.round((Date.now() - t0) / 100) / 10); };
      note();
      for (let i = 0; i < 4; i++) {
        const before = t.links.length;
        timesOut(t, (t.limits.at(-1) ?? 0) / 1000);
        while (t.links.length === before) at(0.1);
        note();
      }
      expect(t.limits).toEqual([5_000, 5_000, 15_000, 15_000, 15_000]);
      // 0, then at once at 5, then the backoff's 0.5, 1 and 2 s after each 15 s attempt.
      expect(started).toEqual([0, 5, 10.5, 26.5, 43.5]);
    });

    it("a tapped Retry over an old outage keeps the long limit", () => {
      const t = makeHost();
      t.host.join(port);
      timesOut(t);
      timesOut(t);
      expect(t.host.reach).toBe("unreachable");
      t.host.retrying();
      expect(t.host.reach).toBe("checking");
      at(60);
      t.host.nudge();
      expect(t.limits.at(-1)).toBe(15_000);
    });
  });

  describe("the connect-timeout rule", () => {
    it("the third and later timeouts ask; a welcome, stop, nudge or other close restart the count", () => {
      const t = makeHost();
      t.host.join(port);
      t.link().drop(1006, "connectTimeout");
      at(30);
      t.link().drop(1006, "connectTimeout");
      expect(t.stuck.calls).toBe(0);
      expect(t.host.stuck).toBe(false);
      at(30);
      t.link().drop(1006, "connectTimeout");
      expect(t.stuck.calls).toBe(1);
      expect(t.host.stuck).toBe(true);
      at(30);
      t.link().drop(1006, "connectTimeout");
      expect(t.stuck.calls).toBe(2);
      at(60);
      t.host.nudge();
      expect(t.host.stuck).toBe(false);
      t.link().drop(1006, "connectTimeout");
      at(30);
      t.link().welcome();
      t.link().drop(1006);
      at(1);
      t.link().drop(1006, "connectTimeout");
      at(30);
      t.link().drop(1006, "connectTimeout");
      expect(t.host.stuck).toBe(false);
      at(30);
      t.link().drop(1006, "connectTimeout");
      t.host.background();
      expect(t.host.stuck).toBe(false);
    });

    it("takes the ordinary backoff and never halts", () => {
      const t = makeHost();
      const lost: unknown[] = [];
      t.host.join({ ...port, linkLost: (info) => lost.push(info) });
      t.link().drop(1006, "connectTimeout");
      t.link().drop(1006, "connectTimeout");
      expect(lost.at(-1)).toEqual({ retryInMs: 500 });
      at(0.5);
      expect(t.links).toHaveLength(3);
    });
  });

  describe("nudge", () => {
    it("returns false while backgrounded, open, or with no tab joined, and the state stays", () => {
      const t = makeHost();
      expect(t.host.nudge()).toBe(false); // no tab
      t.host.join(port);
      timesOut(t);
      timesOut(t);
      expect(t.host.reach).toBe("unreachable");
      t.host.background();
      expect(t.host.nudge()).toBe(false);
      t.host.foreground();
      t.link().welcome();
      expect(t.host.nudge()).toBe(false);
    });

    it("while connecting keeps the attempt, resets the backoff and opens no second link", () => {
      const t = makeHost();
      t.host.join(port);
      t.link().drop(1006, "connectTimeout");
      t.link().drop(1006, "connectTimeout"); // backoff 0.5 s, attempt 1
      at(0.5);
      t.link().drop(1006); // attempt 2: 1 s next
      at(1);
      expect(t.links).toHaveLength(4);
      expect(t.host.nudge()).toBe(true);
      expect(t.links).toHaveLength(4);
      t.link().drop(1006);
      at(0.5); // back at the first step
      expect(t.links).toHaveLength(5);
    });
  });

  describe("every path that opens a socket notes when the attempt began", () => {
    // After a long quiet stretch with nothing in trouble, a failure 1 s into a new attempt is 1 s of trouble, not minutes.
    it.each(["join", "request", "nudge", "foreground", "backoff"])("%s", (path) => {
      const t = makeHost();
      t.host.join(port);
      t.link().welcome();
      at(300);
      if (path === "join" || path === "request") t.host.leave(port);
      if (path === "foreground") t.host.background();
      if (path === "nudge") t.link().drop(4401);
      if (path === "backoff") t.link().drop(4005);
      if (path === "join") t.host.join(port);
      if (path === "request") void t.host.request((req) => ({ type: "listSessions", data: { req } }), () => undefined).catch(() => undefined);
      if (path === "nudge") t.host.nudge();
      if (path === "foreground") t.host.foreground();
      if (path === "backoff") at(0.5);
      expect(t.links).toHaveLength(2);
      at(1);
      t.link().drop(1006);
      expect(t.host.reach).toBe("reachable");
    });
  });
});
