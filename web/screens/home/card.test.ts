import { describe, expect, it } from "vitest";
import type { Admission } from "../../net/admission";
import type { HostClient } from "../../net/hosts";
import { cardBody } from "./card";

const host = (admission: Admission, shown: HostClient["shown"], reachedAt: number | null = null): HostClient => ({ admission, shown, reachedAt }) as HostClient;
const admitted: Admission = { kind: "admitted" };

// browser-behaviors.md "Home": the first row that applies.
describe("a card's body", () => {
  it("needs attention first, even when the server has since stopped answering", () => {
    expect(cardBody(host({ kind: "notEnrolled", nodeName: null }, "unreachable"), undefined)).toEqual({ kind: "attention" });
    expect(cardBody(host({ kind: "incompatible" }, "noNetwork"), undefined)).toEqual({ kind: "attention" });
  });

  it("is offline when unreachable, with when it was last reached, or when the phone has no network", () => {
    expect(cardBody(host(admitted, "unreachable", 99), undefined)).toEqual({ kind: "offline", reachedAt: 99, noNetwork: false });
    expect(cardBody(host(admitted, "noNetwork", 99), undefined)).toEqual({ kind: "offline", reachedAt: 99, noNetwork: true });
    expect(cardBody(host({ kind: "deciding" }, "unreachable"), undefined)).toMatchObject({ kind: "offline" });
  });

  it("is checking while there is no answer, and while admission is undecided on a server that answers", () => {
    expect(cardBody(host(admitted, "checking"), undefined)).toEqual({ kind: "checking", connecting: true });
    expect(cardBody(host({ kind: "deciding" }, "reachable"), undefined)).toEqual({ kind: "checking", connecting: false });
  });

  it("is connected otherwise, with a refused listing or no tmux said under it", () => {
    expect(cardBody(host(admitted, "reachable"), undefined)).toEqual({ kind: "ok" });
    expect(cardBody(host(admitted, "reachable"), { listing: undefined, failure: "refused", updating: false })).toEqual({ kind: "failed" });
    expect(cardBody(host(admitted, "reachable"), { listing: null, failure: null, updating: false })).toEqual({ kind: "noTmux" });
  });
});
