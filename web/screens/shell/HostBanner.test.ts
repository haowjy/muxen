// @vitest-environment jsdom
import { h, render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProvider } from "../../app/context";
import type { AppController } from "../../app/controller";
import type { HostClient } from "../../net/hosts";
import { HostBanner } from "./HostBanner";

const app = { focus: { attach: () => () => undefined }, retryHost: vi.fn(), platform: {} } as unknown as AppController;
const root = document.createElement("div");

function banner(change: Partial<HostClient>, reach = true): string {
  const host = {
    entry: { handle: "h", pageOrigin: "https://pop" },
    name: "pop-os",
    admission: { kind: "admitted" },
    refusing: null,
    shown: "reachable",
    checkingSince: null,
    ...change,
  } as HostClient;
  render(h(AppProvider, { app, children: h(HostBanner, { host, reach }) }), root);
  return root.textContent;
}

afterEach(() => { render(null, root); vi.useRealTimers(); });

describe("a server's banner", () => {
  it("says a native host's incompatible daemon, with Retry, before anything the shown state says", () => {
    const text = banner({ entry: { handle: "h", pageOrigin: null } as HostClient["entry"], admission: { kind: "incompatible" }, shown: "unreachable" });
    expect(text).toContain("speaks a different version");
    expect(text).toContain("Retry");
  });

  it("defers unreachable and no network to a status strip that says them", () => {
    expect(banner({ shown: "unreachable" })).toContain("Can't reach pop-os");
    expect(banner({ shown: "unreachable" }, false)).toBe("");
    expect(banner({ shown: "noNetwork" }, false)).toBe("");
  });

  it("says Checking access only after 10 s undecided on a server that answers", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const undecided = { admission: { kind: "deciding" } } as const;
    expect(banner({ ...undecided, checkingSince: 95_000 })).toBe("");
    expect(banner({ ...undecided, checkingSince: 85_000 })).toContain("Checking access");
    expect(banner({ ...undecided, checkingSince: 85_000, shown: "checking" })).toBe("");
  });

  it("says a refusal on a reachable server", () => {
    expect(banner({ refusing: "overCap" })).toContain("Too many connections to pop-os");
  });
});
