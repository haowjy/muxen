import { describe, expect, it } from "vitest";
import type { ServerState } from "../net/hosts";
import { lookOf } from "../screens/terminal/tabView";
import type { TerminalTab } from "../workspace/state";
import type { ConnectionState } from "./connection";
import { describe as describeTab, type HostLook } from "./status";

const look = (server: ServerState): HostLook => ({ name: "pop-os", server, byToken: false });
const up = look({ kind: "up", refusing: null });
const unreachable = look({ kind: "unreachable" });
const refused = look({ kind: "attention", admission: { kind: "notEnrolled", nodeName: null } });
const connecting: ConnectionState = { kind: "connecting", attempt: 0 };
const lost: ConnectionState = { kind: "reconnecting", attempt: 1, retryInMs: 500, halt: null };

describe("a tab's status", () => {
  it("rests off screen as open, until its server is off: then it reads reconnecting", () => {
    expect(describeTab(connecting, 0, null, 0, up, false).tone).toBe("idle");
    expect(describeTab(connecting, 0, null, 0, unreachable, false)).toMatchObject({ tone: "waiting", server: true });
    expect(describeTab({ kind: "live" }, 0, null, 0, up, false).tone).toBe("idle");
    expect(describeTab({ kind: "live" }, 0, null, 0, up, true).tone).toBe("live");
    expect(describeTab({ kind: "live" }, 0, null, 0, unreachable, false)).toMatchObject({ tone: "waiting", server: true });
  });

  it("says nothing of a refusal, which the banner says once, and offers no Retry of its own", () => {
    for (const state of [connecting, lost, { ...lost, halt: "unauthorized" } as const]) {
      expect(describeTab(state, 0, null, 0, refused, true)).toMatchObject({ tone: "halted", detail: null, action: null });
    }
  });

  it("puts the server's words on the strip only when the tab has none of its own", () => {
    expect(describeTab(lost, 0, null, 0, unreachable, true)).toMatchObject({ detail: "Can't reach pop-os", server: true });
    expect(describeTab({ ...lost, message: "watch failed" }, 0, null, 0, unreachable, true)).toMatchObject({ detail: "watch failed", server: false });
    expect(describeTab({ ...lost, halt: "detached" }, 0, null, 0, unreachable, true)).toMatchObject({ tone: "waiting", detail: "Detached by another tmux client", server: false });
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
