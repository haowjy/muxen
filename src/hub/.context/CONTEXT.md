# src/hub: what to know before editing

`AGENTS.md` lists the rules the code relies on. This file holds the model behind them. The tmux
side is in `src/tmux/.context/CONTEXT.md`; the reasons for the larger choices and the wire
messages are in [daemon-core.md](../../../docs/design/daemon-core.md).

## Model

- **View:** one per watched session, created by the first `watch`, dropped with the last. Its
  **owner** is the control client attached to that session (one for life, respawned after a
  crash). Phases: `Checking` (a one-shot checks the session exists), `Locating { owner }`,
  `Bound` (shown window, index, name, pane and size coherent), `Orphaned` (owner exited; waiting
  for the session check). A bound view stays bound and live while a re-Locate runs.
- **Locate** asks the owner for its session's current window and active pane. A view binds only
  from its owner's own answer: replies and notifications are ordered per control client, so every
  later `CurrentWindow` or `ActivePane` reaches the hub behind it. One Locate per view is in
  flight; a trigger during it re-runs it afterwards.
- **Re-locate on:** `CurrentWindow` naming a window other than the shown one (any client's
  `select-window`, a foreground `new-window`, the window closing, a `swap-window` seen by the
  current-window subscription), a `SelectWindow` reply, the owner respawning, a snapshot failing
  because the pane is gone. `CurrentWindow` updates the pending target at once (subscriptions
  follow in the same `reconcile`) but never overwrites the shown window's metadata or pane; the
  Locate answer does, atomically, and corrects the target if it differs.
- **Only the owner counts** for `Output`, `CurrentWindow`, `ActivePane`, `Layout`,
  `WindowRenamed`, `Acted` and `Cwd`. Another session's client sees a linked window's output too
  and pauses the pane unless it owns a view showing it; a former owner that still wants a pane
  gets `Release` from reconcile. A window linked into two watched sessions is two views, two
  owners, two votes: neither screen gets exactly its size. No rule of its own.
- `watch` checks in order: active id reused (`badRequest`), over the connection's cap
  (`watchEnded { error }`), unparseable or unknown endpoint (`serverExited`), a session whose
  server instance isn't the endpoint's live one (`serverExited` broadcast for the old instance).
- A Locate or session check that fails with anything but `NoServer` ends the view's watches with
  `watchEnded { error }`; `NoServer` is the server being gone. A Locate lost with its control
  client is not a failure: it is needed again.
- `SessionChanged` closes the client (one session for life) and checks the session as after an
  exit; if the session is alive, the exit reads as a detach.

## Pane streams

One per view: `live`, `size`, the snapshot `inflight`. Output goes to every watch not awaiting if
its connection's credit fits; a watch it doesn't fit starts awaiting. A **break** (a `Layout` that
changes the pane's size, `Gap`, a new window or pane, the view leaving `Bound`) makes the stream
not live, every watch awaiting, forgets `inflight` and needs a snapshot. A snapshot failing
`Torn` ×3 or `TooLarge` ends every watch with `watchEnded { error }` naming hooks or screen size;
pane gone re-locates.

## Claims and votes

Policy: a window takes the size of the client that acted last. The view's claim names the watch
that acted last and its pending take; its window is always `View::target()`: the window being
selected, else the pending reported current window, else the shown window.

- **Claims:** `watch` (unless `claim: false`), `resize`, `input`, `paste`, `selectWindow` and
  `newWindow` naming the watch. `input` and `paste` go to the window the client last showed but
  claim only when that window is the target. `history`, `resync`, a re-watch by the client, and a
  tab merely staying on screen claim nothing. The keyboard never resizes.
- **Yield:** `Acted` for the target window drops the claim and clears the vote; the watch stays and
  tmux sizes by `latest`. A claiming watch ending clears the vote even if another watch remains.
- **Target change** drops the claim unless it is the claim's own selection; a claim made before
  binding survives the first binding.
- **A take is due** when the client has no applied vote on the window (new claim, after a yield, a
  window just made current, a respawned client), or the window's size moved off the standing vote
  since a `Layout` last showed it at the vote's size, or the act is the Fit tap. A take that
  doesn't bring the window to the vote isn't repeated until the vote is cast again or Fit. The
  take-and-vote group goes just before the claiming `input`/`paste`'s own group; separate groups so
  a failed take never drops keys.
- **`selectWindow`** sets the target and claims before tmux confirms; its vote and take travel in
  its own group and count as applied. It settles on a matching `CurrentWindow` or the Locate after
  the group reply (selecting the already-current window is announced by neither). A different
  `CurrentWindow` while unresolved stays pending, so a delayed notification from an earlier select
  can't retarget the newer claim. A failed group drops the claim and its vote record.
- **`newWindow`** with a watch claims the created window when `created` arrives; if it isn't
  the target yet it becomes the pending target and the view re-locates. A watch that left claims nothing.
- A claim survives an owner respawn; the new owner votes it and starts a fresh `Acted` baseline.
- Accepted costs (also in the user-visible doc): yielding lags up to about a second; a laptop act
  just before a claim can yield it; each size change breaks the stream (one snapshot per change);
  a window left behind after a change nobody on a terminal made keeps the owner's client size until a
  terminal acts; `selectWindow` moves the laptop too.

## Reconcile

Desired state per control client, compared with what was sent, sent as capacity allows:

| Desired | Sent |
|---|---|
| wanted panes (bound views' panes) | `Snapshot` when needed; `Release` once no bound view shows the pane |
| votes (target of each claimed view) | `Vote` (with `take` when due); `ClearVote` once no view claims it |
| window subscriptions (shown, pending, target windows) and the current-window subscription | `Subscribe`, `WatchCurrent`; the inverses once unused |
| snapshots | when a bound view has awaiting watches, nothing in flight, and credit to reserve |
| Locates, session checks | `Locate` on the owner; session checks on any `Ready` client, else a one-shot |

Order: releases, cleared votes and unsubscribes, then Locates, session checks, subscriptions,
votes, snapshots. Capacity: 32 groups in flight per client; maintenance may use all, a user request
is accepted only below 24 else `busy`; 2 capture slots daemon-wide. What was sent counts as applied
(a failure on a gone window is harmless). Work in flight is recorded against its client; when the
client exits, unanswered Locates, session checks and snapshots become needed again, but a Locate or
check answered with a failure isn't retried. A snapshot the hub stops waiting for gives its
reservations back at once but keeps its tag in `pending` and its capture slot until tmux answers.
`reconcile` is skipped for pump bytes that only carry `Output` (230 ns vs 590–910 ns per chunk).

**Pastes** are answered exactly once by `req`: `pasted`; `error { tmux }` with tmux's message; or
at once `badRequest` (unknown watch) or `busy` (not yet `watching`, or at the user threshold). A
paste is never resent: if its client exits with the tag unanswered the hub sends `error { tmux }`
"tmux stopped answering before confirming the paste; it may have been sent". Every refused or
dropped paste emits `RemoveFile`.

## Control clients

- One per watched session, shared by all connections. At the cap the oldest lingering client closes
  first; with none lingering the view's watches end `watchEnded { limit }` naming the host and the
  sessions that hold the slots, and the view is dropped.
- `Ready` requires the endpoint's known server instance (or records it); a different one means the
  server restarted.
- **Reply timeout** is a progress deadline for the client (10 s with groups in flight and none
  completing), so it also covers `Session`'s untagged groups (startup, pauses). A known tmux
  version mismatch uses the same deadline; the configured `tmux.program` `-V` runs once at start
  and the hub warns once per server instance on a mismatch, naming both versions and the program
  path. It never selects another binary (a package upgrade can delete it).
- **Exit** (tmux `%exit`, pump `Exited`, task panic, reply timeout, `Fatal`, `SessionChanged`): the
  line sender is dropped at once; streams stop being live; views wait. Unless the hub caused the
  exit (linger, cap) a one-shot Locate checks the session first, whether or not a tab was watched:
  - no server or a new instance → `serverExited`, drop that server's views, close its clients,
    start nothing;
  - session gone → `sessionClosed`, drop its views;
  - session alive after `Ready` or `SessionChanged` → another client detached us: `watchEnded {
    detached }`, no reattach (it would fight `attach -d` and make muxen `latest`). `%exit` before
    `Ready`, or an exit without `%exit`, is a **crash**: respawn after 1 s if the server instance
    is unchanged; a second crash within 60 s ends the watches with `watchEnded { error }`.
- `sessionsChanged` comes only from the endpoint's lowest-id `Ready` client (every client receives
  the notifications) and is coalesced once per `handle` input; the web debounces its relisting.
  Window renames are not broadcast.

## Credit and the outbox

- One number per connection, debited for every `ToConn` (`ToConn::charge()`: payload length, at
  least 64 B) and returned over `FromConn::Credit` once the frame is written or discarded.
- Output that doesn't fit is dropped and that watch awaits a snapshot; only that watch starves.
  While a snapshot waits for credit, output fits only above its reservation. A starved watch is
  re-snapshotted no sooner than the snapshot spacing after its previous one.
- Captures reserve first: a snapshot reserves one capture reservation per awaiting watch's
  connection before its group is issued (a connection that can't stays awaiting); history that can't
  reserve gets `busy`; `listSessions` reserves the smaller listing reservation. On reply the hub
  charges the encoded size and returns the rest. Two watches on one connection snapshot one at a
  time under load: credit 2 MiB, reservation 1 MiB.
- **History fit:** `historyChunk` rows plus the base64 wrap bitmap must fit the reservation; the
  fitting loop counts the bitmap per candidate prefix. An oversized capture (the tmux group cap
  binds first) is reissued with half the rows down to one; a single row over the cap ends with
  `error { tmux }`.
- Control JSON is charged but never refused; past the overdraft the connection is wedged (4002).
  The connection's own replies (`welcome`, `pong`, paste refusals) never pass through the hub, hold
  no credit, and wait in a 16-entry queue; while 16 wait the connection stops reading its socket.
- `Outbox` (pure, owned by the connection task): a per-watch ordered queue plus one connection-wide
  JSON FIFO written first. A snapshot replaces the watch's queued frames (they count as discarded).
  Output is coalesced on the leading edge (first goes at once, the rest merged per interval), so
  echoes are never delayed. A watch's queue exists only while it holds frames or its interval runs;
  it is forgotten on `unwatch` or a `ToConn::Msg` whose `ends` names it (`watchEnded`, never
  `error`). Credit returned by a discard is sent immediately, because an idle socket may make no
  write to carry it.

## Bell attention

Source: tmux's `alert-bell` hook (`src/tmux/.context/CONTEXT.md`) incrementing `@muxen-bell`, a
per-session counter (exact for bells within one second; a timestamp isn't). The daemon never scans
pane output for BEL. "Seen" stays on the device.

- **The poll is the `List` one-shot** (`bell.rs`): 5 s after the previous answer finished, only
  while a connection exists, starting at once when the first registers; maintenance, so it waits for
  the slot and never gets `busy`. A user's `listSessions` joins a `List` in flight, and any answer
  restarts the clock.
- Every answer diffs against one baseline (server instance and `(mark, covered)` per session). The
  first answer after polling starts is the baseline and sends nothing; later answers send one `bell`
  for the sessions that changed. A new instance or the first answer after `NoServer` diffs against
  nothing, so every mark is sent. Any error but `NoServer` sets `available: false` and sends one
  `bell` with no sessions; the next success sends `available: true`.
- Marks are keyed by `(server instance, session)`, so a tmux restart never meets an old tab's seen
  value. Bells before the first device connects after a tmux start are lost; with two daemons on one
  server, the first to stop removes the shared entry and bells before the survivor's next `List` are
  lost. `covered` is false for a session-level hook, `monitor-bell off`, a `bell-action` other than
  `any` or a foreign entry at 9100: never silence that reads as no bells.
- Cost, measured on tmux 3.8 (20 sessions, 60 windows): the bell fields add 0.6 ms of tmux CPU
  per poll; process spawn dominates at about 0.15% of a core. 2 s polling would cost 0.4%.

## Public surface

`HubHandle::{connect, send, stop}`, `FromConn`, `ToConn` are the only way `http/` touches the hub.
`connect` whose reply can't be delivered registers nothing. A connection always sends `Closed` on
exit (`http/ws.rs` does on every path but a panic); one that only drops its receiver stays
registered until the hub next sends to it — an accepted gap. The hub's task handle completes only
after its pumps: on the last `HubHandle` drop or `stop` it closes every client's stdin and waits for
each pump (1 s, then kill). `main` calls `stop` itself after `http::serve` returns, because a
connection stalled past axum's graceful shutdown keeps a handle; it also runs `RemoveBellHook`
inside a 1.5 s wait, after the one-shot in flight finishes. SIGKILL or a panic leaves the hook
entry, which is harmless and adopted at the next start.
