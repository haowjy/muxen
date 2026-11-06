// The terminal screen (client-architecture.md §6.4, §7): the surface the renderer draws
// into, with the status band over its top edge, and on touch the dock below it. Its tabs are
// the tab row: the shell's top row (desktop) or the dock's bottom row (touch). The screen is
// mounted once and hidden rather than unmounted (§6.5); the renderer, the drivers and tmux's
// size belong to `terminals.ts`, so this file only places things and draws state.
import { useEffect, useRef } from "preact/hooks";
import { useApp, useAppView, useHostLook } from "../../app/context";
import { hostById } from "../../net/hosts";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { StatusBand } from "../../ui/primitives/StatusBand";
import { useStore } from "../../ui/store";
import { Button } from "../../ui/primitives/Button";
import { activeTerminal } from "../../workspace/state";
import { Dock } from "./dock/Dock";
import { bandTone, lookOf } from "./tabView";
import { terminalsOf } from "./terminals";
import { useNow } from "./useNow";
import styles from "./Terminal.module.css";

export function TerminalScreen({ active }: { active: boolean }) {
  const app = useApp();
  const terminals = terminalsOf(app);
  const slot = useRef<HTMLDivElement>(null);
  const statuses = useStore(terminals, (s) => s.tabs);
  const scrolled = useStore(terminals, (s) => s.scrolled);
  const workspace = useAppView((v) => v.workspace);
  const phone = useAppView((v) => v.viewport.layout === "phone");
  // Touch input (a phone, or an iPad without a trackpad) ends in the dock.
  const dock = useAppView((v) => v.viewport.directInput !== "xterm");

  useEffect(() => {
    if (slot.current) terminals.mount(slot.current);
  }, [terminals]);

  const hostLook = useHostLook();
  const current = activeTerminal(workspace);
  const running = active && current !== null && statuses[current.id]?.state.kind !== "live";
  const now = useNow(running);
  const look = current && lookOf(current, statuses[current.id], hostLook(current.host), active, now);
  const status = look?.status;
  // The strip's Retry is the tab's own and the server's one (plan.md "Reachability", "Retry").
  const retry = (id: string, hostId: string): void => {
    // The server's first: native's incompatible host reconnects there, and the tab's nudge needs the socket.
    const host = hostById(app.hosts.all(), hostId);
    if (host) app.retryHost(host.entry.handle);
    terminals.retry(id);
  };

  return (
    <div class={styles.terminal} hidden={!active} data-layout={phone ? "phone" : "desktop"} data-dock={active && dock && phone ? "" : undefined}>
      <h1 class="sr-only">Terminal</h1>
      <div class={styles.surface} ref={slot}>
        {current === null && (
          <div class={styles.empty}>
            <EmptyState icon="terminal" title="Open a session with +." />
          </div>
        )}
        {scrolled && (
          <Button variant="secondary" class={styles.latest} onPointerDown={(e) => { e.preventDefault(); }} onClick={() => { terminals.toLatest(); }}>
            Jump to latest
          </Button>
        )}
        {current && !status?.detail && statuses[current.id]?.state.kind === "live" && statuses[current.id]?.sizedForOther && (
          <StatusBand tone="notice" text="Sized for another terminal" action={{ label: "Fit", onAction: () => { terminals.fit(current.id); } }} />
        )}
        {current && status?.detail && (
          <StatusBand
            tone={bandTone(status.tone)}
            text={status.detail}
            hint={status.hint}
            action={status.action ? { label: status.action, onAction: () => { retry(current.id, current.host); } } : null}
          />
        )}
      </div>
      {dock && <Dock active={active} />}
    </div>
  );
}

