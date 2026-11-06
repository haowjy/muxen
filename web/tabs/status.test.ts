import { describe, expect, it } from "vitest";
import type { ServerState } from "../net/hosts";
import { lookOf } from "../screens/terminal/tabView";
import type { TerminalTab } from "../workspace/state";
import type { ConnectionState } from "./connection";
import { describe as describeTab, type HostLook } from "./status";

const look = (server: ServerState): HostLook => ({ name: "pop-os", server, byToken: false });
const up = look({ kind: "up", refusing: null });
const unreachable = look({ kind: "unreachable" });
const offline = look({ kind: "noNetwork" });
const refused = look({ kind: "attention", admission: { kind: "notEnrolled", nodeName: null } });
const connecting: ConnectionState = { kind: "connecting", attempt: 0 };
const lost: ConnectionState = { kind: "reconnecting", attempt: 1, retryInMs: 500, halt: null };

describe("a tab's status", () => {
  it("rests off screen as open, until its server is off: then it reads reconnecting", () => {
    expect(describeTab(connecting, 0, null, 0, up, false).tone).toBe("idle");
    expect(describeTab(connecting, 0, null, 0, unreachable, false)).toMatchObject({ tone: "waiting", detail: "Can't reach pop-os" });
    expect(describeTab({ kind: "live" }, 0, null, 0, up, false).tone).toBe("idle");
    expect(describeTab({ kind: "live" }, 0, null, 0, up, true).tone).toBe("live");
    expect(describeTab({ kind: "live" }, 0, null, 0, unreachable, false)).toMatchObject({ tone: "waiting", detail: "Can't reach pop-os" });
    expect(describeTab({ kind: "live" }, 0, null, 0, offline, false)).toMatchObject({ tone: "waiting", detail: "This device is offline." });
    expect(describeTab(connecting, 0, null, 0, offline, false).tone).toBe("waiting");
    expect(describeTab({ kind: "live" }, 0, null, 0, refused, false).tone).toBe("halted");
    expect(describeTab(connecting, 0, null, 0, refused, false).tone).toBe("halted");
  });

  it("reads a refusal on an admitted server as halted, with the refusal's words and Retry", () => {
    expect(describeTab({ ...lost, halt: "unauthorized" }, 0, null, 0, up, true)).toMatchObject({ tone: "halted", action: "Retry" });
    expect(describeTab({ ...lost, halt: "incompatible" }, 0, null, 0, up, true)).toMatchObject({ tone: "halted", action: "Retry" });
    expect(describeTab({ ...lost, halt: "unauthorized" }, 0, null, 0, up, true).detail).not.toBeNull();
  });

  it("says nothing of a refusal, which the banner says once, and offers no Retry of its own", () => {
    for (const state of [connecting, lost, { ...lost, halt: "unauthorized" } as const]) {
      expect(describeTab(state, 0, null, 0, refused, true)).toMatchObject({ tone: "halted", detail: null, action: null });
    }
  });

  it("lets the server's banner show on a terminal tab only when the tab's own state fills the strip", () => {
    const own = (state: ConnectionState, host = up) => describeTab(state, 0, null, 0, host, true).own;
    expect(own({ kind: "live" })).toBe(false);
    expect(own({ kind: "live" }, offline)).toBe(false);
    expect(own(lost, unreachable)).toBe(false);
    expect(own(connecting, unreachable)).toBe(false);
    expect(own({ ...lost, message: "watch failed" }, unreachable)).toBe(true);
    expect(own({ ...lost, halt: "detached" }, unreachable)).toBe(true);
    expect(own({ kind: "closed", reason: "sessionClosed" })).toBe(true);
    expect(own({ kind: "limited" } as ConnectionState)).toBe(true);
  });

  it("puts the server's words on the strip only when the tab has none of its own", () => {
    expect(describeTab(lost, 0, null, 0, unreachable, true)).toMatchObject({ detail: "Can't reach pop-os" });
    expect(describeTab({ ...lost, message: "watch failed" }, 0, null, 0, unreachable, true)).toMatchObject({ detail: "watch failed" });
    expect(describeTab({ ...lost, halt: "detached" }, 0, null, 0, unreachable, true)).toMatchObject({ tone: "waiting", detail: "Detached by another tmux client" });
  });
});

describe("a restored tab's pill", () => {
  const tab = { restoring: true } as TerminalTab;
  const pill = (host: HostLook) => lookOf(tab, undefined, host, false, 0);

  it("reads checking while the server answers, reconnecting while it is off or the phone is offline", () => {
    expect(pill(up).state).toBe("checking");
    expect(pill(unreachable).state).toBe("reconnecting");
    expect(pill(look({ kind: "noNetwork" })).state).toBe("reconnecting");
  });

  it("reads disconnected when the server refused it", () => {
    expect(pill(refused)).toMatchObject({ tone: "error", state: "disconnected" });
  });
});
