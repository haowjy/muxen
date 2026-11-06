# Decision log

The decisions in force behind muxen's specs: who decided, when, what was decided,
why, and which alternatives were rejected. The specs ([plan.md](plan.md),
[daemon-core.md](daemon-core.md), [ios-shell.md](ios-shell.md), [auth.md](auth.md),
[fs.md](fs.md), [complete.md](complete.md), [setup.md](setup.md)) state the current
rules; this log preserves the reasoning.

**Who decides.** Jimmy owns product calls; his decisions are marked as his. Tech lead
settles reviews. Design decisions were made by the spec's author.

The log holds the decisions in force. A decision that replaces another removes it,
naming the old option under Rejected; git history keeps the removed text.

## Jimmy's decisions

Decided by Jimmy, 2026-10-21 unless an entry gives another date.

### A server's reachability is one state, shown on Home and read everywhere (2026-11-05)

- **What:** each server has one reachability (reachable, checking, unreachable), decided on the
  phone from its own traffic to that server ([plan.md](plan.md#reachability)). The Home card shows
  it; the folder view, terminal tabs, the server banner and every other view of the server read the
  same state. Nothing polls, and nothing outside the tailnet is asked (no Tailscale API). Servers
  reporting each other's state is not part of it; it may be added later.
- **Why:** with homebox powered off, the app's folder view loaded indefinitely and Home read
  "pop-os · connected · 1 tab". Each view decided for itself, and the app never decided at all.
  Jimmy: "It should show up on this status screen basically, and then propagate down."
- **Rejected:** per-view detection; polling; the Tailscale API.

### Touch scrolls and selects on one native list of rows; desktop follows (2026-10-31)

- **What:** on touch the terminal is one native scroller of rows: tmux's history, the lines that left the
  screen and the live screen as the newest rows, drawn by muxen from the model's frames. The browser scrolls
  and coasts it. A selection survives scrolling and autoscrolls at the list's edges (iOS's own with the
  keyboard down, muxen's with the mark). A row is redrawn only when its text changes, so output that rewrites
  a selected row closes the selection and nothing else does. Desktop moves to the same list after the phone:
  one implementation everywhere, with WebGL, the history slide, the trackpad switch and `@xterm/xterm` going
  in phase 6 and desktop typing on muxen's own input (phases 5–6). Until then desktop is drawn by xterm, except that a
  finger no longer scrolls it (a touchscreen laptop, an iPad with a trackpad): the wheel and trackpad work, and
  finger scrolling returns with the list in phase 6. Phase 4 removed it; Jimmy accepted the loss for the merge (2026-10-31).
- **Decided:** Jimmy, 2026-10-31. Typing while scrolled up jumps to latest (`Terminals.typeTo`, unchanged), so the typed
  text shows; "yeah, jump i think". Merging with desktop's finger scrolling gone until phase 6: "ok to merge".
  Selection while scrolling and autoscroll reverse the J8 rule ("a selection
  covers what's on screen plus the history already shown; scrolling closes it") and plan.md's "no autoscroll
  at the edges". "yes, 1 implementation everywhere" for the single list.
- **Why:** the selection needed rows that stay put under scrolling, and autoscroll needs a scroller the
  selection lives in. A JS-driven scroll over xterm's redrawn rows could give neither, and each patch to it
  (seam rules, snapshot, momentum) brought the next. One native scroller deletes the scroll code, the
  snapshot and the slide.
- **Rejected:** a runtime switch between the two paths (a `main` build is the comparison); keeping the
  snapshot for the app's native input (a second selection model for the app's default input); JS momentum over
  a native scroller (a second scroll position).
- **Open questions answered (2026-10-31):** after output overflows (a gap) the list keeps the rows above it
  under an "output skipped" row and fetches nothing more until the next snapshot ("probably keep them... try
  to not add random patches"); a tap on a URL on touch does nothing, and copy and paste are the way
  ([issue 4](https://github.com/haowjy/muxen/issues/4) holds opening links as an experiment); Alt+drag column
  selection on desktop goes with xterm's selection; a desktop selection in a redrawing app closes at the next
  redraw, the phone's rule.

### Workspaces: Home, the tab overview, a tab with its tab row (2026-10-30)

- **What:** a workspace is one server's open tabs, in the user's order, and the tab it last showed;
  one per server for now, kept as a record of its own so a second workspace on a server later is
  another record. Home lists the workspaces only and opens one on its last tab. The tab overview
  lists a workspace's tabs as rows (tap to open, drag a handle to reorder, swipe to close) with Open
  session and Open files. A tab shows the tab row: ‹ to the overview, the tabs as pills, + (Open
  session, Open files), and on the phone Show keyboard. With the keyboard up the tab row stays and
  the compose box and key row sit under it. Desktop and phone share the model
  ([client/browser-behaviors.md](client/browser-behaviors.md#platform-layout)).
- **Why:** Jimmy, after the `tab-chip` build on his iPhone ("there is a lot wrong with this") and a
  recording of Termius: the tab chip blended into the key row, its keyboard-down and keyboard-up
  forms differed and opened two pickers, and finding a file took four steps in a mostly empty
  half sheet. "I think maybe we should consider the screen with all the terminals and tabs like a
  'workspace'? (a collection of the tabs and open tab sessions) for a given server"; "maybe in the
  future we can have multiple 'workspaces'"; Home "should only list the workspaces"; the overview
  as a "list of rows"; ‹ "should go back to 2. tab overview".
- **Rejected:** the half-height picker sheet with its open tabs and Add new tab; the tab chip and its
  non-modal tab menu (two pickers for one job); one strip mixing every server's tabs; terminal
  previews in the overview (they would stream every tab's screen); reordering by dragging pills in
  the tab row (it scrolls sideways); Home listing sessions or files.

### Open session is new-or-attach; Open files starts at ~/ (2026-10-30)

- **What:** adding a tab is two actions, in the tab overview and in +'s menu. Open session is one
  screen: a name field over this server's sessions not open in the workspace; a tap or a listed
  name attaches, a name no session has creates it, an empty field creates one tmux names. A new
  session starts in `~` (Jimmy: "yes"). New-or-attach is the client's rule over the listing, not
  tmux's `new-session -A`, which fails from the daemon on an existing name ("open terminal
  failed: not a terminal", tmux 3.8). Open
  files opens a Files tab at `~/`; its path field works like a browser's address bar.
- **Why:** Jimmy: tmux "should use the 'new or attach' command"; Files "should just always start at
  ~/"; the search he meant was "search by path picker".
- **The path field's tap** keeps muxen's behaviour, the caret at the end after a trailing `/`, so
  typing narrows the folder you are in (Jimmy: "maybe the 2nd one?"), not Safari's select-all.
- **Rejected:** separate Attach session and New session actions; the New session form with a start
  directory; Files remembering the workspace's last folder; search by file name (a tree walk on the
  daemon).

### No favorites (2026-10-30)

- **What:** favorites are gone end to end: the star in a Files tab's header, the picker's Files side,
  `GET /fs/favorites`, `POST /fs/favorites/add` and `/remove`, `POST /fs/uploads-dir` (which no
  client called) and the `favorites` key in `config.toml`. With nothing left to write it, the
  daemon's `config.toml` writer goes too. `uploads_dir` stays, set in `config.toml` by hand.
- **Why:** Jimmy: "tbh, idk if we even need the favorites feature at all"; the path field, like an
  address bar, is the way to a folder.
- **Rejected:** favorites as suggestions under the empty path field; a list of recent folders kept
  per device (Jimmy: "I think we just need to, in the workspace, remember where we last were",
  then "it should just always start at ~/").

### A tab's long press has the tmux commands; killing asks first (2026-10-30)

- **What:** a long press on a terminal tab's pill opens: the session's windows (tap switches,
  `select-window`) and New window, Rename session, Move to start or end, Close tab, then Kill
  window (more than one window only) and Kill session, in the danger colour, each behind a
  confirmation that names what ends. Close stays detach-only everywhere (the ×, a swipe, Close
  tab). The daemon needs kill-session, kill-window and rename-session commands (`new-window`
  exists); how they stay clear of tmux 3.4's crash is open (below).
- **Why:** Jimmy: "long pressing a tab - we should be able to detach, or kill a session (what
  else?)", then "consider the most important tmux commands"; on overriding "Closing a tab never
  kills tmux": "yeah I think so... just they have to confirm it".
- **Replaces** "Closing a tab never kills tmux" (2026-10-29), whose rule that no path from the tab
  list runs `kill-session` it reverses; its rule that closing only detaches stands. **Amends the
  invariant** "tmux is the source of truth" (plan.md), which said muxen has no control that kills a
  session or window; it now says muxen never kills tmux on its own or without a confirmation that
  names what ends (Jimmy: "change the invariant").
- **Open:** the daemon side, with the tmux 3.4 crash risk
  ([daemon-core.md](daemon-core.md#the-tabs-tmux-commands-open)).
- **Rejected:** a kill without a confirmation; kill on a swipe or the ×.

### The keyboard is sticky (2026-10-30)

- **What:** only the keyboard control lowers the phone keyboard. Scrolling, tapping the terminal,
  switching tabs in the tab row, the + and long-press menus and reconnects leave it up; the tab
  overview and Home, which have no input, lower it.
- **Why:** Jimmy: typing like Termius is the benchmark, and the keyboard must stay until he closes it.
- **Rejected:** opening an overlay lowers the keyboard (the old picker sheet's rule).

### Keys are plain text; controls are filled (2026-10-30)

- **What:** the key row's keys have no fill until pressed; the tab row's ‹, pills, + and the
  keyboard control are filled.
- **Why:** Jimmy: the tab selector "blends in with the keys"; it should "clearly read as a control".
- **Rejected:** a different colour for the tab chip alone.

### The key row opens esc, tab; ^C last; no ^S or ^Q (2026-10-29)

- **What:** the key row always opens esc, tab ("the first row should guarantee esc | tab"), then
  the arrows; it keeps chords out of its first slots and ^Z away from ⏎; ^C is last; ^S and ^Q
  are dropped ([client/browser-behaviors.md](client/browser-behaviors.md#phone-dock)).
- **Why:** "^C ... is kinda dangerous to be put in the initial keyboard setup"; ⇧tab is rarely
  used now.

### Files reads any path the user can (2026-10-29)

- **What:** Files has no roots or scope; any readable path opens
  ([fs.md](fs.md)). Uploads still never replace a file and downloads are served sandboxed.
- **Why:** a device that can use muxen already has the user's terminal, which reads the same
  files; a scope would add rules without removing any reach.
- **Rejected:** keeping roots below `$HOME`.

### Device: iPhone 17 Pro only

- **What:** one target device, iOS 26. The layout stays responsive for rotation and a
  future iPad.
- **Rejected:** none recorded.

### tmux setup

- **What:** tmux 3.4 is the minimum supported version; `window-size latest`, default
  prefix `C-b`, and the laptop sometimes attached at once. Jimmy adds the recommended
  tmux.conf lines ([plan.md](plan.md#sending-keys-and-tmuxconf)).
- **Why:** opening or closing the keyboard must not resize tmux: a SIGWINCH per toggle
  reflows the app and the laptop. OSC 133, 7 and 52 reach control mode without
  `allow-passthrough` ([probe-tmux.md §1](research/probe-tmux.md)).
- **Rejected:** resizing for each keyboard toggle; recommending `allow-passthrough on`.

### Shell integration

- **What:** shell-agnostic, with one OSC 133 snippet in his dotfiles and carapace for
  flag completion.
- **Rejected:** fish's `complete -C` and zsh capture via zpty: shell-specific and
  heavier.

### Files: view and upload now, three write operations in v2

- **What:** project roots picked in the app; one uploads folder (superseded for Paste:
  [Paste into an open folder](#paste-into-an-open-folder-2026-11-02)); HEIC converted on the
  phone; no video thumbnails; no file watcher. Write operations are edit, new file and
  rename, in v2.
- **Rejected:** the plan review's rename/move/mkdir/delete-to-trash set. Move, mkdir and
  delete are done in the terminal.

### Auth: a device token behind Face ID

- **What:** the Tailscale login check, a Face ID lock on the phone, and a random
  per-device token enrolled once with a code printed on the server
  ([auth.md](auth.md)). This replaced Jimmy's first choice, a Face ID passkey.
- **Why:** a native app can use a passkey only for a relying party in its associated
  domains, which iOS verifies through Apple's CDN, and the CDN can't reach a
  tailnet-only host ([ios-native.md §1](research/ios-native.md)).
- **Rejected:**
  - A Secure Enclave key per phone with signed challenges and short session tokens:
    over a `ThisDeviceOnly` token behind Face ID it adds only protection against the
    token being copied off the phone, which isn't worth a challenge protocol, a
    signature format in two languages and a session-token scheme for one user.
  - Tailscale plus Face ID with no token: any device on the tailnet would get a shell
    without proving anything.
  - Passkeys (above).

### Scratch shell: kept

- **Decided:** 2026-10-21, Jimmy.
- **What:** a scratch shell outside Jimmy's tmux sessions uses a private tmux server
  (`tmux -L muxen-scratch`) started in a transient systemd scope outside muxen's
  cgroup. It reuses the stream path and lands after the core MVP.
- **Rejected:** a raw pty per scratch shell: it has no snapshot for repainting after a
  reconnect without a server-side emulator, and its tab could not use the protocol;
  dropping scratch shells from the product.

### Scope: no agent dashboards; notifications come from outside

- **What:** tmux tabs, a session list, cheap reconnect, a Termius-grade keyboard with
  tool completion, a file manager. muxen runs no notification service of its own:
  anything (an agent harness, a script, CI) can notify the app about a tmux pane, and
  the app opens that pane's tab (2026-10-31, "The name: muxen").
- **Why:** Jimmy's agent harness already decides when to notify; muxen owns the last
  step, getting him to the right tab.
- **Rejected:** agent dashboards and agent-wrapping apps (studied in
  [research/prior-art.md](research/prior-art.md)); muxen deciding on its own when
  something deserves a notification.

### Keyboard: native Swift shell first

- **What:** a native iOS app, a WKWebView hosting the web UI with a native first
  responder owning the keyboard ([ios-shell.md](ios-shell.md)). Xcode installs until
  TestFlight is set up.
- **Why:** iOS shows the keyboard only from a user gesture in a web page, and the
  system accessory's Done button closes it and can't be hidden
  ([ios-web.md §1](research/ios-web.md)).
- **Rejected:** the installable web app with the system keyboard (iOS can't hold it
  open); a keyboard drawn in HTML (no haptics, worse prose typing); a thin WKWebView
  wrapper without a native input view (shares Safari's keyboard behaviour).

### Multi-host: the app connects to each host directly

- **What:** the app keeps a host list and a token per host; each host runs its own
  single-host daemon; tabs from several hosts share one UI.
- **Why:** for a native app, a hub daemon would add a single point of failure on a box
  that already crashes, an extra hop, and daemon-to-daemon auth.
- **Rejected:** a hub daemon proxying the other hosts (the answer only while the
  client was a web app, where each `*.ts.net` origin needed its own install, cookies
  and passkey); one app per host.

### A Mac can host muxen, behind a path secret

- **Decided:** 2026-10-24, Jimmy.
- **What:** on a Mac with the standalone Tailscale app, Serve reaches muxen on a
  loopback TCP port, and muxen publishes itself at a random **path secret** that
  Serve adds to every request. A request without it is dropped before anything else
  runs; then the `Host` rule, the Tailscale check and the existing lanes apply
  unchanged ([auth.md](auth.md#the-mac-front)). This is documented as a weaker local
  boundary than Linux and supported only on a Mac whose one user account is Jimmy's
  (below).
- **What the Mac trusts that Linux doesn't:** that copies of the path secret leaving
  the Mac (Tailscale's log upload, a sysdiagnose, backups) are harmless; that
  nothing binds muxen's port in the moments after a deliberate stop; that nothing
  binds LocalAPI's port while Tailscale is stopped; and that no local process fills the
  64 connection permits ([auth.md](auth.md#threat-model)).
- **Why:** the Tailscale app's extension can't connect to a Unix socket (it logs
  `connect: operation not permitted`, even in a directory its sandbox may write), so
  the Linux front can't exist on a Mac. Serve keeps a target's path on every request
  and a client can't strip it, so a path only Serve's config holds is a secret Serve
  presents for us.
- **Rejected:**
  - Verifying that each loopback connection comes from Tailscale's root-owned, signed
    extension (Jimmy's first choice): an unprivileged daemon can't see a root process's
    sockets on macOS 27. `LOCAL_PEERCRED` is Unix-only; libproc gives `EPERM`; the
    `pcblist_n` sysctl and NetworkStatistics return only the caller's own flows; LocalAPI
    whois doesn't know Serve's loopback ports. Evidence:
    `.meridian/work/tether-mvp/mac-host-peer-provenance.md`.
  - A root helper (a launchd daemon that reports which process owns a loopback
    connection): a root component in a tool that is meant to stay light and never own
    anything, a sudo install step, and new attack surface; that root can see the flows
    on macOS 27 is itself unverified.
  - Homebrew's standalone `tailscaled` instead of the app: keeps the Linux model, but
    replaces the Tailscale app Jimmy uses on the Mac; Jimmy rejected it earlier.
  - A bare loopback TCP front with no secret: any local process, and any page in a
    browser on the Mac that rebinds DNS to loopback, could forge `Tailscale-User-Login`
    and `X-Forwarded-For` and reach the node lane as any enrolled node.
  - Trusting whois on `X-Forwarded-For` alone: the header is whatever the connecting
    process writes, so it identifies a node only when the connection is known to be
    Serve's, which is the question.
  - A Mac daemon that skips LocalAPI checks: no login allowlist or Funnel check.
  - Keeping the Mac a client only: Jimmy wants to host on it.

### A Mac host has one user account, Jimmy's

- **Decided:** 2026-10-24, Jimmy.
- **What:** muxen supports a Mac host only when Jimmy's is its one user account,
  now and as planned. It is the Mac host's stated precondition
  ([auth.md](auth.md#threat-model)), and the Mac design defends against no other login
  account. Background setup refuses to install when another login account exists.
- **Why:** other accounts were the reason for the proposed Mac machinery: a
  LaunchDaemon so the port stays held while Jimmy is logged out or switched away,
  `muxen unpublish` and an unpublish on every stop, pinning LocalAPI's endpoint
  against an account squatting its port, and a gate that needed a second account.
  With one account, the secret's only readers are root and Jimmy, and the processes
  left to keep out are sandboxed apps and macOS's role accounts.
- **Rejected:**
  - Supporting a Mac with other accounts: the machinery above, plus trusting every
    other admin, for a Mac that has none.
  - Defending against role accounts too: they run Apple's services, and a compromise
    of one is a compromise of macOS, which muxen trusts like root.

### muxen runs from a LaunchAgent on a Mac

- **Decided:** 2026-10-24, Jimmy.
- **What:** a LaunchAgent in Jimmy's login session, installed without sudo. launchd
  binds `127.0.0.1:7851` at login and holds it across crashes; muxen stops at logout,
  and while Jimmy is logged out the phone can't reach it on that Mac.
- **Why:** socket activation works the same in a LaunchAgent (probed: after `kill -9`
  the port can't be rebound, and the next connection relaunches the job). What the
  LaunchDaemon added, running while Jimmy is logged out, mattered only for other
  accounts or a Mac reached while nobody is logged in. The agent also runs in his GUI
  session, so TCC can ask about `~/Documents` instead of refusing silently.
- **Rejected:**
  - A LaunchDaemon with `UserName`: a sudo install, a job whose groups,
    environment and TCC behaviour were untested, and no GUI session.
  - The daemon binding the port itself: every crash frees it while Serve points at it.

### Tailscale's log upload stays on for a Mac host

- **Decided:** 2026-10-24, Jimmy.
- **What:** the Mac setup leaves Tailscale's log upload on. The extension uploads the
  Serve handler line, path secret included (`ipn/ipnlocal/serve.go:1450` at v1.104.2,
  through the logtail-backed `b.logf`), and muxen accepts that.
- **Why:** the app can't turn upload off. Tailscale documents the opt-out only for the
  open-source `tailscaled` on macOS, not the Standalone or App Store app
  (https://tailscale.com/docs/features/logging.md, tailscale/tailscale#5114). On this
  Mac, `tailscale bugreport` still returned a normal report ID with the variable set. An
  uploaded secret is useless without a tailnet node reaching Serve, and goes stale at
  muxen's next start. Gate M7 checks the rotation.
- **Rejected:**
  - Turning upload off with `TS_NO_LOGS_NO_SUPPORT=true` in the extension's
    `tailscaled-env.txt`: the app did not honor the opt-out.
  - Running the open-source `tailscaled` from Homebrew on the Mac: it supports the
    opt-out and has a LocalAPI socket, but drops the app Jimmy uses and needs a root
    service.
  - Not hosting on a Mac.
  - Keeping the secret out of the logged target: a Serve target is a URL and the
    extension logs it whole, and Serve can't add a header.

### launchd's socket is taken by a local module, not the `raunch` crate

- **Decided:** 2026-10-24, Jimmy.
- **What:** `src/launchd.rs` (macOS only, about 24 lines) calls
  `launch_activate_socket` and returns `io::Result<Vec<OwnedFd>>`. It is the one module
  allowed `unsafe`: `lib.rs` goes from `forbid(unsafe_code)` to `deny(unsafe_code)` so
  the module's `allow` can override it, and `main.rs` keeps `forbid`. `libc` becomes a
  macOS-only direct dependency; it is already in the lockfile.
- **Why:** raunch 1.0.1 returns `Vec<RawFd>`, so turning its fds into an `OwnedFd` or
  a listener needs `unsafe { from_raw_fd }` in muxen anyway (a compile under
  `forbid` was rejected). The crate doesn't save the lint exception, and it is
  dormant since 2024. The local module owns its fds, returns an empty list for a null
  array instead of raunch's undefined-behaviour edge, and passes errno through.
- **Rejected:** raunch, pinned to `=1.0.1` (the above).

## Product and architecture

### The terminal's rows are muxen's, not xterm's (2026-10-31)

- **Decided:** 2026-10-31, tech lead ("whatever is a better experience").
- **What:** `TerminalModel` (`term/`) parses a pane's output into frames and owns no DOM; the row list draws
  them with muxen's own run-based rows (`rowList.ts`). tmux's older rows are fetched in chunks, decoded with a
  short-lived xterm instance, and anchored against the list's oldest rows so a chunk that no longer lines up
  is dropped. A gap stops fetching until the next snapshot. The merge is gated on screenshots of vim splits,
  htop, tmux borders, Claude Code and CJK text against a `main` build, taken on the phone (not yet done).
- **Why:** the list must own its rows to keep them in place. The earlier choice, "Touch scroll is JS momentum
  over xterm and a DOM history view" (2026-10-24, no decider named), was an implementation choice made to let
  one recognizer tell a tap, a scroll and a hold apart. It is superseded: the browser's scroll leaves the
  recognizer only taps, holds and mark drags.
- **Rejected:** that implementation (JS momentum over xterm's buffer, a slide onto a DOM history view, an
  immutable DOM snapshot for the long press with the system's handles); a native scroller over xterm's DOM
  renderer (its rows are redrawn in place, which ends any selection); tmux copy-mode (every scroll would
  change the pane's state, and tmux's own state is what muxen must not disturb).

### Rust for the daemon

- **Decided:** 2026-10-21, design (first plan).
- **Why:** idle memory of a few MB with no garbage collector, predictable under bursts,
  bounded channels for explicit backpressure, one static binary
  ([research/rust-vs-go.md](research/rust-vs-go.md)).
- **Rejected:** Go: faster to write, but more idle memory and GC behaviour under load
  on an overloaded box.

### No server-side terminal emulator

- **Decided:** 2026-10-21, design (first plan).
- **What:** tmux holds each pane's screen; xterm.js on the phone is the only emulator.
- **Rejected:** a `vt100` or `alacritty_terminal` model per viewed pane: a second
  emulator that can disagree with tmux and xterm.js, memory per pane, and it still
  needs the same snapshot boundary. It comes back only if a feature needs screen
  contents on the server.

### WebSocket transport

- **Decided:** 2026-10-21, design (first plan).
- **Rejected:** WebTransport/QUIC (uneven WebKit support, a QUIC server, and no help
  while the app is suspended; later, behind feature detection); mosh-style UDP (raw
  UDP isn't available to the web UI, and libmosh is GPL; its "sync state, not bytes"
  idea is what snapshots borrow).

### The web UI is bundled in the app

- **Decided:** 2026-10-21, design.
- **What:** the native app bundles its web UI; the daemon also serves the browser UI.
- **Why:** a single native UI can connect to several daemons, checks compatibility per
  host, and launches offline.
- **Rejected:** the native app loading its UI from whichever daemon it connects to:
  which host would serve the UI for all hosts, each origin needs its own storage and
  auth, and a cached copy is of unknown age.

### The WebSocket lives in the web UI

- **Decided:** 2026-10-21, design (iOS shell).
- **Why:** output reaches xterm.js without crossing the bridge; keystroke to echo
  crosses the bridge once either way.
- **Fallback, not rejected:** a native `URLSessionWebSocketTask` behind the same
  interface, if spike 3 finds WKWebView's socket unreliable after resume.

### Snapshot is the only catch-up

- **Decided:** 2026-10-21, tech lead.
- **What:** every watch, reconnect, resize and overflow repaints from a snapshot.
  Frames carry no generation or sequence number.
- **Why:** resume replay was a second catch-up path beside snapshots, and the only
  reason for generations, sequence numbers, rings, `daemon.instance`, stream linger,
  the replay cap and the outbox's sequence filter. The choice between in-flight snapshots and generation breaks added complexity; one fewer state dimension removes that
  class. Resume saved only one capture list; the network round trip is the same.
- **Rejected:** replay from a 256 KiB ring per stream with `(gen, seq)` positions;
  frame counters; a generation per snapshot. Adding an optional `resume` later needs no
  protocol bump.
- **Cost:** a reset and repaint on every tab switch (spike 3 checks for a flash), and
  xterm.js's local scrollback is cleared on each snapshot.

### The daemon is single-host on the wire

- **Decided:** 2026-10-21, tech lead.
- **What:** daemon routes are `/ws`, `/fs/*`, `/auth/*`, `/complete`; no message
  carries `host`. `welcome.host.id` and `/auth/info.hostId` bind tokens to hosts.
- **Why:** one socket per host already routes by host; every `host` field was a
  `badRequest` path that only a bug could hit; the proxy that justified it was
  rejected.
- **Rejected:** a host id in every URL and message.

### One protocol version on the client, a range on the daemon

- **Decided:** 2026-10-21, tech lead.
- **Why:** client-side ranges make the web UI carry old message shapes; only the
  daemon needs to accept several.
- **Rejected:** ranges on both sides with the highest common version; a single
  version with a reload on mismatch (the UI is bundled, so a reload fetches nothing
  new).

### ts-rs for TypeScript, hand-written Swift

- **Decided:** 2026-10-21, tech lead.
- **What:** ts-rs declarations generate one committed TypeScript protocol file; a Rust
  test renders and checks it. Swift is hand-written.
- **Why:** Swift needs only three auth bodies, while the larger bridge is already
  hand-written on both sides against shared fixtures.
- **Rejected:** typeshare (a Swift generator and check for three types); specta (a
  runtime type model plain DTOs do not need); JSON Schema plus quicktype (two tools and
  a schema artifact for one producer); ts-rs `#[ts(export)]` writing generated files on
  every test run rather than checking the committed output.

## Daemon core

### Fail fast on `%exit`; diagnose tmux version mismatches

- **Decided:** 2026-10-26, tech lead.
- **What:** `%exit` closes a control client immediately. Before `Ready` it is a startup
  crash subject to the existing one-respawn/60 s rule; after `Ready`, the one-shot check
  still distinguishes a detach from a gone session or server. The daemon reads
  `tmux.program -V` once, compares it with the server version, warns once per server
  instance, and includes both versions and the configured path when repeated startup
  failures end watches. It uses the normal 10 s reply timeout for both startup attempts;
  after a second startup failure, a known mismatch supplies the error instead of the
  generic failure reason. A view whose first owner is still starting is
  `Locating { owner }`, not `Checking`, so that owner's startup failure orphans the view
  and the crash rule applies; before, the view re-ran its own Locate and spawned a fresh
  client with no crash history, forever ("Connecting..." on the phone).
- **Rejected:** auto-selecting the server's binary: that binary can have been deleted by
  a package upgrade, and muxen must not assume another executable's ownership. Waiting
  for the reply timeout after receiving `%exit`: the event is terminal and should close
  immediately; the normal timeout remains for a silent client. Refusing to attach on a
  mismatch: a newer client can work with an older server. A mismatch-only short startup
  deadline: it adds a special mode for a misconfiguration that is fixed once. One short
  startup deadline for every client: it is unprobed on a busy host.
- **Implementation finding:** on pop-os, the mismatched `tmux -C` process stayed silent
  while the daemon's stdin pipe remained open; `%exit` arrived only after the process was
  signalled. Handling `%exit` immediately did not by itself fix the observed hang, so
  startup still uses the ordinary 10 s reply timeout and one-respawn rule.

### Snapshot boundary: one atomic command list

- **Decided:** 2026-10-21, design.
- **What:** `continue`, state, captures in one list; the snapshot is emitted at its
  replies' position in the stream; torn lists are retried.
- **Rejected:** pause → capture → marker → continue (pausing discards output; a probe
  measured a gap); a private marker command (the list is already atomic); a
  server-side `vt100` (a second emulator, still needing the boundary).

### Torn: the snapshot's own pane, or a changed size

- **Decided:** 2026-10-22, design.
- **What:** a snapshot group is torn when `%output` for its own pane arrives between its
  first and last reply, or when the full `<STATE>` re-read by the list's last command
  isn't byte-identical to the first state reply (about 150 bytes per snapshot).
  Rejected: re-reading only the size, which accepts a hook's `send-keys -R` (screen
  cleared, cursor moved, keypad off, size unchanged). It is re-sent, 3 attempts in all.
- **Why:** a hook that doesn't wait (`after-display-message 'display-message -p
  HOOKED'`) puts a flag-0 block between the replies but lets no output in, so the old
  rule would have failed every snapshot for anyone with such a hook. A waiting hook
  (`run-shell 'sleep 0.3'`) shows pane output arriving outside any block between the
  state and the capture replies, which the new rule catches.
- **Rejected:** any flag-0 block or any `%output` in the list as torn (the old rule,
  above); output for other panes cannot be in this pane's capture.

### A released snapshot is answered `Released`

- **Decided:** 2026-10-22, tech lead.
- **What:** `Release` abandons outstanding snapshot attempts for its pane. A released
  attempt is never retried and emits no `Snapshot`; when its command group ends it
  emits `Done { tag, Err(TmuxError::Released) }` in stream order. The tag and capture
  slot are freed on that answer ([daemon-core.md §3.3](daemon-core.md#33-session-the-sans-io-control-client-sessionrs)).
- **Why:** each snapshot begins with `continue`, so retrying after release would resume
  an unwanted pane. `Session` already knows which attempts release invalidates; answering
  each attempt lets the hub end its tag the same way as any other, without separately
  reconstructing the invalidation rule.
- **Rejected:** silently dropping the attempt and having the hub infer its invalidated
  tags; retrying after release.

### The daemon composes restore bytes

- **Decided:** 2026-10-21, design (daemon core).
- **Rejected:** structured state each client applies: the web and Swift clients would
  both carry restore logic, and only the daemon can test it against tmux with a `vt100`
  oracle.

### `Session` composes them: `Event::Snapshot { tag, pane, size, restore }`

- **Decided:** 2026-10-22, design.
- **What:** `Session` runs `snapshot::compose` over the five typed replies and emits the
  composed bytes with the pane's size. `PaneSnapshot` and `PaneState` stay inside
  `tmux/snapshot.rs`.
- **Why:** the hub never needs tmux's state format, so hub tests feed recorded streams
  and see only bytes; `compose` is pure, so it is tested where the recordings are.
- **Rejected:** the event carrying the typed replies and the hub calling `compose`
  (the hub would depend on tmux's state format).

### Restore bytes: what the probes settled

- **Decided:** 2026-10-22, design.
- **What:**
  - `?1003h` comes from `mouse_all_flag`.
  - Each tab stop is a CUP to its column and `ESC H`.
  - Empty rows are skipped.
  - Tab stops, region and origin mode apply to the screen in use only.
  - A cursor past the last column (tmux's pending wrap) is clamped.
  - Every position is clamped to the pane.
- **Why:** in tmux's `format.c`, `mouse_any_flag` means that some mouse mode is on (a
  fixture that sets only `?1000h ?1006h` reports `mouse_any_flag=1`), so a restore
  keyed on it would switch on any-motion tracking for every mouse application.
  `ESC H` sets a stop at the cursor's column, so a bare run of them sets one stop.
  tmux 3.4 reports `cursor_x == cols` at a pending wrap, and xterm.js clamps a cursor
  at `cols` to the last column, so restore clamps it itself and loses the wrap.
- **Rejected:** `mouse_any_flag` for `?1003`; a bare `ESC H` per stop.

### How the composer is tested

- **Decided:** 2026-10-22, design.
- **What:** the recorded snapshots' restore bytes are fed to `vt100` 0.18 and compared
  with tmux's capture and state; the modes `vt100` lacks (autowrap, insert, tab
  stops) are pinned on the bytes; a continuity check restores snapshot 1, feeds the
  live output and compares with snapshot 2; and every composer change is cross-checked
  against `@xterm/headless` 6.0.0 by hand ([daemon-core.md §8](daemon-core.md#8-testing)).
- **Why:** the renderer is xterm.js, so `vt100` alone is a second emulator's opinion.
  Seventeen deliberate breaks of `compose` were all caught by these tests; the xterm.js
  run flagged a stripped `CSI 4 h` and a stripped tab-stop section, which `vt100`
  cannot see.
- **Rejected:** `vt100` as the only oracle, since it has no autowrap, insert mode or
  tab stops.

### One control client per session, fixed for life

- **Decided:** 2026-10-21, design (daemon core).
- **Rejected:** one client that switches sessions (saves 5.3 MB only during the linger
  overlap, but invalidates every stream on a switch, fires `client-session-changed`
  hooks, and makes the client `latest` in each session it visits); reusing an idle
  client by switching (same costs). Spawning takes about 2 ms.

### Pause unviewed panes on their first output

- **Decided:** 2026-10-21, design (daemon core).
- **Rejected:** client-wide `no-output` (silences the viewed pane too); `'%P:off'`
  (crashes tmux 3.4 with output queued); listing panes on every layout event to pause
  them up front (more commands, same result).

### Sans-IO cores

- **Decided:** 2026-10-21, tech lead.
- **What:** `tmux::Session::{feed, request}` and `hub::State::handle(input, now)` are
  pure; the pool folds into the hub state; the I/O tasks are pumps and effect
  executors.
- **Why:** the subtlest rules (wanted and paused panes, gaps, torn snapshots, the
  first-vote rule) sat in the I/O file, testable only against real tmux.
- **Rejected:** a pure parser and correlator beside an I/O task that holds the rules; a
  separate `pool.rs`.

### The hub owns every Session; the pump only moves bytes

- **Decided:** 2026-10-21, design.
- **Why:** one pure value holds all state, so capacity, ownership and wanted panes are
  read in one place, and a hub test can feed recorded tmux bytes end to end. The
  runtime is single-threaded, so parsing on the hub task costs nothing extra.
- **Rejected:** the Session inside the control-client task, sending typed events to the
  hub: the hub would then have to mirror the session's in-flight count to know its
  capacity.

### Maintenance is desired state

- **Decided:** 2026-10-21, tech lead.
- **What:** snapshots needed, releases, votes and clears (and, in this revision, cwd
  subscriptions and Locates) are derived from the hub state and reconciled when a
  control client has capacity. Only user requests get `busy`.
- **Why:** a maintenance request refused as `busy` had no one to retry it: a stream
  stayed resyncing forever, a vote never cleared.
- **Rejected:** one-shot maintenance requests sharing the user path.

### Capacity: a user threshold and capture slots

- **Decided:** 2026-10-21, design.
- **What:** 32 groups in flight per control client, user requests only below 24;
  snapshots and history share 2 capture slots daemon-wide.
- **Why:** reserved headroom means user traffic can't starve maintenance, and the
  capture slots bound reply memory for the ceiling.
- **Rejected:** a separate priority queue inside the control client (a second queue
  the decision set out to remove); per-request retry timers (polling).

### `tmux -N` on every invocation

- **Decided:** 2026-10-21, tech lead. Evidence: [probe-locate-subscriptions.md](research/probe-locate-subscriptions.md).
- **What:** every tmux command muxen runs fails instead of starting a server. New
  windows and sessions are one-shots.
- **Rejected:** `-f /dev/null` so a started server exits at once, attaching only to
  sessions just seen in a listing, and spawning a control client on the first listed
  session for `newSession` (which also made it `latest` there).

### `-u` on every invocation

- **Decided:** 2026-10-22, tech lead.
- **What:** every tmux process muxen runs, control client and one-shot, is
  `tmux -u -N …`, built in `Endpoint::command`.
- **Why:** when the client's locale isn't UTF-8, tmux 3.4 replaces non-ASCII characters
  and line breaks in format output (window names, `display-message`, listings) with `_`.
  A systemd unit's locale may not be UTF-8. With no locale set and no `-u`, a window
  named `中w` came back as `__w`, and the real-tmux tests catch the missing flag.
- **Rejected:** relying on the inherited locale.

### Both no-server messages are `NoServer`

- **Decided:** 2026-10-22, tech lead.
- **What:** with `-N`, a stale socket prints `no server running on …` and a missing
  socket file prints `error connecting to … (No such file or directory)`. Both map to
  `TmuxError::NoServer`.
- **Why:** both mean no server is running, and the hub answers both with `serverExited`
  and `notRunning`.
- **Rejected:** matching only `no server running`: a missing socket file (tmux never
  started, or its socket removed) would surface as a generic `tmux` error.

### One-shots are arguments, not command lines

- **Decided:** 2026-10-22, tech lead.
- **What:** a one-shot is an argv vector. A user's `name` or `dir` gets every `#`
  doubled, a trailing `;` sent as `\;`, and control characters refused.
- **Why:** tmux takes each argument literally, so the single-quote quoting of a
  control-client line would put quote marks into names. The exception is a trailing
  `;`, which ends the command: `-n 'x;'` produced `unknown command: -c`. `#` is
  format-expanded in `-n` and `-c`. A control character is refused as on a control-client
  line, and a name with a line break would also garble the listing.
- **Rejected:** building the same quoted string a control client takes and passing it
  to tmux as one command; sending a trailing `;` unescaped.
- **Listing constraint:** tmux 3.4 permits tabs and line breaks in window names but
  escapes them in session names. Listing puts the window name last and splits only
  the fixed leading fields; malformed extra lines are skipped.

### One reply type for control-client and one-shot answers

- **Decided:** 2026-10-22, tech lead.
- **What:** a one-shot answers `Result<Reply, TmuxError>`, like `Event::Done`. `Reply`
  gained `Listing` and `Created`; `TmuxError` gained `NoServer`, `Timeout` and
  `Spawn(String)`.
- **Why:** the hub handles a Locate answer the same way from a control client and from a
  one-shot.
- **Rejected:** a separate `OneShotResult` type: the hub would carry two shapes for one
  answer.

### `pump::spawn` can't fail

- **Decided:** 2026-10-22, tech lead.
- **What:** `spawn` returns the line sender and the task handle. A failure to start
  tmux arrives as `PumpMsg::Exited` with `stderr_tail` `can't run tmux: …` and no bytes
  before it.
- **Why:** the hub has one path for a client that ended, whether it never started or
  died later.
- **Rejected:** a `SpawnError` at the call: a second exit path beside `Exited`.

### "Nothing is lost" holds only for stalls shorter than `pause-after`

- **Decided:** 2026-10-22, tech lead.
- **What:** with only control clients attached, a stall shorter than `pause-after`
  (3 s) loses nothing and sends no `%pause`. A longer stall can still end in a Gap.
- **Why:** when a control client falls behind, tmux stops reading the pane, but the
  blocks it had already queued keep ageing and are paused at 3 s. That explains the
  1-in-3 Gap observed with control clients only. The hub's inbox (2 MiB) sits in front of
  tmux, so tmux notices a stall only once the inbox is full. The real-tmux test uses a 2 s
  stall for the no-Gap case and a terminal client with a 7 s stall for the Gap case.
- **Rejected:** keeping the unconditional claim, which the tests contradict.

### The client size is set at startup

- **Decided:** 2026-10-21, tech lead and design.
- **What:** the session's startup line reports the current window's size, and the
  session sets it as the client size before reporting `Ready`, so no vote reaches tmux
  first. The default 80×24 client size would otherwise resize other windows.
- **Why two lines:** `refresh-client -C` doesn't expand formats, so the size can't be
  read and set in one command group.
- **Rejected:** "the first `Vote` also sets the client size" (a second mode in the
  vote path); a one-shot size query before spawning (an extra process per attach);
  setting the client size to the phone size (shrinks every window where the client is
  `latest` or alone); attaching with `ignore-size` (the phone could never size a window
  while the laptop was attached).

### A watch exists only while its tab is on screen

- **Decided:** 2026-10-21, tech lead.
- **What:** a covered or hidden terminal sends `unwatch`; `watch` carries a required
  size.
- **Rejected:** a `visibility` message with per-connection and per-watch visible state
  and re-sent votes: a second way of saying "on screen".
- **Cost:** returning from a settings screen costs one snapshot.

### The cwd subscription's shape

- **Decided:** 2026-10-21, design. Evidence: [probe-locate-subscriptions.md](research/probe-locate-subscriptions.md).
- **What:** one window subscription per watched window on its owner, named `w<W>`,
  including `@W:#{pane_current_path}` and the other-client activity data; cwd goes
  in `watching.cwd`, and `watching` is
  re-sent when it changes. `cwd` is null until tmux first reports, within about a
  second.
- **Why:** a window subscription follows the active pane by itself, reports its first
  value on subscribing, and is active only on the owner's session, which matches
  ownership.
- **Rejected:** one session-wide `%*` or `@*` subscription per control client at
  startup (reports every pane or window, and the hub would have to cache values for
  windows nobody watches); a separate `cwd` message (`watching` already carries a
  watch's changing facts); holding `watching` until the first value (delays the
  screen).

### Closure is a broadcast fact

- **Decided:** 2026-10-21, tech lead.
- **What:** `sessionClosed` and `serverExited` are broadcasts; `watchEnded` ends an
  individual watch for detach, limit or error.
- **Why:** a session or server closure affects tabs that are not watched as well as
  the visible tab.
- **Rejected:** reporting closure only as a watch-local `watchEnded`, which leaves
  hidden tabs open, or reporting the same closure twice as both a watch-local reason
  and a broadcast.

### No automatic reattach after a detach

- **Decided:** 2026-10-21, design (daemon core).
- **What:** when another client detaches muxen's control client (`attach -d`,
  `detach-client`), its watches end with `watchEnded { detached }`; a tap reattaches.
- **Why:** the user who detached muxen meant it.
- **Rejected:** auto-reattach: fights `attach -d`, and reattaching makes muxen
  `latest`, shrinking the laptop's window right after the user took it.

### Input: hex for text, names for keys

- **Decided:** 2026-10-21, design (daemon core); native key mapping by tech lead, 2026-10-24.
- **What:** native key names stay within the daemon's allowlist; Shift is omitted for
  unshiftable names. Option plus printable non-alphanumeric ASCII sends ESC-prefixed
  bytes, except Option+Space, which is `M-Space`.
- **Why:** Shift on Escape or Backspace produced names the daemon rejected for the
  entire input batch.
- **Rejected:** `send-keys -l '…'` (needs quoting, can't carry newlines); raw bytes for
  named keys (wrong in application-cursor mode); unvalidated key names.

### Input before `watching` is refused

- **Decided:** 2026-10-21, design.
- **What:** `input` and `paste` for a watch that isn't bound get `busy`; the client
  sends input only after `watching`.
- **Why:** with Locate before binding there may be no control client yet, and the
  screen isn't shown until the snapshot anyway.
- **Rejected:** routing early input through any live control client (none may exist
  on a cold start); buffering it in the daemon (another queue).

### Watches use client-chosen ids and target a session

- **Decided:** 2026-10-21, design; session target, 2026-10-25.
- **What:** each watch has a client-chosen, non-reused id and targets a session.
  Input and paste separately name the window the user saw.
- **Rejected:** server-assigned ids (one round trip per tab); reusable ids (a stale
  frame could reach a new watch); a pane target (the client would have to track active
  pane changes it cannot see).

### One hub task

- **Decided:** 2026-10-21, design (daemon core).
- **Rejected:** a task per pane stream (more channels and routing for a single-user
  load); streams inside the control-client task (tangles protocol parsing with
  fan-out policy).

### Credit-based flow control per connection

- **Decided:** 2026-10-22, tech lead.
- **What:** the hub holds a byte credit per connection (2 MiB) and debits it for every
  `ToConn`; the connection returns credit over `FromConn::Credit` once a frame is
  written or discarded. A snapshot or history capture reserves 1 MiB before its group
  is issued: a snapshot that can't stays desired, a history request gets `busy`, and
  the reply is charged at its encoded size. Output that doesn't fit starves that watch
  alone, which catches up by snapshot, no sooner than 250 ms after its last one.
  Control JSON is never refused and may overdraw by 64 KiB; past that the connection
  is wedged (4002). The outbox keeps ordering, replacement and coalescing, and no
  limits ([daemon-core.md §4.6](daemon-core.md#46-credit-and-the-outbox)).
- **Why:** count-bounded queues carrying variable-size payloads escaped the byte
  budget. A legal 200-row history capture at 500 columns encoded to 134 KB, so 256
  queued in one JSON FIFO were 34 MB; snapshots and output in the 256-message
  `ToConn` channel had the same gap. One number in the hub, which already decides what
  to send, bounds production, transit, outbox residence and the frame being written,
  and keeps the no-shared-state rule: the connection only reports bytes. It also
  returns credit when it discards a frame, since an idle socket may make no next write.
  The hub owns starvation with the credit; the outbox no longer tracks it, so the
  state is not duplicated. Wedged (4002) covers control JSON past its overdraft or a
  full channel.
- **Rejected:** end-to-end permits (a response permit object carried from the capture
  to the socket and dropped on delivery: the same bound, but shared state across
  tasks, which the hub/connection split forbids); per-message byte caps (each message
  bounded, but the count still multiplies them: 256 × a capped `historyChunk` is the
  failure above); keeping the outbox budget beside the credit (two limits on the same
  bytes, and the outbox would starve watches the hub thinks are live); an unbounded
  queue; a snapshot on every overflow (capture rate would follow a flood); replay for
  slow consumers (a snapshot costs far fewer bytes than a ring full of flood output).

### Every watch the daemon ends gets `watchEnded`

- **Decided:** 2026-10-21, design.
- **What:** apart from the closure broadcasts, a watch ends only with `watchEnded`,
  including a watch refused for the connection's watch cap or the control-client cap.
  `error` refuses one request and never ends a watch; the outbox forgets a watch only
  on `unwatch` and `watchEnded`.
- **Rejected:** `error { tooManyWatches | tooManySessions }` ending a watch, and the
  outbox forgetting a watch on any `error` naming it: a `busy` history request would
  have orphaned a live watch.

### Paste slots

- **Decided:** 2026-10-21, design.
- **What:** at most 4 paste files exist at once daemon-wide; without a free slot the
  connection answers `busy` before writing anything. Deleting the file frees its slot.
- **Why:** `$XDG_RUNTIME_DIR` is tmpfs, charged to muxen's cgroup; with only the
  queue bounds, about 150 pastes could wait as files, close to 38 MiB.
- **Rejected:** counting only in-memory payloads.

### Paste: a file on receipt, deleted on the group's reply

- **Decided:** 2026-10-21, tech lead.
- **Why:** with payloads in a queue, 256 queued pastes of 256 KiB were 64 MiB, the
  whole memory limit; a probe showed tmux has read the file by the time the group
  replies.
- **Rejected:** deleting on `%paste-buffer-deleted` or after a 5 s timer.

### Failed paste groups clean up tmux buffers

- **Decided:** 2026-10-22, design.
- **What:** the paste group is `load-buffer ; paste-buffer -p -d`, the buffer is
  `muxen-<tag>`, and a failed group is followed by a separate `delete-buffer -b
  muxen-<tag>` group whose error is ignored. Tags are unique across control clients.
- **Why:** `paste-buffer -d` deletes only on success, so a failure after `load-buffer`
  would leave the pasted text in tmux's buffer list. A leading `send-keys -t @W` guard
  was tried and dropped: it covered only a missing window, and the cleanup covers every
  failure point. tmux skips the rest of a failed
  list, so the delete can't ride in the same group. Buffer names are server-wide, so
  two control clients sharing a tag space would collide. A missing file doesn't fail
  `load-buffer` on 3.4 (the error is printed outside any block); the group fails at
  `paste-buffer` instead.
- **Rejected:** `paste-buffer -d` alone (leaves the buffer on failure).

### An oversized reply fails its group, not the control client

- **Decided:** 2026-10-21, design.
- **What:** `Session` caps a group's replies at 1 MiB and fails an oversized group
  `TooLarge`. The parser limits the length of a line but does not cap a reply block;
  attach and hook replies are not held.
- **Why:** a legal, very large screen could exceed the earlier limit, killing a control
  client that would respawn and fail again. Only `Session` knows command groups.
- **Rejected:** killing the control client on a group-limit breach; a block cap in the
  parser, which cannot know the groups.

### A zoomed pane uses the visible layout

- **Decided:** 2026-10-22, design, from tmux 3.4 behavior.
- **What:** `Layout` gets pane sizes from the visible layout, so a zoomed pane reports
  its full window size. A repeated size does not break a stream.
- **Rejected:** deriving sizes from the window layout, which is the unzoomed layout.

### Logs carry framing metadata only

- **Decided:** 2026-10-21, tech lead.
- **What:** parser failures report kind and position, not content. Completion JSON
  errors use fixed phrases and line/column, never serde's message.
- **Why:** serde error messages can quote carapace output, which can echo what Jimmy
  typed; the control-client stream contains terminal output and captured screens.
- **Rejected:** logging serde's message or the last 4 KiB of control-client input.

### Server instances name their endpoint

- **Decided:** 2026-10-21, design; session references, 2026-10-25.
- **What:** `SessionRef.server` is `"<endpoint>:<pid>-<start_time>"`, where the
  endpoint is `main` or `scratch`. The hub routes a session from the reference alone.
- **Rejected:** a separate endpoint field on every reference; a lookup from instance
  to endpoint, which is empty after daemon restart before anything is attached.

### A failing Locate or session check ends the watches

- **Decided:** 2026-10-22, tech lead.
- **What:** a failed Locate or session check ends that view's watches with
  `watchEnded { error }`, except `NoServer`, which means the server is gone. Work lost
  when its control client exited can still be needed again.
- **Why:** immediately retrying a failing one-shot during reconciliation can spawn a
  failing process on every input when tmux cannot run.
- **Rejected:** treating one-shot failures and timeouts as always needed again.

### The reply timeout is a progress deadline; every unplanned exit gets a session check

- **Decided:** 2026-10-22, tech lead. Evidence: [§4.5](daemon-core.md#45-control-clients).
- **What:**
  - A control client with groups in flight that completes none for 10 s is killed. The
    deadline belongs to the client, so it also covers `Session`'s own groups (the
    startup line, pauses), which the hub never tags.
  - Fatal errors and timeouts count as crashes, not detaches: the hub killed the client,
    so tmux sent no `%exit`.
  - The session check runs on every exit the hub didn't cause (not on a linger or cap
    close), so `serverExited` and `sessionClosed` go out even when no tab was watched.
- **Rejected:** a deadline per tagged group (the groups `Session` sends itself would be
  unwatched); checking a session only when one of its windows was watched (closure
  broadcasts reach tabs that exist but aren't on screen, and they would never be told).

### The stream is part of the session view

- **Decided:** 2026-10-22, tech lead; session views, 2026-10-25.
- **What:** the pane stream is part of the watched session's view, which displays one
  pane at a time.
- **Why:** the stream and view change together.
- **Rejected:** a separate stream map keyed by pane, requiring every transition to keep
  the map and its view in step.

### Reconcile runs only after inputs that may change desired state

- **Decided:** 2026-10-22, tech lead. Evidence: [daemon-core.md §4.1](daemon-core.md#41-statehandle).
- **What:** `reconcile` is skipped for pump bytes that complete no group, produce only
  `Output` events and starve no watch. Every other input, and every timer that fires,
  runs it.
- **Why:** measured in one release process, a plain output chunk cost about 230 ns
  without `reconcile` and 590–910 ns with it; with the skip it costs about 256 ns, 5% of
  the pump's own ~5 µs wake per chunk. Output is the only input at pump rate.
  Snapshot spacing feeds `next_deadline` without being a timer action.
- **Rejected:** `reconcile` after every `handle` (2.5 to 4 times the hub's work on the
  hot path, for no change in what is sent); scanning every watch for snapshot spacing
  in the timer action (an extra 35–45 ns per chunk with three connections).

### `sessions.tmux` is `TmuxListing | null`

- **Decided:** 2026-10-22, tech lead. Evidence: [daemon-core.md §5.3](daemon-core.md#53-json-messages).
- **Why:** `null` for "no tmux server" is what serde and ts-rs express cleanly.
- **Rejected:** `"notRunning" | { … }`: a string-or-object union has no clean serde or
  ts-rs shape.

### Watches that can never bind, and reused ids

- **Decided:** 2026-10-22, tech lead. Evidence: [daemon-core.md §4.2](daemon-core.md#42-views-owners-and-locate).
- **What:** a `watch` whose `server` string doesn't parse, or names an unknown endpoint,
  gets `serverExited` for that string on that connection, which closes the tab. A watch
  id that is already active gets `error { badRequest }` and the active watch is
  unchanged.
- **Why:** such a ref can never bind, which is what `serverExited` says of a dead
  server's windows. A `watchEnded` for a reused id would name the live watch and end it.
- **Rejected:** `error { badRequest }` for the unparseable server (the tab would wait
  for a `watching` that never comes); `watchEnded` for a reused id.

### Unknown message types are reported by `decode`

- **Decided:** 2026-10-22, tech lead. Evidence: [daemon-core.md §5.2](daemon-core.md#52-handshake-and-versions).
- **What:** `ClientMsg::decode` returns `Decoded::Unknown { kind }` for a type it
  doesn't know, so the connection logs and ignores it; a known type with bad data is a
  protocol violation (4003).
- **Why:** the protocol says new message types need no version bump.
- **Rejected:** serde's `#[serde(other)]` catch-all alone: it matches only a message
  without `data`, so a newer client's message carrying a `data` object would fail to
  parse and look like a protocol violation.

### An oversized history capture is retried with half the rows

- **Decided:** 2026-10-22, tech lead. Evidence: [daemon-core.md §4.6](daemon-core.md#46-credit-and-the-outbox).
- **What:** when a `history` capture fails `TooLarge`, the hub reissues it with half the
  rows, down to one row, and the client sees a shorter `historyChunk` and asks again
  from where it ends. A single row that still fails answers `error { tmux }`.
- **Why:** `Session` caps a group's replies at 1 MiB raw, but the reservation holds the
  base64 text, a third larger. A capture of 768 KiB to 1 MiB raw succeeds and is cut to
  the rows that fit. Over 1 MiB raw (200 heavily styled 500-column rows) the group
  fails, and without a retry every request for that range fails the same way.
- **Rejected:** the client shrinking its range on `error` (the error doesn't say what
  size fits, and every client would carry the retry); the hub asking for fewer rows up
  front (it can't know row sizes before capturing, and a fixed lower limit would shrink
  every request for the rare heavy one).

### `NewWindow` carries the server instance, and tmux checks it

- **Decided:** 2026-10-22, tech lead. Evidence: [daemon-core.md §3.8](daemon-core.md#38-one-shots-and-endpoints-oneshotrs).
- **What:** `OneShotCmd::NewWindow` carries the instance named by the request's
  `SessionRef`, and the one-shot starts with `if-shell -F
  '#{!=:#{pid}-#{start_time},<server>}' muxen-server-changed ;` before `new-window`. On
  another instance tmux can't parse the branch, `if-shell` fails, and tmux skips the rest
  of the list. The one-shot reads `muxen-server-changed` in stderr as `NoServer`, so
  `NoServer` also means "not the instance this one-shot was for", and the hub answers
  as for a dead server: `serverExited` for that instance and `error { noServer }`. The
  hub's cached comparison with the live instance is removed.
- **Why:** session ids restart at `$0` on every tmux server, so a ref from an earlier
  run names some other session on the live one. The hub's cached instance is unknown on
  a fresh hub (after a daemon restart) and stale after a server restart, so its check let
  `newWindow` create a window in the wrong server's session: the reviewer's probe got
  `created` and `@1` in the wrong instance. tmux evaluates the instance in the same
  command list that creates the window, so there is no gap between check and use. Checked
  on 3.4 (a mismatch exits 1 and creates nothing; a match creates the window); tmux
  master has the same `if-shell` and list-abort behaviour, 3.7b not run.
- **Rejected:** the hub comparing the ref with its cached live instance (unknown or
  stale, above); reading the instance in one process and then running `new-window` in
  another (leaves a window for the server to restart between the two).

### Time reaches `State` with the next input

- **Decided:** 2026-10-22, tech lead.
- **What:** `handle` treats any input at or past `next_deadline()` as a Tick too: it
  fires the timers that are due and runs `reconcile` once, whatever the input was. The
  deadline is reported only until then, so one that can't be acted on (credit or a
  capture slot missing) can't spin the timer.
- **Why:** the runtime's select may take a ready pump input over its timer, so output at
  a steady rate kept the snapshot-spacing wakeup of a starved watch from ever running:
  the reviewer's probe saw nothing delivered after output, with the snapshot still
  owed. Putting the rule in the pure `State` keeps it testable with scripted inputs and a
  fake clock. Cost: about 30 ns more per output chunk (313 to 347 ns median, release
  build), under 1% of the pump's ~5 µs wake per chunk.
- **Rejected:** a timer-first (biased) select in `run.rs` (the rule would live in the
  executor's polling order, outside the pure core and its tests).

### `DropConn` and `CloseClient` on every exit

- **Decided:** 2026-10-22, tech lead. Evidence: [daemon-core.md §4.1](daemon-core.md#41-statehandle).
- **What:** `State` owns every lifecycle and `run.rs` only mirrors it. `DropConn` means
  the connection is gone from the hub, whether it closed or was dropped as wedged;
  `CloseClient` goes out whenever a started control client leaves the state, whether the
  hub closed it or it exited. The executor removes its entries idempotently. A `connect`
  whose reply can't be delivered registers nothing.
- **Why:** a normal `Closed` and a natural client exit emitted no effect, so the
  executor's channel for each leaked. Over 10,000 connect and close cycles the daemon's
  RSS went from 2.8 to 24.8 MB; 10,000 connects cancelled before the answer went from
  2.9 to 25.8 MB. With the fix: 2.8 to 3.1 MB and 2.9 to 3.0 MB.
- **Rejected:** the executor deciding for itself when a connection or client is dead
  (a second owner of the lifecycle, so two places to keep in step); a
  periodic sweep (polling, and an idle daemon must have no timer).
- **Open:** a connection that drops its receiver without sending `Closed` stays
  registered until the hub next sends to it. `http/ws.rs` sends `Closed` on every path
  but a panic or the runtime's shutdown, so no machinery was added.

### One reporter per endpoint coalesces session-change hints

- **Decided:** 2026-10-22, tech lead.
- **What:** the endpoint's lowest-id ready control client is the sole reporter for
  session changes and window adds or closes. The hub broadcasts at most one
  `sessionsChanged` per input and the web debounces relisting
  ([daemon-core.md §4.5](daemon-core.md#45-control-clients)).
- **Why:** tmux sends notifications to every control client; broadcasting each copy
  would duplicate the hint. The hub holds only watched views, so without a hint an
  unwatched window's close or move was invisible to listings. On tmux 3.4, the hint
  made one notification for an unwatched window close and one for a four-window
  session close, not one per window.
- **Rejected:** a Locate and state per unwatched window; a broadcast per closed window;
  a timed hub debounce when the web already debounces; broadcasting every client's
  copy of the notification.

### Reserved credit stays a counter, with a debug check

- **Decided:** 2026-10-22, tech lead. Evidence: [daemon-core.md §4.6](daemon-core.md#46-credit-and-the-outbox).
- **What:** `Conn.reserved` stays a counter. Debug builds derive what it must be (a
  capture reservation per watch a snapshot in flight reserved for and per history
  capture in flight, plus the listing's) and `debug_assert_eq!` it for every connection
  at the end of each `handle` (`check_reservations` in `credit.rs`). Taking out the
  `unreserve` in `listed`, or the ones in `abandon`, each fails a hub test.
- **Why:** measured in a release build pinned to one core, the median cost of one
  `%output` chunk through `State::handle`:

  | Scenario | Counter | Derived |
  |---|---|---|
  | one connection, one watch | ~210 ns | ~227 ns (+17) |
  | 3 connections × 2 watches | ~298 ns | ~375 ns (+77) |
  | same, 20 inputs in flight per client | ~298 ns | ~625 ns (+325) |

  Deriving scans every client's pending work for every watch on every chunk, so it
  costs most when the box is busiest.
- **Rejected:** deriving it on the output path (above); scanning once per chunk (still
  about +100 ns loaded); a `State`-level map of captures (a second structure mirroring
  `pending`).

## Daemon service, as built

Decided 2026-10-22 by the tech lead.

### The connection's own replies are bounded by a queue of 16, not charged to credit

- **What:** `welcome`, `pong` and the paste refusals the connection makes itself
  (`inputTooLarge`, `busy`) are written by the connection task and never pass through
  the hub. They wait in a queue of 16 entries, ahead of the outbox's frames; while 16
  wait, the connection stops reading its socket
  ([daemon-core.md §4.6](daemon-core.md#46-credit-and-the-outbox)).
- **Why:** credit is the hub's only copy of the bytes it sent to a connection. These
  messages start in the connection, so charging them would mean telling the hub about
  bytes it never sent. Not reading the socket while the queue is full is the same
  backpressure that keeps a client that pings without reading from growing it.
- **Rejected:** charging them to credit, as §4.6 first implied for "every byte"; an
  unbounded queue.

### The unit uses `KillMode=mixed` and a restart backoff

- **What:** `contrib/muxen.service` sets `KillMode=mixed`, `RestartSec=2`,
  `RestartSteps=5`, `RestartMaxDelaySec=60` and `StartLimitIntervalSec=0`
  ([plan.md](plan.md#resource-budget)). Changes plan.md's earlier unit sketch, which had
  neither.
- **Why:**
  - Under the default kill mode, `systemctl stop` signals the `tmux -C` clients
    directly, so the hub logged them as detached while the sockets were closing with
    4004, and the phone could get `watchEnded { detached }` instead of reconnecting.
    Verified with a transient unit.
  - tailscaled is a system unit that a user unit can't order itself after, so at boot
    muxen may start before it. The earlier daemon exited when LocalAPI was absent;
    the browser-auth daemon instead starts and retries its tailnet-state cell in the
    background.
- **Rejected:** the default `KillMode=control-group` (the false "detached" above);
  ordering after `tailscaled.service` (a user unit can't); a fixed `RestartSec=2` with
  the default start limit (a slow boot would exhaust it and leave muxen down).

### No sd-notify watchdog, no tracing-journald

- **What:** the daemon sends `READY=1` and `STOPPING=1` only, and logs to stderr, which
  the journal captures ([plan.md](plan.md#stack)). Changes the stack row that listed a
  watchdog and optional tracing-journald.
- **Why:** a watchdog needs a periodic timer, which breaks the zero-wakeup idle (0
  context switches over 60 s, measured). stderr already reaches the journal, so
  tracing-journald adds a dependency for nothing.
- **Rejected:** `WatchdogSec` with a keep-alive timer; tracing-journald.

### Paste cleanup follows the runtime lock and socket binds

- **Decided:** 2026-10-22, tech lead.
- **What:** the daemon holds its runtime lock and binds its sockets before emptying
  only its private `paste/` directory ([daemon-core.md §3.4](daemon-core.md#34-commands-commandrs)).
- **Why:** a mistakenly started second daemon once emptied the directory before its
  bind failed, deleting the running daemon's in-flight paste files.
- **Rejected:** cleaning the directory before establishing exclusive ownership.

## iOS app

### Snapshots apply after earlier writes drain

- **Decided:** 2026-10-21, tech lead.
- **What:** one serialized write pipeline per terminal in `web/term/`; a snapshot runs
  `reset(); resize(); write(restore)` only after every earlier write's callback fired.
- **Why:** bytes still queued inside xterm.js parse after `reset()` and can switch on a
  mode (insert mode) that the restore never switches off.
- **Rejected:** replacing the terminal instance per snapshot (renderer and WebGL
  context churn on every tab switch).

### Upload paths are queued per tab

- **Decided:** 2026-10-21, tech lead; window targeting, 2026-10-25.
- **What:** a path inserted from Files or an image paste targets the originating tab
  and the window it showed when the action began. A connecting or hidden eligible tab
  can queue the insertion until watched; a failed watch, closed target or disconnected
  target is reported without redirecting the path to another tab.
- **Why:** uploads may finish after the user switches tabs or the session follows a
  different window; the path must go where the user intended.
- **Rejected:** inserting into whichever tab or window is current after upload; keeping
  background watches open just for uploads.

### Host content on its own origin

- **Decided:** 2026-10-21, tech lead and design.
- **What:** proxied host content comes from `muxen-app://h-{host}/…`, the UI from
  `muxen-app://ui/`, so the UI's `script-src 'self'` never covers a daemon response.
  The scheme handler adds `Access-Control-Allow-Origin: muxen-app://ui`. Native
  proxies a host's requests only after its `/auth/info` reported a compatible protocol
  range in this app session. Native asks `/auth/info` itself on the host's first
  proxied request (2026-10-27).
- **Why the gate uses `/auth/info`:** the WebSocket, and so `welcome`, lives in the web;
  `/auth/info` reports the same range. Native otherwise calls it only at enrolment, so
  the gate remained shut for the app's token lane. Rejected: checking every host at
  launch (a round trip per host before anything is used).
- **Rejected:** host content under `muxen-app://ui/h/{host}/…` (same origin as the
  UI, so a proxied script could run as the app); the web reporting `welcome` results
  over the bridge (native's gate would trust web state).

### XcodeGen for the project

- **Decided:** 2026-10-21, design (iOS shell).
- **Rejected:** a committed `.xcodeproj` (unreviewable diffs, agent edits break it);
  Tuist (more machinery for one app); a bare Swift package (can't build an app with
  entitlements and extensions).

### The web asks native to recreate the web view: `recreateWebView`

- **Decided:** 2026-10-22, tech lead. Evidence: [ios-shell.md](ios-shell.md#the-bridge).
- **What:** `recreateWebView` is a web → native message with no data and no reply. The
  web sends it under the [connect-timeout rule](plan.md#reconnect), limited on the web's side
  (see "A stuck socket recreates the web view only if the server answers"). Native discards the
  `WKWebView` and loads a new one, and the tabs come back through `boot`.
- **Why:** [plan.md](plan.md#reconnect) already says the client recreates the web view
  when a socket stays stuck in CONNECTING (WebKit 308073). Only the web sees the stuck
  socket, so only the web can ask; native's content-process hook never fires for it.
- **Rejected:** native detecting the stuck socket (it can't see inside the web view's
  sockets); moving the socket to native now (the recorded fallback, kept for if spike 3
  shows recreation doesn't clear it).
- **Names:** `lifecycle.phase` stays `active` and `background`, the spec's names; the
  web host-layer brief called the first one "foreground".

### Native persists the web-owned workspace

- **Decided:** 2026-10-21, tech lead.
- **What:** native persists the web-owned saved workspace without maintaining a second
  tab model; the web restores it after a WebKit content-process restart.
- **Why:** survival of WKWebView `localStorage` on the custom scheme after a content-
  process kill was unverified, so native persistence owns the recovery boundary.
- **Rejected:** depending on that unverified web-storage behavior alone.

### The web prunes its tabs against `sessions` listings

- **Decided:** 2026-10-22, tech lead; session tabs, 2026-10-25.
- **What:** on each connection and later listing, the web closes a terminal tab whose
  `SessionRef` is absent. A failed or refused listing prunes nothing; the main-server
  listing never prunes scratch tabs. The daemon's session-change hint prompts a relist.
- **Why:** only the tab on screen is watched, so a session closed under a hidden tab
  cannot depend on a watch event. A listing already used by the session sheet covers
  open tabs without tracking all of them in the daemon.
- **Rejected:** watching every tab (unseen windows would vote and resize); holding a
  daemon-side watch and Locate per hidden tab; waiting until the user selects the dead
  tab; maintaining a second listing in the daemon to diff closures.

### The tmux size sits inside every safe-area inset, and a `keyboard` viewport keeps the full-screen insets

- **Decided:** 2026-10-22, tech lead.
- **What:** every native viewport carries the full-screen safe-area insets, including
  when the keyboard is up. tmux is sized from the full-screen stable height less the
  top and bottom insets and resting dock, and from the width less side insets, each at
  least 4 px ([ios-shell.md](ios-shell.md#keyboard-geometry)). The keyboard and
  suggestion strip never enter the tmux size.
- **Why:** a web view ending above the keyboard reports a zero bottom inset of its own;
  using that value on rotation would compute rows without the home-indicator band. The
  4 px minimum edge keeps text off the bezel and cost one column on a 393 pt portrait
  view, none in landscape.
- **Rejected:** live web-view insets during keyboard display (they lose the bottom
  safe area); a wider edge (another column on a 393 pt phone); subtracting the
  transient suggestion strip (it would resize tmux whenever chips appear or disappear).

## Auth

### Token details

- **Decided:** 2026-10-21, design (auth).
- **Rejected:** a slow password hash (argon2, bcrypt: protects low-entropy secrets, and
  costs CPU per request); the phone generating the token (equally secure, but the
  daemon keeps format and entropy in one place shared with `muxen device add`);
  expiring tokens (a trip to the server shell every few weeks for protection Face ID
  already gives); a session token derived from the device token (would bring back
  minting, expiry and refresh for no protection the transport doesn't give).

### Keychain: one item for all hosts

- **Decided:** 2026-10-21, design; lifecycle policy by tech lead, 2026-10-24.
- **What:** one `muxen.tokens` Keychain item stores the host-token map with
  `WhenPasscodeSetThisDeviceOnly` and `.biometryCurrentSet`. One background Keychain
  read unlocks all hosts, and tokens stay in memory until lock. On background, a short
  task lets the web close sockets; the user selects the relock interval.
- **Why:** one read avoids repeated biometric prompts without putting a screen in
  front of an independently accessible token. Short app switches need not force an
  immediate reauthentication.
- **Rejected:** an item per host (one prompt for all would depend on an evaluated
  `LAContext` covering several reads); an app-level `evaluatePolicy` in front of a
  plain item; `.biometryAny` (a newly added face can unlock); `.userPresence` (the
  passcode stands in for Face ID); locking on every background transition.

### Auth is functions over one state file

- **Decided:** 2026-10-21, tech lead and design.
- **What:** every check reads, parses and scans `auth.toml` (devices and the pending
  enrolment with its wrong-try counter), written atomically under the flock; consuming
  the code and adding the device is one write. The axum middleware lives in `http/`;
  `auth` exports `check(headers)`. `host_id` stays in its own file.
- **Why:** the device set is a few rows, so a check is tens of microseconds; a crash
  between the old two writes left a reusable code beside the new device, and a restart
  reset the wrong-code counter.
- **Rejected:** an `AuthService` task caching the devices behind a channel (a second
  owner of the set, and an undefined channel-full case); `devices.toml` plus
  `enroll.pending`; `host_id` inside `auth.toml` (the rewritten file could take the
  identity with it).

### Bad tokens on the WebSocket close with 4401

- **Decided:** 2026-10-21, design (auth).
- **Why:** a browser WebSocket can't see a refused upgrade's status (it reports 1006,
  like a network failure), so an HTTP 401 would leave the app retrying a dead token.

### No `Origin` check (native lane only)

- **Decided:** 2026-10-21, design.
- **What:** the native-token lane does not require an Origin check. The browser/node
  lane requires exact Origin and fetch metadata checks.
- **Why:** Origin checks protect ambient credentials from cross-site use. Native bearer
  tokens are not ambient credentials a foreign page can read; enrolled node identity is
  ambient, so browser requests require the additional checks.

### An unreadable `auth.toml` fails closed but retryable: 503 and close 4503

- **Decided:** 2026-10-22, tech lead.
- **What:** when the token check can't read or parse `auth.toml`, HTTP gets `503
  auth_unavailable` and a WebSocket upgrade completes and closes with `4503` (live
  sockets at their next re-check). The app keeps its token, doesn't mark the host "not
  enrolled", and retries with the usual backoff. The check still reads the file every
  time. The close code is 4503, in the app range beside 4401, to pair with the 503; the
  number is the design's pick.
- **Why:** a typo in a hand edit of `auth.toml` would otherwise force re-enrolling
  every device: 401 and 4401 tell the app its token is dead and it stops retrying.
  The app can't tell a broken file from a revoked device unless the daemon says so.
- **Rejected:** keeping 401 and 4401 for this case (the re-enrolment above); serving
  from the last good parse (a cache is the second owner of the device set that "Auth is
  functions over one state file" rejected, and a removed device would stay valid while
  the file is broken); failing open.

## File API

Decided 2026-10-22 by design, writing [fs.md](fs.md). The product calls behind it
are Jimmy's ([Files](#files-view-and-upload-now-three-write-operations-in-v2)).

### One resolution function that returns a checked descriptor

- **What:** `fs::open` canonicalizes with `realpath`, checks the result against the
  canonical roots component by component, opens with `O_NOFOLLOW | O_NONBLOCK`, then
  reads the descriptor's real path (`/proc/self/fd`, `F_GETPATH`) and checks it again.
  Callers get the descriptor, never a path to reopen. In-root symlinks are followed;
  `..` is resolved by `realpath`, not lexically.
- **Why:** checking the file actually opened closes the check-then-open race for one
  syscall, and v2 writes need a checked parent descriptor anyway. `O_NONBLOCK` keeps a
  FIFO in a repo from pinning a blocking thread.
- **Rejected:** canonicalize-check-open alone (racy, and a later route would be
  tempted to reopen by path); `openat2(RESOLVE_BENEATH)` (Linux only, and refuses
  absolute symlinks that stay inside the root, common in repos); `RESOLVE_IN_ROOT`
  (chroot semantics: an absolute link resolves to the wrong file); lexical `..`
  rejection (wrong after a symlink, and `realpath` already handles it).

### Roots are a scope; the `$HOME` picker shows directory names only

- **What:** the roots keep the file API inside the trees Jimmy picked; they are not an
  authorization boundary, because a device token already runs commands in tmux. The
  picker is a listing scoped to the canonical `$HOME` that returns directories only,
  with no sizes or times. Adding a root or setting `uploads_dir` from the app needs a
  directory strictly below `$HOME`; `config.toml` may name any directory.
- **Why:** stating what the roots protect against (a mis-tap, a crafted symlink, a
  viewer bug) is what makes showing names outside them safe. Confining the app below
  `$HOME` keeps it from widening the scope to `$HOME` itself (`~/.ssh`) or to `/`. A symlink outside the roots is listed with
  its target kind, size and mtime, but opening it is refused: listing reveals no
  contents.
- **Rejected:** a picker that lists files too (reveals more than choosing a directory
  needs); a picker free of `$HOME` (no use case, and `/proc` and `/etc` become
  browsable); `$HOME` as a root from the app (defeats the scope); treating roots as
  security against the token holder (they can't be).

### fs reads `roots` from `config.toml` on every request

- **What:** `roots` and `uploads_dir` are read and canonicalized per fs request, from
  the path `Config::load` resolved at startup, with its missing-file rule. A file that
  exists but can't be read or parsed fails closed as `503 config_unavailable`.
- **Why:** the same reasoning as auth's per-check read: a small file, no watcher, no
  cache to invalidate, and a hand edit applies at once. Re-canonicalizing per request
  also follows a root that is itself a symlink being repointed.
- **Rejected:** loading roots once at startup (a hand edit would need a restart, and
  the daemon's own writes would need an in-memory copy kept in sync); a cache keyed on
  the file's `stat` (an optimisation for a cost nobody has measured).

### Config writes: `toml_edit`, auth's lock, temp file and rename, re-stat before rename

- **What:** writes take the `flock` on `$XDG_STATE_HOME/muxen/lock`, `canonicalize`
  the config path to write a symlink's target, edit only `roots` or `uploads_dir` with
  `toml_edit`, write `<name>.tmp` in the same directory, re-stat the original, and
  rename (retrying up to 3 times if it changed). A file that doesn't parse is never
  written; an unwritable target is `409 config_read_only`.
- **Why:** `toml_edit` keeps Jimmy's comments and any keys a newer daemon wrote;
  following the symlink keeps a dotfiles link intact; the re-stat catches most editor
  saves that land mid-write; one lock for every muxen writer is simpler than two.
  Editors that rewrite in place can still race it in a microsecond window; accepted.
- **Rejected:** serializing `Config` with serde (drops comments and unknown keys,
  breaking "an older daemon reads a newer config"); a separate `config.lock` in
  `~/.config/muxen` (clutter in a dotfiles directory); renaming over the symlink
  (silently replaces the dotfiles link with a copy).
- **Added 2026-10-22 (tech lead, from the security review): a link to
  nothing is refused, not written through.** A `config.toml` that is a dangling
  symlink, or whose directory (or a directory above it) is one, gets `409
  config_read_only`; the link, its target and the directories on the way are left as
  they were. Before, the file case answered `200` and replaced the link with a regular
  file, and the directory case answered `500 internal`. The web's message for this
  code, "config.toml can't be written on the server", already fits, and reads are
  unchanged.
  - **Why:** a write through the link would create a file, and possibly directories,
    wherever it points (a dotfiles checkout that moved, say), from a tap on the phone.
    Refusing is the answer an unwritable target already gets, and Jimmy can fix the
    link in the terminal.
  - **Rejected:** writing through the dangling link (it creates the target and its
    directories wherever the link points: a file the user didn't make, in a tree the
    app doesn't know); renaming over the link (the rule above: it replaces the
    dotfiles link with a copy).

- **Changed 2026-11-05 (p567 review): a save no longer takes the state directory's
  lock.** `LiveConfig::save` runs under the running config's own lock, which a reload
  also takes, so saves and reloads in the daemon go one at a time; no other muxen
  writer of `config.toml` exists (no CLI or setup writer), and the runtime lock keeps a
  second daemon out.
  - **Why:** "one lock for every muxen writer" assumed a second writer that never came.
    The flock guarded nothing, cost a polling wait and a `503 busy` path, and let a slow
    `auth.toml` write make Settings answer `busy`.
  - **Rejected:** keeping it for a future CLI writer (none is planned; it would come
    back with that writer, and its reason with it).

### Paths ride in the URL path

- **What:** `/fs/list/{*path}`, `/fs/raw/{*path}`, `/fs/dirs/{*path}`, each segment
  percent-encoded. Paths on the wire are absolute UTF-8 strings. Path and query
  rejections are answered in the JSON error shape.
- **Why:** AVFoundation sees the file's extension in the URL, and a relative image in
  Markdown resolves against the document's own raw URL with plain URL resolution.
- **Rejected:** `?path=` query strings (no extension in the URL, and the Markdown
  viewer would need its own relative-path joining); root-index-plus-relative paths
  (every caller converts, and `cwd`, `dir` and upload paths are absolute already).

### Non-UTF-8 names are listed but not openable

- **What:** listed with U+FFFD and `utf8: false`, greyed in the web, refused by the
  routes because they can't be named in a UTF-8 path.
- **Why:** they don't occur in Jimmy's trees in practice; the terminal handles them.
- **Rejected:** byte-exact names in base64 on every entry and route (every client pays
  for a case that doesn't occur); hiding them (the directory would look wrong).

### Search skips hidden names, tagged caches and the server's own patterns (2026-11-05)

- **Decided:** 2026-11-05, Jimmy. Asked why `target` was skipped by a hard-coded list: "by default skip
  hidden files...? and then we have a setting for ignored patterns?"; on `target`: "but target is a common
  folder name...". He agreed to the rules below ("yeah, sure") and to the setting living in the app,
  per server ("in app... also in app should be able to modify config.toml... maybe?").
- **What:** Search skips names starting with `.` unless Show hidden files is on; directories tagged with
  a valid `CACHEDIR.TAG` (the Cache Directory Tagging spec, which cargo writes in `target/`); and
  directories matching `search_skip` in the server's `config.toml`, default `["node_modules"]`, edited in
  Settings' section for that server. Settings also edits `uploads_dir` there. The hard-coded list
  (`.git`, `node_modules`, `target`) goes.
- **Why:** no tool shares a default list (research p564): per-query walkers (ripgrep, fd, VS Code search)
  skip hidden files and honour project rules, with a switch to include the rest. `.git` is hidden, so
  the hidden rule covers it. A cache tag marks build output without guessing from a name: pop-os has 192
  under `~`, cargo's `target/` among them, while a folder merely named `target` stays searchable.
  `node_modules` writes no tag, so it is the one default pattern. A skipped folder is listed, not
  entered, so Search still finds `node_modules` or `target` themselves and a tap goes in.
- **Read once, reloaded on demand (Jimmy: "i feel like we should just, at startup, read config once, and
  then they need to 'reload it'... and then if it breaks it, it doesn't reload... this is standard...
  no?").** `config.toml` is read at startup and on a reload (SIGHUP, `systemctl --user reload muxen`, or
  Settings' Reload button); a reload that doesn't parse changes nothing and says why; Settings saves
  apply in memory at once. This supersedes "fs reads `roots` from `config.toml` on every request" (and
  its uploads re-read). Rejected: re-reading per request with a last-good fallback (a silent fallback
  hides the error, and each key would follow its own rule); re-reading per request failing closed (a
  typo stops uploads). `auth.toml` keeps its per-check read: enrolment on another device must apply at
  once.
- **Rejected:** keeping `target` by name (hides ordinary folders of that name); honouring `.gitignore`
  with the `ignore` crate (a dependency and a rule set for what two defaults and a tag cover; possible
  later); skipping nothing but hidden (results flooded by dependencies and build files, and `~`'s cap
  spent inside them); the list per device (each device would differ, and it would ride every request);
  hand edits only (Jimmy wants it in the app). The keys that apply only at a restart stay hand edits:
  shown in the app they would need a restart step, and a wrong tmux socket set from the phone would cut
  off the screen that fixes it.
- **Changed 2026-11-05 (p567 review, lead):** SIGHUP reloads only when the daemon's stdin was not a
  terminal at start. A foreground `muxen serve` in a terminal keeps SIGHUP's default: closing the
  terminal ends it, where a reload would leave it running orphaned with the runtime lock, so the next
  `muxen serve` is refused. Rejected: reloading on SIGHUP always and documenting the orphan (a surprise
  each time a terminal closes); keying on a service manager's variables (`NOTIFY_SOCKET` is systemd's
  only, and launchd sets none). Also from that review: the restart-only keys a loaded or written file
  changed stay with the running config, and every Settings answer carries them (`restartNeeded`), since
  a save can pick up a hand edit too; a reload answers the same `ServerSettings` as a save.
- **Supersedes:** "fs reads `roots` from `config.toml` on every request"; "skipped by name" in the decision below, and the deletion of the `config.toml` writer
  in "No favorites (2026-10-30)": a writer returns for `search_skip` and `uploads_dir`.

### Search walks per query and sends only the best 50 (2026-11-05)

- **Decided:** 2026-11-05, by the UX lead building Jimmy's Files Search ("search for a file (a glob? or
  something? ... fuzzy search as well?) the search could have recent"; of the options put to him he
  chose fuzzy, a glob when `*` or `?` is typed, and recents when the field is empty).
- **What:** `GET /fs/search/{*path}?q=` walks below the folder on each settled query, breadth first
  with one directory open at a time, matches as it reads, and answers the best 50 with their match
  positions. Its own slot; caps of 100,000 entries or 500 ms, and a 1 MiB queue; no symlinks, no
  other mounts; `.git`, `node_modules` and `target` skipped by name (a non-Rust folder called
  `target` is skipped too). Nothing is cached. Recents are the client's, per device.
- **Why:** measured on pop-os (warm, load about 1): `~` is 4.4 million entries, 4.7 s to walk and 59 MB
  gzipped as a path list; a large repo (ComfyUI, 67,000 entries) is 70 ms and 400 KB gzipped. A
  client-side index costs hundreds of KB to MB per folder on a spotty link and can't cover `~`; a
  per-query walk costs a bounded burst on the host (about 150 ms of a core at broad roots) and a few
  KiB on the wire, and holds no memory between requests, like listings. Breadth first means a capped
  walk has covered everything down to some depth, and needs no stack of open directories.
- **Rejected:** sending the folder's file index to the client and matching there (bytes; `~` can't fit);
  a daemon-side index kept between queries (memory held on a busy host, plus a staleness rule); host
  indexes (`git ls-files`, `plocate`, `mdfind`: each covers only some folders, and differs per host);
  sharing the scan slot (a walk would stall browsing); depth first (a descriptor and buffer per level,
  and a capped walk spends itself in whichever subtree comes first); lowering the walk thread's nice
  (an unprivileged thread can't raise it back, so lane threads would stay slow); a tree-shaped wire
  form (gzip already removes most of the repetition, and moot at 50 matches).

### Listings: one scan per page, sorted, paged by offset, nothing kept

- **What:** each page re-reads the directory with names and `d_type`, `stat`ing only
  symlinks and `DT_UNKNOWN` entries, up to 5,000 entries or 1 MiB of names; sorts
  directories first, then case-folded names; and `stat`s the 200 entries on the page.
  The scan cap counts every entry read, including filtered dotfiles. Dotfiles are
  filtered on the server unless `hidden=1`. Link targets aren't
  root-checked until opened. The `$HOME` picker is the same listing, directories only.
- **Why:** sorting needs the whole directory, and holding it between pages would be
  state for a viewer nobody may come back to. A symlinked directory must sort as a
  directory, which `d_type` alone can't tell. Filtering hidden names on the server
  keeps pages full.
- **Rejected:** a server-side cursor or cached listing (memory held between requests);
  `readdir` order without sorting (useless on a phone); a `stat` per scanned entry
  (5,000 syscalls on an overloaded disk for one page); client-side hidden filtering
  (pages with holes); an unpaged picker (up to ~1 MiB of JSON in one response).

### Content types: an extension allowlist that never sends HTML or script

- **What:** one table by extension; HTML, JavaScript, CSS and XML are served as
  `text/plain; charset=utf-8`; SVG as `image/svg+xml`; unknown as
  `application/octet-stream`. The daemon itself sets `nosniff` and `sandbox` on raw
  responses, as the scheme handler also does.
- **Why:** the native player bypasses the scheme handler, so the daemon must send the
  headers; with `nosniff`, the declared type is the only type, so an allowlist makes
  "nothing renders as a page" a property of one table. `<img>` runs no SVG script.
- **Rejected:** `mime_guess` (its broad table includes `text/html` and script types,
  and the allowlist is the point); content sniffing (reads every file's first bytes
  on a busy disk, and `nosniff` exists to stop it); serving SVG as text (the image
  viewer would need to rasterize it itself).

### Raw: single Range, strong ETag from `stat`, exact length, no `304`

- **What:** `bytes=a-b | a- | -n` gets `206`; a range list or an unparsable header gets
  the whole file; `416` past the end. ETag `"<ino>-<size>-<mtime_ns>"`, honoured by
  `If-Range`. The body is exactly the length `fstat` gave at open; a file that shrinks
  mid-stream aborts the response. A producer task feeds the body through a channel of
  one chunk, and a send that waits 30 s aborts the response. Sent pages are dropped
  with `posix_fadvise(DONTNEED)` from the response start through the latest chunk
  for files over 8 MiB.
- **Why:** the viewers and AVFoundation send single ranges only; an ETag from `stat`
  costs nothing and changes when the file does. Without the send deadline, a paused
  player holds its slot, and the daemon's shutdown, forever, because hyper stops
  polling a body whose socket is full. Without `DONTNEED`, a streamed video fills the
  unit's page cache and throttles every task in it at `MemoryHigh`.
- **Rejected:** multipart ranges (no client sends them); a content-hash ETag (reads the
  whole file); `If-None-Match` and `304` (WebKit doesn't cache custom-scheme
  responses, so nothing would send it); tower-http's `ServeFile` (plan.md keeps
  `/fs/raw` custom so the root check and the limits are muxen's).
- **Evidence:** on Linux with `MemoryHigh=48M`, dropping each 64 KiB chunk kept large
  readahead folios resident (a 1 GiB download left 44.6 MB cached); dropping from the
  response start kept streaming cache at or below 260 KB. Dropping through the end of
  the file was rejected because it evicts the readahead needed by the next chunk.

### Uploads: raw body, server-chosen UTC name, part file then no-replace rename

- **What:** `POST /fs/upload?name=…` with the bytes as the body, 128 MiB cap, one at a
  time, a 30 s idle timeout. The file is `YYYYMMDD-HHMMSSZ-xxxx.<ext>` in
  `uploads_dir`, written as a 0600 `.muxen-upload-*.part` file, flushed with
  `fdatasync` and `DONTNEED` every 2 MiB, and renamed without replacing; no final
  `fsync`. `uploads_dir` is created before the roots are read. The response is
  `201 { path, size }`. A filesystem without a no-replace rename fails the upload
  rather than falling back to a racy check-then-rename.
- **Why:** a raw body streams straight to disk with nothing to parse; taking only the
  extension from the client's name keeps paths, quotes and dotfiles out of the folder
  and out of the path typed into the terminal; the part file means an agent never sees
  a half-written photo at the final name. The periodic flush bounds the dirty pages
  charged to the unit on a disk it reaches at idle priority. UTC needs no time-zone
  crate.
- **Rejected:** multipart (a parser and a crate for one file); base64 in JSON (+33% and
  buffering); keeping the client's file name (`IMG_0001.jpg` collides and can carry
  shell metacharacters); local time (needs `chrono` or `jiff`; the `time` crate can't
  read the local offset in a multithreaded process on Linux); a final `fsync` (the
  phone still has the photo); 2+ uploads at once (native sends one at a time, and each
  costs a hyper read buffer).
- **Evidence:** dirty pages count toward the unit and cannot be reclaimed until
  written. An 8 MiB interval held up to 8.2 MB dirty in a measured 120 MiB upload;
  2 MiB bounds that allocation at the cost of more `fdatasync` waits. Rejected:
  retaining 8 MiB without counting the dirty pages in the ceiling.

### Socket buffers are bounded on the local Serve hop

- **Decided:** 2026-10-22, design.
- **What:** accepted sockets use 64 KiB `SO_SNDBUF` and `SO_RCVBUF` limits; file I/O
  uses bounded lanes and route slots ([fs.md](fs.md#limits)).
- **Why:** Linux cgroup memory accounting includes kernel socket buffers, not just
  process RSS. On the dev box, a stalled loopback reader let 4 MiB queue in one
  default sender buffer. The socket is the local hop to Tailscale Serve, so 64 KiB per
  round trip does not throttle the phone's network connection.
- **Rejected:** the kernel default buffer sizes (an unaccounted per-socket cost); larger
  raw-response buffers on the assumption that the socket reaches the phone directly.

### `dir` on `newWindow` and `newSession` is checked for shape, not roots

- **What:** the connection calls `fs::check_dir`: an absolute path of at most 4,096
  bytes with no NUL that `stat`s as a directory. It is passed to tmux as given. A
  refusal is `error { badRequest }` with a message naming the cause. This replaces the
  root check daemon-core §5.3 named.
- **Why:** the roots scope the file API; tmux already runs as Jimmy. The web's
  start-directory prompt (`askDir` in `web/app/app.ts`) offers the tab's cwd or any
  typed path, and the default config has no roots, so a root check would refuse a new
  window in `~`, `/tmp` or any repo not yet added, and a broken `config.toml` would
  block every new window. Passing the path as given keeps a symlinked `~/code` showing
  as `~/code`.
- **Rejected:** checking `dir` against the roots, as §5.3 first said (the failures
  above, for no protection tmux doesn't already bypass); restricting the prompt to
  roots (a product change Jimmy hasn't asked for); passing the canonical path (the
  shell would show the link's target).

### The scheme handler forwards methods and bodies, and answers preflights itself

- **What:** ios-shell.md's proxy forwards `GET`, `POST` (and v2's `PUT`) with their
  bodies and `Content-Type`, and answers CORS preflights for `muxen-app://ui`
  without contacting the daemon. It no longer lists `If-None-Match`.
- **Why:** the Settings routes are JSON `POST`s from `muxen-app://ui` to
  `muxen-app://h-{host}`, which need a preflight, and the daemon answers none
  ([auth.md](auth.md#carrying-the-token)).
- **Rejected:** answering `OPTIONS` in the daemon (it would open a CORS path that
  auth.md keeps shut for browsers on the tailnet).
- **Added** (from the web file-manager run): the handler also sends
  `Access-Control-Expose-Headers: Content-Range, ETag`. The CORS rules let a
  cross-origin page read only safelisted response headers, so without it the web can't
  read a file's size or ETag from a `206`. The gap can't show in dev mode, where the
  Vite proxy makes everything same-origin. Rejected: none recorded.

### `main` stops the hub explicitly at shutdown

- **Decided:** 2026-10-22, tech lead.
- **What:** once `http::serve` returns, `main` calls `HubHandle::stop`, then waits up to
  2 s for the hub task. `stop` makes the hub close its control clients as the last
  handle's drop does; the hub handle ends only after its pumps close control-client
  stdin ([daemon-core.md §4.7](daemon-core.md#47-public-interface), §7).
- **Why:** axum's graceful shutdown never force-closes a connection. A raw response whose
  reader has paused keeps its connection task, which holds a `Ctx` and so a `HubHandle`,
  past `serve`'s 2 s wait, and the hub ends only when every handle is gone. Measured: a
  SIGTERM with a paused raw stream took 4 s and exited 1 ("the hub didn't end within
  2 s"). With `stop` it takes 2.0 s, exits 0 and closes a live `tmux -C` client cleanly.
- **Rejected:** leaving it (the 4 s, exit 1 above). Nothing else is recorded.

### A save replaces the file with a temp file and a rename, under its own slot

- **Decided:** 2026-11-06, daemon lead, from review p625 (B1, B6, B7) and p630 (17); Jimmy decided the refusals.
  Spec: [fs.md](fs.md#put-fsfilepath).
- **What:** `PUT /fs/file/{*path}` resolves the file with `open(…, File)` (a link saves to its target), then
  writes through `files::Target`: one fixed `.muxen-save` temp file per folder, `fsync`, a stamp check
  against the folder entry, `renameat`. `If-Match` is required (`*` overwrites). A stale one is
  `412 changed`, unless the file already holds exactly the body: the answer was lost and this is the
  retry. A file with another hard link, owned by another user, or not writable is `403 denied` and nothing
  is written. The save has its own one-permit slot, taken before the body is read; the body read is the
  upload's idle-timed `next_chunk`. `config`'s writer and the save share `files::Target`, with the temp
  name a parameter.
- **Why:** the rename is atomic, so a reader sees the old file or the new one and a crash leaves one. The
  stamp check at the rename closes the race with a writer that gets in after the open. The refusals are
  the cases where a swap does what the user didn't ask for: the other hard link keeps the old text, the
  owner changes, the mode of a read-only file is lost. A fixed temp name means a leftover is removed by
  the next save in that folder, with no record file; `{name}.tmp` would delete a user's `notes.txt.tmp`.
  A separate slot means a minutes-long upload never makes a save `busy`; taking it before the body bounds
  the buffered 1 MiB by the slot, as the memory table counts.
- **Rejected:** the upload's `Part` (a record file, flush cycle and naming for a 128 MiB stream; its tmpfs
  refusal would stop a save in `/tmp`; and `land` never replaces). Writing in place (`pwrite`
  and `ftruncate`): it keeps the inode, hard links and owner, but a crash or a full disk mid-write leaves a
  torn file, which is worse than the refusals above. Jimmy asked and kept the rename. Opening the parent
  `Want::Dir` with a plain name, as create does: it would replace a link with a file and leave FIFOs
  unguarded.

## Completion

Decided 2026-10-22 by design, writing [complete.md](complete.md). The product calls
behind it are Jimmy's ([Shell integration](#shell-integration)); see the
[request and cwd decision](#the-request-is-before-after-cwd-and-a-chip-only-extends-what-is-typed).

### The request is `{before, after, cwd}`, and a chip only extends what is typed

- **What:** completion is `POST /complete` outside the hub. The client sends the input
  before and after the cursor as two strings,
  and `cwd` or null. Each chip carries `insert`, the literal text typed at the cursor,
  with no control characters; every source matches by prefix, so no chip deletes.
  The current prompt's OSC 7 path is preferred; a tmux window subscription supplies cwd
  without the shell snippet and in TUIs.
- **Why:** a cursor index needs a character unit both JavaScript (UTF-16) and Rust
  (UTF-8 bytes) agree on; two strings need none. Prefix-only chips make the diff
  against what's typed a plain suffix, which the client sends like typed text, and
  dropping control characters means a chip can never press Enter.
- **Rejected:** `{line, cursor}` (the unit problem); a `shell` field (the client
  can't know the shell; the daemon picks the history file); replace ranges with a
  delete count and fuzzy matches (backspaces through readline and vi modes behave
  differently, and the counts need the same unit agreement); using only OSC 7 (no cwd
  without the snippet or inside TUIs); querying completion through the hub (the hub
  would have to run the completion work).

### History: one file, parsed into a cached index, ranked by entry age

- **What:** one history file, from `[complete] history` or the most recently
  modified default (zsh, bash, fish), its format from its name; the last 1 MiB parsed
  into 10,000 distinct lines scored by `0.5^(age / 200 entries)` per occurrence, held
  in one contiguous buffer, revalidated by `(dev, ino, size, mtime)` on each request.
  Never logged.
- **Why:** a `stat` per request costs nothing, and a re-parse happens once per change;
  entry age ranks without timestamps, which bash doesn't write by default; one large
  buffer goes back to the kernel when the idle drop frees it.
- **Rejected:** reading the file on every request (a 1 MiB parse per keystroke); an
  inotify watcher (muxen has no watchers); merging every shell's file (Jimmy uses
  one shell); time-based recency (no timestamps in bash's default format); detecting
  the format from content (plain zsh and bash lines look the same, and only zsh's
  needs unmetafying).
- **Memory bound:** score at most 12,000 distinct lines, newest first, keeping 10,000;
  older occurrences contribute only to already-scored lines. A margin of 2,000 cannot
  change the kept lines: the maximum accumulated score is 289 times a line's newest
  occurrence, and `289 × 2^(-2000/200) < 1`. The unbounded map reached 17.6–18.8 MB
  peak on a 1 MiB history of short distinct lines; the capped map reached 1.5–2.0 MB.
  History chips remain unescaped shell syntax.

### The snippet appends history after each command

- **What:** `contrib/shell/muxen.bash` runs `history -a` before each prompt;
  `muxen.zsh` sets `INC_APPEND_HISTORY`. `MUXEN_NO_HISTORY_APPEND=1` opts out.
- **Why:** bash writes history only on exit, so the commands Jimmy ran in open shells,
  the ones he most likely wants again, were missing from the strip.
- **Rejected:** leaving the default (stale suggestions); reading a shell's in-memory
  history (needs a channel into every shell).

### The PATH index uses the daemon's PATH and an mtime check

- **What:** the names in `[complete] path`, else the daemon's own `PATH`, built on
  first use; each request that needs it `stat`s every `PATH` directory and rebuilds on
  any change.
- **Why:** a dozen `stat`s per request is cheaper than any watcher. The user
  manager's `PATH` holds `~/.local/bin` and `~/.cargo/bin` on the dev box but not what
  Jimmy's rc files add (nvm, bun, Go), so installing writes his interactive `PATH`
  into the key.
- **Rejected:** a watcher; the tmux global environment (`/complete` never touches
  tmux); a pane's `/proc/<pid>/environ` (the environment at exec, before the rc files
  change `PATH`).

### carapace runs in its own transient scope

- **What:** under systemd, each run is `systemd-run --user --scope --collect
  --description="muxen completion" -p MemoryMax=128M -p TasksMax=64 -p CPUWeight=20
  -p IOWeight=10 -p RuntimeMaxSec=2 -- carapace …`; outside systemd it is spawned
  directly.
- **Why:** measured on the dev box, carapace 1.8.0's RSS is 17–44 MB per run and a
  scope's peak up to 49 MB warm and 74 MB with its 95 MB binary cold in the page
  cache, while the unit's ceiling already sits at its 64 MB `MemoryMax`
  ([daemon-core.md §6](daemon-core.md#6-limits-and-the-memory-ceiling)). Scoped, the
  unit's peak rose 1.1 MB per run, for about 27 ms of scope setup inside the 300 ms
  timeout. Its threads also leave the unit's `TasksMax`. The review  found two
  things the bare command needs: the default description is the command line, so
  every run's arguments, the words Jimmy typed, reached the user journal; and a kill
  landing before `systemd-run` execs (5–20 ms after spawn) leaked an empty scope that
  stayed active, which `RuntimeMaxSec=2` reaps and which also bounds helpers that
  outlive a crashed muxen.
- **Rejected:** running it in the unit (it alone can exceed `MemoryMax`); raising
  `MemoryMax` (the limit protects the overloaded box, and a 74 MB peak would need it
  doubled); a sub-cgroup with `Delegate=yes` (muxen would manage cgroups itself);
  a long-lived carapace process (carapace has no server mode, and one would hold its
  20–40 MB while idle).

### carapace is installed by hand: pinned, checked against checksums, in `~/.local/bin`

- **Decided:** 2026-10-22, design. Evidence: [running.md](../running.md#set-up-completion).
- **What:** as Jimmy, never system-wide: carapace-bin v1.8.0's `linux_amd64` tarball,
  checked against the release's `checksums.txt`, with `carapace` in `~/.local/bin`.
  `[complete] carapace` names another binary; otherwise it is `carapace` on the
  `[complete] path` (config keys `history`, `path` and `carapace`,
  [plan.md](plan.md#config)). An upgrade is a deliberate re-pin: the parser's golden
  fixtures run against the new binary first.
- **Why:** carapace's JSON has no stability promise, so the pin and the fixtures are the
  guard against a changed shape. The unit's `PATH` holds `~/.local/bin`, and the checksum
  step costs nothing next to running a downloaded binary as Jimmy.
- **Rejected:** none recorded.

### carapace: run per stem, latest wins, 30-second cache

- **What:** carapace gets the current word cut back to its **stem** (through its last
  `/ = : , @ +`, else `-` for a flag, else empty) and muxen filters its values by the
  whole word; the key is `(cwd, cmd, args before the current word, stem)`. Only
  commands in `carapace --list` are run. One runner task owns the child: one run at a
  time, a request for another key kills the run in flight, one for the same key
  waits, and an aborted request kills nothing. Results, timeouts and failures
  included, are cached 30 s in a 64-entry, 1 MiB LRU.
- **Why:** one run serves every keystroke until the stem changes. An empty current
  word, as first written, returns no flags (`git checkout ""` gives refs only; `-`
  gives the 40 flags), nothing after a `/` (`origin/m`) and no multi-part values
  (`chmod u+`); the review  measured all three. Latest-wins matches typing,
  where the older answer is already stale; a runner that owns the child keeps the
  phone's aborts from killing every run. The TTL lets new git branches appear and
  stops a command that always times out from costing 300 ms per keystroke.
- **Rejected:** an always-empty current word (above); passing the whole word and
  keying on it (a run per keystroke); queueing runs (a stale run delays the fresh one
  by up to 300 ms); runs owned by their request (aborts kill them, so fast typing
  never gets chips); an LRU with no expiry (branches go stale); trying every command
  (a scope and a process for every unknown command); routing every word with a `/` to
  paths (`git checkout origin/m` needs carapace).
- **Cached requests:** a cache hit kills no run for another key: no new run is needed,
  so cancelling one would discard useful work.

### The unit pins glibc's mmap threshold

- **Decided:** 2026-10-22, design.
- **What:** the systemd unit sets `GLIBC_TUNABLES=glibc.malloc.mmap_threshold=131072`.
  It applies to the glibc binary, not static musl release binaries.
- **Why:** glibc raises its dynamic mmap threshold after a large free, so later
  completion indexes can remain resident in the heap after the idle drop. A probe on
  the dev box's glibc showed the second 1.1 MiB block from the heap without the tunable
  and every block mmapped with it.
- **Rejected:** `malloc_trim` or `mallopt`, which require an unsafe FFI call.

### Path chips list names in any readable directory

- **What:** path completion opens the directory with `fs::open` and scope `/`, and
  returns names only.
- **Why:** the roots keep file contents and viewer bugs inside the trees Jimmy
  picked; completion reads no contents, and the shell's own Tab already lists any
  directory. Scoping it would break completion in the common places.
- **Rejected:** the effective roots (no completion in `~`, `/tmp` or a repo not yet
  added; the default config has no roots); `$HOME` plus the roots (still none in
  `/tmp` or `/etc`, for no protection, since only names are returned).

### Completion state is dropped after 5 idle minutes

- **What:** one timer, re-armed by each request, frees every index and cache 5 minutes
  after the last request.
- **Why:** the idle budget is ~5 MB with no phone connected, and completion can hold
  ~11 MB; one wakeup per idle period keeps the box quiet.
- **Rejected:** keeping the indexes for the process's life (breaks the idle budget);
  dropping when the last WebSocket closes (`complete` doesn't see the hub's
  connections, by design).

### The snippet: OSC 133 from prompt hooks and `PS1`, plus OSC 7

- **What:** D, A and OSC 7 from the first prompt hook; B appended to `PS1` by the last
  hook, re-added each prompt; C from `PS0` (bash) or `preexec` (zsh); raw OSC with
  BEL. The client prefers the OSC 7 path of the current prompt over `watching`'s cwd.
- **Why:** prompt hooks see `$?` before anything else changes it; prompt themes
  rebuild `PS1` in their own hooks, so B must be re-added after them; `PS0` gives bash
  a pre-exec point with no `DEBUG` trap. OSC 7 at the prompt is current at once, where
  tmux's subscription lags a `cd` by up to a second; tmux's cwd stays the fallback,
  so completion still works without the snippet.
- **Rejected:** a `DEBUG`-trap preexec (bash-preexec: heavier, and it competes with
  other traps); wrapping the marks in tmux's DCS passthrough (not needed: control mode
  sees them raw); OSC 7 as the only cwd source (already rejected above: no cwd without
  the snippet or inside TUIs).
- **The bash wrapper** makes an existing `PROMPT_COMMAND` an array on bash 5.1+ and
  joins it with newlines before that: joined with `;`, one ending in `&` broke every
  prompt and one ending in a comment swallowed the B hook.

### Chips are escaped literals, with `~` and `=` escaped everywhere

- **Decided:** 2026-10-22, tech lead.
- **What:**
  - One encoder, `context::literal`, writes every command, path and carapace `insert`;
    `chip()` applies it, so no source can skip it. It backslash-escapes every ASCII
    character outside `[A-Za-z0-9._+,:@%/-]`; non-ASCII characters stay as they are.
    `~` and `=` are escaped wherever they sit in the name.
  - History chips are the line as written, unescaped: they are shell syntax Jimmy
    typed.
  - The lexer reads a leading `~` that was escaped or quoted as `./~`: `\~x` and
    `'~'/s` mean the files `./~x` and `./~/s`, not a home directory.
- **Why:** the first build escaped only paths, and left `~` and `=` out of the set. The
  review ran what a chip typed:
  - **Commands:** an executable named `p65x;printf P65_INJECTED` was completed
    unescaped, and running the line printed `P65_INJECTED`: the `;` ended the command.
    Command names need the same escaping as file names.
  - **`~` and `=`:** bash expands `~` after `=` or `:` in an argument too (`echo
    a=~root` printed `a=/root` on bash 5.2); zsh expands a leading `=cmd`, and with
    `MAGIC_EQUAL_SUBST` a `~` or `=` after `=` or `:`; bash's own Tab escapes both. A
    file named `~root`, `a=~root` or `=ls` completed bare ran as something else. The
    `bash -c` read-back test checks 24 hostile names through command, path and carapace
    chips and fails if `~` or `=` rejoin the safe set.
  - **The lexer rule:** without it, a line holding `\~x` was read back as the home
    directory `~x`, and the next request listed `$HOME` instead of the directory it
    meant.
  - **History:** a history line is shell syntax Jimmy typed, with its own quoting and
    operators, so it goes in as written; escaping it would change the command he ran.
- **Cost:** names like `foo~` show as `foo\~` on the line. zsh is covered by its
  documented rules, not by a run: the dev box has no zsh
  ([complete.md](complete.md#open-risks)).
- **Rejected:** `~` and `=` in the unescaped set, as the first build had them (a name
  starting with one was expanded by the shell, and so was one after `=` or `:`);
  leaving commands unescaped (the `;` above); escaping history lines (shell syntax, as
  above). Other encodings: none recorded.

## Batched pipe reads for control clients

- **Decided:** 2026-10-22, tech lead.
- **What:** the pump reads a control client's stdout through tokio's pipe `Receiver`,
  registered with epoll only while waiting on a quiet pipe. While output is sustained
  it leaves epoll (`into_nonblocking_fd`) and reads at most 4 turns per 2 ms, each
  turn draining the pipe in 16 KiB reads. The first read after a quiet spell is
  immediate. Default 64 KiB pipe; no extra thread; no `unsafe`.
- **Why:** tmux writes one short `%output` line per write, and the old pump woke once
  per write: a numbered-line flood cost 44.8% of a core. Batched: 2.0%, with idle
  echo unchanged (p50 0.17 ms), idle CPU zero, throughput and tmux's own cost
  unchanged, and echo during a flood up to ~3 ms later (p99 3.3 ms).
- **Rejected:** a gate that stays registered with epoll (35%: every write still wakes
  the runtime); a blocking reader thread per client (same CPU, 3 more threads against
  `TasksMax`); `AsyncFd` (its safe constructors are deprecated as unsound in tokio
  1.54, the replacements are `unsafe`); one read per interval (adds the full interval
  to every keystroke, because the reply and the echo are separate writes); a 5 ms+
  gate (needs a 1 MiB pipe or caps throughput at 15 MB/s).

## Never send `respawn-pane` over control mode

- **Decided:** 2026-10-22, tech lead.
- **What:** muxen never sends `respawn-pane` on a control client.
- **Why:** with a control client attached and the pane flooding, `respawn-pane -k`
  sent over control mode kills the whole tmux server (4 of 4 runs), taking every
  session with it. The one-shot form, `kill-pane` and `kill-window` did not crash.

## Blocking lanes

- **Decided:** 2026-10-22, tech lead.
- **What:** the Tokio blocking pool has 8 threads split into four lanes: fs 4 (10 s
  wait, 8 waiting callers shared across fs slots and blocking calls), index 1 (300 ms),
  dir 1 (300 ms), auth 2 (10 s, no waiter cap). Every blocking call uses its lane;
  Tokio's `fs` feature is disabled. `PermitPool` owns route slots, the shared waiter
  budget and an optional deadline; fs scan/raw pools share the fs lane queue, and the
  shell owns named 4-slot/16-waiter limits with no queue deadline. A lane permit stays
  with its blocking closure until work ends. A panic returns `busy`.
- **Why:** a hung filesystem mount must not consume threads used for authentication. Auth waiters are
  uncapped because device checks arrive in bursts, such as a thumbnail grid. Directory
  checks share one lane because paths supplied by users may name hung mounts;
  fs slot waiters count against the same bounded queue as fs blocking work.
- **Rejected:** one shared pool, which lets hung filesystem work starve auth; a separate
  `newWindow` lane, which would add another pool share for the same directory checks;
  duplicating the slots-plus-waiters rule with route-specific semaphore pairs; listing
  individual `tokio::fs` APIs as forbidden, instead of disabling the feature.

## Shared HTTP error contract

- **Decided:** 2026-10-22, tech lead.
- **What:** every route refusal uses `proto::HttpError` and the JSON body
  `ErrorBody { error: HttpError, reason?, node? }`. Browser admission adds
  `bad_origin`, `node_refused`, `not_enrolled` and `identity_unavailable` to that
  shared type. `http::Refusal` maps the code to one status table;
  it preserves axum's 400/415/422 JSON-rejection status, maps oversized bodies to 413
  `too_large`, adds `Retry-After: 1` to `busy` and `Content-Range` to `bad_range`, and
  maps auth failures to HTTP errors; WebSocket auth failures have their own close-code
  mapping.
- **Why:** route handlers share one wire contract, status mapping and auth mapping.
- **Rejected:** separate refusal builders and duplicated HTTP/WebSocket auth-code maps;
  treating an oversized enrolment body as generic `bad_request`.

## Shared file primitives

- **Decided:** 2026-10-22, tech lead.
- **What:** `files::Stamp`, `Dir`, `Temp`, the state-directory lock and TOML error-line
  extraction serve auth, config writes, uploads, history, PATH and file listings. `Temp`
  has no `Drop` cleanup; callers clean up explicitly on a blocking lane, and the upload
  part-file startup sweep removes leftovers.
- **Why:** cleanup can block on a hung mount. A lane may refuse work and drop its
  closure on the runtime thread, so `Drop` must not unlink a temp file there.
- **Rejected:** unlinking from `Drop`, which can block the runtime thread; keeping stamp,
  lock and temp-write implementations duplicated in `fs` and `auth`.

## Browser/mobile client direction and portable design record

- **Decided:** 2026-10-22, Jimmy.
- **What:** desktop browser, mobile browser/PWA and native iPhone are supported clients.
  Their shared [client contract, mockup and research](client/README.md) live in the
  repository so each platform can build from the same record.
- **Why:** a Mac session must be able to build the iPhone client without private work
  artifacts or conversation history; ordinary browsers are first-class clients, not
  terminal test harnesses.
- **Rejected:** native-only access. Detailed alternatives are in
  [decision reconciliation](client/browser-review-decisions.md).

## Installable phone browser

- **Decided:** 2026-10-22, Jimmy.
- **What:** the phone browser client must be installable as a PWA, sharing the browser UI.
  Native iPhone remains a separate platform shell.
- **Why:** Home Screen launch should be available without installing the native app.
- **Rejected:** treating PWA as an optional future feature or a separate terminal client.
- **Research, not final security spec:** [browser setup](client/browser-setup.md) recommends
  same-origin tailnet hosting, reviewed browser credentials, offline shell/drafts and
  controlled updates. No offline command replay; production auth and device gates stay open.

## Tailscale first, public HTTPS follow-up

- **Decided:** 2026-10-22, Jimmy: Tailscale first, probably public HTTPS afterward
  to connect to multiple machines even outside the tailnet.
- **What:** [connection roadmap](client/connection-roadmap.md) records the intended
  sequence, saved-server name/URL/status, native server selection, and initial
  per-server browser/PWA URLs. Unified cross-origin browser switching is separate.
- **Why:** deliver the minimal private client first without tying the terminal UI
  to one network or one machine permanently.
- **Alternatives:** SSH-key access was discussed but is not the selected next phase.
  Password login and passkeys are not implemented or approved auth contracts.
- **Unresolved:** first-phase identity-only versus additional app authentication;
  public authentication and unlocked-device protections; reachable TLS endpoints
  versus a future tunnel/relay; unified browser cross-origin behavior.
- **Safety boundary:** existing tailnet-only, no-Funnel and device-token rules remain
  current until reviewed replacements are specified. No public exposure is authorized
  by this roadmap, and no network/service configuration changes accompany it.

## Browser authentication: enrolled tailnet nodes

- **Decided:** 2026-10-23, tech lead (Jimmy delegated first-phase auth).
- **What:** A browser/PWA presents no credential; it is admitted as an enrolled
  Tailscale node. The daemon listens on `serve.sock` and `local.sock` in a private
  `0700` runtime directory. Only `serve.sock` can admit nodes, and only when the
  canonical-origin check finds that socket exactly once in the Serve configuration,
  as the sole `/` handler of one HTTPS entry with Funnel off. The daemon checks the
  exact forwarded host, browser Origin and fetch metadata, resolves the forwarded
  address with LocalAPI whois on each node-lane request, refuses tagged, shared,
  subnet-routing and self nodes, then matches stable ID and owner login against a
  `node` row in `auth.toml`. The iOS app's device-token lane remains unchanged.
  Both kinds share `muxen enroll`'s one-time code and `muxen device remove`; live
  node sockets re-check the device, node and origin every 10 seconds.
- **Why:** a cookie can be replayed by any HTTPS service on the same hostname and
  node-wide Tailscale access alone cannot be revoked per device. Serve's identity
  headers are trusted only on the socket tailscaled's HTTP proxy reaches, and the
  canonical-origin rule closes the raw TCP-forward and same-origin co-resident-app
  paths.
- **Costs:** an enrolled node is trusted whole, including every browser, app and OS
  account on it. The operator remains trusted and can replace the publication; Linux
  setup publishes through LocalAPI after the operator grant.
- **Rejected:**
  - A replayable browser cookie: any HTTPS service on the same hostname could replay it.
  - A token in browser storage: injected script could read it, and media requests cannot
    attach an authorization header.
  - Tailscale identity without enrolment: no per-device revocation.
  - A loopback TCP peer check or `sock_diag` UID lookup: local users can forge forwarded
    headers or still fill permits; UID lookup has no macOS counterpart.
  - Choosing the auth lane by peer UID, or requiring the Tailscale UID on the socket:
    a Serve TCP forward also arrives from tailscaled with client-controlled headers.
  - A Tailscale app capability or grant as the device list: node-wide, so every Unix
    user's daemon would share one list, and changing it needs the admin console.
  - Caching whois by address: an address can move to another node.
  - Requiring Tailscale 1.100: the root requirement for later Serve changes does not
    protect against the trusted operator replacing the publication.
  - A configurable `browser_origin`: one unsafe Serve publication should refuse
    admission, not choose between several.
  - Reading security state at startup or shell boot: it misses changes while the
    daemon runs.
  - Shelling out to `tailscale serve status --json`: LocalAPI provides the same Serve
    configuration without a subprocess.
  - Closing a live socket on its first failed whois re-check: a slow LocalAPI would
    drop every connection; removal itself is checked without whois.
  - Ignoring unknown device-row fields: a future scoped or expiring row could be read
    as a full-power device by an older daemon.
  - Public HTTPS or passkeys in this change: they need a separate future lane and
    security design.

### Tailnet-state retries back off from 2 s to 30 s

- **Decided:** 2026-10-23, tech lead.
- **What:** after a failed LocalAPI fill, retry in the background after 2 s and double
  the delay on repeated failures, capped at 30 s. A healthy cell is refreshed by the
  first request after its 10 s freshness period; only a failed read enables the
  30-second stale-value hold. An empty or expired cell with no failed read starts or
  joins a fill and waits.
- **Why:** repeated LocalAPI failures should not make the daemon hammer tailscaled on
  a busy host.
- **Side effect:** after a held value expires, requests fail closed with
  `503 identity_unavailable`; when tailscaled recovers, detection can lag by up to
  30 s until the scheduled retry succeeds.
- **Rejected:** retrying at a fixed 2 s forever, which imposes needless LocalAPI load
  throughout a long outage.

## Resource limits

### One memory budget sizes daemon caps, checked against the unit

- **Decided:** 2026-10-23, Jimmy (hard CPU cap, one memory setting in `config.toml`,
  OOM never the result, tuning documented in running.md; default 72 keeps 3 tmux
  sessions at once), design (the tier table, startup-only selection and refusal paths).
- **What:** `memory_budget_mib` (default 72, minimum 42) sets the counts at startup.
  The daemon uses the lower of that and the cgroup v2 `memory.max`, floored to MiB.
  The round tier boundaries stay 72, 64, 58, 53 and 42; the tier selects three caps:
  control clients, sockets and completion on/off. The default gives 3 clients, 3 sockets
  and completion; the current in-scope unreclaimable ceiling is 62.4 MiB. The browser-
  auth whois and shell rows (1.2 MiB) are not part of this resource-limit change. Linux
  uploads to tmpfs or ramfs are refused as `409 memory_backed`. The 64-permit HTTP
  accept loop shares 64 permits across `serve.sock` and `local.sock`, with 16 KiB hyper
  buffers and the 128 connection backlog. Completion-off is
  `welcome.daemon.completion: false`; a stray
  `/complete` gets `200 {"chips":[]}` without constructing completion. The control
  client cap ends a watch with `reason: "limit"`; its message names the holding tmux
  session IDs. Every `ConfigError` and a budget below 42 exits 78. The systemd unit has
  `MemoryMax=72M`, no `MemoryHigh`, `CPUQuota=50%`, `CPUQuotaPeriodSec=10ms` and
  `RestartPreventExitStatus=78`. Read the cgroup and select caps at startup only. On
  macOS, where there is no cgroup, the budget only sizes counts.
- **Why:** the shared dev box is overloaded, and one setting is all a user should have
  to choose; muxen knows its own costs. Reading the unit's cgroup makes a lower
  `MemoryMax` safe after a restart, so the config and unit cannot drift into an OOM kill.
  Tiers keep each configuration measurable; scaling only session, socket and completion
  counts makes refusals explainable. The default preserves three sessions because the
  unit bounds muxen, not tmux and its processes. A memory-backed upload could leave
  unreclaimable shmem after the request, outside the ceiling. The HTTP accept bound is
  required because otherwise unupgraded connections and hyper buffers are unbounded.
  `MemoryHigh` below the unreclaimable ceiling stalls allocations instead
  of making the budget safe. A 10 ms quota period bounds a throttled keystroke by one
  period.
- **Rejected:** documentation only (one missed edit and caps outgrow `MemoryMax`); using
  only the unit limit (no budget in development); a computed solver over every cap
  (unmeasured combinations); budgets above 72 raising caps; starting below 42 (caps
  would reach OOM); `MemoryHigh` at three quarters or budget minus 4 MiB (stall cliff or
  second number to keep aligned); halving capture, paste, raw and completion limits
  (more budget-dependent caps and ranking changes); completion before the third socket
  (no strip at 46–57); live resizing (policy for caps already in use); HTTP
  `503 limit` for completion off (fixed startup state needs no client suppression); a
  browser-auth Unix socket, peer class, whois rows and shell server in this change
  (they depend on browser auth); a user-visible session display name (the hub stores
  tmux session IDs, not display names, and a separate one-shot just to name a refusal
  adds work to a capped path).

### The unit caps CPU at half a core, metered every 10 ms

- **Decided:** 2026-10-23, Jimmy (hard cap), design (the value).
- **What:** `CPUQuota=50%`, `CPUQuotaPeriodSec=10ms`, beside existing `CPUWeight=20`
  and `Nice=10`.
- **Why:** `CPUWeight` and `Nice` yield under contention but cap nothing. Sustained load
  is small (an output flood measured 2% of a core for the daemon process), so half a
  core binds on bursts. The quota is per cgroup and spent across CPUs; when several
  threads drain it at once, the unit waits out the rest of the period. A throttled
  keystroke therefore waits at most one period, 10 ms.
- **Rejected:** 100% (doesn't bound the blocking pool and tmux clients either); 25%
  (bursts take 4× longer for a saving that matters with several users, who can tune it);
  a 20 ms or default 100 ms period (a throttled keystroke can wait past one 60 Hz frame).

## History range labels and soft-wrap restoration

- **Decided:** 2026-10-23, tech lead.
- **What:** Bracket each history capture group with `#{history_size} #{pane_height}`;
  replay tmux's range clamp in the tmux core, label returned rows from the true clamped
  start, and return empty above retained history. The before/after pair is the history
  tear check. On every supported tmux version, pair `-N -T` physical rows with `-J`
  joined rows in the same command group; set only unambiguous wrap bits. Snapshot wrap
  data stays in daemon restore composition, for the active grid only; replay a mapped
  continuation by enabling xterm autowrap for its first character. History sends a
  packed wrap bitmap with each chunk, counted before rows in the fit limit, and the
  client joins wrapped history rows for copy.
- **Why:** tmux clamps out-of-range history requests, so requested offsets are not the
  row labels and a range above history otherwise repeats the top row forever. Paired
  captures avoid a version branch or reliance on newer `-F`; ordinary xterm input is
  enough to recover `isWrapped` without changing the snapshot wire format. History is
  independently rendered in the DOM, so it needs its own row metadata.
- **Rejected:** guessing from row fullness; using `-J` as the history payload, which
  loses physical row offsets and trailing-cell behavior; parsing the private `-R` dump;
  `-F`, which is unavailable on the minimum supported tmux; putting a wrap map on the
  snapshot frame or in the terminal pipeline; mapping the saved primary screen after
  an alternate-screen resize, where its old width is unavailable; leaving xterm wrap
  enabled for a whole row, which can scroll when cell widths drift.

## Browser theme tokens set the minimum browser floor

- **Decided:** 2026-10-23, tech lead.
- **What:** semantic colour tokens use one `light-dark()` value with dark and light
  colours; `color-scheme` selects the value, and the platform's `data-scheme` on
  `<html>` overrides the system preference. The supported floor is Safari/iOS 17.5,
  Chrome 123 and Firefox 120. The browser minimums in [auth.md](auth.md) reflect this
  floor as well as the required `Sec-Fetch-Site` request metadata.
  The iOS app's deployment target (`ios/project.yml`) follows it, so `AbortSignal.any` needs no fallback.
- **Why:** the only target device runs current iOS, and one token block avoids a flash
  while the scheme is applied.
- **Rejected:** separate dark and light scheme blocks, which would preserve Safari/iOS
  16.4 but double the token file and need careful handling to prevent flashes.

## Pre-push preflight checks pushed tips

- **Decided:** 2026-10-23, tech lead.
- **What:** the pre-push hook runs the full preflight on each pushed branch tip only.
  The lead separately preflights each commit on a clean export before pushing.
- **Why:** this keeps the hook's guarantee tied to the code that would land while
  preserving a check of every coherent commit in the initial-build workflow.
- **Rejected:** running a full release build for every commit in the push range inside
  the hook, which repeats the expensive gate for every commit on every push.

## Reduced motion shortens duration tokens

- **Decided:** 2026-10-23, tech lead.
- **What:** `prefers-reduced-motion` shortens the duration tokens; there is no global
  transition override.
- **Why:** the global override also animated scheme changes and made the accessibility
  contrast gate flaky.
- **Rejected:** a blanket reduced-motion rule forcing every transition to 1 ms.

## Terminal and desktop input details

- **Decided:** 2026-10-23, tech lead.
- **What:** the terminal renderer and tab drivers live outside the screen component.
  Keystrokes batch for 8 ms into one `input` message. The first watch waits for fonts
  and a measured stable box; keyboard geometry never determines tmux's size. A paste
  is one `paste` message and is refused over 256 KiB. Other requests wait up to 5 s
  for a socket, then 30 s for a reply; they are not automatically re-sent.
- **Why:** a short deadline after sending can report a create as failed while the daemon
  is still performing it, inviting a duplicate on retry. A dead socket is detected
  separately. Unmounting a screen must not lose the terminal buffer or watch. A burst of
  individual inputs could receive a daemon `busy` that named no request, dropping
  characters in WebKit. Measuring the stable box avoids an initial 80×24 resize and
  keeps a keyboard-shortened native view from resizing tmux.
- **Rejected:** a component owning the renderer; one message per keystroke; a longer
  batch window that adds echo latency without a need; one request timeout that either
  abandons a slow sent request early or waits too long for a dead socket; sizing tmux
  from the keyboard-shortened view.

## Files details

- **Decided:** 2026-10-23, tech lead.
- **What:** a completed upload offers Preview and an insert-path action instead of
  navigating away from the folder. The browser can choose several files, uploads one
  at a time and uses `XMLHttpRequest` for progress.
- **Why:** jumping to a preview would pull the user out of the folder. Safari `fetch`
  has no upload-progress reporting.
- **Rejected:** automatically opening a preview on upload completion; limiting the
  file picker to a single upload.

## The PWA is built by the Vite plugin

- **Decided:** 2026-10-23, tech lead.
- **What:** the service worker is built by the plugin's `closeBundle` with a nested
  `vite build`. The cache name is `muxen-shell-<12 hex of sha256 over every precached
  file's path and bytes>`, which also makes `sw.js` byte-different per build, so the
  browser's own update check needs no version endpoint. The build fails if `dist/` holds
  a file the daemon does not route (`SERVED` in `sw/vite-plugin.ts` mirrors `routes()` in
  `src/http/shell.rs`). `updates.apply()` checks for a new worker first and reloads when
  there is none, so the protocol-mismatch screen's Update button needs no extra wiring. A
  cache miss for a shell path falls back to the network. The worker looks in its own
  cache first, then in every `muxen-shell-*`. A failed install deletes its half-filled
  cache. `createPwa(emit)` repeats the current state on every `check()`. A third update
  state, `reload`, means another page applied an update while this one keeps the previous
  build; its banner reads "Reload to finish updating" and is separate from the schema
  upgrade banner. `install.installed()` is display-mode standalone or iOS
  `navigator.standalone`. The icon is a blue `>_` prompt on the dark surface; its hex
  colours copy the tokens because a manifest cannot read a CSS token.
- **Why:** the worker needs the finished file list and its hash, which exist only after
  the main bundle and `public/` are written; a precached path the daemon 404s would fail
  every install; the schema banner's copy says changes are kept in memory, which is false
  after a plain worker takeover. A 404 for an uncached asset left a blank page when
  `/` survived but one of its assets had been evicted.
- **Rejected:** a second Rollup input (the list is not known yet); a post-build script
  (preflight needs a second step to remember); the Vite manifest hash for the cache name,
  which ignores an icon or manifest change; a
  `clients.claim`; reusing the schema banner for `reload`.

## One real-daemon e2e stack

- **Decided:** 2026-10-23, tech lead.
- **What:** the real-daemon specs (`e2e/*/*.real.ts`) share `e2e/shared/stack.ts`: an
  isolated daemon with `--allow-login e2e`, a private tmux, Vite's dev server with the dev
  proxy, and a front proxy that stands in for Tailscale Serve and answers `/auth/info`
  itself. They are opt-in: `pnpm e2e:real` needs the local tmux builds. The dev proxy's `/auth/info` request carries the token and the
  caller's `Tailscale-User-Login`, which the daemon's Tailscale check requires.
- **Why:** a browser cannot add `Tailscale-User-Login` to a WebSocket upgrade, so
  something must stand in for Serve, and one stack serves every lane.
- **Rejected:** a `MUXEN_LOCALAPI_SOCKET` override in the daemon with a fake LocalAPI
  (a test hook in the production identity path); a patched daemon copy; a separate
  stack per lane; running the real specs in a default test run (they fail on a
  machine without the tmux builds); a shared `test-results/` that one run empties under
  another.

## Drafts of closed tabs are kept

- **Decided:** 2026-10-23, Jimmy.
- **What:** closing a tab keeps its unsent local draft. The draft comes back when that
  session is opened again, on the same device. At most 32 drafts are kept; the oldest
  goes first.
- **Why:** closing a tab is often a tidy-up, not a decision to throw away text; losing
  a half-written prompt costs more than a bounded record in local storage.
- **Rejected:** deleting the draft with its tab, which is simpler but loses text.

## Terminals owns the tab drivers and which tab is shown

- **Decided:** 2026-10-23, tech lead.
- **What:** `Terminals` owns tab drivers and derives which tab is shown from workspace
  state. One insertion eligibility rule serves both Files and image paste: connecting
  and live tabs accept a path; reconnecting, limited and closed tabs refuse it.
- **Why:** keeping a controller registry and a second shown-tab state alongside the
  terminal drivers made their lifecycles drift. Two insert checks also disagreed about
  whether a connecting tab could receive a path.
- **Rejected:** a second controller registry or port for drivers; separately deriving
  shown state in the reducer and the terminal owner.

## Ctrl+Shift+F leaves the terminal

- **Decided:** 2026-10-23, Jimmy; the key chosen by the tech lead.
- **What:** a keyboard user leaves a focused terminal with Ctrl+Shift+F, which moves focus
  to the active tab's button in the tab strip. The keymap handles it before any key is sent
  (`decideKey` returns `leave`); Settings and browser-behaviors.md name it.
- **Why this chord:** a terminal cannot encode Ctrl+Shift+letter apart from Ctrl+letter, so
  shells lose nothing. First-hand checks: [Chrome's keyboard shortcuts](https://support.google.com/chrome/answer/157179)
  for Windows, Linux and macOS; Firefox's [`browser-sets.inc.xhtml`](https://github.com/mozilla-firefox/firefox/blob/main/browser/base/content/browser-sets.inc.xhtml)
  and [`DevToolsStartup.sys.mjs`](https://github.com/mozilla-firefox/firefox/blob/main/devtools/startup/DevToolsStartup.sys.mjs);
  and [Safari's keyboard shortcuts](https://support.apple.com/guide/safari/keyboard-and-other-shortcuts-cpsh003/mac).
  None defines Ctrl+Shift+F; Firefox's only Shift+F full-screen binding is Cmd+Shift+F in
  its macOS-only keyset. Windows' Microsoft Pinyin IME uses Ctrl+Shift+F while active to
  switch Simplified/Traditional Chinese, rebindable in IME settings ([Huawei support](https://consumer.huawei.com/en/support/content/en-us00689079),
  [Microsoft Q&A](https://learn.microsoft.com/en-us/answers/a/12306063)); that is an OS/IME
  shortcut, not a browser shortcut. Ctrl+Shift+C and V are copy and paste.
- **Rejected:** Ctrl+Shift+L (Edge's paste and go), Ctrl+Shift+U and E (GTK's Unicode and
  emoji input on Linux), Ctrl+Shift+Y (Firefox downloads), Escape (a shell and vim need it).

## Phone input and keyboard

Jimmy made the phone-input calls after using the native keyboard on his iPhone;
design and the tech lead settled the structure around them.

### The app handoff prefills the form and waits

- **Decided:** 2026-10-26, Jimmy, after using the flow.
- **What:** `muxen://add?host=<origin>&code=<code>` opens Add server at step 1 with
  the HTTPS host and optional code filled in. It sends no request until the user taps
  Next and then Add. With a code, the app enrolls the node through `POST /auth/node/enroll {code}` and
  then mints its token with an empty code. Without a code it uses the already-enrolled
  node-mint path through `POST /auth/node/enroll` with `Origin` only.
  Wrong or expired codes and `not_enrolled` remain visible on the device-name step.
  Manual Add is two steps: server and optional code, then device name. Eight native
  code fields advance as the user types, handle whole-code paste and empty-cell
  Backspace; Back preserves both steps and the default name is `UIDevice.current.name`.
- **Why:** the link must prepare the form, not make an enrolment decision or send a
  credential before Jimmy confirms it. Sharing the manual Add path also keeps both
  enrolment lanes behind the same explicit Next and Add taps. Separating the device
  name makes each step about one task; native code fields provide native tap targets
  without synthesizing a cursor over a drawn overlay.
- **Rejected:** automatically minting or enrolling when the deep link opens; the app
  would submit before Jimmy reaches the form and the link would not wait for confirmation;
  a single text field with a drawn code-cell overlay, which needs custom tap-to-cursor
  mapping and selection state.

### A setup link belongs to the app, so Safari never enrols

- **Decided:** 2026-10-26, Jimmy, on the phone: "when u open in browser, try to open
  muxen first", "with that code", "so we don't login via safari".
- **What:** a page that arrives with a `#code=` fires
  `muxen://add?host=<origin>&code=<code>` as soon as it knows the host's origin, on a
  platform where the app can exist and never inside the native shell. Safari shows the
  page only long enough to hand over; the prefilled screen and its "Open in the muxen
  app" action remain the fallback when nothing handles the scheme. The app's Add with a
  code posts `POST /auth/node/enroll {code}` — which enrols the phone's **node** — then
  mints its own token with an empty code. One code therefore admits the phone: Safari
  and the PWA on it need none, and the app has its token.
- **Why:** Jimmy does not want to enrol the browser. Making the app spend the code
  removes the Safari login entirely while keeping the design's one-code-per-phone
  property, because the code is redeemed on the node rather than on a device. The
  app needs its own token because its web socket origin is `muxen-app://ui`, which
  the node lane refuses. An empty-code mint replaces that node's earlier app token;
  removing the node revokes its bound token. Browser fetch metadata is refused for
  minting, so a page cannot obtain a portable credential.
- **Rejected:**
  - Universal Links: Apple's CDN cannot fetch an association file from a tailnet-only
    host, and a wildcard development profile cannot carry associated domains without
    an explicit App ID.
  - Allowlisting `muxen-app://ui` for the node lane: it widens the auth surface and
    the app still needs a token for its lock and uploads.
  - The browser enrols the node and the app only mints (the previous shape). It works,
    but it requires completing an enrolment in Safari first, which is the thing he does
    not want.
  - The app keeps posting `POST /auth/enroll`: it mints a device token and leaves the
    phone's node unenrolled, so Safari on the phone would ask for a code already spent.
  - Having the daemon answer a code request from any tailnet node: that removes the
    code as the gate. An approval on the server would keep the gate and remove the
    copy-paste; left out of this change because the app path already needs no code on an
    enrolled node.

### Phone paste: the line field's menu and the terminal's edit menu

- **Decided:** 2026-10-24, design.
- **What:** the dock has no Paste button. In the browser/PWA line field, paste is the
  platform's own menu; in the app mirror, the long-press menu has Paste / Select all /
  Clear. One line is inserted for editing, text with a line break goes to the terminal
  as one paste without Enter, and an image takes the image paste route. On the
  terminal, muxen's edit menu, opened by a released long-press, has Paste (alone over
  a blank cell), which sends the clipboard to the terminal as one paste without Enter
  (`readPasteboard` in the app).
- **Why:** the resting row Jimmy chose has room for the tab chip, the field and the
  toggle only, and the key row is his fixed list; the edit menu is where iOS users look
  for Paste on content that isn't a text field.
- **Rejected:** a Paste chip in the resting row (crowds the row and shrinks the field);
  a paste key in the key row (not in the fixed row, and hidden with the keyboard down).

### The text box is one line; Return sends it and Enter

- **Decided:** 2026-10-24, Jimmy ("edit should be a single line editor"; Return sends
  the text and Enter and clears the box).
- **What:** the dock's compose field holds one logical line, visually wraps and grows from
  one to five lines before scrolling inside. Browser/PWA uses its textarea; the app uses
  a native editor with autocorrect, predictions, capitalization and spell checking off.
  Return sends its text to the active tab, then Enter, and clears it; the line target
  keeps the keyboard. An empty Return sends Enter. The unsent text is the
  tab's draft, saved per tab key; [Drafts of closed tabs are kept](#drafts-of-closed-tabs-are-kept)
  still applies to it.
- **Why:** on the phone the text box is for saying one thing to a shell or an agent
  and sending it; a separate Insert and a second Enter cost a tap each time.
- **Rejected:** the multiline editor with Insert; Return inserting without Enter.

### One keyboard: native owns line editing, web mirrors it

- **Decided:** 2026-10-26, Jimmy, after using the app on the phone:
  > "I still get predictions on the iphone app, and swapping between if i used the button or if i used the box is still really wonky (they do different things still)"
  > "I have to press the box twice to open the keyboard sometimes"
  > "it should just act like a text box / not be a text box / a local text box / and then also the predictions should go away"
- **What:** the web draws the dock in browser, PWA and app. In the app one hidden
  `UITextField` is first responder for `terminal` and `line`: terminal input goes to
  tmux; native edits the line and the web mirrors its text, selection and composition.
  The mirror supports tap-to-place, spacebar trackpad and Paste / Select all / Clear,
  but not selection handles. Native disables autocorrection, capitalization, spell checking, smart punctuation and
  inline prediction; dictation and locale IMEs remain available. Sheet and Files fields
  remain WebKit-owned. The browser uses a textarea; both boxes grow from one to five
  visual lines while keeping one logical line. Return sends and pasted newlines go to
  tmux as one paste. Draft persistence, send results and notices remain web-owned.
- **Restore and routing:** native owns line generations. `lineSet` binds a draft and tab
  atomically and returns the new generation. `lineEdit` and `lineReturn` identify their
  originating tab; Return captures its text before native clears and advances. On a
  WebKit restart, `Boot` carries the focus target and a tab-bound native line snapshot;
  one app-started web owner waits for draft hydration, reconciles that snapshot and
  buffers early events. If the page is not ready, Return stays in the native field with
  a warning instead of being queued. Marked-text Backspace and Return stay in UIKit.
  The web owns ctrl/alt chord interpretation; native diverts only a one-grapheme insert
  at a collapsed caret, and an unchordable character returns to the line at the caret.
- **Why:** one responder avoids the WebKit handoff and makes both typing targets use the
  same keyboard. Public native text-field traits remove the predictive bar; attributes
  alone did not remove it on the phone. Commands and prompts should not be corrected as
  prose, and initial capitalization breaks most commands. A web dock avoids separate
  browser and native implementations. A textarea wraps where an input cannot. Binding
  edits and Return to a tab prevents late events or a restart sending text to another tab.
- **Rejected:** a bare `UIKeyInput` (cannot preserve IME composition and text-field
  selection); repairing separate responders with a private WebKit trait override; a
  native field overlaid on the web dock (its frame must track web layout and keyboard
  animation); a native copy of the dock (two implementations and split modifier state);
  sentence capitalization; JavaScript generation counters, duplicate event buffers and
  retrying a Return whose delivery is unknown; sending an unchordable character as bare
  terminal input.

### Keyboard control and key-row routing follow the focus target

- **Decided:** 2026-10-24, design and tech lead; focus routing refined by Jimmy,
  2026-10-27.
- **What:** the keyboard control opens terminal input when the keyboard is down and
  closes the keyboard when it is up. With compose focused, ← and → move its caret;
  Escape and a terminal tap return focus to tmux without lowering the keyboard. ↑, ↓,
  ^R, ^C and Tab go to tmux. Character keys go to the focused input; armed ctrl/alt
  sends a chordable character to tmux, while an unchordable character stays in compose.
  A pasted line break goes to tmux as one paste without Enter.
- **Why:** the toggle has a predictable open/close function. Symbols are slow to reach
  on iOS, so typing one while composing belongs at the compose caret. The focus cues
  and key labels show where input will go.
- **Rejected:** reopening the last hidden target (hidden state); making the toggle
  switch inputs instead of open/close; every key-row character going to tmux while
  composing; flattening multiline paste into one line (changes the command).

### Sheets lower the keyboard, and closing one gives it back

- **Decided:** 2026-10-24, design.
- **What:** opening a sheet or dialog on Terminal, the switcher included, moves focus
  into it and lowers the keyboard; leaving Terminal for Home or Files lowers it too.
  When a sheet closes, the input that held the keyboard gets it back: native raises it
  through the resting mode; the browser refocuses that input inside the closing tap,
  and leaves the keyboard down when the sheet closed without a tap (back gesture,
  Escape), since Safari raises the keyboard only inside a gesture.
- **Why:** a sheet needs the screen: with the keyboard up the switcher's list would be
  a few rows, and keys typed while it is open would go to a terminal the user can't
  see. Giving the keyboard back on close keeps a switch of tabs from costing a toggle
  tap.
- **Rejected:** the keyboard staying up under sheets (above); leaving it down after
  every close (an extra tap per tab switch).

### Return sends a paste with Enter in the same tmux group, and the daemon confirms it

- **Decided:** 2026-10-24, design.
- **What:** the line goes as one `paste { req, watch, window, text, enter: true }`. The daemon
  starts that tmux command list with `copy-mode -q` so the phone's latest action leaves
  any pane mode, then pastes and sends `Enter`, which tmux skips if the paste fails. It
  answers every paste exactly once: `pasted { req, watch }`, or
  `error { req, watch, code }`, also when the connection refuses it itself
  ([daemon-core.md](daemon-core.md#53-json-messages)). A refused or unanswered paste
  puts the line back into its tab's draft. A paste whose control client exited before
  answering is reported, never resent. The client keeps no timeout of its own: one
  shorter than the daemon's answer would restore a line that ran.
- **Failure avoided:** without an answer naming the paste, a `busy` refusal is
  dropped by the client, the Enter behind it is accepted, and the shell runs whatever
  was already on the prompt line while the field has cleared the user's line.
- **Why:** one message, no extra round trip on a slow link, and no window where the
  Enter can run without its paste. Clearing a laptop's copy mode follows last-active-wins:
  the user's phone action takes effect. A pane that asked for bracketed paste sees the
  line delimited and the Enter outside it, so the Enter submits.
- **Rejected:** preserving another client's copy mode for a phone paste with Enter (then
  tmux accepts Enter in the mode while the daemon reports the line sent); the client
  sending `{ key: "Enter" }` after `pasted` (a round trip per line, and the Enter can still meet a different prompt if
  something else typed in between; it stays the fallback if an agent CLI absorbs an
  immediate Enter); the text as literal `input` keystrokes (an agent CLI may read the
  burst as a paste and swallow the Enter); an Enter inside the pasted text (in bracketed
  mode it is a newline, not a submit); resending a paste whose answer was lost (it
  could run twice).
- **Risk:** whether Claude Code and Codex submit on an Enter that immediately follows a
  bracketed paste is unverified on the target apps.

### The key row stays with a hardware keyboard

- **Decided:** 2026-10-24, design.
- **What:** the dock is the same with a hardware keyboard attached: the key row shows
  while an input holds focus, as with the on-screen keyboard.
- **Why:** the browser cannot detect a hardware keyboard reliably, and one layout is
  easier to get right.
- **Rejected:** collapsing in native only (two layouts of one web dock).

## Window size follows the client that acted last

Jimmy chose last-acted sizing; design settled and probed the mechanism on tmux 3.4
and 3.7b ([probe-latest-activity.md](research/probe-latest-activity.md)).

### Whoever acted last gets the window's size

- **Decided:** 2026-10-24, Jimmy ("just whoever has the last focus gets the focus and
  the size of the screen").
- **What:** tmux's `window-size latest`, extended to muxen. A watch **claims** its
  window with `watch`, `resize`, `input` and `paste`, and its owner takes `latest`
  and votes that watch's size; when another tmux client acts there, the window **yields**: the vote clears,
  the watch stays, and tmux sizes the window by `latest`
  ([daemon-core.md §3.6](daemon-core.md#36-sizing)).
- **Rejected:** keeping the cap (the laptop could never take back a window the phone
  had on screen); `window-size smallest` (the laptop would always be phone-sized while
  the phone watched); `largest` (the phone would always get the laptop's size, the
  opposite of "whoever I'm using"); dropping the vote after N idle minutes (a timer
  where an act is the signal).

### "Acts" means input or bringing the tab on screen, not looking

- **Decided:** 2026-10-24, design.
- **What:** the phone claims when the user brings a tab on screen (opening, switching
  to it, returning from Home or Files, unlocking into it), on rotation or a font
  change, on every keystroke and paste, and on Fit. A tab that stays on screen claims
  nothing, nor do scrolling the history and `resync`. A re-watch the client makes by
  itself (a reconnect, a retry) sends `watch { claim: false }` unless the tab held the
  window when its watch ended.
- **Why:** coming on screen is the phone's attach or `switch-client`, which tmux itself
  counts as making a client `latest`. Opening the app is the moment Jimmy picks up the
  phone to use it; making him type a key to read the screen would put junk in the
  shell. A phone propped on the desk with the tab open sends nothing, so it never
  takes the window back while he types on the laptop.
- **Rejected:** input only (opening the phone would show a laptop-sized window until a
  key); any message on the watch, `history` included (scrolling back to read would
  shrink the laptop's layout); a `claim` message (`resize` already says "this is my
  size", and Fit re-sends it); every `watch` claiming, reconnects included (on a
  spotty link each blip would shrink the laptop's window mid-command, though
  nobody touched the phone).
- **Cost:** `watch` carries a flag, and the client must tell a user's re-watch from its
  own.

### The other client's act is seen through the window subscription

- **Decided:** 2026-10-24, design. Evidence: [probe-latest-activity.md](research/probe-latest-activity.md).
- **What:** the `w<W>` subscription, which carried only the cwd, becomes the window
  subscription: it also lists, with tmux's client loop `L:`,
  each non-control client whose current window is `@W`, with its activity time, size
  and flags. A new or changed entry is an act, except a focus-out alone and a client
  with `ignore-size`; the first value is the baseline
  ([daemon-core.md §3.7](daemon-core.md#37-window-subscription)).
- **Why:** it catches every act that makes a client `latest` (key, mouse, focus,
  switching to the window, attaching, a terminal resize), costs nothing while nobody
  else types, adds no op, and reuses a subscription with the same lifetime. tmux
  already checks it once a second.
- **Rejected:** a `client-active` hook
  (`set-hook` changes Jimmy's tmux config and can't reach the daemon); polling
  `list-clients` (a timer in the daemon); one session-wide subscription (inside `L:` a
  client's window is the outer one, so it can't say which window a client is on, and
  its value would change whenever anyone typed anywhere); a separate `a<W>`
  subscription (a second op pair with the same lifetime); comparing activity times with
  the claim's time (one-second resolution; the phone's next act fixes a stale yield).
- **Cost:** yielding lags the other client's act by up to about a second. A focus-out
  updates client activity without making that client `latest`, so the flags prevent a
  false yield.

### Files in landscape lowers the keyboard, as in portrait

- **Decided:** 2026-10-24, Jimmy ("yes").
- **What:** leaving Terminal for Files lowers the keyboard in landscape as in portrait
  ([browser-behaviors.md](client/browser-behaviors.md#phone-dock)); no layout keeps it
  up over Files.

### iOS Link resolves the socket without exposing host routing in page state

- **Decided:** 2026-10-24, tech lead.
- **What:** a `HostLink` asks native with `{type:"socket", host}`; native replies with
  `{url, token}`, `{locked:true}` or `{notEnrolled:true}`. The URL is
  `wss://<stored host>/ws`. The URL and token stay inside that Link and are never
  persisted or copied into `PlatformHost`, workspace or general app state.
- **Why:** the web must own the socket for direct frame delivery, but it does not need
  the native host registry or a second credential store.
- **Rejected:** putting `baseURL` on `PlatformHost` (host routing leaks into ordinary
  page state); deriving a URL from the host name (a user-visible label need not be
  its MagicDNS name); WebSocket over `muxen-app://` (a scheme handler cannot carry it); native
  `URLSessionWebSocketTask` (keep as fallback only if spike 3 finds stuck sockets).

### Native caches the web's active tab for keyboard batches

- **Decided:** 2026-10-24, tech lead.
- **What:** web sends `activeTab { tab: TabKey | null }` when selection changes; native
  uses that cache to tag a whole coalesced keyboard batch. The web still drops input
  for a stale or closed tab.
- **Why:** the hot input path needs one native-to-web bridge crossing per batch.
- **Rejected:** asking `activeTab()` for every batch (a second bridge round trip for
  every keystroke); native mirroring the workspace's tab model.

### Host management has a typed native presentation request

- **Decided:** 2026-10-24, tech lead.
- **What:** the web's Home/Settings host-management entry sends `manageHosts`; native
  presents the server sheet. Remove the floating native Servers control when that web
  entry lands.
- **Why:** one intentional web entry avoids covering application content while the
  sensitive host/enrolment screen remains native.
- **Rejected:** a generic `nativeModal` bridge (arbitrary page-driven native UI is not a
  stable contract); retaining the floating overlay after the web entry exists.

### User Copy is not an OSC 52 server write

- **Decided:** 2026-10-24, tech lead.
- **What:** bridge `copy { text }` always writes user-selected terminal text to the
  system pasteboard. Server-origin OSC 52 remains a separate, disabled web policy.
- **Why:** applying the server-write gate to user-initiated Copy made the terminal's
  Copy command silently fail by default.
- **Rejected:** gating every copy through a native setting; conflating user and server
  clipboard provenance in one bridge message.

### Keep the Termius-quality keyboard layout without a WebKit bar

- **Decided:** 2026-10-24, tech lead.
- **What:** suppress the WebKit form accessory bar through the private
  `WKContentView` input-accessory path; if the class path is absent, leave the bar in
  place rather than fail the app. Keep the ^C/^D warning haptic for native hardware
  input and expose the warning kind for the web key row.
- **Why:** the `⌃ ⌄ ✓` strip between keyboard and dock falls below Jimmy's Termius UI
  bar; explicit warning feedback stays attached to terminal interrupts.
- **Rejected:** accepting the form bar as a permanent layout element; dropping the
  warning haptic and treating ^C/^D as ordinary key taps.

### Defer the Debug dev-server asset source

- **Decided:** 2026-10-24.
- **What:** the app bundles its web assets. A Debug-only dev-server source/HMR path
  is deferred to `ios/.context/FUTURE`; the bundled CSP is not relaxed for it.
- **Why:** the optional shortcut needs a separate trusted-origin, certificate, HMR and
  CSP check; desktop browser/Vite remains available for iteration.
- **Rejected:** shipping an unverified dev-server route and broader CSP with the shell.

### Touch state belongs to the shown tab

- **Decided:** 2026-10-24, tech lead.
- **What:** one shown-tab owner holds the touch recognizer, momentum, history view
  and selection snapshot. It resets them on a tab change, snapshot, visibility change
  or lost pointer capture, and sends are bound to the tab on which they began. A history
  chunk overlaps up to eight known rows and finds the matching run nearest its expected
  position; wrap flags carry across chunk and buffer seams. The selection snapshot is
  bounded relative to the visible rows, not the newest rows.
- **Why:** a coast or gesture belongs to one tab on a surface shared by all tabs;
  waiting for the next snapshot to reset it let input reach the next tab. tmux history
  row numbers shift as output arrives, and a single repeated or blank row is an
  ambiguous anchor. A snapshot bounded from the newest rows cannot select far up a
  long scrollback.
- **Rejected:** resetting only one scroll control instead of the shown-tab owner;
  matching a single seam row; the daemon's history size as an anchor (it does not say
  where known rows moved); guessing cell widths from text for xterm rows.

### Native lifecycle messages are full snapshots

- **Decided:** 2026-10-24.
- **What:** app visibility, reachability, lock and native coverage travel together in a
  complete `lifecycle` snapshot; `covered` is not a separate bridge event. Native saves
  focus requests while covered, applies the latest on uncover, and drops queued terminal
  input while locked or covered.
- **Why:** web admission and socket watching recompute one predicate from the current state,
  without merging deltas that may arrive after a page restart. The web can unwatch
  under a native cover and re-watch on return, releasing tmux sizing while hidden.
  Input and focus must not bypass a native cover.
- **Rejected:** a separate `lifecycle.covered { covered }` event alongside a partial lifecycle
  update; Swift-only cover state, which leaves the web watch owner unaware.

### Track expected token-item state without storing credentials in app preferences

- **Decided:** 2026-10-24.
- **What:** a non-secret preference records whether a non-empty Keychain token map is
  expected. A missing expected item stays locked so the user can explicitly reset it;
  Reset clears the marker while preserving saved host labels as not enrolled. A 401
  revokes only the exact token sent in the rejected request; while locked, a digest
  suffices to identify it. Keychain work is serialized off the main thread and reuses
  the successful unlock context until lock.
- **Why:** Keychain can report an item as missing after a Face ID change, which must not
  silently turn an auth recovery state into an ordinary un-enrolled state. A late 401
  must not erase a newer credential for the same host.
- **Rejected:** treating every missing item as an explicit reset (the recovery screen
  becomes unreachable), deleting a credential by host id alone, or persisting tokens
  outside the one Keychain item.

### Guard the client subscription against unidentified tmux clients

- **Decided:** 2026-10-24, investigation of the scratch-server crash.
- **What:** the `L:` subscription checks `client_height` before expanding `client_name`.
  On tmux 3.4, an accepted socket is visible to `L:` before IDENTIFY finishes and
  before `client_name` exists; its format callback calls `xstrdup(NULL)`. An initialized
  terminal client has a height, so this guard keeps the same entries for every attached
  non-control client while skipping the transient state. Keep the gated real-tmux test
  that holds an unidentified Unix-socket client through the subscription timer.
- **Why:** the exact subscription crashed an isolated tmux 3.4 server with the same
  `format_find → xstrdup(NULL)` stack as the reports. The raw-socket repro also passes
  on 3.7b and 3.8, but muxen cannot rely on a tmux version's incidental client-list
  filtering to keep the server alive. Evidence and the minimal repro are in
  [tmux-subscription-format-crash.md](research/tmux-subscription-format-crash.md).
- **Rejected:** changing only `client_control_mode` or the membership match (the crash
  happens when the selected format looks up `client_name`); requiring a newer tmux
  (3.4 is a supported server version); or omitting client names/activity and losing
  the act detection behavior.

### Native uploads are named by the web, not guessed by native

- **Decided:** 2026-10-24, tech lead.
- **What:** `pickMedia { id, host }` and `readPasteboard { tab, id }` carry an id the web chose and the host to upload to; every `upload { id, progress, path?, error?, cancelled? }` event carries that id back, and the adapter routes events by id alone. A dismissed picker sends a terminal `cancelled` event. Native sends an upload's first event after its reply. Upload works with no tab open. Native keeps no tab for media, so `activeTab` serves keyboard batches only. A pasted image inserts its path into the tab pasted into (the user's intent is clear); a Files upload only offers "Insert path".
- **Why:** native chose the host and stream from its own cached state, so a pasted image could be claimed by an abandoned Files pick, and Upload did nothing with no tab or went to the active tab's host rather than Files'.
- **Rejected:** a first-match by host (the bug); a host and optional tab on `pickMedia` with a version bump (the tab would only be echoed back, and the web already knows its target); native reporting `upload` events with `host` and `tab` for the web to match.

### Native draft conflicts: stored revision greater than the base

- **Decided:** 2026-10-24, tech lead.
- **What:** `DraftStore.put` returns `conflict` only when the stored revision is greater than `baseRevision`, as the browser does. The check runs in Swift, and client-architecture.md §5.6 says so.
- **Why:** the web's base is the last revision it issued, so after one `failed` put the retry's base is ahead of the store. An equality check answered `conflict` and the reducer dropped the draft.
- **Rejected:** moving the check to JS (the page cannot see the stored revision without another round trip).

### The app registers a stand-in `terminal` focus target

- **Decided:** 2026-10-24, tech lead.
- **What:** `FocusController.nativeTerminal()` returns a hidden element whose `focus()` and `blur()` announce themselves as DOM focus events (so owner tracking, dialog returns and the viewport's keyboard-drop rule work unchanged) and ask native for the resting mode. There is no separate native branch in `toggleKeyboard`.
- **Why:** the keyboard toggle, leaving Terminal and returning from a dialog had one path in the browser and a special case in the app, which missed the dialog return.
- **Rejected:** a `directInput === "native"` branch in the controller.

## The Mac front

Decided 2026-10-24 by design within Jimmy's Mac-host decisions. Probe results:
`.meridian/work/tether-mvp/mac-front-probes.md`.

### Publication and admission use one canonical-origin rule

- **What:** one `MacFront { port, secret }` owns target formatting, recognition of
  earlier muxen-shaped handlers, and assembly of the Serve target, publication and
  request gate. Publication first plans edits to the raw Serve JSON, preserving
  unrelated fields and handlers, then deserializes the planned config and judges it
  with `ServeConfig::canonical_origin(&target)` before any POST. A plan refused by
  this rule never writes; request admission applies the same rule to the current
  config.
- **Why :** the previous publication-specific checks accepted configs
  the canonical-origin rule later rejected (including a TCP forward and a handler at
  another port), so muxen could publish a front that then refused every browser. One
  policy boundary prevents those checks from drifting apart.
- **Rejected:** separately re-implementing Funnel, TCP/443 and handler checks in the
  publication plan; validating the daemon-generated proxy URL by parsing it back into
  a URI; overwriting an existing handler to make the proposed config appear canonical.

### Canonical-origin refusals retain their cause

- **What:** `canonical_origin` returns a typed refusal reason, and renders a
  target-specific message naming the actual conflict and its repair. In particular,
  messages distinguish Funnel, a TCP forward on the HTTPS port, and a sibling handler
  at its real mount path. Never include proxy URLs in messages: a Mac proxy contains
  the path secret.
- **Why :** returning only the offending target reference made a plan
  report muxen's newly invented `/_` handler instead of the app's real `/` handler,
  and hid the Funnel or TCP-forward condition that caused rejection.
- **Rejected:** reconstructing the cause from the final message or logging an entire
  proxy target to make the conflict more specific.

### muxen writes its own Serve entry and picks a new path secret at each start

- **What:** `muxen serve --publish` reads the serve config and its `Etag` through
  LocalAPI, changes only `Web["<MagicDNS name>:443"]`, `TCP["443"]` when it is
  missing, and its own earlier handlers (muxen-shaped:
  `http://127.0.0.1:<its port>/muxen-<43 base64url chars>`), and writes it back with
  `If-Match` only when the resulting config passes canonical-origin validation. It
  publishes once per start and never unpublishes.
- **Why:** the macsys proof token, which muxen already needs to read LocalAPI, can
  write the serve config, and `If-Match` turns the write into a compare-and-swap
  (probed: a wrong `Etag` gets `412`). The extension logs the full target at every
  write, so a secret that never changes would stay valid in every log copy forever;
  a new one each start makes those copies stale.
- **Rejected:**
  - Jimmy running a publish command with a secret stored in `config.toml`: one more
    copy of the secret on disk, no rotation, and a step to repeat by hand.
  - Rotating on a timer: each rotation is another write and log line, and live sockets
    would need both secrets for a while; the threat it shortens needs local code on
    the Mac.
  - Re-publishing whenever the config loses muxen's entry: it would undo Jimmy's own
    `tailscale serve reset`.
  - Removing muxen-shaped handlers for any port: a handler for another port isn't
    this front's publication, and muxen changes only what it published.
  - Putting the secret somewhere the extension doesn't log: a Serve target is a URL
    and the extension logs it whole, userinfo included; Serve can't add a header.

### Publishing needs `--publish`

- **What:** without it a Mac daemon binds only `local.sock` and never touches the
  serve config. On Linux the flag is a configuration error (exit 78).
- **Why:** the real-daemon e2e stack and dev runs start `muxen serve` on the Mac; a
  daemon that published on every start would overwrite Jimmy's Serve entry during
  tests.
- **Rejected:** always publishing on macOS (the above); a `config.toml` key (it would
  apply to every daemon that reads Jimmy's config, including one he starts by hand to
  debug; the flag puts publishing in the command, which the LaunchAgent carries); a separate `muxen publish` command (the publication must follow the
  daemon's life, which only the daemon knows).

### launchd holds the Mac front's socket

- **What:** the LaunchAgent's `Sockets` entry `Listener` binds `127.0.0.1:7851` when
  Jimmy logs in; the daemon takes it through `src/launchd.rs`, sets `FD_CLOEXEC`
  unconditionally, makes it non-blocking and hands it to tokio. `--publish` without it exits 78 with "no launchd socket
  `Listener`", since launchd's `ESRCH` means either "not a launchd job" or "no such
  socket". The front is published on the MagicDNS name's port 443 only.
- **Why:** the publication must not point at a port something else can bind while
  Jimmy uses it. If the daemon owned its listener, every crash, `kill -9`, jetsam kill
  or hub failure would free the port while Serve still pointed at it, and whatever
  bound it would receive the iOS app's device token. launchd keeps the
  port bound across all of those (probed). The iOS app adds a host by its MagicDNS
  name, so 443 is the port it uses.
- **A socket launchd couldn't bind:** if a process holds the port when the agent
  loads, launchd's bind fails silently and the job gets one unbound fd (probed),
  while Serve's entry from the last session points at that process. The daemon
  requires the socket at `127.0.0.1` with a non-zero port; otherwise it withdraws
  every muxen-shaped handler (any port) from `Web["<name>:443"]`, trying for 2 s, and
  exits 78. launchd's 10 s restarts retry it. Rejected: exiting without withdrawing
  (the phone's device token keeps going to that process); checking only in gate M0
  (a login item can race launchd at any login).
- **Costs:** a fixed port that something else may hold (the plist's to change); the
  plist must carry `PATH`; one module with `unsafe`.
- **Rejected:**
  - A port the daemon binds itself, kernel-picked or fixed: freed by every crash. A
    probe showed a wildcard bind with `SO_REUSEADDR` on the same port can even
    pre-position while muxen's own listener runs, and receive Serve's connections
    the moment muxen stops.
  - A watchdog parent process holding the socket: dies with the daemon under `kill
    -9` of the process group or jetsam.
  - A wildcard or tailnet address: tailnet clients would reach muxen without Serve.
  - A configurable HTTPS port: the app can't use it.

### The path secret is checked first, in constant time, and answers an empty 404

- **What:** before any header is read, the raw path must start with
  `/<path secret>/`, compared with `subtle`; a mismatch is a `404` with no body and no
  log above `debug`. A match strips the secret from the URI, so no later layer or log
  sees it. The check runs in the accept loop's per-request service, before the
  router: axum routes before `Router::layer` middleware runs, so a gate there would
  see paths already routed as `/<secret>/…`.
- **Why:** everything after the gate trusts headers that only Serve should be able to
  write. An empty 404 tells a local prober nothing about what listens.
- **Rejected:** checking `Host` or the Tailscale headers first (they are forgeable,
  and judging them costs a tailnet-state read); `403` with muxen's JSON error body
  (identifies muxen to a prober).

### The Mac front's `Host` rule uses the authority muxen published

- **What:** `Host` must equal `<MagicDNS name>` (`:443` optional) and exactly one
  `X-Forwarded-Host` must equal it, both held in memory from the publication; before
  a publication, `503 identity_unavailable`.
- **Why:** Serve passes a TCP target the browser's `Host` and sets `X-Forwarded-Host`
  to the same value (probed). The rule is a cheap filter like `serve.sock`'s
  `localhost` check; the node lane still compares `X-Forwarded-Host` with the canonical
  origin. Holding it in memory keeps the native lane free of a LocalAPI read it
  doesn't otherwise need.
- **Rejected:** no `Host` rule (a misdirected publication would go unnoticed); comparing
  with the canonical origin on every lane (a handler added beside muxen would refuse
  the native app too, which on Linux keeps working).

### The LocalAPI transport is chosen at startup and its endpoint found per connection

- **What:** Linux keeps its Unix-socket search. macOS uses the proof-token TCP
  transport: the macsys files first (`/Library/Tailscale/ipnport`,
  `sameuserproof-<port>`), then the App Store app's `lsof` lookup. The endpoint is
  looked up again whenever a connection opens. Failures stay `503
  identity_unavailable`, never a startup refusal.
- **Why:** the extension's port and token change when it restarts. The macsys lookup is
  two system calls; `lsof` spawns a process, so it goes second, unlike Tailscale's CLI.
- **Rejected:** a `MUXEN_LOCALAPI` override (a test hook in the production identity
  path, rejected before for the e2e stack); resolving once at startup (a Tailscale
  restart would need a muxen restart); the App Store lookup first (a process spawn on
  every reconnect on the common install); verifying who listens on LocalAPI's port
  (an unprivileged process can't see root's sockets); re-reading `ipnport`
  before every request, reconnecting on `401`/`403`, and exiting when the endpoint
  the daemon published through changes (reviews): they shortened another
  account's hold on LocalAPI's old port, and a one-account Mac accepts the window
  ([auth.md](auth.md#threat-model)).

### macOS binds no `serve.sock`

- **What:** a Mac daemon binds `local.sock`, plus the Mac front with `--publish`. The
  Unix Serve front stays in the code, and integration tests build it on any platform.
- **Why:** the extension can't connect to it, so it would be a front nothing can use,
  and the canonical-origin rule would point Jimmy at a `sudo tailscale serve unix:…`
  command that gives 502.
- **Rejected:** keeping it for a Homebrew `tailscaled` setup (rejected as a setup;
  the macOS transport doesn't look for its socket).

### The publication has one owner, and `muxen enroll` asks the daemon on a Mac

- **What:** one task owns the publication's state. Publishing removes every
  muxen-shaped handler that targets the front's port, wherever it is, and drops
  entries and plain-HTTPS `TCP` ports it leaves unused. Refusal text comes from each
  serve target, so a Mac never shows the Linux `sudo tailscale serve` command. On a
  Mac `muxen enroll` prints what the running daemon's `GET /auth/info` says over
  `local.sock`.
- **Why :** a handler left under an old MagicDNS name would make the
  serve target appear twice and refuse browsers; only the daemon knows its secret, so
  a separate computation in `muxen enroll` couldn't apply the "named exactly once"
  rule.
- **Rejected:** a file in the runtime directory recording the published origin for
  `muxen enroll` (a second copy of state the daemon already serves).

### The daemon never unpublishes; teardown removes its handlers

- **Decided:** 2026-10-24, design; teardown by tech lead, 2026-10-25.
- **What:** the daemon never unpublishes on exit. The next start replaces a stale
  handler; in between Serve answers `502`. If launchd could not bind the front, startup
  withdraws the unsafe muxen-shaped handlers. `muxen teardown` stops the service,
  removes only muxen-matching Serve handlers and removes the service file.
- **Why:** launchd holds the port across crashes. On a one-account Mac there is no
  second login account to protect against after a stop, while teardown reverses setup
  without removing other Serve entries.
- **Rejected:** unpublishing on every daemon stop, with cancellation and a compare-and-
  swap retry (extra shutdown state and a race with publication); asking Jimmy to clear
  the whole HTTPS entry by hand; a separate unpublish command duplicating teardown.

## muxen setup

### Setup runs in the foreground by default

- **Decided:** 2026-10-25, Jimmy.
- **What:** plain Linux `muxen setup` runs muxen in the terminal until SIGINT or
  SIGTERM; `muxen setup --background` installs the systemd user service. Plain setup
  on a Mac refuses before changing anything; the LaunchAgent is still the only Mac
  front phones can reach.
- **Why:** Jimmy chose plain `muxen setup` to stay attached to the terminal; background
  installation requires an explicit flag. Stopping the process does not imply ownership
  of the tailnet's Serve config.
- **Rejected:** background by default (Jimmy chose foreground); a foreground Mac run
  over loopback TCP (phones cannot reach it without launchd's socket, and an unsecreted
  loopback port is the Mac front's known hole); withdrawing Serve on Ctrl-C (a crash
  would leave the entry anyway, and reruns would churn the config).

### Linux setup publishes as the operator

- **Decided:** 2026-10-25, lead (setup review findings).
- **What:** Linux `muxen setup` writes Serve through LocalAPI as Jimmy, the Tailscale
  operator, after the first-run grant.
- **Why:** reruns and teardown need no root command when the account has the operator
  grant, and LocalAPI's compare-and-swap preserves concurrent changes from other apps.
- **Rejected:** running `sudo tailscale serve` by hand each time.

### The Linux daemon never writes Serve

- **Decided:** 2026-10-25, lead (setup review findings).
- **What:** on Linux only setup publishes Serve; the daemon never writes it.
- **Why:** the daemon may start at boot before setup has granted the operator, and
  setup and the daemon would otherwise race as two publication owners.
- **Rejected:** having the Linux daemon publish like the Mac daemon.

### Every background setup run restarts muxen

- **Decided:** 2026-10-25, lead (setup review findings).
- **What:** every successful `muxen setup --background` run restarts the service,
  even when its installed file is identical. Foreground setup starts the daemon in the
  current process instead.
- **Why:** rerunning background setup is how Jimmy applies a config change, upgrade or
  fix.
- **Rejected:** restarting only when the service file changes.

### systemd is the only automatic Linux service manager

- **Decided:** 2026-10-25, lead (setup review findings).
- **What:** background Linux setup supports systemd only; foreground setup needs no
  service manager.
- **Why:** no target host uses another service manager.
- **Rejected:** adding OpenRC and runit support.

### Setup prints privileged commands and copies links with OSC 52

- **Decided:** 2026-10-24, tech lead.
- **What:** setup prints each privileged command before running it; `sudo` supplies its
  own prompt. When stdout is a terminal, setup copies the link with OSC 52.
- **Why:** setup is a deliberate act, and OSC 52 can reach the clipboard over SSH.
- **Rejected:** an additional `[y/N]` before `sudo`; `pbcopy`, `wl-copy` or `xclip`,
  which over SSH copy on the server rather than the client.

### The app reports no keyboard inset, because its view moves

- **Decided:** 2026-10-26, lead, from a phone screenshot with the keyboard up.
- **What:** `keyboardInset` in the v2 `viewport` object means how far the keyboard covers
  the page the web can see. The browser reports the covered strip; the app reports 0,
  because the native shell moves its web view's bottom edge above the keyboard.
  `keyboard` (the frame taken, at least 120 pt) still says the keyboard is up.
- **Why:** both platforms were describing the keyboard, so the app's dock, sheets and
  toasts rose by the keyboard height inside a view that had already shrunk, leaving a
  keyboard-height gap under them. Measured in a real-daemon browser run at phone size:
  a 593 px view with `--keyboard-inset: 259px` leaves the dock with 259 px of blank
  space under it; with 0 the dock's bottom sits on the view's bottom.
- **Rejected:**
  - Stopping the native resize and letting the web rise by the inset everywhere (the
    design's documented fallback). It keeps one number but gives up the frame animation
    and reopens WebKit scrolling the focused line field.
  - A web-side check of whether the page height already excludes the keyboard. The
    platform knows what it did; the page would have to measure it back.
  - Making the dock's lift depend on `keyboard` instead of the inset: the strip shows on
    the same flag, and the gap is the inset's job in the browser.

### Setup links carry enrolment codes in fragments

- **Decided:** 2026-10-26, Jimmy.
- **What:** Setup prints one link, `<origin>/#code=<CODE>`, and encodes that exact
  link in its QR and terminal clipboard. The browser reads the code from the fragment;
  the daemon does not parse it. `muxen enroll` prints the bare MagicDNS name on
  `Host:` and the same code-bearing URL on `Browser:`.
- **Why:** Scanning or opening the link can enrol a browser without transcribing the
  code. Unlike the earlier decision, the web and iOS flows now consume the fragment.
  Fragments do not reach the daemon or appear in `Referer` headers. Browser history
  still retains the URL, including its fragment; that remaining exposure is accepted
  for a one-use code that expires after 10 minutes.
- **Rejected:**
  - A query string, which would reach the daemon and could be forwarded as a referrer.
  - Making the setup link itself an iOS-only deep link, which would not cover Safari
    and would require the app to be installed.
  - Keeping the plain link and separate code as the only browser path, which still
    requires entering the code on the phone and leaves the screen with multiple links.

### Setup probes the daemon lock before changing host state

- **Decided:** 2026-10-25, tech lead.
- **What:** the non-blocking probe uses the daemon's existing runtime flock. Background
  setup refuses before grants or installation when that lock belongs to a terminal run;
  an active service may be restarted. Teardown reports a terminal run that remains
  active. Foreground setup requires `config::runtime_dir()` to equal
  `/run/user/<uid>/muxen`. `daemon::open` owns the budget, runtime directory, flock,
  binds, state store and auth before setup grants the operator. Setup publishes Serve,
  refreshes the daemon's cache, issues the code and prints; `Opened::run` then registers
  signals and serves. Exit 78 is mapped only for `muxen serve`, and teardown mentions
  linger only when `loginctl` reports `Linger=yes`.
- **Why:** setup must refuse before a change if another process owns muxen's daemon
  slot; one flock keeps setup and serving on the same instance rule. Opening state and
  auth before the grant keeps filesystem refusals on the no-mutation side of the setup
  boundary. Keeping publication in the foreground sequence removes a split assembly
  hook, while registering signals only in `run` preserves default signal exit during
  grants and setup writes. The exact runtime path keeps the published Unix target and
  teardown matcher aligned.
- **Rejected:** a setup-only lock or PID check; granting the operator before daemon
  startup checks complete; a post-bind publication hook; mapping daemon configuration
  failures to exit 78 for setup; unconditional linger advice.

### Setup's report prints only what Jimmy acts on

- **Decided:** 2026-10-25, Jimmy ("really verbose", first Linux run).
- **What:** the success report is the mode line (with "starts at boot" or "starts when
  you log in" for a service), one line per change, any notes, the link, its QR code and
  "Enrolment code: <code> (one device, 10 minutes)", then "For another device, run
  `muxen enroll`." A terminal run logs at `warn`
  unless `RUST_LOG` is set, from before the daemon opens so its budget warnings show.
  An unenrolled node logs at `debug` on every route: the response already reports it,
  and every phone is unenrolled until it enters its code.
- **Why:** each dropped line repeated another one or explained something a second run
  doesn't need: "Nothing else to change" (no change lines says it), "Published on your
  tailnet", per-client enrolment steps (the phone page asks for the code; the iOS host
  name is the link's), the `teardown` line (in running.md; `muxen enroll` keeps a line under the code, since
  Jimmy had to ask how to get another code), the clipboard
  sentence (setup can't tell whether OSC 52 landed), the daemon's "listening" line
  under a report that already says muxen is running, and a warning for the expected
  enrol-after-opening order.
- **Rejected:** a `--quiet` flag (two output formats to keep correct); keeping the
  banner for the foreground Serve entry that outlives Ctrl-C (running.md says so, and
  the phone shows 502, not someone else's page).

### Setup's `401` names Tailscale's full-name check

- **Decided:** 2026-10-25, tech lead.
- **What:** on a `401` from the Serve write, setup explains that tailscaled 1.98.9+
  checks `sudo --other-user=<full name> --list tailscale` with the account's full name
  (tailscale/tailscale#21204), suggests `sudo chfn -f $USER $USER` when the names
  differ, then checking `sudo -l tailscale`. Teardown adds `sudo tailscale serve
  --https=443 off`, stating that it removes every handler on port 443.
- **Why:** pop-os's account had a sudo rule for tailscale and still got the `401`; the
  old message asked for that rule. `chfn -f` changes only the full name; Go's user
  lookup, which tailscaled tries first, cuts the name at the first comma.
- **Rejected:** setup reading the account's full name and choosing one of two messages
  (another lookup, wrong for LDAP accounts, for a rare error); `usermod -c` (replaces
  the whole GECOS field); a narrower teardown command with `--set-path` (unverified);
  naming tailscaled's `PATH` lacking `tailscale`, the other cause reported on #21204
  (seen with Homebrew's launchd tailscaled; a Linux tailscaled finds `/usr/bin`).

### Session listings omit client-attachment state

- **Decided:** 2026-10-25, Jimmy.
- **What:** session listings omit `attachedElsewhere` and do not query tmux clients to
  compute it.
- **Why:** Jimmy said the note is not useful; acted-last sizing makes switching between
  laptop and muxen harmless. Removing it saves a field and the tmux query per listing.
  Removing the field alone needed no protocol bump: version 1 had not shipped, and a
  v1 web peer treated the missing value as false. Protocol 2 was later required by
  session watches, not by this field removal.
- **Rejected:** retaining a field and query with no current reader; version-specific
  shaping solely for an attachment note.

## Tabs follow a session

### One tab per session, like `tmux attach`

- **Decided:** 2026-10-25, Jimmy, from first real use.
- **What:** a muxen terminal tab is a tmux session. It shows the session's current
  window and follows it when any client changes it. Session lists show sessions, not
  window rows; multi-window sessions offer window switching. The route to create a
  window in a one-window session remains open.
- **Why:** Jimmy, on Home listing "0: python / open / + New window" under every session:
  "default just list the session … by default it should just load the whole thing
  (especially if there is only 1 window)". Jimmy does not split panes, so the tab shows
  the current window's active pane.
- **Rejected:** opening the session's active window as a fixed window tab: it would stop
  matching the laptop's view after a prefix-n.

### The daemon follows the window; the client never re-watches

- **Decided:** 2026-10-25, design.
- **What:** a watch names a session. The hub keeps one view per watched session, owned
  by the control client attached to it; that client's `%session-window-changed` for its
  own session sets the view's current window, and a Locate on the owner
  (`display-message -t '$S'`) finds the window's pane. The tab gets one `watching` and
  one snapshot per change. `Locate { window }` and `LocateSession` become one
  `Locate { session }`; window phases, `windowClosed` and `windowRenamed` are deleted.
- **Why:** following costs the network the minimum: the snapshot the new window needs
  anyway, with no client round trip. Sessions don't move, so the owner is known without
  asking tmux, which removes the moved-window rebinding the window model needed. The
  probe ([research/probe-session-follow.md](research/probe-session-follow.md)) showed
  the notification on 3.4 and 3.7b for every trigger, ahead of the new window's layout.
  The owner's own Locate also orders its answer with its notifications; another client's
  answer could miss an earlier change and bind a stale pane.
- **Rejected:** the daemon telling the client and the client re-watching the new window
  (an extra round trip on every switch, on the connections where it hurts most); a
  session-scoped subscription carrying the acts and cwd in place of the per-window one
  (the laptop riding along on a switch would read as an act and yield muxen's claim;
  a session subscription carrying only the current window id is kept, as the backstop
  for `swap-window`); grouped sessions so muxen's window choice doesn't move the laptop
  (muxen would create sessions in Jimmy's tmux, against "a window onto tmux, never its
  owner"); using failure of `display-message` to detect a missing target (tmux 3.4
  succeeds with empty fields).

### Input, paste and inserted paths name the window the tab showed

- **Decided:** 2026-10-25, design.
- **What:** `input` and `paste` carry `window`, the window of the tab's latest
  `watching`, and the daemon sends to `-t @W`. Image paste and Files' insert capture
  the window with the tab.
- **Why:** on a slow link the laptop can switch windows between a keystroke and its
  arrival; the key should land where the user was looking. A path inserted after an
  upload lands in the window it was pasted into, not whatever the session shows by
  then; a gone window fails visibly, as a gone tab did. Inserted paths with C0 control
  characters or DEL are refused: raw CR or LF would submit the terminal input.
- **Rejected:** targeting the session (`-t '$S:'`, tmux attach's own semantics, which
  sends a line typed for one window into another); refusing input whose window is no
  longer current (drops keys typed in the instant after a switch made elsewhere).

### Session watches require protocol 2

- **Decided:** 2026-10-25, design.
- **What:** session watches require protocol 2; the daemon rejects protocol-1 peers.
  The window-tab workspace and its drafts are discarded rather than guessed into the
  session model.
- **Why:** a version-1 peer sends window watches the daemon cannot read. A stale peer
  needs an incompatibility response rather than a protocol-violation reconnect loop.
  The old workspace did not record each window's session, so migration would require
  looking it up; reopening a few sessions is the cost of dropping it.
- **Rejected:** keeping both wire models with per-version watch handling; resolving
  old window tabs against a listing for a one-time migration.

### `%session-changed` closes the control client

- **Decided:** 2026-10-25, design.
- **What:** when tmux moves a control client to another session (its own destroyed
  under `detach-on-destroy off`), the hub closes it and checks the session, which
  reports `sessionClosed`. Only a `%session-changed` naming another session counts:
  tmux also sends one naming the client's own session at attach and for every take
  ("muxen takes tmux's `latest` with a same-session `switch-client`"), and `Session`
  drops those.
- **Why:** a control client belongs to one session for life; reusing it for the
  session tmux picked would bind views to a session nobody watched.
- **Rejected:** adopting the client for the new session.

## Files: find a folder by path completion

### A path field with completion

- **Decided:** 2026-10-25, Jimmy, from first real use.
- **What:** Files gets a path field: type a path; it predicts the next existing folder;
  accepting takes it; a list below narrows as you type. Mobile first.
- **Why:** Jimmy: "/#/files needs a ui rework … there should be a search for a folder
  … maybe like vscode, prediction match the next folder … it should be mobile first".
- **Rejected:** fuzzy search over all folders (needs a server index); both modes in one
  field.

### The field heads Files, and Go opens

- **Decided:** 2026-10-25, design.
- **What:** one field at the top of Files on every platform, showing the current path
  at rest. Editing starts from the current path plus `/`. A row tap, a `/` after a name
  that isn't a folder, Tab, or → at the end accepts the prediction into the field
  without leaving the current folder; Go (Return) opens the highlighted folder or the
  one typed. Completion lists folders only. Hidden folders appear when the segment
  starts with `.` or the hidden toggle is on.
- **Keyboard:** the ordinary text keyboard, not `inputmode="url"`: the iPhone's URL
  keyboard has `/` on its first layer but no space bar, and folder names can hold
  spaces. With the empty-segment rule, Go right after an accept opens the accepted
  folder (a review found Go opening its first subfolder).
- **Why:** at the top the field doubles as the path context Files already had, and the
  best match sits right under it, above the keyboard. A phone keyboard has no Tab, so
  the thumb's accept is the row tap, and `/` (which the user types anyway) accepts a
  prefix ("rep/" becomes "repos/"). Keeping accept and open apart lets the user go
  several folders deep without a listing of files at every step.
- **Rejected:** the field at the bottom in thumb reach, like the session switcher's
  search (the location display would sit at the bottom, and matches would read upward);
  a row tap that opens the folder (every step would leave the field); a ghost-text tap
  target (too small beside the caret); files in completion (Jimmy asked for folders;
  the folder view lists files once opened).

### One listing per folder, never one per keystroke

- **Decided:** 2026-10-25, design.
- **What:** completion filters listings the client holds. Entering a folder fetches its
  listing once, after typing pauses 250 ms, only for the folder the field settles on;
  listings are cached per host for the Files session (32 folders, shared with
  browsing). Folders-only first pages page on to 1,000 folders. Above the roots and
  outside `$HOME`, completion uses the root paths already loaded and asks for nothing.
  No daemon change: `/fs/list` sorts directories first and `/fs/dirs` lists only them.
- **Why:** each request costs a round trip on a spotty link; a folder is entered far
  less often than a key is typed.
- **Rejected:** a `prefix` query on `/fs/list` (a request per keystroke pause, and a
  daemon change for folders with more than 1,000 subfolders); prefetching the
  predicted folder (bytes spent on guesses).

### Add folder becomes the path field

- **Decided:** 2026-10-25, Jimmy and design.
- **What:** the path field completes under `$HOME` outside the roots from `/fs/dirs`,
  marking those rows "not added"; opening such a folder lists its subfolders under
  "Not one of your folders" with "Add this folder", keeping the dialog's refusals
  ($HOME itself, already added, outside `$HOME`, read-only `config.toml`). "Add folder…"
  starts the field at `~/`. The Add folder dialog and its one-folder-at-a-time browser
  are deleted.
- **Why:** Jimmy wanted a fresh install with no root to be usable without editing
  `config.toml` on the host. The dialog was a second folder browser with its own
  field-less navigation;
  the path field now does what it did, faster. "Add folder in Files" rejected a path
  field because there was no way to see what exists; completion is that way.
- **Rejected:** keeping the dialog beside the field (two ways to browse `$HOME`);
  browsing freely above `$HOME` (the daemon confines root selection); putting roots
  in Settings (they are Files state); swipe-to-remove without confirmation.

### `swap-window` is caught by a current-window subscription

- **Decided:** 2026-10-25, design.
- **What:** each owner with a view subscribes to its session's current window id
  (`refresh-client -B 'c::#{window_id}'`); a value naming another window becomes
  `CurrentWindow`, as the notification does.
- **Why:** `swap-window` without `-d` changes a session's current window without
  `%session-window-changed` (it never calls `session_set_current`; tmux's window menu
  offers Swap Left and Swap Right). The session subscription sends one line per change,
  costs one evaluation per owner per second and bounds a swap's lag at about a second.
  It carries no client entries, so it doesn't reopen the rejected session-scoped
  subscription for acts: that one was rejected because its value changes whenever any
  client types anywhere and can't say which window a client is on ("The other client's
  act is seen through the window subscription"); this value is a window id, which
  changes only when the current window does, and carries no clients. Probed on 3.4 and
  3.7b : a line 0.2–0.7 s after each swap that changes the current window,
  `-d` included, and none for typing, idling, a cwd change, a swap of two other windows
  or a window linked twice.
- **Rejected:** `#{window_active}` in each `w<W>` value (an earlier fix: a window
  linked twice into one session sends a 0 line from its other place on every value
  change, about once a second while anyone types, which would re-locate and drop the
  claim each time); polling the session's current window; ignoring swaps (the tab
  would show and vote a window the session no longer shows).

### Scrollback names its pane

- **Decided:** 2026-10-25, design.
- **What:** `historyChunk` carries `pane`; the client drops a chunk for any pane but its
  latest `watching.pane` and restarts its history cache when the pane changes.
- **Why:** a window change made elsewhere swaps the pane under a tab mid-scroll; without
  the pane, one window's rows could sit above another's.
- **Rejected:** a `pane` in the request that the hub refuses when stale (a refusal to
  handle for a race the client can settle alone).

### muxen takes tmux's `latest` with a same-session `switch-client`

- **Decided:** 2026-10-25, Jimmy and design. Evidence: [probe-latest-client.md](research/probe-latest-client.md), [probe-session-follow.md](research/probe-session-follow.md).
- **What:** when a take is due, the owner **takes** `latest` before its vote: when it
  starts voting a window (a new claim, a claim after a yield, a claim on a window just
  made current, the first vote on a respawned client), when the window's size has moved
  off a standing vote since tmux last showed it at the vote (a laptop act the
  subscription didn't report, a review), and on every Fit. A take that leaves the
  window off the vote isn't repeated until the vote is cast again or Fit. The take is `switch-client -c '<client>' -t '$S' ;
  refresh-client -C '@W:CxR'`, its own name (from the startup line) and its own
  session, then the vote. `selectWindow`'s group is the select, then the take. A claiming
  `input` or `paste` writes its take-and-vote group just before its own group. The yield
  is unchanged: another client's act clears the vote, and tmux has already made that
  client `latest` (daemon-core §3.6).
- **Why:** under `window-size latest` a vote only caps, so the phone could never be
  larger than the laptop's terminal: a probe reproduced a 274×53 browser held at the
  laptop's 80×23 after typing. `server_client_set_session` sets `latest` for the
  session's current window on every `switch-client`, the session it is already on
  included; on 3.4 it does so after its own recalculation, so the vote after the
  switch recalculates. The take injects no key, leaves `window-size` alone and dies
  with the control client, so tmux's state never depends on muxen's: after a crash,
  the laptop's next key sizes the window as before. Since tabs follow sessions, a claim
  is always on the session's current window, the one window a switch can take.
- **Rejected:**
  - `resize-window`: it sets the window's `window-size` to `manual`, which muxen would
    have to restore on every yield, and a crash would leave behind.
  - `send-keys -K` for input: keys go through tmux's key tables, so `C-b` starts the
    prefix and the next key runs a binding; on 3.4 ASCII and Enter didn't reach the pane.
  - Keeping the cap (Jimmy's requirement unmet; the band never showed).
  - A take with every keystroke: each take runs the `client-session-changed` hook and
    sends a line to every other control client; the window's size says when tmux has
    stopped sizing by the vote.
  - A take only when no vote stands (the first draft, a review): a laptop key in the
    same second as its last reported act makes it `latest` unreported, and typing on
    the phone would then never take the window back.
  - The switch alone, without the vote after it: 3.4 doesn't recalculate.
  - The take inside the input's own group: tmux skips a group's remaining commands
    after an error, so a failed take would drop keys.
  - Handing the window back to the laptop's size when a claim ends without a yield:
    tmux has no way to make another client `latest`; the window takes the owner's
    client size until the laptop's next key.
- **Cost:** a take is a real `switch-client`: the owner gets `%session-changed` for its
  own session and other control clients `%client-session-changed` (both dropped by
  `Session`); a `client-session-changed` hook runs once per take; the session's activity
  and last-attached times advance; the control client's key table resets (unused). A
  window the owner took and no longer votes takes the owner's client size until a
  terminal acts there. Under `window-size smallest`, `largest` or `manual` the take does
  nothing.

### The band shows whenever the window isn't at this screen's size

- **Decided:** 2026-10-25, Jimmy ("Sized for another terminal" + Fit whenever tmux's
  size differs from muxen's, nothing when muxen holds it), and design.
- **What:** draw the pane at tmux's size and the chosen font, aligned left; wider
  content is clipped, and a smaller window sits at top left. The band appears after
  the window's size differs in either direction for longer than one second or the last
  ping round trip plus half a second, whichever is longer. A claiming send restarts the
  wait; Fit sends this screen's size and takes `latest`. A larger pane uses xterm's DOM
  renderer; `watching` reports the window size.
- **Why:** another terminal's window is for glancing, with Fit one tap away. Once
  muxen holds a window, the sizes match, so a mismatch identifies the situation
  without another daemon flag. Waiting avoids a flash while a claim is in flight.
- **Rejected:** scaling the font (a wide laptop terminal is unreadably small on a
  phone and font changes feed the sizer); CSS scaling (blur and incorrect cell
  mapping); horizontal panning (reserved for the system back gesture); WebGL for an
  oversized pane (a 250×70 canvas at 3× reaches roughly 17 million device pixels,
  past WebKit's canvas limit); a daemon `held` flag (a second fact that could disagree
  with the size); comparing pane size (a split pane is always smaller); showing the
  band immediately or after a fixed second (a slow round trip makes it flash).

### Late completion answers are kept; Back ends a path edit

- **Decided:** 2026-10-25, design.
- **What:** an answer for a folder the path field has left is never shown but is kept
  in the cache, not dropped. Editing the path is a `files/find` router overlay, so Back
  ends the edit before it leaves the folder. The first page a completion fetch gets is
  handed to browsing (opening the folder costs one listing), and a failed listing is
  asked for again.
- **Why:** completion reads only the listing of the folder the field names now, so a
  late answer cannot appear in the wrong place; the bytes are already paid for, and
  backspacing into that folder then costs nothing. Cancelling the pending 250 ms timer
  is what saves requests.
- **Rejected:** discarding late answers (a request wasted for nothing); a second,
  browsing-only cache of the same listing (two copies to keep in step).


### Claim targets and shown windows have different lifetimes

- **Decided:** 2026-10-25, tech lead.
- **What:** a session view keeps the last coherent shown window/pane until its
  owner's Locate answers. Its claim target is the pending selection, otherwise
  the latest reported window once the view has bound, otherwise the shown window.
  Before first binding, a claim waits for Locate. Claims hold a watch and take
  intent, not another mutable copy of the window ID. The owner's tmux subscription
  state owns each window's cwd; `watching` reads the shown window's path from it.
  A select is followed by taking `latest` and the vote in the same group; a change of
  window by another client drops the old claim rather than carrying it to the new window.
- **Why:** independently assigning claim windows in watch, resize and notification
  handlers left claims on windows the tab had already left. Updating only the
  shown window ID exposed new IDs with old names, panes and working directories.
  Two notifications before the first Locate also dropped the initial claim. A session-
  wide claim would carry the phone's size onto a window the laptop switched to;
  selecting before taking and voting avoids two reflows.
- **Rejected:** patching each handler separately (the same invariant still had
  multiple owners); making a view unbound during every switch (rejects input for
  the Locate round trip and discards a still-useful stream); retaining a per-view
  cwd (belongs to a window, not to the session); a session-wide claim; comparing
  `client_activity` to claim time (one-second resolution and two clocks).

### Report the first current-window subscription value

- **Decided:** 2026-10-25, tech lead.
- **What:** the first `c::#{window_id}` value emits `CurrentWindow`, just like later
  changed values. The hub ignores an observation matching its shown window when
  no transition is pending.
- **Why:** silently accepting the first value could miss a `swap-window` between
  the initial Locate and that value. Reporting it costs no extra request when it
  merely confirms the shown window.
- **Rejected:** a silent initial baseline (loses a real change); polling to repair
  it (the subscription already reports the needed fact).

### The keyboard pan keeps the terminal bottom visible unless that would hide the cursor

- **Decided:** 2026-10-26, tech lead; Jimmy agreed either implementation works.
- **What:** tmux keeps the keyboard-down size. When the visible terminal area is shorter
  than its rows, `terminalBottomPan` moves the terminal so its last row meets the area's
  bottom. If that offset would put the cursor above the area's top, it instead puts the
  cursor row at the bottom, as before. It never pans past the last row, does nothing while
  all rows fit, and does not pan while scrolled into history. The dock refreshes its area
  when `Viewport.visibleHeight` changes, including the native app's keyboard resize where
  `keyboardInset` remains 0. The muxen chrome is measured from the surface in a short
  window after layout, density, directInput, width, stable height or the safe area change,
  and at the start, as client-architecture.md §5.4 says; a keyboard changes none of those,
  so a shrinking web view never becomes chrome.
- **Why:** full-screen harnesses often park the cursor above their input/status/footer
  rows; cursor-only anchoring hides those rows. The cursor guard keeps an editor cursor
  near the top visible. Recomputing from `visibleHeight` makes the app use the geometry
  native actually changed instead of waiting on `keyboardInset` or a strip size change;
  measuring the short surface as chrome on every resize could also resize tmux during its
  frame animation before the final viewport message arrived. Guards that compared
  `visibleHeight` with `stableHeight` or checked the focus owner were rejected: they patched
  a per-resize derivation, and the first misfired at fractional zoom, where the visual
  viewport is a fraction below the rounded stable height.
- **Rejected:** resizing tmux to the visible rows while the keyboard is up (each keyboard
  toggle redraws every TUI over a spotty link and resizes the laptop's view); cursor-only
  anchoring (hides harness status lines); bottom-only anchoring with no cursor guard (can
  push a cursor near the top off-screen).

### The terminal long-press selects at once; arrows are keys; a tap near the cursor opens the keyboard

- **Decided:** 2026-10-26, Jimmy, with the tech lead's call to remove the arrow pad.
  Jimmy: "selection - yes"; "if i clicked somewhere where I wanted to enter text, the
  keyboard should open on its own"; "holding finger down and dragging turns into the
  arrow pad IF YOU MOVE, but if you don't move i think it should select the text, and
  then u can drag it with the things to the side (like termius)"; "unless you think it
  would be better ur way to just remove the drag thing".
- **What:**
  - **No arrow pad.** The long-press highlights the word under the finger the moment it
    fires (haptic as before). Dragging while still held moves the selection's far end to
    the cell under the finger, across rows, inside the snapshot; release shows the handles
    and the edit menu (Copy / Paste; Paste alone over a blank cell). No mouse event, in
    mouse-mode apps too. The pad's states, dead zone, range and repeat speeds, and the
    ring that drew nothing useful, are deleted.
  - **← and → join the key row**: esc, ←, ↑, ↓, →, ^R, ^C, tab, ctrl, alt, `|`, `~`, `/`,
    `-`. They repeat while held as ↑ and ↓ do. The four sit together in a keyboard
    cluster's order rather than ←→ apart from ↑↓, which a thumb on one row reads as one
    control.
  - **A tap on the cursor's row, or the row directly above or below it, raises the
    keyboard for the terminal** (the toggle's action) when it is down. The cursor is
    tmux's (xterm `cursorY`); scrolled back into history it is off screen and nothing
    opens. In app mouse mode the tap is still sent as a click and also opens the keyboard.
    A tap never lowers the keyboard; taps elsewhere keep their meaning. The tap that
    raises the keyboard does not also move the prompt's cursor: that happens only when the
    terminal's input held the keyboard before the tap.
  - **`focus select` goes to native when the finger lifts** (superseded 2026-10-30: it goes when the long press selects). The highlight and the drag
    are the web's while the finger is down, over a snapshot layer that takes no pointer
    events, so WebKit's own long-press cannot take the touch and send `pointercancel`.
- **Why:** the pad drew nothing, so a press meant to select looked like a dead control
  once the finger moved past 16 px; hold-to-select with a visible highlight is what iOS and
  Termius do, and arrows as keys cost nothing in the terminal's gesture space. Jimmy had also
  described selection as "long press -> release -> highlight word -> can drag it further". Typing
  where the cursor is should not need a trip to the toggle.
- **Rejected:** using only the keyboard toggle as an opener (Jimmy earlier wanted
  "like termius" and "there should only be 1 place to click to open and close the
  keyboard"); leaving ← and → off the row (Jimmy earlier said "i don't think the
  arrow buttons should be needed" and recall was "probably mostly recalling commands");
  using the spacebar trackpad for terminal arrows ("kinda works, but not that well");
  keeping the pad and adding visuals (a second mode under one gesture, and
  the jitter between select and pad stays).

## Client redesign

### Home is server-first, with Settings behind a gear

- **Decided:** 2026-10-27, Jimmy.
- **What:** Home has a card per server with status, its open terminal and Files tabs,
  All sessions and Files; Add server and enrolment are on Home. One server uses the
  same card and does not cause an automatic jump. Offline, no servers, no sessions and
  tmux not running are distinct states. Home has no phone tab strip. A gear opens a
  separate Settings screen for appearance, terminal text size, device/browser data and,
  in the app, Face ID. The phone browser offers Add to Home Screen.
- **Why:** Jimmy wanted a place to find and manage servers, rather than a screen that
  looked like Settings without showing his servers or sessions. Listing open tabs in
  each card makes a second tab strip on Home redundant.
- **Rejected:** a settings-style Home without server cards; Home as a full-height detent
  of the session sheet; putting Settings directly on Home; an automatic jump for one
  server; retaining a Home tab strip alongside the open-tab rows.

### Sessions and tabs share the phone sheet; desktop uses a popover

- **Decided:** 2026-10-27, Jimmy.
- **What:** a current-tab button opens a half-height sheet over the current phone tab;
  Home opens a full-height sheet with Back. Its session list has search, server groups
  and open markers. In the half-height sheet a horizontally scrolling strip at the bottom
  has the open terminal and Files tabs, × on the active tab, and + for New session /
  Browse files; the full-height sheet has no strip (Home lists the open tabs) and puts +
  beside search. Swiping
  scrolls the strip; tapping a tab switches the view behind without closing the sheet.
  Desktop has Home, tabs and + across the top; + opens a session popover with the same
  creation choices, not an attach-only modal.
- **Why:** Jimmy can see a switch happen in the background and reach tabs and creation
  in the thumb zone. The current-tab button leaves the terminal with less chrome.
- **Rejected:** the tall sheet with tabs at the top and × on each; closing the sheet on
  every tab switch; a phone terminal tab strip with its own +; an attach-only desktop
  picker and a separate Files rail.

### Terminal tabs continue to follow the current session window

- **Decided:** 2026-10-27, Jimmy.
- **What:** a terminal tab remains a tmux session, opening on its current window and
  following it. Only sessions with multiple windows offer a window-switching control;
  on the phone it is within the sessions sheet. The exact control and the route for
  creating a window in a one-window session remain open. Selecting a window changes
  the shared tmux session, so an attached laptop follows it; Jimmy accepted that.
- **Why:** Jimmy uses windows infrequently and agreed that the current window makes more
  sense than selecting the first; the tab continues to match the session as other
  clients change it. tmux prefix keys do not switch windows from muxen: `send-keys`
  writes to the pane past tmux's key tables.
- **Rejected:** making each tab a fixed tmux window; selecting the first window on open;
  a window switcher visible for every one-window session; a separate phone window
  strip, which would lose a terminal row and resize tmux as window count changes.

### Multiple Files tabs keep independent places

- **Decided:** 2026-10-27, Jimmy.
- **What:** any number of Files tabs may coexist, including several on a server. Each
  keeps its own folder or open file locally and uses that name as its label. Home Files
  and Browse files open a new tab at the selected server's folder list (its roots); existing tabs
  are reached in Home or the tab strip. A new tab starts at the folder list rather than
  `$HOME`, because outside a root the file API lists subfolders only.
- **Why:** Files is a peer of the terminal, and Jimmy can keep more than one place open
  without losing a folder or preview when switching.
- **Rejected:** one Files destination shared by every tab; the earlier proposal of one
  Files tab per server; opening at the active terminal's cwd by default.

### A parent row and path field navigate Files

- **Decided:** 2026-10-27, Jimmy.
- **What:** Files retains its path field and uses a “‹ parent” row at the top of the
  list, absent at a root; swipe Back also navigates back.
- **Why:** moving up stays in the list and does not need another row of chrome.
- **Rejected:** a separate up button in the path bar; folder accordions.
- **Superseded on a desktop** by "A desktop's Files list is an outline" (2026-11-05): folders open in
  place there; the phone keeps one folder per screen and the `..` row.

### Keep Mermaid in the Markdown viewer

- **Decided:** 2026-10-27, Jimmy (“mermaid is important”).
- **What:** render Mermaid in Markdown in this redesign rather than waiting for v2.
  Load it lazily, use strict mode, and sanitize the rendered content with DOMPurify.
  Markdown uses an allowlist; clicks in a document are cancelled and links and image
  maps are passed to the link handler, so a rendered `<area>` cannot navigate the app.
- **Why:** diagrams are part of the documents Jimmy needs to read; untrusted rendered
  content must remain sanitized.
- **Rejected:** deferring diagrams with the rest of repo-viewer parity; rendering
  Mermaid without the existing strict and sanitization boundaries.

### Mermaid ships in the daemon's shell, outside the precache and the shell budget

- **Decided:** 2026-10-27, tech coder (build slice 6), where the spec left it open;
  revised the same day after the security review (below).
- **What:** Mermaid 12.1.0 (exact pin) loads only when a Markdown preview holds a
  `mermaid` fence. Its chunks (114 files, 921 KB gzipped)
  are embedded in the daemon like the rest of the build, but the service worker does not
  precache them and `checks.mjs` budgets them apart (1.4 MiB gzipped) instead of in the
  1.5 MiB / 64-file shell budget; a diagram on a spotty link costs one on-demand
  download. Initial JS rose from 195.8 to 196.0 KB gzipped (the lazy-loading glue and
  the code that lets a fence's class through), so its budget went from 196 to 197 KB.
  The daemon's embed caps rose from 3 MiB and 128 files to 8 MiB and 192 files
  (`build.rs`), because Mermaid alone is 4.7 MB raw; the per-file cap stays 1.5 MiB.
  The memory ceiling table counts the larger file-backed, reclaimable shell pages.
- **Also:** KaTeX is replaced by a stub (a `$$math$$` label fails with the "couldn't
  render" note), saving 260 KB raw. A diagram that fails to parse stays as its source in
  a code block with "Diagram couldn't render: <first line of the error>" under it, and
  Mermaid's own error drawing is removed from the page. Diagrams draw at their natural
  width and scroll inside their own box (no zoom or pan). The theme is Mermaid's `neutral`
  in light and `dark` in dark, not the app's tokens (Mermaid cannot read OKLCH).
  The SVG Mermaid returns passes DOMPurify's SVG profile again, minus `foreignObject`
  and `image`, with `href` limited to in-document fragments and `@import` and non-fragment
  `url()` removed from its styles.
- **Review round:** every render starts from `mermaidAPI.reset()`, because a document's
  config is stored before it is validated and one bad colour otherwise broke every later
  diagram; `htmlLabels` and `layout` join Mermaid's `secure` keys, so frontmatter cannot
  turn labels into the `foreignObject` the sanitizer removes; `a` is forbidden in the
  SVG (a diagram link was a dead tab stop); the CSP is what refuses Mermaid's
  pre-sanitize image fetches, and the module says so. Diagrams use the `dagre` layout
  and elkjs (1.4 MB raw, 600 KB gzipped) is stubbed: diagram files fell from 1347 to 921 KB
  gzipped, and the largest file is now 709 KB raw against the 1.5 MiB per-file cap.
- **Diagrams need the network.** Their files are not precached, so a page one build
  behind finds them gone. The worker reports a 404 for an `/assets/` file it has no copy
  of (`buildGone`) and the app raises "Update required" with Reload, an `update` state
  beside `ready` and `reload` (browser-behaviors.md "Offline and updates"). A load that
  fails otherwise leaves a note under the fence, and the loader tries again on the next
  document; Chromium keeps a failed module URL failed for the page's life, so there only
  a reload recovers (Safari retries).
- **Rejected:** precaching the diagram chunks (about 1 MB on every install, for a
  feature most documents don't use); a single Mermaid chunk (rolldown's `manualChunks`
  also pulls in each chunk's dependencies, including the sanitizer the app's entry
  shares); keeping ELK (Mermaid 12.1 draws flowcharts with dagre when told to);
  detecting the 404 in the page (Safari's import error carries no URL, and a probe of
  the precached loader is answered from the cache); loading Mermaid from a CDN
  (nothing loads from outside the host).

### Choose System, Light or Dark; use a black dark terminal

- **Decided:** 2026-10-27, Jimmy, approving the redesign direction.
- **What:** Settings offers System / Light / Dark on the app and browsers. System
  follows the device; explicit choices override it. The approved dark direction uses a
  true-black terminal and neutral greys. The native app and web use the same effective
  scheme.
- **Why:** Jimmy wanted a selectable light and classic dark appearance rather than
  being limited to the phone's current system choice.
- **Rejected:** system-only appearance and the existing blue-tinted dark terminal.
  True black was the brief's assumption, not a separately recorded comparison with
  near-black.
- **Extends:** “Browser theme tokens set the minimum browser floor”; the choice now
  participates in selecting the effective scheme.

### Phone dock: current tab at rest, compose above keys when typing

- **Decided:** 2026-10-27, Jimmy.
- **What:** with the keyboard down the bar has the current-tab button, tab count and
  keyboard control, without a tab strip or +. With it up, no session pill shows; an
  always-visible compose box sits above a text-only key row with Hide keyboard. The row
  meets the keyboard, except for Safari's system form bar, and the resting bar meets the
  bottom inset. Files and previews use the same current-tab bar.
- **Why:** Jimmy wanted the session sheet behind a button, the keys nearest the thumbs,
  an available compose box and no empty band. He accepted Safari's system form bar.
- **Rejected:** a tab strip on the terminal; a session pill while typing; hiding or
  shrinking away the idle compose box; placing the key row above the box; reserving a
  blank band beside the keyboard or home indicator; copying the Termius dock exactly
  (Jimmy: "i don't think we should EXACTLY copy termius"); tabs on top ("hard to reach");
  the earlier "one row at rest" that also placed the compose field in the resting bar.

### The compose box and terminal make focus visible and switchable

- **Decided:** 2026-10-27, Jimmy.
- **What:** the idle compose box has no caret while the terminal cursor is solid. When
  composing, the box has a ring, caret and Send, the terminal cursor is hollow, and
  Send keeps box focus. A terminal tap or esc returns
  typing to tmux without lowering the keyboard. While composing, ← and → move the
  box caret; ↑, ↓, ^R, ^C, tab and other terminal keys still go to tmux, with their
  destination visible in the key row.
- **Why:** a blinking box caret alongside the terminal cursor obscured where typing
  went, and escaping the box previously required lowering the keyboard. Jimmy asked to
  "note the difference when the focus is different" in his Termius reference.
- **Rejected:** two active typing cursors; forcing a keyboard close to return to tmux;
  a separate "type in the terminal" button in the compose row (Jimmy: "i dont think we
  need it": esc and a terminal tap already do it);
  sending esc and horizontal arrows to tmux while the box is focused; sending all the
  key-row controls to the box; a field as the only keyboard opener, which loses live
  typing for shell completion, vim and prompts.

### Bell attention: BEL in the stream, plus one runtime alert-bell hook

- **Decided:** 2026-10-27, Jimmy (“if we can find it”; the hook: “yes, although wait for
  my tmux restart”; the agent setting: “okay with that change (but u need to also add it
  to muxen docs)”).
- **What:** an attention dot on session rows, tabs and the current-tab button marks a
  terminal bell since this device last showed the tab. The streamed tab's BEL comes from
  pane output; other sessions are covered by one server-global `alert-bell` hook muxen
  appends at runtime and removes on stop, recording the session in a muxen user option.
  muxen keeps "seen" itself. Users make agents ring BEL (Claude Code:
  `preferredNotifChannel: "terminal_bell"`); running.md documents it with the feature.
  The hook reaches Jimmy's live server only after his planned tmux restart. Show a
  connection indicator on the terminal only when not live; it is separate from the dot.
- **Why:** an agent may need attention without the user watching its tab. Probes
  showed the same behavior on 3.4, 3.7b and 3.8: BEL arrives in `%output` with no
  separate notification; the global hook fires for current and other windows and
  can mark the session with `set-option -F`; `set-hook -a` keeps the user's own hooks.
- **How the daemon learns of a marker:** a local `list-sessions -F` every few seconds,
  only while a device is connected, reporting changes only (Jimmy: "do u think we SHOULD
  add a little bit of polling...?"). Rejected: a hook-run command per bell (another
  process and a callback path into the daemon for no gain).
- **Rejected:** reading tmux's `window_bell_flag` (shared with every client, cleared
  when any client looks, and not set for a current window while a client is attached);
  `refresh-client -B` subscriptions (scoped to the control client's own session);
  editing `.tmux.conf` or changing `monitor-bell`/`bell-action` to widen
  coverage; per-session hooks that would override a user's own session hook. Accepted
  limits: a session-level user hook shadows muxen's global one, and `monitor-bell off`
  or an excluding `bell-action` suppresses it.

### Face ID relock is selectable, not disabled

- **Decided:** 2026-10-27, Jimmy.
- **What:** keep the Keychain and Face ID lock, with a Settings choice of 5 min, 1 hour
  (default), or At launch. At launch means one unlock per process launch, not removal of
  Face ID protection from the Keychain item.
- **Why:** frequent prompts were annoying, while keeping Face ID preserves the token's
  biometric boundary at launch and at the chosen relock points.
- **Rejected:** disabling Face ID and re-saving tokens without biometry; fixed five-minute
  relock; calling the launch-only choice “Never”.

### Compact phone headers

- **Decided:** 2026-10-27, Jimmy.
- **What:** use one 44 pt phone header row, with a back icon where the screen has a
  parent and a 17 pt title; no large titles.
- **Why:** Jimmy wanted Settings higher and more vertical space for the content.
- **Rejected:** large titles and a separate back/header row.

### Back is at the top on pages, at the bottom only on tabs

- **Decided:** 2026-11-05, Jimmy ("the back button on the settings is still at the bottom", then of the
  choices put to him: "Top on pages, bottom on tabs").
- **What:** Settings, Open session and the tab list put Back at the top left of their header on the
  phone too; they have no bottom bar. Terminal and Files tabs keep ‹ in the dock's tab row.
- **Why:** with the gear moved to the top, Settings opened from the top and closed from the bottom.
- **Rejected:** Back at the top on tabs too (a terminal row, and a reach); Settings alone.
- **Supersedes:** the "bottom everywhere" part of "Home and a tab are the two levels; Back sits where
  the dock is" (2026-10-31), for pages. `BottomBar`, `PageBack` and the dialog footer are gone.

### Settings' gear is in Home's header on the phone too

- **Decided:** 2026-11-05, Jimmy ("I feel like on phon,e the settings should be at the top as well").
- **What:** the gear sits at the end of Home's header on every layout; Home has no bottom bar. Back
  stays in the bottom bar on docked screens (the 2026-10-31 rule), since Home has no Back.
- **Rejected:** keeping the gear in a bottom bar of its own (the lead's recommendation, for reach and
  for the 2026-10-31 "bottom everywhere" rule).
- **Amends:** "Home and a tab are the two levels; Back sits where the dock is" (Home's Settings no
  longer in a bottom bar).

### One header row on every screen

- **Decided:** 2026-11-05, ux lead, for Jimmy's "consistency" ask.
- **What:** Home, the tab overview, Settings and Open session share one header, `ScreenBar`: back
  icon (desktop; docked screens keep it in the bottom bar), title left-aligned in the column,
  controls at the end, a rule under it.
- **Why:** three headers had drifted: the overview centred its title behind a text "‹ muxen"
  button, Settings had no rule, Home its own bar.
- **Rejected:** keeping the overview's named text back button (the icon's label still names where
  Back goes).

### A launch opens where you left off, and the address names it

- **Decided:** 2026-11-05, Jimmy ("we should record more information in the …/#/tab address... we
  should be able to get back to where ever we left off at"; then, of the choices put to him: reopen and
  explain an unreachable server in place; the address carries the tab and the Files folder or file; the
  app reopens too; "readable i guess").
- **What:** a launch (a reload, a bookmark, a copied link, the app after iOS killed it) opens the place
  the hash names, else the route last shown (saved with the workspaces), else Home. The hash reads
  `#/`, `#/tabs`, `#/term/<session>`, `#/files/<path>` (a folder ends in `/`; `~/…` under home). It
  names no server: a browser page talks to one host, its own origin. A session with no tab shows the
  overview; a Files place with no tab showing it opens a new Files tab there. Back from it is Home. A
  server that is down is explained on the tab itself ("Can't reach pop-os" with Retry).
- **Why:** landing on Home after every reload threw the place away, and the tab already explains an
  unreachable server, which was the reason for the earlier rule.
- **Rejected:** an opaque tab id in the hash (a reload works but a link can't name a folder); a server
  name segment (it repeats the origin, and a browser learns the host's id only after `/auth/info`).
  Accepted cost: file paths and session names now enter browser history, which iCloud and Google sync;
  client-architecture §6.6 had kept them out for that reason.
- **Supersedes:** "A clean launch opens Home" (below).

### A clean launch opens Home (superseded 2026-11-05)

- **Decided:** 2026-10-27, Jimmy ("I think we should default to home from a clean
  launch...? what if muxen isn't running anymore?").
- **What:** a cold start opens Home even when tabs are saved; the saved tabs are listed on
  their server cards. Returning from the background keeps the screen the user left.
- **Why:** if the daemon or server is down, reopening the last tab would land on a
  reconnecting terminal with no explanation; Home says what is unreachable and offers
  Retry.
- **Rejected:** reopening the last tab on launch (the lead's earlier proposal).

### Several servers are a product rule

- **Decided:** 2026-10-27, Jimmy ("multiple servers becomes a product rule").
- **What:** muxen serves several servers at once: Home has a card per server, the
  sessions sheet groups by server, and tabs from different servers coexist. The app
  already connects to each host directly; the browser/PWA stays bound to its page origin
  until a multi-server browser design keeps its admission boundary.
- **Why:** Jimmy runs muxen on more than one machine (pop-os and his Mac), and the
  redesigned Home and sheet are built around server cards and groups.
- **Rejected:** one host in the MVP with a layout that merely allows more later (the
  lead's lean), since it would ship Home and the sheet in a shape the product rule then
  changes.

### Invariants are separate from decisions; test tmux 3.4 and 3.8

- **Decided:** 2026-10-27, Jimmy ("tailnet is a product rule, Supported tmux versions
  should not be an invariant... its just what we tested, process is not an invariant";
  "we should be testing against tmux 3.8").
- **What:** plan.md opens with four invariants (tmux is the source of truth, network
  bytes cost the user, light on the host, content never runs as the app) and says that
  everything else is a decision: product rules, engineering standards, the interaction
  design and test coverage. Tailnet-only access is a product rule. Test coverage is tmux
  3.4, the oldest supported, and 3.8, the newest; recording 3.8 fixtures is open work.
- **Why:** the specs mixed invariants with decisions, so a reader could not tell which
  rules may change through this log. Network polling and host work have different
  costs: a local check that sends nothing over the network and runs only while a
  client is connected can respect both constraints.
- **Rejected:** treating tested tmux versions, the build process or the code structure
  as invariants; keeping 3.7b as the second tested version.

### Saved workspace v3 discards v2 and v1 whole; drafts stay

- **Decided:** 2026-10-27, tech lead, in the redesign build plan (structure review p320).
- **What:** the saved workspace is version 3: tabs in order (a terminal tab as before, a
  Files tab with its id, host and place) and `active` by id. One web parser takes what
  storage returns as `unknown` and returns version 3 or null; it discards version 2 and
  version 1 whole, and the storage adapters no longer know versions. It also drops a
  repeated tab id (the first wins) and carries `lastTerminal`, the terminal tab last
  activated per host. Drafts are not cleared with the workspace: a draft keyed by a
  session `TabKey` returns when that session is reopened. The one exception is at the
  storage boundary: the browser adapter's `drafts.list()` drops any record whose key is
  not a session `TabKey`, because a build from before tabs followed sessions left drafts
  keyed by window, which name no session and would crash the drafts reducer at boot. This
  replaces the earlier rule that a version-1 workspace also cleared every draft.
- **Why:** the earlier clear existed because a window-tab draft named no session. A
  session-keyed draft is still correct after the workspace is discarded, and a clean
  launch opens Home, so the tab list is cheap to rebuild from the server cards.
- **Rejected:** converting version 2 (a compatibility branch for one tab list per device);
  clearing drafts along with an old workspace.

### Files tabs: the workspace owns the place, history is a record

- **Decided:** 2026-10-27, tech lead, in the redesign build plan (structure review p320).
- **What:** a tab is a terminal tab or a Files tab, each with a stable id and a host. The
  workspace owns a Files tab's place and writes it only from `navigated`; a history entry
  records `{tab, place}` so Back returns to an earlier folder without a new request.
  While a tab route shows, the current entry always names the active tab (see "The
  current history entry names the active tab"), so a drill-in is a plain push of
  `{tab, to}`. A Back that lands on an entry whose tab is gone or not active goes to
  Home's entry in one `history.go(-n)` computed from the in-memory stack, announcing
  nothing for the stale entry; a tab switch under an open overlay rewrites the overlay's entry
  too. The router keeps the whole history stack with a cursor, so a
  Forward after a Back stays in it. There is still one `FileBrowser` per host: it shows
  the active Files tab's place and reports the daemon's canonical path back, which
  replaces the entry's place; that report, and a Markdown link's probe, are dropped by one
  cancellation, the pane's per-place effect, and both act on the active Files tab. A Files
  tab's label is its folder or file name, and "Files" at the folder list. Insert path and
  uploads go to the host's `lastTerminal`, the terminal tab last activated and still open,
  saved in the workspace; with none, they are disabled with "Open a terminal tab first".
  Any change that leaves no tab while the route is a tab navigates Home, in the reducer.
- **Why:** one owner for a place means a tab switch, a reload and Back cannot disagree
  about where a tab is.
- **Rejected:** a `FileBrowser` per tab (a lifecycle that tracks tab open and close for no
  gain: the per-host listing cache restores a tab's folder without a request, as
  browser-behaviors.md "Cost on a spotty network" says: the first pages of the 32 most
  recently loaded folders, filled by the path field and by browsing, dropped by a refresh
  or an upload, and a probed file is likewise held); Back as the in-app
  parent only (it misses the history rule in browser-behaviors.md "Browsing by tap");
  inserting into the active tab (a Files tab is never a terminal).

### The current history entry names the active tab

- **Decided:** 2026-10-27, slice 1 strict review (p330).
- **What:** on a tab route the controller rewrites the current history entry to
  `{tab, place}` whenever the active tab changes (no entry is added; since 2026-10-31 the
  earlier tab's entries go too, see "A tab switch drops the earlier tab's entries"). The
  router's entry names the active tab, except for the moment a switch's history step is in
  flight; a pop to an entry of any other tab is stale and skips to Home. `Entry` is a union (`home`, or `tab` with
  its place), `history.state` is checked at the boundary including the place, and the
  router emits the `Entry` itself. A host's `Folders` holds one bounded record per folder
  (subfolder names and first page), and each Files session's scroll positions are bounded.
- **Why:** the first design stamped the entry only on a drill-in, so after any tab switch
  the entry named the tab pushed last and the controller's guard dropped every tap in the
  switched-to Files tab. A record that copies its owner and is trusted as the owner goes
  out of date; rewriting it at the one place the owner changes ends the class.
- **Rejected:** stamping before each push (the stale copy stays and every reader must
  distrust it); a guard on the controller's taps (the bug moves to the next reader).

### Switching between tabs adds no history entry

- **Decided:** 2026-10-27, tech lead, in the redesign build plan.
- **What:** moving between a terminal tab and a Files tab, or between two tabs of the
  same kind, with the tab route showing, adds no history entry. Only Home to a tab, a tab
  to Home, a Files drill-in and an overlay push one. Routes are `home | tab`; the screen
  (`home`, `terminal` or `files`) is derived from the route and the active tab, and focus
  follows that screen, not the route.
- **Why:** browser-behaviors.md states "tab changes are not history" for terminal tabs
  only; extending it keeps Back meaning "leave this tab's folders, then leave to Home".
  The folders are the shown tab's only: a switch drops the earlier tab's (below).
- **Rejected:** an entry per tab switch (Back would replay every switch).

### A tab switch drops the earlier tab's entries

- **Decided:** 2026-10-31, ux-lead, from the swipe-back review (c419, p438) and its router review (p440).
- **What:** a tab switch with no overlay open (and an overlay's close after a switch under it) goes back to the
  entry under the workspace's run of tab entries, Home, and pushes the new tab there: history is Home, then the
  tab, with nothing forward. The pop it waits for is named by entry id; a different traversal that lands first
  (a quick Back or ‹ Home) wins and the switch's push is dropped. With nothing under the run (an entry from an
  earlier page life) the entry is replaced.
- **Why:** a Files tab's folders stayed below the tab switched to. A back swipe from it showed WebKit's snapshot
  of the earlier tab, then the stale entry bounced to Home; Forward from Home did the same.
- **Rejected:** leaving the stale entries with the bounce; skipping stale entries in the pop's direction (still two
  steps, still the snapshot); a replace of the first entry of the run (left the earlier tab's entries forward of
  it, so a second Forward bounced); tab entries that never stack (Files folders need their own entries for Back).

## Harness UI tests removed; real-daemon e2e kept as scripts

- **Decided:** 2026-10-27, Jimmy.
- **What:** the Playwright specs that ran against the harness's fake daemon (Files, Home
  keyboard, PWA, admission, navigation, routes, the axe checks), their helpers,
  `@axe-core/playwright`, the `e2e` script and `MUXEN_PREFLIGHT_E2E` are deleted. Kept: the
  harness and its fixtures (every state has one, for looking at it), vitest, Rust and Swift
  tests, and the `*.real.ts` end-to-end scripts on `e2e/shared/stack.ts`. Those run a real
  daemon on a private tmux 3.4 and 3.8, opt-in and never in preflight, to exercise full
  behaviour end to end and, later, to record performance (not built yet).
  `pnpm --dir web run e2e:stack` starts the isolated stack alone and prints its URL, so a
  prober can drive it by hand without touching Jimmy's sessions. Verification is structural
  review, probes on the running system (harness, real stack), and the device checklist.
- **Why:** Jimmy: "we shouldn't have any ui tesets, u should just make the code strong enough
  that it shouldn't happen or we shouldn't be able to question it in the first place (code
  structure over if statements)", then "i don't think i've ever seen ui tests catch anything
  really", then "e2e scripts maybe (to test the full behavior, and record performance)".
- **Rejected:** keeping the harness suite, opt-in or in preflight (it checks a fake daemon's
  idea of the app, and costs a browser install and maintenance every change).

## Phone sessions sheet: list, row tap keeps the sheet, windows under the active row

- **Decided:** 2026-10-27, Jimmy, answering the redesign's open details.
- **What:** (1) the sessions sheet lists sessions, not a grid ("List"); (2) a session-row
  tap opens or activates that tab behind the sheet and the sheet stays open, the same as a
  tab in the strip ("it should open the tab, not close the sheet? (be consistent with
  tabs?)"); dismissal is the backdrop, Back or Escape; the desktop popover still closes on
  selection; (3) the active tab's session row lists its windows beneath it when it has more
  than one ("Under the active row"): "index: name", the latest `watching` window marked
  "shown", a tap runs `select-window` and choosing the shown one does nothing; other rows
  show a window count. New window has no button on the phone this pass (`prefix c`).
  Browse files, like a row tap, leaves the sheet open on the new Files tab (tech coder's call).
- **Also:** one `sessions` overlay replaces `picker` and `switcher`; tabs switched under an
  open sheet replace its history entry, and a Back that closes the sheet repairs the entry
  below it (`Router.popped`) so Back leaves the sheet in place and the next Back goes Home.
- **Rejected:** a grid; closing the sheet on a row tap; keeping the base entry in step
  (browser history can only replace the current entry); a window disclosure chevron.

## The opener chooses the sessions overlay's form

- **Decided:** 2026-10-27, tech lead, from review of the sessions sheet.
- **What:** the current-tab button opens `{ screen: "sessions", name: "sheet" }` and the
  top row's + opens `name: "picker"`; `Sessions` renders by name and never reads the layout.
  The sheet's New session and Browse files use the active tab's own server, else the first
  server when no tab is open, and are disabled with the reason when that server is unknown
  or unreachable; they never fall back to another server. An empty server's list says "No
  sessions on X" and no hint, since the controls that create one sit beside or below it.
- **Why:** "which button opened it" and "which form it takes" were two rules for one fact:
  a narrow desktop window (mouse, top row) got the phone sheet, opened it on Home, and Back
  later reopened it.
- **Rejected:** one viewport-derived value read by both (the form would still change under
  an open overlay).

## Desktop +: a popover with the windows rows, replacing the windows menu

- **Decided:** 2026-10-27, tech lead (slice 2b), applying the 2026-10-27 popover decision.
- **What:** + opens the `picker` overlay as a popover under the top row, anchored to +: search
  in focus, sessions by server, the active session's windows under its row, New session and
  Browse files. A pick closes it and then acts. The windows menu on the active pill and its
  rows are deleted; the popover's rows are the one renderer of "index: name", "shown" and
  "the shown window does nothing". Desktop has no New window button either, as on the phone.
- **Why:** two renderers of the same rows could drift (p335 #3).
- **Rejected:** keeping the pill's windows button beside the popover (a second path to the same
  rows); a popover built outside `Dialog` (it would redo Escape, focus return and the router
  tie-in).
- **Cost:** the desktop's only New window path goes; `newWindow`'s creation form stays in the
  code, unreachable, for the lead to keep or delete.

## Keyboard-up dock: one routing rule, and a native caret step

- **Decided:** 2026-10-27, tech lead (slice 3, bridge v6).
- **What:** the Dock is `resting` (current-tab button, Show keyboard) or `typing` (compose box
  above the key row, Hide keyboard at the row's end), derived from the focus owner; the row is
  one height in both, so the keyboard never resizes tmux. Where a key-row key goes is one pure
  function, `routeKey(key, owner, armed)` (`web/touch/keyRoute.ts`): terminal input, a caret step,
  focus the terminal (esc), or a line insert. The browser textarea and the native line take the
  same decision, and the key row marks the keys it sends to the box. A caret step is a dock
  callback: the textarea steps by grapheme (`Intl.Segmenter`); native gets `lineCaretStep(-1|1)`
  and steps with UIKit's own positions (`position(from:in:offset:)`), so the text, the caret and
  marked composition stay native's. While marked text is up the step is dropped: the composition
  belongs to the keyboard until it commits. A hardware Esc in the native line does what the row's
  esc does. A terminal tap with the keyboard up gives typing to the terminal wherever it lands.
  esc and that tap use the existing `focusTarget("terminal")`.
- **Also:** a blur that hands focus to the other input (terminal ⇄ line) is not a release; the
  focus controller waits for the focus event that names the new owner. Reporting `none` between
  the two rendered the dock at rest and hid the compose box before it could take the focus.
  The desktop "New window" client path is deleted (`CreateDialog` creates sessions only);
  `newWindow` stays in the daemon (`src/proto/.context/FUTURE`).
- **Why:** two editors with their own copies of the table would drift; a native caret is
  UIKit's to move, since the 33 ms arrow repeat would race a web-computed index against the
  `lineEdit` echo.
- **Rejected:** a web-computed caret index sent through `lineCaret` (that race, and it breaks
  marked composition); committing the composition and then stepping (it ends a composition the
  user did not end; revisit on device if dropping the step feels dead).
- **Send:** the box shows a Send button while it owns typing; it acts as Return (the line, then
  Enter; focus stays) and takes no focus (`DockButton`). In the app native holds the text, so the
  button sends the web-to-native `lineSubmit`, which runs the same code as native's Return key.
  Part of v6, which no build has shipped.

## Home is server cards; Settings and a server's sessions are page dialogs

- **Decided:** 2026-10-27, tech lead (slice 4).
- **What:** Home is one `ServerCard` per host (name, status, that server's open tabs, All N
  sessions, Files, or what its state needs: Retry, "tmux isn't running", New session). Home has no
  search and no Settings row; the gear in its header opens Settings. Settings and the server's
  full-height sessions sheet are router overlays rendered as `Dialog variant="page"`, not routes.
  The browser shows its one origin and no Add server. "Last reached" is the cache's in-memory
  `reachedAt`: a page that has never reached the host says so. (Replaced: see "Last reached is saved
  with the workspace".)
  The desktop workspace no longer focuses Home search on closing the last tab; the search is gone.
  Appearance and terminal text size are left out of Settings until slice 5 can store them.
- **Why:** overlays give Back, Escape and focus return for free; a route needs a `Route`, a hash and
  a saved form for a screen with no state of its own.
- **Budget:** the initial JS budget went from 197 to 198 KB (197.4 measured): the card, the page variant and the menu are code Home needs at launch.
- **Rejected:** a Settings route; flattening one server's sessions into Home; persisting last-reached.

## One mount per overlay name; one anchored dialog; row state as one callback

- **Decided:** 2026-10-27, tech lead (slice 4, from review p342).
- **What:** `Picker` is mounted in `Shell` beside `Sessions`, so a sessions overlay name has its
  renderer whatever the layout (it was inside `TopRow`, which unmounts when a window narrows,
  stranding the router entry). `Dialog`'s variant is `"dialog" | "sheet" | { kind: "popover" |
  "menu", to }`: an anchored dialog goes under its anchor (an element or a registered focus
  target; centred if absent), above it when there is more room there, and is re-placed on
  resize. The sheet's `+` is `NewMenu`, a `menu` dialog of plain buttons; the full-height server
  sheet reuses it. `HostSessionLists` hands `SessionList` one `rowOf(session)` ("here", "open" or
  none; the bell joins it), and `NewActions(host)` is the one renderer of New session and Browse
  files, both through `commit`, so a picker's New session now closes it first, like its other picks.
- **Why:** a mount tied to layout reintroduced layout as a second fact deciding an overlay's
  form; three copies of the `+` menu and two lists of the two actions were coming.
- **Rejected:** a `role="menu"` with hand-rolled focus and arrow keys (a modal dialog gives
  Escape, containment and focus return for free; plain buttons need no menu keys); making the menu
  a router overlay (a `+` menu is not a place Back should land on, and the sheet unmounting it is
  simpler).

## Review fixes to the keyboard-up dock: one dispatch, one action per tap

- **Decided:** 2026-10-27, lead (slice 3 fix round, from review p343).
- **What:** `routeKey` returns `{ route, armed }`; `ArmedModifiers.route(key, owner)` reads the
  live armed state, commits the modifier the key uses and sends terminal input, and every caller
  (key row, including each repeat tick; the browser field's `beforeinput` and Esc; the native text
  path) goes through it. `chord()` and the callers' own `disarm()` are deleted, and the owner type
  is `"terminal" | "line"`. A held armed ← sends one `C-Left`, then steps the caret: the repeat
  timer used a render's copy of `armed`. A held hardware Esc in the native line no longer sends
  Escapes to tmux: repeats stop on a focus-mode change. The browser's caret step drops during
  IME composition, as native's does.
- **Taps:** with the keyboard up and the box owning typing, a terminal tap does exactly one thing,
  gives typing back to the terminal: no mouse click, no cursor move, and the next tap acts as
  usual. `tapAction(...)` resolves every tap to a single action.
- **Rejected:** a tap that both returns typing and clicks (an unintended click in vim or htop
  mid-line is worse than one extra tap).

## The dock's key dispatch is one controller method; a sheet no longer returns the keyboard

- **Decided:** 2026-10-27, lead (from re-check p350).
- **What:** `TerminalsController.key(key)` reads the live owner, routes through
  `ArmedModifiers.route` and carries out every route kind: terminal, `focusTerminal`, and the
  compose box's insert and caret step through one `LineEditor` (`dock/lineEditor.ts`):
  `nativeLineEditor(platform)` in the app, the browser one the mounted `LineField` registers on
  the controller beside its textarea and IME flag. The key row, the browser Esc and the native
  text path are each one call; Dock holds no editor, ref or composition flag. Browser Send drops
  while the IME composes, as native's does. (The browser `beforeinput` stays on `route`: it
  only decides whether to cancel the insert.)
- **Dropped behaviour:** "the keyboard comes back to the input that held it after a sheet" no
  longer applies. The phone's key row replaces the sessions button while typing, so the sessions
  sheet cannot open with the keyboard up, and the wide-screen picker returns focus to `+`. The
  spec lines in `browser-behaviors.md` and `plan.md` say so; the e2e test for it was removed
  in slice 3.
- **Rejected:** `key(key, editor)` with the caller passing the editor (every caller would pick
  the platform's editor again).

## Slice 4 fixes: one tab state, one card state, variants mean placement

- **Decided:** 2026-10-27, tech lead (slice 4, from reviews p347 and p348).
- **What:**
  - Home's tab rows come from `tabPills`/`lookOf`, the derivation the top row and the sheet strip
    use; a row's words are `pillMeta`. A tab sits on its host's card by id; the lone-host stand-in
    applies only while that host's id is unknown. With the host list complete, `hostsKnown` drops
    every tab of a host that is gone.
  - `cardOf(host, sessions)` returns the card's body and whether Files is offered. The body kind
    decides the status word (`STATUS`), so a card can't read "live" over an offline body. Home's
    empty body offers New session alone; Files is the card's own row.
  - Clear local data: `Persist` treats the tabs open at the time as unsaved until they close.
  - A listing is asked for on entering each listing surface (Home, the picker, the sheet, a server's
    sheet), keyed by surface name, so Home to a server's sheet lists again.
  - `app.retryHost` is the one Retry; Home hides the unreachable host's banner, since its card says
    so and offers the Retry.
  - `Dialog`'s variant means placement only. Top rows are `TitleBar`, `ToolBar` and `PageBar`,
    passed as `header`; the dialog is named by `aria-label`.
  - The test platform welcomes each socket with its saved host's id and name. It had welcomed all
    of them as the one fake daemon, so a second server's sessions matched the first's tabs.
- **Budget:** initial JS 198 to 199 KB (198.1 measured).
- **Rejected:** a Home-only `waiting` rule; clearing by closing the open tabs.

## Slice 5: preferences (appearance, text size) and the Face ID relock

- **Decided:** 2026-10-27, tech lead (slice 5).
- **What:**
  - The platform keeps the preferences: `BootResult.preferences` at start, `Platform.setPreference(name,
    value)` to change one, and a `preferences` event on the one change channel carrying the whole value.
    `relock` is present only where the app locks (native), so the browser's Settings shows no Face ID row.
    (The plan's `preferences.get/set/subscribe` became these three because the platform already has one
    `boot` and one `subscribe`; a second subscribe would be a second channel.)
  - Browser: `localStorage`, read once at start and parsed (it can throw or hold anything; a failure falls
    back to the defaults and a failed write keeps the choice for the page). The chosen appearance folds with
    `prefers-color-scheme` into `Viewport.scheme`, so the theme keeps one input; `html[data-scheme]` is always
    set, so the pre-script flash with a chosen scheme that differs from the system's is one frame.
  - Native: Swift owns the preferences (`UserDefaults`), sets the window's `overrideUserInterfaceStyle`
    from `viewWillAppear` (before the web loads), and reports the effective scheme in `Viewport.scheme`
    (a trait change now publishes it). The relock choice is the delay in `sceneChanged(.active)`; At launch has
    none. The default relock is 1 hour (it was a fixed 5 minutes). Bridge v7: `preferences` in `Boot` and a web to
    native `setPreference { name, value }` whose reply is every preference. Native never changes a
    preference by itself, so there is no native to web change event.
  - Text size is `small | default | large | larger` = the density's size - 1, +0, +2, +4 px (`--term-text-delta`
    on top of 12 px touch and 13 px compact). Whole-pixel steps keep xterm's cell measure on integers, and 1 px
    is the least a reader sees. The terminal re-fonts on the preference's change; Settings opens over Home, where no window is shown, so the new fit is sent with the next show's one resize (verified: nothing is sent while on Home, and tmux's width follows the size on return).
  - Dark: the terminal background is `#000`; the dark greys, the terminal's foreground, cursor, selection and grey
    ANSI colours have no hue (the light greys stay slightly blue); the PWA theme colour is `#121212`.
  - `Choice` (a radio group of buttons) is the primitive for a few settings visible at once.
- **Budget:** initial JS 199 to 200 KB (199.1 measured): the two Settings sections and the preferences owner are launch code.
- **Rejected:** the web owning the preferences and pushing them to native (two stores disagree at boot, and
  native must apply appearance and relock before or without the web).

## Slice 4 re-check notes (commit before slice 5)

- **Decided:** 2026-10-27, tech lead (from p352).
- **What:** a listing overlay lists only the hosts it shows (a server's sheet, its host; the picker, all), and
  returning from an overlay to Home is not entering. Clear local data resets the drafts' memory through a clearer
  that `LineDrafts` registers with `Persist`, as it does a flusher. Home owns its hosts' notices: Shell renders no
  host banner on Home and each card renders its host's banner (the unreachable host's card has its own note and
  Retry instead), so the card's attention body no longer points at "the notice above". `Pill` carries `host` and `kind`.
- **Rejected:** a Shell filter that hides banners by admission kind on Home.

## Slice 5 fix round 1: one appearance owner, relock as a guarded control

- **Decided:** 2026-10-27, lead (from p354, p355).
- **What:**
  - The window's appearance has one owner, SwiftUI's `.preferredColorScheme` on the root view; the
    `viewWillAppear` writer is deleted (it ran before the view had a window, so a stored choice was
    ignored at launch).
  - The relock delay is measured on `ContinuousClock`, and a negative elapsed time locks.
  - A stored `Preferences` decodes per field; `relock` falls back to 5 min, the strictest.
  - `setPreference` is refused while locked. A change that loosens relock (a longer interval or At
    launch) needs a fresh native Face ID evaluation first; tightening applies at once; a declined
    evaluation returns the stored preferences. Rejected: any web request applies, since relock is a
    security control the web alone shouldn't weaken.
  - The terminal sizer reads the cell from the font (canvas metrics with the renderer's device-pixel
    rounding), not from the laid-out `.xterm-screen`, so every sizer input is current while the terminal
    is hidden and a return sends one `watch` at the right size. Rejected: keeping the host laid out
    (`visibility:hidden`), which sizes it against the wrong box.
  - Relock is a platform capability (`setRelock`), not a value `setPreference` accepts; `Choice` is a
    `role="group"` of `aria-pressed` buttons (each its own tab stop) and no longer clips its focus ring.

## Bell attention in the daemon and protocol

- **Decided:** 2026-10-27, slice 7 design (spec: [daemon-core.md §4.8](daemon-core.md#48-bell-attention), §3.3, §5.3).
  Probes on isolated tmux 3.4 and 3.8 servers; measurements are in the spec.
- **A fixed hook index (9100), not `set-hook -ga`.** `-a` takes the first free index,
  so muxen would search `show-hooks` for its own entry to find, update or remove it, and
  could not tell it from a user's. A fixed index makes install idempotent, two daemons on
  one server write the same entry, a crashed daemon's stale entry is overwritten, and
  "ours" is one indexed read. Remove is one guarded `if-shell -F` command list (unset
  only while the element still starts with muxen's text), so it never removes a user's
  entry. This replaces `-ga` in the entry "Bell attention: BEL in the stream, plus one
  runtime alert-bell hook". Rejected: `-ga` with a content search (races between the
  read and the unset, and a stale duplicate per crash); a per-daemon option name and
  pid-liveness cleanup (more state to detect a dead owner than the entry is worth);
  an unguarded install (it clobbers a user's entry; see "Install is guarded" below).
- **The marker is a per-session counter**, `set-option -F @muxen-bell
  "#{e|+:#{?#{@muxen-bell},#{@muxen-bell},0},1}"`. Exact for bells within one second,
  survives the daemon not running, needs no clock. Rejected: a timestamp (two bells in a
  second look like one; format clocks are one-second), a boolean (needs the daemon to
  clear it, which a crashed or absent daemon can't).
- **Coverage is reported, not assumed.** The listing also asks tmux, per window,
  whether the global entry resolves, `monitor-bell` is on and `bell-action` is `any`;
  that is `covered`. A session that fails the test shows as "not tracked", never as
  quiet. `bell-action current` / `other` count as uncovered rather than partial.
  Rejected: reporting nothing and documenting the limits (a user with `monitor-bell off`
  would see a dead feature and no reason).
- **Hook only: the daemon does not scan the stream for BEL.** Jimmy, 2026-10-27, "Hook
  only". This changes the earlier entry ("Bell attention: BEL in the stream, plus one
  runtime alert-bell hook") and plan.md's "for the tab on screen the daemon finds BEL in
  the pane output". The tab on screen counts as seen on that device, so a stream bell
  could never raise a dot for the viewing device, and it served other devices only for
  the one watched pane of an uncovered session. Removed with it: the VT string tracker
  (`BellScan`, `Event::Bell`, hub bumps, coverage-dependent dedupe, a one-per-second
  `bell` spacing timer). Rejected: keep the stream path for uncovered sessions (a state
  machine in `tmux::Session` and three hub rules for a sliver of cases); a local signal
  from xterm.js's `onBell` (free on the wire, but it would put a dot on a tab the user is
  looking at). The client treats the on-screen tab as seen
  ([browser-behaviors.md](client/browser-behaviors.md)).
- **Listing lines are records by construction.** The window name passes through `#{s/<LF>/\\n/:…}` and the user-writable `@muxen-bell` through `#{e|+:…,0}`, so no field holds a raw line break and every line is one window record; a line that doesn't parse is a bad reply, not skipped. Rejected: length framing with `#{n:window_name}` (it counts stored bytes, while 3.4 escapes control characters only on output, so a length-framed parser loses sync). Probed on 3.4 and 3.8 (re-check p364).
- **The bell poll is the existing `List` one-shot** (review p362), with the session's
  `@muxen-bell`, and a per-window coverage test in each window line, placed before the
  names. Measured 5.2 ms wall, 1.0 ms server CPU, 2351 bytes at 60 windows against
  5.1 ms, 0.7 ms and 1811 bytes for the current listing. It deletes the separate
  `Markers` one-shot, `Reply::Bells` and marker lines, and takes the server-instance and
  `NoServer` handling `listed` already has. A user `list` during a poll joins it (the
  connect-time `list` otherwise collides with the poll started by the same connection),
  and every listing answer diffs against one baseline and broadcasts, so a device's
  listing returning before the first poll answer is never behind. Coverage is per window
  (`monitor-bell` of a non-current window was missed when read per session). Rejected:
  a separate `list-sessions` marker command (a second path, a second parser, `busy`
  collisions).
- **Install is `set-option -goq 'alert-bell[9100]' '<hook>'`, empty-only, at the head of
  every `List`** (review p368 found the first form, `if-shell -F '#{==:#{alert-bell[9100]},}'
  "set-hook -g …"`, wrong). `if-shell -F` formats against the most recent session, so a
  session-level `alert-bell` hook there hides the global array, index 9100 reads empty,
  and the install overwrote a foreign global entry (probed on 3.4 and 3.8). `-o` checks
  the global array itself, `-q` makes an occupied index exit 0 so the list goes on.
  Steady state writes nothing, a missing entry is back within one poll, a foreign entry is
  never overwritten. Hub start runs `if-shell -F '<ours>' "set-hook -g …" ; <install>`
  once, to rewrite an older build's entry; the shadowed guard there can only skip a
  rewrite. Rejected: read the state, then write (a `HookState` and a gap); an unguarded
  install at hub start (it overwrote a user's entry at 9100); keeping the `if-shell`
  guard for install and teaching it to read the global array (no format reads the global
  array while a session shadows it).
- **The baseline's silence is only for the first answer after a connection comes.** After
  a new tmux instance or `NoServer` the next answer is diffed against nothing, so every
  mark reaches the devices (review p368): a connected device with no control client on the
  new server never relists, and the first bell of the new server was swallowed as a
  baseline. `bell.server` is absent while no instance is known, not the endpoint name.
  The stop sequence closes the control clients' stdin, lets the one-shot in flight finish
  and then removes the entry, all inside 1.5 s of the hub's 2 s (the unset used to race an
  in-flight `List`'s install and spend the whole budget before the pumps drained).
- **Stated limits** (plan.md "Coverage limits"): bells before the first device connects
  after a tmux start are lost; with two daemons on one server the first to stop removes
  the shared entry and the survivor reinstalls at its next listing. No cheap fix exists:
  muxen has no contact with tmux while no device is connected.
- **Poll failure is server-level.** One `bell { available: false }`; per-session `covered`
  is tmux configuration only, so the client says "Bell tracking unavailable on this host"
  and "tmux settings hide bells in this session" separately.
- **Polling is the 5 s listing, while a device is connected**, about 0.15% of one core
  at most (spawn-dominated; the listing's bell fields add 0.6 ms of server CPU). Worst-case latency 5 s (average 2.5 s);
  2 s would cost 0.4% for a gain a phone alert doesn't need. It runs 5 s after the
  previous finished. Rejected: polling over a control client (zero spawns, but a client
  exists only while a tab is watched, so a second path for the rest; the measured spawn
  is already small); a hook that runs a command to notify the daemon (a process and a
  callback path per bell; Jimmy rejected the same in the earlier entry); `refresh-client -B`
  subscriptions (scoped to the client's session).
- **Rejected, the structure review's alternative (p320): poll `#{window_bell_flag}` /
  `#{session_alerts}` with no hook.** No tmux modification and no daemon-owned state in
  tmux, but the probes (p310, p314) show the flag is tmux's shared state: it is not set
  for a current window while any client is attached (Jimmy's laptop, usually), it clears
  when any client selects the window, and `kill-session -C` clears it, so a bell in another
  client's current window, the common case, is missed and "since this device last showed
  it" cannot be kept. It would also bring back marking tmux's flags for the phone. The hook
  writes muxen's own marker; the cost is the one runtime hook Jimmy approved.
- **Protocol: one new message `bell` (`{ server, available, sessions }`) and an optional
  `bell` field per listed session; no version bump.** Both are ignorable by an older peer (`src/proto/AGENTS.md`: new message
  types and optional fields need no bump); the old client shows no dot. A reconnect learns
  marks from the listing it fetches anyway, so nothing is replayed. `bell` carries
  `{ session, mark, covered }` for the sessions that changed, to every connection: about 120
  bytes for one bell, none while quiet (the poll's 5 s is the spacing). Rejected: marks
  folded into `sessionsChanged` (it makes every client relist, 100s of bytes to learn one
  number); a snapshot message on connect (the listing already is one); the daemon
  remembering what each device has seen (per-device state in the daemon for something the
  device already keeps).
- **One baseline rule on the device, for a listing and a `bell`** (review p369). A session
  with no seen mark takes the first mark it learns as its baseline, unless the page has
  already listed that host, on any instance: its counter then started after that, at 0, so
  the mark is a bell not yet shown. Review p369 asked for "an instance this device has already
  listed"; that still swallows the first bell of a restarted server, whose first answer
  arrives as a `bell` before any relist. Rejected: "heard any marks from that host"
  (re-check p373): a `bell` reaching a page before its first listing would make that listing
  dot every session that ever rang. Rejected: a rule per path (a race decided
  whether a new session got a dot). An overlay over a terminal tab still counts the tab as
  seen (the half-height sheet leaves it visible); two pages of one origin save one
  `bellSeen` each and the last writer wins, a stated limit. `Row` gets a `mark` slot that
  never shrinks, so a dot beside a truncating label can't be clipped.
- **Failure is visible.** A foreign entry at 9100, a session-level hook, `monitor-bell off`
  and `bell-action` not `any` produce `covered: false`; a failed poll produces
  `available: false`. The daemon
  never edits a user's hooks or options to widen coverage, and removes only its own entry.
- **Web: the dot, the per-device mark and the two unavailable strings are launch code.** The bell owner
  (`sessions/bells.ts`), the dot on `Pill`, session rows and Home's tab rows, and the words for hidden and
  unavailable bells are on every screen, so none of it can load later. **Budget:** initial JS 200 to 201 KB
  (200.2 measured with the whole change; the build before it was under 200.0 with under 0.1 KB to spare).
  "Seen" is saved with the workspace (reversed 2026-10-27, Jimmy: before review): in memory only, a reload or
  relaunch re-learned the current marks as the baseline, so a bell rung while the phone was away never showed,
  which is the main use. The marks are `bellSeen` (tab id to mark) beside `hostName`, written by `Persist` and
  parsed by `workspace/saved.ts` (an absent or odd value reads as empty); the native side stores the workspace
  as opaque JSON, so no bridge change. They stay bounded: each listing prunes its host's marks to live sessions,
  and the save drops hosts the device no longer lists. The first-mark-is-baseline rule now covers only a session
  with nothing saved. Clear local data resets the marks to the current ones. Rejected: a separate storage key
  (a second owner and writer).

### 2026-10-27: Choosing files on a phone (walkthrough fixes)

- **A tap on a completion row opens the folder** (it is Go on that row), instead of filling the field and waiting for a Return the phone's user does not know about. Drilling deeper is a tap in the opened folder's list. Go on a row that is a step toward a root (`Users` above `~/repos`) fills the field instead, as Tab does, for tap and Enter alike. Tab and → on a hardware keyboard still accept in place. Rejected: a visible "Open" button beside the field (a second step for the common case).
- **A disabled `Button` shows its reason beside it**, from the one `disabledReason` prop that already named it to screen readers; the visible span is also the button's `aria-describedby`. Rejected: a per-screen caption (each screen would repeat the rule). Busy is its own state (`busy`: blocked by work in flight, `aria-busy`, no reason), since the label already says "Adding…". Rejected: showing a reason for busy too (the label and the reason would say the same thing twice). The sessions picker and + menu show one server reason in place of their two dead buttons, since it is about the server and not either button.
- **A previewed file's path line wraps** (the title still truncates), so its full name is readable without a new control; matches the code and Markdown viewers, which wrap on a phone. Rejected: tap-to-expand title (a hidden gesture for text that can simply be shown).
- **A Mermaid block reads "Loading diagram…" until it draws**, its source hidden; a failure restores the source with the reason.

### 2026-10-28: Files without a scope

- **What:** Files opens any folder or file the daemon's user can read, `/` included, as the
  terminal can. The roots scope is gone: `Scope`, the containment checks, `outside_roots` and
  `outside_home`, the `$HOME`-only `/fs/dirs` picker listing and the below-`$HOME` rule for
  adding folders. `roots` in `config.toml` becomes `favorites` (shortcuts, not a boundary); the
  routes are `GET /fs/favorites`, `POST /fs/favorites/add` and `/remove`, and `uploads_dir` may
  be any existing directory. `Listing.root` is removed and `Listing.parent` is null only at `/`.
  The client side (rules 1 to 6 in `client/browser-behaviors.md#files`): every folder but `/`
  starts with an up row; the picker's Files side lists Home (`~`), the favorites, then Uploads;
  a Files tab has no favorites page (a saved `{kind:"roots"}` place reads as `~`); a star in the tab's header
  adds or removes the favorite with no confirmation; the path field completes folders anywhere
  from one `/fs/list` per folder. Kept: the hidden-files toggle, sandboxed previews and
  sanitized Markdown and Mermaid, the scan, page and upload caps, the descriptor-checked
  no-follow open (so the reported path is real, and a FIFO never blocks), non-UTF-8 names, the
  upload destination and naming. (Favorites were removed on 2026-10-30, "No favorites".)
- **Why:** Jimmy, on a real iPhone at `~` that said "Open a folder inside your home folder
  first": "u already have terminal access... why tf are we restricting this?". A device token
  already runs any command in tmux, so the scope guarded against nothing but Jimmy, and it
  cost a folders-only view, a "not added" state, an "Add this folder" flow, an
  outside-your-folders message and a fallback between two list routes.
- **Reverses** "Roots are a scope; the `$HOME` picker shows directory names only" and the
  app-side below-`$HOME` rule for adding folders.
- **Rejected:** keeping the scope and fixing only the wording (protects nothing a token holder
  can't already do in tmux); `$HOME` as a built-in root with the scope kept elsewhere (the same
  rule one level up, and `/etc` is readable in tmux); a favorites page inside the Files tab (two
  lists of one thing, since the picker lists them); keeping `roots` as the config name or
  accepting it as an alias (two names for one concept, and a compatibility layer for one user:
  the CHANGELOG says to rename the key).

## The key row's order, and Home's card

- **Decided:** 2026-10-28, Jimmy, on a real iPhone, over two screenshots of his own use.
- **The key row's order** (Jimmy: "esc tab, ctrl, alt (some characters) ^C, ^S, ^Z I think (can u
  research it)?"): esc, tab, ⇧tab, ctrl, alt, ← ↑ ↓ →, `|` `~` `/` `-`, ^C, ^R, ^S, ^Q, ^Z, ⏎.
  Three groups in the order a keyboard and a command suggest them: a keyboard's left edge top to
  bottom (esc, then tab, then the ctrl/alt cluster); the keys typing a command needs, arrows for
  recall and the caret before the shell's punctuation; then the control chords, last because a tap
  on one is rare. The widest single-row precedent puts the same four first: Termux's default extra
  keys are `[[ESC, TAB, CTRL, ALT, {key: '-', popup: '|'}, DOWN, UP]]`, and WebSSH's iPhone
  accessory row is `{ESC}{TAB}{CTL}{FN}{ARROWS}[/][:][-][|]…`.
- **^Q joins ^S.** `^S` is XOFF on a shell's tty: sent to a pane, it stops all output until `^Q`
  (measured on tmux 3.4 here: a pane writing every 200 ms produced five lines before `^S`, none in
  the 1.2 s after, and resumed on `^Q`), and inside a raw-mode TUI it is an ordinary key instead, so
  the same chip behaves two ways. With no `^Q` in the row the only way back is ctrl-arming `q` on
  the system keyboard. `^Q` costs one chip at the far end of a scrolling row.
- **Home's card shows at most three tab rows** (Jimmy: "why is it listing ALL of them...? I thought
  we just limited it to the first 3"), then the one row to the rest; the spec never said three, so
  the card is what changes.
- **A tab row closes by swiping left**, as an iOS list row does, revealing a red Close; a long swipe
  closes at once, and a tap on a revealed row closes the reveal rather than opening the tab. With a
  mouse there is no swipe, so the row keeps its × — one close affordance per pointer kind, never
  both (Jimmy: "the x might make more sense on desktop?"). The action is a real button behind the
  row, so it stays in the tree for VoiceOver, which takes swipes for navigation.
- **"Sessions and files" reads "All sessions and files"** (Jimmy), on Home's row and wherever the
  spec names it.
- **Rejected:** arrows at the end of the row as both Termux and the physical keyboard's right-hand
  cluster would have them (the row scrolls; an arrow past the first screenful costs a swipe and ↑ is
  the most-tapped key after tab); dropping `^R` or ⇧tab from Jimmy's list (Claude Code's Shift+Tab
  cycles permission mode, `^R` is reverse search: he named the order, not the members); an × on
  touch beside the swipe (two affordances for one verb); keeping the swipe and the × both live on a
  computer (a mouse drag can swipe, but one verb gets one control).

- **The row on screen is the filled one, not the word** (Jimmy: "why do we need the word 'here' while
  also having it selected?"). A session, window or favorite row whose tab is on screen is marked by
  its fill alone; every other open one reads "open" in its meta, and a window row is filled while it
  is the window shown. The fill no longer means "has a tab": it means "is the thing you are looking
  at", which is what a fill means on the pills too. Rejected: a checkmark for the row on screen
  (a third mark beside the fill and the word).

## Web build of the tab row: two reads of the spec (2026-10-30)

- **A server's workspace is made when the server is first known, not with its first tab.** Home
  lists a row per server and a server with no tab still has an overview to open (Open session lives
  there), so the record has to exist first. The id is derived from the host id (`ws/<host id>`) and is
  opaque to everything else. Rejected: a `workspaceOpened` event on the first tap of an empty row (a
  state between "no workspace" and "empty workspace" that nothing else needs).
- **A pill's menu lists the session's windows only for the tab on screen.** `select-window` is sent
  on the tab's watch (`selectWindow` needs `watch`), and only the shown tab has one. Every terminal
  tab's menu has New window (`newWindow` takes a session). Rejected: activating the tab first and
  selecting on its next `watching` (a menu row that moves the user to another tab).


## The app's keyboard covers the web view; the dock rides it (2026-10-30)

- **The app's web view always fills the screen, and a docked keyboard covers its bottom, as in a
  browser.** Native reports the covered height as `keyboardInset`, with `keyboardDuration`, the
  seconds of the keyboard's animation left, as the keyboard starts to move. The dock, Files' tab row,
  full-screen sheets and the terminal's pan move by the inset with that duration on a curve fitted to
  the keyboard's measured motion (`cubic-bezier(0.25, 0.6, 0.1, 1)`, within 7 pt of the keyboard's
  top over its travel in the iOS 26.5 Simulator). This supersedes "The app reports no keyboard inset,
  because its view moves" (2026-10-26): the inset now means the same thing on both platforms, and nothing
  shrinks underneath it, so the gap that entry fixed can't return. WebKit lays a resized web view out at its final size at
  once, so the dock jumped to its keyboard-up height before the keyboard moved and the keyboard slid
  into an empty band; closing, the dock dropped out and snapped back (Jimmy: "opening the keyboard
  animates horribly"; reproduced in the Simulator). Rejected: keeping the resize and sending the
  viewport at the start (the jump is WebKit's layout, not the message); sending the keyboard's
  position every frame (one bridge message per frame lags and jitters); a fixed CSS duration (the
  keyboard's own duration is in its notification, and Jimmy's ux-lead asked for it).
- **A keyboard rising for WebKit is held 60 ms before the page hears of it; every other change is
  sent at once.** Handing first responder from the native field to WebKit with no keyboard wanted (a tab
  switch to Files) posts a full-height frame and a zero one 20 to 50 ms later, and no keyboard shows;
  sent through, the page lurched up and back (Jimmy: "swapping to a folder tap looks like it tries to
  bring up the keyboard"). Holding every frame instead made the dock trail the terminal's keyboard by
  80 to 140 ms. Not taken for now: the web resting Files in `hidden` while no field is focused would
  avoid the handoff altogether; the native hold already keeps the page still, and the web's focus flow
  is the ux-lead's to change.

## The terminal's selection keeps the keyboard; `select` is a flag (2026-10-30)

- **Superseded in part (2026-10-31):** the web no longer sends `focus select`. The selection snapshot it
  served is gone: the rows are page text on every touch path, so WebKit's selection works with no flag.
  Native still accepts the mode (bridge v9 is unchanged); nothing sends it.

- **`focus select` no longer changes first responder or the keyboard.** Native's `FocusController`
  keeps the keyboard's target (`hidden`, `terminal`, `line`, `webText`) and a separate `selecting`
  flag; `select` sets the flag and any other mode clears it. Resigning the native field there dropped
  the keyboard (Jimmy: "if i long press with the keyboard up... it actually closes the keyboard... the
  keyboard should only be dropped with the button... even if i do something outside of it"), and on
  his phone WebKit cleared the page's selection 1 to 100 ms after the resign, so every long press on a
  word selected nothing (Jimmy: "long tap is bugged... it should select a word... but it just...
  doesn't work"; a debug build's log on the phone showed it on each press that found a word). A
  separate flag, not a fifth mode, because the field's mode and native's mode would otherwise disagree
  in a selection: an app cover and uncover then brought the field back in `webText`, and line edits
  were dropped. Rejected: the web ignoring a selection-less change for a while after release (the
  selection was gone, not just reported gone); keeping the resign for WebKit's handles (the
  Simulator shows them without it; dragging a handle is still to check on the phone).
- **The web sends `focus select` when the long press selects, not when the finger lifts.** This
  supersedes "`focus select` goes to native when the finger lifts" (2026-10-24). That rule kept WebKit
  from taking the held touch, which only resigning the native field allowed; `select` no longer does.
  While the flag is on, the web view refuses every edit action and removes WebKit's AutoFill submenu
  (which no refusal reaches). Told only on release, the flag sometimes came after WebKit built that
  menu, and AutoFill showed over muxen's Copy and Paste in the Simulator.
- **The terminal's surface isolates its stacking.** The opaque selection snapshot (z 3) painted over
  the dock (z 2) once the dock rode over the surface with the keyboard up.
- **The snapshot is not a scroller while the finger that made the selection is down.** With
  scrollback above the screen the snapshot scrolls (`overflow-y: auto`), and WebKit cleared the
  selection when the press lifted over it: on a full terminal every long press selected nothing,
  keyboard up or down (Jimmy: "i can't select text if the keyboard is up"; in the Simulator with the
  snapshot unscrollable, the same presses kept their selection). It scrolls again once the finger is up.
- **Writing Tools are off in the app** (`writingToolsBehavior = .none` on the web view and the native
  field): Apple Intelligence's button sat over muxen's Copy and Paste on a selection. muxen's text is a
  terminal and short fields, none of them prose.

## The keyboard control stays in the tab row (2026-10-30)

- **The phone's keyboard control is always the tab row's last control.** It reads Show keyboard with
  the keyboard down and Hide keyboard with it up, in the same place; the key row no longer ends with
  its own Hide keyboard. Jimmy: "when the keyboard is up, can we actually have the keyboard thing
  remain on the tabs bar... so that its consistent and doesn't move". The key row gains that width for
  keys. Rejected: Hide keyboard at the key row's end (Termius's place, taken earlier the same day),
  which moved the control between rows as the keyboard rose.

## Icons come from Lucide (2026-10-31)

- **Every icon is a Lucide icon** (`lucide-preact`, ISC, imported one by one), behind muxen's own names
  in `web/ui/primitives/Icon.tsx`. The hand-drawn set it replaces drew Settings as a circle with rays,
  which read as a sun (Jimmy: "the setings icon is hard to read - its not a freaking gear icon"; then
  "yeah just Lucide"). Same 24-unit grid and 2 px stroke as before. Hide keyboard is Lucide's
  keyboard-off: Lucide has no keyboard with a down arrow. Rejected: drawing more icons by hand.

## Every text box has autocorrect off (2026-10-31)

- **One record of keyboard settings applies to every text box** (`web/ui/primitives/fieldSettings.ts`):
  autocapitalize off, autocorrect off, autocomplete off, spellcheck false, writingsuggestions false,
  inputmode text. The terminal input, the line box, the Files path box, the code box (capitals on) and
  the text and search fields all take it, so Device name, Session name and the session search lose
  autocorrect too. They are set as attributes, never JSX props: Preact assigns a prop to the element's
  property when one exists, and WebKit's `autocorrect` property is a boolean, so `"off"` became true.
  Jimmy: autocorrect off on every one of them, Device name included. Rejected: autocorrect kept on
  prose-like fields such as Device name (a second kind of field to decide for, for names that are
  mostly identifiers and short); one helper that fixes only `autocorrect` (the class of bug is the
  property-versus-attribute mismatch, not one name).

## Home and a tab are the two levels; Back sits where the dock is (2026-10-31)

- **A Home row opens the workspace's last tab, and Back from a tab is Home.** Jimmy: "going from home
  completely skips the workspace selection, and going back u have to go to the workspace slection". Forward
  skipped the tab overview and Back stopped on it. He chose two levels over three ("Home ↔ tab"). Rejected:
  every level both ways (Home, then the overview, then the tab), an extra tap on every return to a
  terminal, launch included, since a clean launch opens Home.
- **The tab overview over a tab is the tab list, a router overlay** (`{ screen: "overview", name: "tabs" }`),
  opened from the tab row's All tabs. The overlay already keeps a tab switched under it when it closes, so a
  row tap is activate-then-close. The overview route stays only for a workspace with no tab, and a tab opened
  from it replaces it in history. The tab row gains a control, so phone pills are about 44 px narrower.
- **Where tabs have the dock, Back and a screen's controls are in a bottom bar the dock's height**, in
  the place of the dock's ‹: Home (Settings), the tab overview, page dialogs. Jimmy: "the back button jumps
  from top to bottom"; he chose bottom everywhere. Rejected: Back at the top in tabs, which costs a
  terminal row and is a reach on a large phone.

## Swipe back is WebKit's own gesture, off at the terminal (2026-10-31)

- **The app turns on WebKit's back-forward swipe (`allowsBackForwardNavigationGestures`) everywhere but a
  terminal tab with nothing over it.** Jimmy: "going back by swiping", and it "obviously shouldn't happen at
  the terminal". Every Back is a history entry, so the swipe pops the router and no back logic is added. The
  web sends `backSwipe { enabled }` from `syncScreen` when the value changes (bridge v8: the contract is
  strict equality and native refuses a message it doesn't know, so an older native cannot take the new one).
  Native holds one `backSwipe` state, starting off and reset for each new web view, so a cold launch cannot
  swipe before the page has rendered a screen. Phone Safari: no-op.
- **A crashed content process makes a new web view instead of reloading.** A reload via `loadUI` left the
  dead document's entry in the back list (measured: `back=1` after the kill), and a swipe from the new
  document's first entry would load it again. Clearing the list is not public API. Rejected: gesture off
  while the list leaves the document (a KVO on the list and a floor to track), and refusing the navigation
  in the policy (it can't tell back from forward, nor the target document).
- **Rejected: a native edge-pan recognizer calling `history.back()`.** It needs no WebKit snapshot but has
  no animation. Held as the fallback if WebKit's swipe snapshot shows a stale terminal frame.
- **A forward swipe exists** (WebKit's, not tested on a device) while the gesture is on and the forward list is non-empty (Home after Back from a
  tab, right-edge swipe returns to the tab). Left alone: it replays a router entry, as the browser's Forward.

## The keyboard-up mark's menu is native's, over the page's mark (bridge v9) (2026-10-31)

- **The page marks, native shows the menu.** With the keyboard up the mark is a CSS highlight, not a DOM
  selection, so WebKit offers no menu. Bridge v9 adds `editMenu { rect | null }` (web to native) and `menuCopy`
  and `menuPaste` (native to web). `MuxenWebView` presents a `UIEditMenuInteraction` over the rect; a choice comes
  back as a message and the page does the work: Copy through `copy` with the mark's joined text, Paste through
  `pasteFromMenu`. v9 is a new version because the contract is strict equality.
- **Native owns whether the menu is up.** iOS can dismiss it itself, and a page that tracked its visibility went
  stale (the next tap on the mark did nothing). Native tracks `willPresent` and `willDismiss`; a rect from the
  page shows the menu or, if up, hides it, so a tap on the mark needs no state of the page's. No close message.
- **The Paste item on iOS's own menu (keyboard down) is there whenever no keyboard covers the view.** It was
  gated on native's `activeTab`, which stays set on Home and the tab list, and which the native-input removal
  deletes. The page already ignores a Paste with no terminal shown, so native keeps no terminal state for it.
- **Rejected: the text sent with `editMenu`,** so native could copy itself. The page's join of soft-wrapped rows
  is the one Copy path (`PageSelection.textOf`), and a copy in native would be a second.
- **Rejected: a menu the web draws over the mark.** Step 0's Safari test failed it: a touch on a web-drawn menu
  moves the selection or the keyboard, and it does not match the system's.
- **Rejected: a `menuClosed` event** for the stale state; native owning the state needs no extra message.

## The touch shell counts the fingers the platform lists, not the ends it was sent (2026-10-31)

- **A touch whose end never arrives must not outlive the next touch.** On the iPhone (DOM renderer, rows replaced as
  output arrives) a touch that began on a row xterm then replaced was dispatched to a detached node, so no end reached
  `.host`; the leaked finger made every later swipe a two-finger one, which the recognizer ignores.
  Chromium and the phone agree that a detached node's events never reach the surface or the document, only the node
  itself. So at `touchstart` the shell listens, non-passive, on each new touch's own target for `touchmove`,
  `touchend` and `touchcancel` (removed when that touch ends, unless another touch began on the same node), and a swipe
  whose span is redrawn mid-gesture keeps scrolling. Only touches whose target is inside the surface are counted (a
  finger held on a dock key is not a second finger on the terminal). Every touch event also checks `event.touches`, as
  the safety net: a counted finger it no longer lists cancels the gesture it belonged to (never a tap), and the next
  touch starts clean. A `touchcancel` with no touches left also ends a handed-over touch. Nothing non-passive is
  attached to the document.
- **The pointer path is left as it is.** It captures the pointer on the surface at `pointerdown`, so its events target the
  surface, not a row, and `lostpointercapture` already ends a gesture whose pointer was taken.
- **Rejected: a timeout on a counted finger.** A held finger is long and legitimate; the platform's list says exactly
  which fingers are down.

## The name: muxen

Decided by Jimmy, 2026-10-31.

- **What:** tether is renamed `muxen`: the binary, crate, config and state directories,
  bundle ID (`com.jimmyyao.muxen`), web scheme, docs and repo. "All your tmux, in your
  pocket": many muxes, as ox → oxen, because one app reaches the tmux on several servers.
  It is for anyone who runs tmux, not only Meridian users; anything can extend it by
  notifying the app about a pane (`muxen notify`), and Meridian is one such caller.
  Renamed in one pass, before the first release and before push ties a bundle ID to
  Apple. Live state under the old name gets a one-time manual step, not compatibility
  code. The plan and inventory: `.meridian/work/tether-mvp/rename-muxen.md`.
- **Why:** "tether" is hard to type (Jimmy: "i keep trying to start with th..."), and
  the command is typed all day. A made-up word is findable in the App Store and on
  crates.io; the plural says what the app does that `tmux attach` doesn't.
- **Rejected:** "Meridian tmux" (implies Meridian is required and owns your tmux; cut
  off on the home screen); naming it as a meridian-cli subcommand (the daemon and
  Meridian change independently, and tmux users without Meridian couldn't use it);
  `muxi` (Jimmy's first pick: crates.io `muxi` is a tmux session-bookmark tool and
  muxi-ai/muxi is agent infrastructure); `muxo` and `moxu` (free, but the letter means
  nothing); `pane`, `perch`, `kite`, `beckon` (Jimmy preferred the muxi style); `omux`,
  `amux`, `muxy`, `tuxi`, `plexo` (taken, `amux` and `omux` by tmux-and-agent tools);
  a short alias beside `tether` (two names forever).

## The web code field is input-otp

Decided by Jimmy, 2026-10-31 ("the enroll entering code sucks ass... can we get a react library for it").

- **What:** the web enrolment code field (`ui/primitives/CodeField.tsx`) renders its eight cells on
  `input-otp`, through `preact/compat` (the Vite preset aliases `react`; `tsconfig.json` maps the
  types). A pasted code keeps letters and digits only, so `PJHF-SVDD` fills all eight cells. Startup
  JS grew about 3 KB gzipped.
- **Why:** on a real iPhone the hand-made field (a near-invisible input over drawn cells, its value
  rewritten on each keystroke) took one character and then nothing, and offered no Paste. WebKit
  emulation didn't reproduce it; input-otp carries the fixes for iOS Safari's paste menu, caret and
  autofill that the overlay kept missing.
- **Rejected:** fixing the overlay by hand (the bug only shows on the device, and each fix is
  another guess at Safari); a plain single text field (Jimmy asked for the library; the cells are
  the spec's look).

## Keyboard down, WebKit takes the responder for the selection; keyboard up, the mark owns the hold (2026-11-02)

Five changes from the phone investigation of "selection does nothing with the keyboard down" and "the mark
clears while I hold it". Source: `.meridian/work/tether-mvp/ios-simplify/redesign-touch/investigation-phone-selection.md`.

- **`hidden` no longer refuses WebKit's responder request.** This overturns the premise of "The terminal's
  selection keeps the keyboard; `select` is a flag" (2026-10-30), which held that the native field is first
  responder in every mode but `webText`: a field that refuses to resign is why iOS's loupe, handles and Copy
  never appeared with the keyboard down. `terminal` and `line` still refuse (the keyboard is up for the field).
  While WebKit holds the responder, hardware keys arrive as `keydown` and `Terminals.hardwareKey` sends them to
  tmux (it now runs in the app too). When the page's selection goes from a range to none, `TerminalView` asks
  for `focus hidden` again, so the field takes the responder back if WebKit left none (one owner, on
  `selectionchange`, not on each path that closes a selection).
- **`data-marking` turns native selection off while the mark is eligible** (`user-select: none`,
  `-webkit-touch-callout: none`), so WebKit's long press cannot start after muxen's 380 ms hold and
  `touchcancel` the mark. `TerminalView.markable` is the one check; the touch code and the attribute both
  follow it. `Mark.caretAt` makes the rows selectable for each lookup because `caretRangeFromPoint` finds nothing
  in `none` text.
- **`touchcancel` after the mark exists ends it as a lift does.** A system gesture took the finger; nobody
  dismissed the mark. A second finger during the hold does the same. J7 (a redraw under the mark) is unchanged.
  A reset drops the selection before cancelling the touch, so no menu shows for a mark about to go.
- **The cursor is drawn by its own row** (`data-caret`, `--caret-x`, `--caret-w`, a `::after`). The overlay kept
  a content coordinate that a history prepend or trim left stale. A pseudo-element, not a child, so it never
  appears in selection ranges or rects. `frame().cursor` also carries `cell`, the drawn column: clamped to the
  last column at pending wrap and stepped back to a wide character's lead cell; `col` stays the logical value.
- **Rejected:** pausing output while a selection is up (J7 is designed; a different lifetime is Jimmy's call);
  a longer hold timer (redraws still clear the mark, WebKit can still take the touch first); a blanket
  `touchstart.preventDefault()` (breaks native scroll and the other touches); re-placing the overlay cursor
  after `editAbove` (keeps the stale-coordinate state); switching the mode to `webText` to get past the
  guard (a second responder owner and a wrong logical mode); reclaiming the responder only on the dismissing
  tap (misses J7, reset, paste, font change, resize).

## The mark in both keyboard states (2026-11-02)

With the keyboard down, iOS's own long-press selection felt slow. Asked whether to use muxen's mark in both
states, Jimmy said: "i guess we should make it more consistent".

- **In the app the hold is the mark with the keyboard up or down.** `Mark.available` (the platform has
  `editMenu`) is the one check: the touch code starts the mark by it alone. A browser has no edit menu, so no mark; it keeps WebKit's selection.
- **Supersedes** the keyboard-down half of the 2026-11-02 "Keyboard down, WebKit takes the responder" entry
  (`hidden` lets WebKit take the responder; hardware keys through `Terminals.hardwareKey` in the app; the
  `selectionchange` reclaim and `TerminalView.markable`) and the step-0 choice that the keyboard-down state uses
  iOS's own selection. The native field refuses WebKit's responder request in every mode but `webText` again, as
  the 2026-10-30 "select is a flag" entry had it; `Terminals.hardwareKey` is the phone browser's only; the
  reclaim and `markable` are deleted. The rest of that entry (`touchcancel` ends the mark as a lift, the cursor
  row, the reset order) stands; its `data-marking` is deleted (next entry).
- **Tap rules, keyboard down with a mark up:** a tap inside toggles the menu; a tap elsewhere clears the mark and
  does nothing else (no keyboard raise). With no mark a tap is as before.
- **Rejected:** keeping iOS's selection with the keyboard down (the slowness is Jimmy's complaint; two
  selections with two looks and two lifetimes); a setting for it (a mode for one person's taste).

## The rows stay selectable under the mark (2026-11-02)

On the phone the mark showed its handles and Copy but no highlight. WebKit paints no CSS Custom Highlight on
`user-select: none` text; a Playwright WebKit page with one highlight across a `text` row and a `none` row painted
only the first. `data-marking` (the host `user-select: none` and `-webkit-touch-callout: none` in the app) is
deleted, and with it `Mark.caretAt`'s selectable-for-the-lookup toggle.

- **Why it isn't needed:** in the app the native field keeps first responder in every mode but `webText`, and a
  locked responder lets WebKit select nothing (the native A/B, and Jimmy's keyboard-down report on that state: a
  long press did nothing at all). A `touchcancel` after the mark exists ends it as a lift, so a system gesture
  taking the finger no longer clears it.
- **Rejected:** keeping `user-select: none` and drawing the highlight as boxes from the range's rects (a second
  geometry to keep in step with scroll and history inserts, for a case the responder already rules out).

## The Paste item on iOS's own menu is deleted (2026-11-02)

The app's long press is the mark in both keyboard states, so the rows never take iOS's own selection and the
`buildMenu` Paste item (added whenever no keyboard covered the web view) had no purpose. It also misdirected: its
`menuPaste` reaches `pasteFromMenu`, which pastes into the shown terminal tab even while a dialog is open over it,
so a Paste from a dialog's text menu went into tmux. `MuxenWebView.addsPaste` and the insert are deleted;
`menuPaste` stays for the mark's menu. Supersedes the "Paste item on iOS's own menu (keyboard down)" entry above.

## `focus select` is deleted (2026-11-02)

`select` stayed in `FocusMode` for "an older page, served by an older daemon" (issue #6). The app serves only its
bundled `WebUI/` and the web throws on any `bridgeVersion` other than its own, so no page a build can load sends it;
the daemon serves only the browser build. Deleted: `FocusMode.select`, `FocusController.selecting`,
`MuxenWebView.suppressesEditMenu`, its `canPerformAction` override and `buildMenu`'s AutoFill removal (with the Paste
item gone above, `buildMenu` was empty). The wire doesn't change for the web, whose `FocusMode` never had `select`,
so no bridge bump.

## The selection follows text that moved (J7 refined) (2026-11-02)

Jimmy, asking whether a selection can survive TUI redraws: "can it work with redraws or no...?" J7 closed the
selection when a frame rewrote any selected row. Measured on real Claude Code 2.1.316 and OpenCode 2.2.5 traffic
(`redesign-touch/claude-redraw-trace.md`): in fullscreen Claude and OpenCode a growing tool hint repaints
completed paragraphs one to three rows up or down in place (no history rows), and J7 closed all 12 sampled
selections 1.7-2.7 s after they were made. Classic Claude scrolls normally, row identity carries into history, and J7
never fired on completed text (6 of 6 survived). Following the moved text kept 17 of 18 selections for 10 s,
against 6 of 18 under J7 (18 of 18 at 5 s).

- **The rule.** When a frame redraws rows under the selection: the selected rows' whole text, as a contiguous
  block, unchanged in place keeps the selection (a style-only change included); that block now at other rows of the
  same screen, in exactly one place, moves it there with the same columns and the same offsets within the rows;
  otherwise it closes, as before (the text changed, it appears in more than one place, or it left the screen, which an
  alternate screen cannot follow into). Output never pauses.
- **One place.** `RowRanges.anchor` (before a frame's first redraw, `RowListOptions.rewriting`) and `RowRanges.follow`
  (after it, `rewritten`), called from `TerminalView`. A redraw replaces a row's text nodes, so a range inside it is
  rebuilt over the new nodes in every case, not only a move. `Selection.replace` puts the mark or the DOM selection on
  the new range; the mark's native menu hides when text moved (its rect is stale), and a tap inside brings it back.
- **Rejected:** following the characters rather than the rows (the survival table's variant c: more permissive, but
  it needs partial-row matching, and a selection starting mid-row of a repainted paragraph is the same case with
  more room to match something else); delayed reacquisition after a no-match (a repaint split across frames then
  reads as text gone; this stays a close, since a guess that waits has no end); tracking the selection in the alt
  screen's own scrollback (the app has none to give); a second path for the mark.
- **Known limit:** muxen does not honor synchronized output (`CSI ? 2026`), so a repaint that reaches the model as
  two frames (the erase, then the text) shows the text gone in between and closes the selection. Claude Code writes a
  repaint in one chunk; a split across tmux's control-mode lines is possible and unmeasured.

## One `Selection` per environment (2026-11-02)

The mark and the DOM selection each had their own arms in the view, the touch control and the terminals: which
one exists, what a touch near it means, how it dies. Replaced by one interface (`selection/selection.ts`: `range`,
`text`, `touch`, `replace`, `clear`) that `TerminalView` picks once at construction, the mark where
`Platform.editMenu` exists (the app) and the DOM selection otherwise (a browser). Both are ranges over the row
list's rows, and range geometry (`textOf`, `rectsOf`, `cut`, the J7 tests, `near`, `boxOf`) is shared in
`selection/rowRanges.ts`. Every rule about "the selection" (J7, dismissal, Copy, what a touch that begins on it
means) is written once.

- **Why at construction:** `editMenu` is a static property of the platform object, which exists before the view is
  built, and there is one surface and one row list for all tabs; nothing changes it after.
- **Rejected:** keeping both selections alive and checking each at every site (two lifetimes and two looks that
  could disagree, and the arms had already drifted); choosing per touch (the platform does not change per touch).

## Paste into an open folder (2026-11-02)

Jimmy, first: "i want to be able to paste an image and have it upload (the files path)". Then: "I mean if u open a
folder, u should be able to paste an image into it (or i guess text)?" This ends the product rule that uploads go
to one folder: an upload may name the folder it lands in.

- **The rule.** In a Files tab showing a folder, Paste (a toolbar control; Cmd/Ctrl-V on desktop) puts the
  clipboard into that folder: an image as a file named like any upload, text as `pasted-<timestamp>.txt` holding
  exactly the text. It never overwrites (a numeric suffix on a clash). `POST /fs/upload` takes an optional `dir`;
  without it, uploads go to `uploads_dir` as before. Every limit, the one upload slot and the `memory_backed`
  refusal carry over.
- **Writes have no scope.** Reads of any path the daemon's user can read were already allowed, on the argument that
  a device token runs any command in tmux as Jimmy, so a boundary guards nothing but Jimmy. `dir` adds writes under
  the same argument: any folder the daemon's user can write.
- **Stale part files.** A crash leaves a `.muxen-upload-*.part` file in whatever folder the upload was writing.
  Rule: one upload slot means one live part file at most, so the daemon records its absolute path in `upload-part` in
  its state directory before creating it, and deletes the record when the part lands or is removed. At startup and
  before each upload it deletes the record, then the recorded file (if still a regular file named like a part file) on
  the fs lane, not awaited: the path may be on a hung mount, which must fill an fs thread and nothing else. The upload
  slot moves into the part file and is released after the cleanup clears the record, so a cleanup that outlives its
  request can't race the next upload. Nothing scans a folder, and the cleanup never fails an upload or the start. (A first version swept the upload's own
  folder on every upload. That left a hidden file for good in any folder nobody uploaded to again, and it could fail
  an upload on an entry it couldn't delete.) This replaces the startup sweep of `uploads_dir`, which covered one folder.
- **Rejected:** sweeping the upload's own folder on every upload (leaves a stale file in any folder never uploaded
  to again; scans up to 5,000 entries per upload; can fail the upload on an entry it can't unlink); a recorded *folder*
  rather than the exact part file (it would still scan, and could delete a lookalike file that isn't ours); a part file in `uploads_dir` renamed into the folder (a
  cross-filesystem rename fails, and no-replace needs one filesystem); `O_TMPFILE` (Linux only); a favorites list or
  a config key naming the allowed folders (Jimmy chose none, [no favorites](#no-favorites-2026-10-30)); a new route
  for text (the same body, slot and limits; only the name differs, so `text=1`).

## Paste into a folder: one paste path, one table of upload words (2026-11-02)

Review of the paste-into-a-folder change found the app showing "The upload failed (HTTP 403)" for every refusal, and
two web routes for one action.

- **Words for refusals live in one web table** (`net/refusalWords.ts`, keyed by the generated `HttpError`, shared with the file manager's `describeError`). The browser reads the daemon's
  `{"error": code}` body; native parses the same body and sends the code in the `upload` event; the page words it.
  Rejected: words in Swift (a second table to keep in step with the daemon's codes).
- **One paste path.** `uploads.paste(handle, dir, signal, pasted?)` serves the button and desktop Cmd/Ctrl-V; `send`
  has no destination argument (it is the terminal's image upload). The screen no longer checks which methods a
  platform has. `pasteInto` stays its own bridge message beside `readPasteboard`: one uploads, the other returns text.
- **The Cmd/Ctrl-V listener stays on the document** and returns while any dialog is open. Rejected: a listener on the
  pane, which needs focus inside the pane, and only `app/focus.ts` may move focus.

## The default uploads folder is hidden (2026-11-02)

Jimmy, on the terminal's pasted images: "I think this is really nice feature... but I think it should go into a hidden
thing like ~/.muxen-uploads/<>". The default `uploads_dir` is `~/.muxen-uploads`. An explicit `uploads_dir` in
`config.toml` still wins, and a Paste into a folder names its own destination.

- **Rejected:** migrating `~/muxen-uploads` (one user, pre-release: existing uploads stay where they are).

## Native input is deleted; the page's text boxes are the app's only keyboard (2026-11-02)

Jimmy, on the ios-simplify plan: "a yes, finish the plan... delete as much code as possible", and on the leftover
checks: "why... do we still need those tests... delete them". He then paused it ("wait... so but i wanted the current
experience...? it was fine on my phone?"), turned the switch on, and used the page keyboard: "the web keyboard is
okay for the most part". The deletion resumed on that.

The hidden `UITextField` (`KeyboardInput`), `FocusController`, `KeyMapper`, the focus, line, modifier, input and
activeTab messages (bridge v10), `LineMirror`, `nativeLine.ts`, the "Web keyboard (test)" switch and its key all
go. The page's own boxes hold the keyboard, as in phone Safari. Hardware keys go through `Terminals.hardwareKey`.
Native keeps keyboard geometry, the mark's edit menu, drafts, copy and the pasteboard, haptics (`key`, `modifier`),
cover and lock, and the three WebKit hooks (focus policy, form-bar swap, scroll reset), now unconditional. The
`^C`/`^D` warning haptic for hardware keys went with the native key path.

**This supersedes:** the native-field rules ("one native `UITextField` owns the keyboard for both targets", the
focus modes `hidden`/`terminal`/`line`/`webText`, `lineSet` generations, the 60 ms keyboard hold, the native
`tapAction` `raises` half); "the rows stay selectable under the mark" (below, same day); and "a tap never raises the
keyboard" (this day's earlier call, when the app was to match Safari).

- **`directInput` stays**, as `"xterm" | "owned"`. It is the one axis "who handles keys": desktop's xterm textarea or
  the page's boxes. It is not derivable from `density` (a touch laptop is coarse and still xterm) and the app says
  `"owned"` always, so a boolean would only rename it across the bridge and its fixtures.
- **Settings.** Nothing else in the web Settings or the native server list was test-only or dead: Appearance, text size,
  Face ID relock, Servers, This device, the desktop-only Keyboard help and Clear local data are all live.

### Three problems from Jimmy's trial, and their fixes

1. **Two selections at once** (muxen's mark and iOS's own on the same rows). With the page path nothing holds first
   responder away from WebKit, and the rows had been made selectable only so a CSS Custom Highlight would paint.
   The mark now draws boxes in the scroller's content coordinates from `RowRanges.rectsOf`, placed and redrawn
   with the handles, and the CSS highlight is gone. Where the platform has `editMenu` the rows are `user-select: none`
   and `-webkit-touch-callout: none`; `Mark.caretAt` makes the scroller selectable only for the `caretRangeFromPoint`
   call. The earlier rejection of boxes ("a second geometry to keep in step") held only while the native field ruled out
   iOS's selection; the handles already needed that geometry.
2. **The "Type or dictate a line" box deleted its own text.** Cause: `nativeLine.ts` stayed alive under the page path.
   A restored `Boot.lineSnapshot` bound it to the tab, so every keystroke in the page box made it send `lineSet`, and
   each reply wrote native's older copy back into the drafts (`editNative`): with a slow bridge the box shortened
   and scrambled mid-typing. Reproduced at phone size with a fake bridge that delays `lineSet` replies 150 ms (the
   box ended as `t i o xusv ea g`); with no latency or no snapshot it did not. Deleting the mirror leaves
   `LineField.edit` as the one writer of the line's text.
3. **A tap on the terminal raises the keyboard,** in the app and in phone Safari. In a mouse app (mouse tracking on) the
   tap is a click and raises nothing. With a mark up, a tap elsewhere clears it and raises nothing. With the
   terminal's input already holding the keyboard, a tap on the prompt row still moves the cursor. The focus is made in
   the tap's own `touchend`: iOS shows the keyboard only for a focus made in the gesture. **Rejected:** Safari's earlier
   rule (a tap never raises; the dock button does), which Jimmy found wrong in use ("the terminal itself").

### The path field narrows the folder's rows; the completion stack is gone

- **Decided:** 2026-11-05, Jimmy (Files redesign, `ui-polish/audit.md`), settled in a plan review (p529) that found
  the first-page cache could not serve it.
- **What:** typing in the path field narrows the typed folder's held rows, folders and files, through the outline core
  (`files/outline.ts`): the name typed whole first, then starts-with, then contains. Enter opens the selected row (the
  first match when a name is typed), a folder as a folder and a file as a file. Typing a path to another folder lists
  that folder once, after the 250 ms settle. When the folder is not held in full the list says its matches come from the
  pages loaded and offers Load the rest. **Supersedes** "Files gets a path field … it predicts the next existing folder",
  and from "The field heads Files, and Go opens": the ghost text, `/`, Tab and → accepting the prediction, "completion
  lists folders only", and a row tap that does not leave the field (a row tap now opens the place and ends editing,
  which is Go on that row). **Supersedes** from "One listing per folder, never one per keystroke": the 32-folder cache
  of first pages, the folders-only paging to 1,000 folders, and the `names` held beside the first page. The
  one-listing-per-folder rule stays.
- **Per-folder record:** every folder has one record holding all the pages loaded so far, shared by browsing and the
  path field, pinned while on screen and bounded by total entries held (10,000), not by folder count. A first page
  cannot hold the files of a folder over 200 entries, since the daemon sorts folders first.
- **Why:** a path field that finds files as well as folders is what Jimmy asked for; ghost and accept rules needed a
  separate folders-only model (`names`, `MAX_PAGES`, `seed`, `FolderField` with no callers) beside the pages browsing
  already held. One record and one filter replace both.
- **Rejected:** keeping ghost text and Tab-accept beside file rows (two models, and the mockup has neither); a search
  request per keystroke or per pause for matches in an unloaded page (a round trip each; Load the rest is one tap and
  pages through the existing `more()`); matching only the first 200 entries without saying so (misses files in any
  big folder).

## Files redesign, phase 1: chrome and rows (2026-11-05)

Jimmy picked mockup C (`ui-polish/mockups/C-revised/`: "overall i think its good... we can probably start
building it immediately"); the audit's later lines win where they differ from C. Phase 1 is the rows, the
one-line headers, the path line, Copy path, Download, Insert, the row menu, the code frame and pull to
refresh, on both layouts. The desktop tree and Preview panel are phase 2; Search is phase 3.

### Folders and files read apart; the up row is `..`

- **Decided:** 2026-11-05, Jimmy ("Folders look like files; every row has `>`"; "how do i go 'up' to the
  prior folder? where is the '..' ?"), built from C.
- **What:** a folder has the only coloured icon (accent stroke over a 22% accent fill) and a medium-weight
  name; a file has a muted icon for its kind and a regular name. Files never get a chevron; folders get one
  on the phone only, where a tap drills in. A desktop row is 28px with size and a short age (`3h`, `6d`) in
  tight columns beside the name; a phone row is 48px with the size alone. The up row reads `..`, styled as
  a folder, first in every listing but `/`. **Supersedes** from "A parent row and path field navigate
  Files" the “‹ parent” label (the row stays, as `..`), and the spec's "matching navigation treatment"
  rule that gave Files rows the session rows' look and a chevron on every row.
- **Rejected:** a chevron on every row (Jimmy's complaint); dates as "Today 13:47" / "27 Oct" (a ragged
  column, C critique 5); a Kind column and zebra stripes (C's Preview-off table, phase 2's, not this
  list); keeping `OptionRow` in `ui/primitives` for one caller whose look no longer matches `Row` (deleted).

### One header line; the path line is one plain string that selects its last folder

- **Decided:** 2026-11-05, Jimmy ("I dont think selecting the / repos / should navigate to repos... it should
  just be 1 line string... and the default should select the last folder so u can just delete it (and then
  cancel if u dont actually want to go there), its especially bad on mobiel where uc an just fat figner it";
  "I think the copy button is misplaced... maybe just dont include it"; phone header: "path, Search, ...
  only"; desktop keeps Upload, Paste, Refresh as icons).
- **What:** a folder has one header line: the path line, then its controls. At rest the path is one plain
  mono string with its trailing `/`; a click or tap makes it the field with the last folder's name and `/`
  selected. Delete leaves the parent and lists it; Enter right away stays put; Esc and Cancel restore. A
  desktop line has Upload, Paste and Refresh icons and ⋯; the phone's has ⋯ alone, which holds Upload, Paste
  and Refresh too. ⋯ holds Copy path (first) and Show hidden files on both. The path line has no keyboard shortcut
  until Search settles its keys; a click is the way in. **Supersedes** the folder header of a title with Refresh, Paste and Upload buttons (Paste's
  "toolbar control", 2026-11-02, Paste into an open folder, is now an icon or a ⋯ item) and the path field's caret-at-the-end start ("A tap starts editing
  with the current path and a trailing `/`, and the caret goes to the end"). Show hidden files moves into ⋯
  (the quiet toggle under the list and Cmd/Ctrl+Shift+. stay).
- **Search:** not on the line yet. A Search button with nothing behind it would be a dead control; it
  arrives with Search itself.
- **Cmd+L, Cmd+Shift+C:** not bound. Whether Chrome and Safari let a page take them was not checked on a
  real browser (no way to send real keystrokes from the build box), and both belong to the browser
  (address bar, DevTools' inspector) where it keeps them. ⋯ › Copy path copies the folder's path.
- **`/` is not bound here:** Search owns `/` (mockup C's DIRECTION.md, settled: "Search is separate (magnifier, Cmd+P, `/`)").
  Phase 1 first bound it to the path line, from a brief that missed this; review p538 caught it and the
  binding was removed before Search arrived.
- **Rejected:** clickable path segments (a fat-finger trap on the phone, Jimmy); a copy icon after the path
  (Jimmy: misplaced); selecting the whole path on a click (an earlier call the same day, overridden by
  "select the last folder"); keeping the folder name as a heading above the path (the tab and the path say
  it; the line is one row on the phone).

### One Insert control lists the terminal tabs; Copy path and Download on every file

- **Decided:** 2026-11-05, Jimmy ("Insert path should let him choose the terminal. Copy path button";
  "Download for any file (a .webp had no preview and no easy download)"; "Put the preview header on one
  line"), settled in review p529 (no new state for the Insert menu).
- **What:** **Insert into terminal ▾** opens this server's terminal tabs: the default first (an upload's own
  tab for its offer, else the workspace's last terminal tab), then the others in tab order; still-restoring
  or failed tabs are listed disabled with the reason. Cmd/Ctrl+I sends to the default. The same control is
  the file header's and the upload offer's. A file's header is one line with Back named for its folder, the
  name and size, the viewer's controls, Copy path, Download and Insert. Copy path confirms in place for
  1.6 s; a menu's copy confirms with a notice. Download is an optional platform capability (`download`):
  the browser's same-origin `<a download>` on `/fs/raw`; the app lacks it until its share-sheet route.
  **Supersedes** "the target is the workspace's last terminal tab" as the only target, and "insertion is
  disabled with 'Open a terminal tab first', shown beside the button" (the menu says it). The two-line
  preview header (name, then path) and the separate Insert bar under it are gone.
- **Rejected:** a split button (insert into the default, ▾ for the rest: two targets in one control, the
  click-model problem C fixed in rows); naming the default tab on the button ("Insert path into muxen
  agent" outgrows a one-line header on the phone); listing each terminal's working folder (needs
  `pane_current_path` sent to the client; out of scope); a Download link the page builds itself (environment
  checks belong in `platform/`, and the app's web view would show a dead button).

### A row's menu: Open, Open in new tab, Copy path, Download, Insert

- **Decided:** 2026-11-05, Jimmy (C's row menu; "Download for any file", "Insert path should let him choose
  the terminal").
- **What:** right-click (desktop), Shift+F10 or the menu key, and a held touch (phone) open one menu on a
  row: Open (Go into folder), Open in new tab, Copy path, Download with the size (files), then the Insert
  section the Insert ▾ button shows. A long-press does not select the row, as a tap doesn't; a right-click
  does. The gesture is one listener on the listbox, which finds the row under the press, so rows stay
  unaware of it. It is the existing Menu primitive at the press point.
- **Rejected:** C's phone bottom sheet with the file's name over it (a second menu form beside the tab row's
  popover; deferred with the sheet question for every menu); C's "Insert into <default>" plus "Insert into
  another terminal" submenu (a submenu is a second level on a phone, and the tab list is short); a ⋯ button
  on each row (a hover target on desktop, a second tap target on the phone's 48px rows).

### Pull to refresh on the phone's folder list

- **Decided:** 2026-11-05, Jimmy (C; Refresh moved into ⋯ on the phone, so the list needs its own gesture).
- **What:** passive touch listeners on the list: a touch that starts at the top and moves down pulls a chip
  down over the list (half the finger's distance, at most 96px); past 64px a release calls the same
  `reload()` as Refresh. Nothing is cancelled, so iOS's rubber band and Chrome's scrolling stay native. The
  chip is its own component with its own state, so a pull redraws only it. Reduced motion stops the arrow
  turning.
- **Rejected:** moving the list down with the finger (fights the rubber band, which already moves it on iOS,
  and needs `preventDefault` on touchmove, a non-passive listener on every scroll); the browser's own pull
  to refresh (it reloads the page, and the iPhone app's web view has none); pointer events (a scroll cancels
  them before the pull is long enough).

### One Files keymap decides when a shortcut may fire

- **Decided:** 2026-11-05, by the Files lead on review p538 (finding 3).
- **What:** every Files shortcut registers with `screens/files/keymap.ts`, which owns the one document
  `keydown` and `paste` listener. Keys are free for Files when no dialog or menu is open, no text field
  has focus (unless the chord allows it), and no earlier handler claimed the key. Cmd/Ctrl+V is served by
  the `paste` event, which alone carries the clipboard. Phase 2's Space and tree keys and phase 3's
  Search keys register there too.
- **Written per keyboard, shown by its owner:** a shortcut's label comes from its chord (`useChordLabel`):
  ⌘ and ⇧ where `Platform.shortcuts` is `apple`, Ctrl and Shift elsewhere (the dev box is Linux). A hint
  appears only on the control whose shortcut it is, so the upload offer's and a row's Insert menus don't
  show ⌘I, which only the file's own Insert answers.
- **Rejected:** a listener per shortcut, each with its own rule (phase 1 had four, with four different
  rules: Cmd+Shift+. fired while typing in the path field and with a menu open, paste fired under a menu).

### The code frame: numbered lines, a Wrap lines switch, Copy text; a big Download for what muxen can't show

- **Decided:** 2026-11-05, Jimmy ("make text display prettier", JSON and plain text especially; "Download for
  any file"), built from C's code view and no-preview card.
- **What:** code and text run edge to edge on the sunken surface with line numbers in a sticky gutter
  (CSS counters, so a copy or a selection never takes them); Wrap lines is a switch in the header (⋯ on the
  phone); Copy text copies the text read, saying so when that is only the first 1 MiB. The phone adds a
  facts line (language, lines, size, age). Markdown is set at a 72ch measure. A binary file gets a card with
  its facts and a big Download, with Open as text beside it. **Supersedes** the Wrap lines button in the
  Insert bar and "binary files (Open as text)" as the whole offer.
- **Rejected:** numbers as text in each line (a copy would take them); a separate gutter column (it drifts
  from wrapped lines); a JSON pretty-printer (changes what the file says; the frame and colours were the
  ask); Shiki's own line-number transformer (a second render path beside the plain one).
- **The gutter's cost (review p538):** a sticky number on every line made each scroll of a 1 MiB file
  (17,189 lines) cost about 25 ms in desktop Chromium (20 scrolls: ~450 ms, against 10 ms before numbers).
  Unwrapped, every line is one row, so one sticky gutter holds all the numbers (generated content from a
  `data-lines` attribute) and the lines are plain blocks again: 20 scrolls in 11 ms. Wrapped, nothing
  scrolls sideways and a line may take several rows, so each line carries its own non-sticky counter in its
  padding: 17 ms. Rejected: sticky numbers below a line cap (two looks for one file kind); one gutter in
  wrap mode too (it drifts from wrapped lines, as above).

### On touch, the tap that closes a menu only closes it

- **Decided:** 2026-11-05, ux lead (Files phase 2 brief), following iOS: a tap outside an open menu
  dismisses it and nothing else.
- **What:** `Menu` swallows the click that ends a touch press outside it, so a row or button under the
  finger doesn't also open. A mouse press outside still closes the menu and acts, as on a desktop.
- **Rejected:** a transparent backdrop under every menu (it would also swallow a scroll starting on the
  list, which closes a row's menu today).

### A desktop's Files list is an outline; the phone keeps one folder per screen

- **Decided:** 2026-11-05, Jimmy picked mockup C's split ("a on desktop, B on phone"), whose desktop is
  an outline with folders opening in place. **Supersedes** "A parent row and path field navigate Files"
  on a desktop, which rejected folder accordions.
- **What:** folder rows carry a disclosure and open in place; a click looks (selects, and opens or closes
  a folder), a double-click or Enter goes in (the root moves, a history entry); ArrowRight and ArrowLeft
  open, close and walk the tree. Each open folder is one listing, from the host's shared folder cache,
  pinned while it shows; a folder past a page ends in Show more. A tab keeps at most 32 folders open,
  closing the oldest past that, and the open set and selection are the tab's view state in its Files
  session, never history. The phone is unchanged.
- **Why one target per row:** mockup A entered a folder on its name and expanded it on a 12px triangle,
  and the two fought; with the click always looking and the double-click always going in, there is
  nothing to miss. Re-rooting is the rarer move and gets the heavier gesture Finder users know.
- **Why 32:** each open folder holds a listing (up to a page of 200 entries, about 40 KB) and is pinned
  against the cache's 10,000-entry bound while it shows; 32 pages is 6,400 entries, inside that bound,
  and more open folders than a screen shows is past what anyone reads.
- **Which folder closes at 32** (amended after review, 2026-11-05): first the oldest that doesn't show
  (inside a closed folder, or outside the root), then the oldest that does, and never one holding the
  folder just opened, whose open ancestors become the newest with it. Closing plain oldest-first closed
  the parent of the 32nd subfolder opened, hiding it and its siblings.
- **Rejected:** the disclosure as its own target (A's two targets); listing every open folder again on a
  return to the tab (the cache already holds them); keeping the open set in history (Back would close
  folders instead of leaving places); an unbounded open set (a long session would pin the cache).

### The outline's disclosure is the one target that opens a folder in place

- **Decided:** 2026-11-05, the lead, from the phase 2 review (p546). **Supersedes** "Why one target per
  row" in "A desktop's Files list is an outline": a click on a folder row no longer opens or closes it.
- **What:** on a desktop a click on a row selects it (the Preview panel shows a folder's summary); a
  click on a folder's disclosure opens or closes it, every click; double-click or Enter goes in;
  ArrowRight and ArrowLeft open and close. The disclosure's hit area is 28px wide.
- **Why:** with the click opening folders, a double-click to go in first opened the folder, so Back found
  it open in its parent's outline, holding one of the tab's 32 slots for nothing. A click that only
  selects also lets the panel show a folder without changing the tree.
- **Rejected:** keeping one target and accepting the open folder behind (it costs a listing and a slot
  per folder entered); the click toggling and the double-click undoing it (a flicker, and a listing
  asked for and dropped).

### A folder never replaces the Preview panel; a click on one opens it in place

- **Decided:** 2026-11-05, Jimmy, on the desktop: "clicking a folder on desktop webapp shouldn't open the
  'folder' in the view", and "the folder replacing the preview thing? that shouldn't happen in the first
  place". **Supersedes** "The outline's disclosure is the one target that opens a folder in place". That
  the click opens the folder is the lead's reading of what it should do instead; Jimmy named only what it
  shouldn't.
- **What:** only a file moves the Preview panel. A click on a folder row selects it and opens or closes it
  in place, the panel unchanged; so do the arrow keys. A double-click still goes in, and puts the folder
  back as it was in its parent's outline. The panel's folder summary is only ever the list's own root, so
  "Go into", and the summary's own listing, pin and loading states, are gone.
- **Why:** the panel was reading the file, and a click meant to look inside a folder threw it away.
- **Why the double-click restores it:** the superseded decision kept the click from opening folders
  because a double-click left the folder open behind, holding one of the tab's 32 slots. Undoing the first
  click ends that. The listing it asks for isn't dropped: it is the folder being entered, from the same
  cache. A double-click's click at the 33rd open folder can close the oldest, and the undo doesn't bring
  it back; that is rare and costs one reopen.
- **Amended after review, same day:** the kept file is the session's, per tab and root (`previews`, beside
  `selections`), because held in the panel a remount (Search, the toggle, a tab switch) lost it, and Back
  from a folder did too. A file the app selected is shown without counting as opened. One gone from a folder
  held in full is let go and forgotten. Who moved the selection is carried with it (`PanelPick`), so nothing infers it. A file landing in the folder on screen is selected on a desktop, which is how
  Paste shows it; the "fresh" row mark, the same blue as the selection, stays on the phone only (Jimmy: "pasting
  something doesn't immediately open it in preview", and a screenshot of two blue rows).
- **Rejected:** the panel showing a blank or the folder's contents on a folder click (it still loses the
  file); a delay on the click to tell it from a double-click (every open would lag).

### Files makes empty files and folders

- **Decided:** 2026-11-05, Jimmy: "is there no way to create an empty text file or a new folder...? I think we
  should have the ability to do those things". **Supersedes**, in "Files: view and upload now, three write
  operations in v2", new file's place in v2 and "mkdir ... done in the terminal".
- **What:** New file and New folder in ⋯ and a folder row's menu; a name field among the rows on a desktop, a
  dialog on the phone; `POST /fs/create` ([fs.md](fs.md#post-fscreate)), which never replaces anything. No editor
  comes with it.
- **Why `{ dir, name }` and `Want::Dir`:** fs.md planned `Want::Parent` to split a path's last component.
  A client that sends the folder and the name has nothing to split, so the mode was never built.
- **Why the field is drawn among the rows, not a row:** the list's model, its arrow keys and its selection stay as
  they are, and the field's keys stop at its form.
- **Why a landing is one path:** upload, paste and create all end in `FileBrowser.added`, which lists the folder again
  wherever it shows and sets `fresh`. A create of its own would keep the stale-record bug the shared path fixed.
- **Why the session owns the request:** the POST and the relist outlive the form, and on a slow connection a form that
  awaited them closed a second form and collapsed folders with its stale closures. The form awaits the answer only.
- **Lead's calls within Jimmy's sketch:** leaving the field empty cancels and leaving it with a name keeps it; a "Created
  <name>" notice, as Paste has; a new folder on the phone is marked, not entered, since "opens in place" means nothing in
  a flat list.
- **Rejected:** a dialog on the desktop too (no field among the rows, but not the naming in place Jimmy agreed to);
  a pending kind of `OutlineRow` (a case in the row model, the key handling and the selection for a thing that is none
  of those); `Want::Parent`.

### A file's language and line count live in Info

- **Why:** Jimmy, of the phone's strip above the code: "why tf do we need it... add that to like "..." -> (info)". Four facts took a line from the file on the smallest screen, and nobody reads them on the way to the code.
- **What:** Info shows Type and Lines for a file read as text, on both layouts, above Size, Modified and Path. The strip is gone. Lines are counted when Info opens, and a file read only in part shows "+" after the count. **Supersedes** the phone's facts line in "The code frame".
- **Rejected:** keeping the strip behind a setting (a setting to hide something nobody needs); a desktop-only Info difference (the same four facts on both layouts is one rule).

### Files renames and deletes; delete is permanent, for now

- **Why:** Jimmy: "we are missing right click rename... and then right click delete". Asked trash or permanent: "permanent with confirm could be fine for now". **Supersedes** "Move and delete are done in the terminal" for delete; moving to another folder stays there.
- **What:** Rename and Delete are the last rows of a row's menu. Rename stands in a name field for the row (a dialog on the phone), with the stem selected, and never replaces anything. Delete asks first, and a folder goes with all it holds. `POST /fs/rename` and `POST /fs/delete` work from the folder's descriptor. A delete never follows a link, stops at a mount unlike `rm -r` (a bind mount too, through `openat2`, the open search uses), stops 64 levels down, and runs under its own slot. The daemon refuses home, its state folder and every folder above them, by device and inode: a menu check alone missed a path through a link. A failed delete leaves what it removed gone, so Cancel becomes Hide while it runs and the client says some may be gone.
- **Rejected:** moving to the system trash for now (`~/.local/share/Trash`, `~/.Trash`): it needs a copy across disks, a trash that fills, and per-OS layouts. It remains the likely next step. Only empty folders (the common wish is `node_modules`, and the terminal is one tap away, but a file manager that refuses most folders reads as broken). Asking the daemon for a count before the confirm (a walk per dialog, on a slow link, for a number nobody checks). Rewriting other tabs' places on a rename: they show the "gone" state and offer the way up, as for anything renamed in the terminal.

### The editor's edit lives on the Files session; the save buffer comes from upload's

- **Decided:** 2026-11-06, design lead. Jimmy's calls: Edit is an item in the ⋯ menu ("sure"); the
  phone keeps the key row ("sure, just keep it i guess"); unsaved text survives a relaunch ("i think
  it hsould survive? but if its too much work no need"), and a relaunch reopens the editor rather than
  the viewer: of a test build that restored the text only after Edit, "it doesn't save the state that
  I was in the edit".
- **What:** `Edits`, one store per host's `FilesSession`, owns each open edit from Edit to Done (ETag,
  line ending, CodeMirror state, save, reload, the remembered copy); a view holds none of it,
  so a save's or reload's answer that lands after the view has gone finds the edit by path. `FileView` renders the editor whenever its file has an edit, so a tab switch, Back
  and a relaunch need no route of their own. The latest changed edit per host goes to view memory only
  from `persist.onFlush`. The upload flush interval drops from 2 MiB to 1 MiB so the save's 1 MiB
  buffer leaves the memory ceiling where it was. A file that would not survive byte for byte (mixed
  endings, a BOM, invalid UTF-8, read in part) offers no Edit.
- **Why:** the keyboard belongs to whichever text box has it, so the focus controller needs a target,
  not a new owner. Writing up to a MiB per keystroke would cost more than the rare loss it prevents.
  The ceiling rule is that each tier fits its lowest budget, and an upload flushing twice as often
  costs less than moving a tier.
- **Rejected:** a focus `Owner` for the editor; a persisted draft per file (one per host covers a kill
  and stays bounded); a dialog for a conflict (it would drop the keyboard); normalizing line endings
  on save; moving a memory tier boundary; reusing an upload's part file for the save.

### The editor keeps autocorrect off, for now

- **Decided:** 2026-11-06. Jimmy, after trying it on the iPhone: "is actually debeatable in this case,
  but for now, okay". The current rule is off, as a trial with no end date.
- **What:** the editor carries the same keyboard settings as every other text box
  ([Every text box has autocorrect off](#every-text-box-has-autocorrect-off-2026-10-31)).
- **Open:** autocorrect on for `.md` files is in `web/.context/FUTURE`.

### Dialogs and Settings say what the user can't see, and no more

- **Decided:** 2026-11-06, Jimmy, of the editor's discard dialog: "\"discard your changes\" is enough"
  and "u don't need to explain everything". He applied it to the other dialogs and Settings ("yes
  change them"), and of "Everything in this folder goes with it": "\"goes\" is not clear at all, goes
  where?".
- **What:** a dialog's title carries it when it can: "Discard your changes?" and a file's "Delete
  notes.txt?" have no body. Body text stays for a consequence the title leaves out: a folder's
  "Everything in this folder is deleted as well.", a link's "Only the link is deleted, not what it
  points to." Settings' Terminal text size has no detail line. A
  verb says what happens: "is deleted", never "goes".
- **Rejected:** "goes with it", which doesn't say where anything goes; dialog text that explains how a
  control works.

### The folder cache asks for two first pages at a time, the outline's last

- **Decided:** 2026-11-05, from the phase 2 review (p546): Show hidden re-listed every open folder at
  once, up to 32, against a daemon that admits one scan and 8 waiters and refuses the rest as `busy`.
- **What:** `Folders` (the host's one owner of listings) runs at most two first-page requests; the rest
  wait. The outline's open folders are asked `behind`, so the place's folder, the Preview panel's and the
  path field's go first. Next pages (Show more, scrolling) are one request the user asked for and are not
  queued.
- **Rejected:** a limit in each caller (Show hidden, reveal and a reconnect would each need one, and they
  would still add up); one at a time (a slow folder would hold up the one the user just clicked);
  raising the daemon's waiter count (the cap is what keeps muxen light on a busy host).

### The Preview panel beside a desktop's outline is on or off, and its toggle never moves

- **Decided:** 2026-11-05, Jimmy, on mockup C: "how do u close the desktop 'preview' one? it hsould be
  like a 'preview' bar thing", then "I usually like it when the close stays in the same place so u can
  tap to open tap to close without moving the mouse (also I'm fine with it just being an icon)".
- **What:** the right of a desktop's Files is the Preview panel, on or off. On, it shows the selection
  once it has settled for 200 ms (a file's viewer; a folder's README, else its facts and Go into; the
  list's own folder with nothing selected). Its toggle is an icon, the last control of the header line,
  on the same pixels whether the panel is on or off (checked by script at 1440 and 2560 in six states);
  Space toggles it while the list has the keys. The divider drags and takes the arrow keys, between 300px
  and 60% of the window. On or off and the width are remembered per device. A file opens full width as
  its own place, from the expand button or a double-click or Enter; Back is history Back to the list it
  came from, else, after a reload, its own folder.
- **Rejected:** an × on the panel (it closed one file, not the panel: "it doesn't actually close"); the
  toggle in the list's bar always (with the panel on it would sit mid-window, and turning the panel off
  would leave the pointer over nothing); a copy of the toggle in each bar it might end (it held its place
  only while three bars kept the same height, padding and right inset, and was remounted on every toggle;
  replaced after review by one control at the header's right end that the bar under it leaves room for);
  `aria-pressed` on it (with the name saying what a click does it
  reads "Hide preview, pressed"); a read per selection move (a held arrow key would read every file it
  passes); full-width Back as "up to the file's folder" (from a root's outline, a nested file's folder is
  not where you were).
- **Panel off keeps the outline's row** (diverges from C, which turned it into a Finder table with column
  headings, a Kind column, dates and stripes): Jimmy said "dont just copy finder" and those were dropped
  earlier, so the list keeps its name, size and age columns across the width, the fills spanning the row.
- **Panel off, the rows stop at 960px** (the lead, from the phase 2 shots, 2026-11-05): across a 1440px
  window a size and age sat about 1,400px from the name. They are left-aligned under the path rather
  than centred as phase 1's column was: centred, the rows would jump sideways on every toggle and start
  away from the path that names their folder. Rejected: a cap with the panel on too (the divider is the
  user's own width).

### Search in Files: a desktop click looks, a file the user opens is a file opened

- **Decided:** 2026-11-05, the Files phase 3 build (p550), where the Search spec and mockup C left it open;
  revised the same day by the tech lead after review (p551): which row the panel follows, and what counts
  as opened.
- **What:** on a desktop a click on a result selects it and the Preview panel follows it, as a click in
  the outline does; Enter or a double-click closes Search and reveals the row in the outline. The phone
  opens a result on a tap. Each answer selects its first row for Enter, but the panel follows only a row
  the user selected (a click, an arrow key) and shows the folder until then. A file counts as opened for
  the recents when the user opens it: full width, full screen, Enter or a double-click on a result, or a
  selection that settles in the panel; never a row the app selected. The recents keep a path, its type
  and when it was opened, and a recent row shows that time, not a size. Search's field ends with Cancel on
  both layouts, as the path field does. Search's history
  entry names the folder it searches, and the host's Files session keeps one Search per tab and folder.
- **Rejected:** a desktop click that reveals at once (the panel could not show a result before you
  leave Search, and it would differ from the outline's click); recording only files opened full width
  (on a desktop with the panel on, most reading happens there and the recents would stay nearly empty);
  the panel following each answer's first row, and a file counting as opened whenever it shows (each
  settled query read up to a MiB of its top file and put it in the recents, and opening Search re-stamped
  the first recent's time to now);
  a stored size on a recent (stale once the file changes: missing data shows as missing); mockup C's ×
  inside the desktop field (the path field, already shipped, ends with Cancel); one Search per tab with
  no folder (a Back onto Search's entry renders once with the folder it left before the place follows,
  which replaced the kept Search with an empty one).

## Download in the iPhone app is a bridge request to a native fetch and the share sheet (bridge v11) (2026-11-05)

- **Decided:** 2026-11-05, the Files redesign phase 4 build (p554), on Jimmy's "an easy download for
  unsupported or any file".
- **What:** the app's web view can't download, so Files hid Download there. Bridge v11 adds
  `download { url, name }`: native resolves the page's own `muxen-app://h-{host}/fs/raw/…` URL as the scheme
  handler does (the host's `baseURL`, the percent-encoded path unchanged), fetches it with the Bearer token
  into one temporary file (`URLSessionDownloadTask`, 30 s between bytes, the daemon's raw stall deadline),
  shows a native alert with the bytes so far and Cancel once the download has run 0.5 s, then presents
  `UIActivityViewController` with the file under `name`. The reply comes when the sheet closes: `null`, or
  `{ error, code? }` that the web words with `refusalWords` and says in Files' notice. The file is deleted
  when the sheet closes, and the temporary folder is emptied before each download. A lock cancels the
  download and dismisses its alert or sheet. `Platform.download` is no longer optional and returns the words
  for a failure, so Download shows on every platform. v11 because the contract is strict equality and an
  older native refuses a message it doesn't know.
- **Rejected:**
  - `download { host, path }` like `playVideo`: the page already holds the raw URL the scheme handler
    resolves, and `Platform.download` takes it; a second path encoder in native would have to match the
    web's.
  - Progress in the web (an event stream like `upload` and a `cancelDownload` message, a download row in
    the upload panel): a second message, an id, and a panel the share sheet covers anyway. The alert and
    the sheet are both native and modal, so one reply when it's over carries everything the web shows.
  - A whole-file `Data` fetch, or a stream into the page as a `blob:`: memory grows with the file, and the
    blob would still need a native hand-off to save.
  - Showing the alert for every download: a small file would flash it before the sheet.
  - Saving straight to Files (`UIDocumentPickerViewController` in export mode): the share sheet has Save to
    Files and also AirDrop and opening in another app, which the brief asked for.

## Native requests to a daemon share one resolver and one redirect rule (2026-11-05)

- **Decided:** 2026-11-05, on the phase 4 review (p555, findings 3 and 6).
- **What:** the scheme handler's proxy, the uploader, the video player and Download each looked up the
  host's `baseURL` and token themselves, and only the proxy refused a cross-origin redirect; Download
  followed any. `MuxenAppModel.request(on:path:query:)` now builds every one (the `baseURL`, the
  percent-encoded path unchanged, the Bearer token), and `HostRequest.redirect` is the one redirect rule:
  the same origin, within the route the request was for. The video player can't take the rule, since
  AVFoundation follows redirects itself with no hook; it drops `Authorization` on a cross-origin redirect
  (checked on macOS), and a player plays what it gets, never as the app.
- **Rejected:**
  - Each session keeping its own copy of the check: four copies had already drifted to one.
  - Loading video through an `AVAssetResourceLoaderDelegate` on a custom scheme so native's own session
    fetches it: a Range-serving proxy in the app to police a redirect the daemon never sends.

## The app's native screens go up one way, and a lock takes any of them down (2026-11-05)

- **Decided:** 2026-11-05, on the phase 4 review (p555, findings 1 and 2).
- **What:** each present in the web shell checked, or didn't check, for the others on its own. Download's
  share sheet could be dropped (a video opened during the download, or Cancel tapped as it finished), and
  then the page never got its reply and the file stayed; a lock during the sheet's opening animation
  could leave it over the lock screen; the video player stayed over the lock screen. Now every screen
  (image menu, pickers, player, Download's alert and sheet) goes up through `MediaController.show`, which
  waits for a running transition, then refuses while another screen is up or the app is locked, and the
  refusal ends the request. A lock takes the screen down after its transition and runs what its own close
  would have.
- **Rejected:**
  - Guarding only the share sheet, as the review's minimum: the player over the lock screen is the same
    fault, and the next screen would repeat it.
  - Queueing a refused screen until the one up closes: a share sheet popping up after a video, minutes
    later, is a surprise; the notice says what happened and Download is one tap again.

### One path form: `~/…` under home, absolute elsewhere, icon-only header actions, size in Info

- **Decided:** 2026-11-05, Jimmy, from a desktop screenshot of the Preview panel.
- **What:** a path reads `~/…` under the host's `$HOME` and absolute elsewhere, as the path field does,
  in a file's and folder's header, Info, the can't-preview card, the "Copied <path>" notice and what Copy
  path puts on the clipboard. Insert into terminal still sends the absolute path. The Preview panel's
  header shows that full path (folder quiet, name bold) instead of the folder below the list's root.
  Copy path, Download and Insert ▾ in the file and folder headers are icon buttons on the desktop too,
  with tooltips; the size leaves the header line, and ⋯ (File options) on the desktop, as on the phone,
  holds Info: size, modified time and path.
- **Why:** the header read `.meridian/git/…/QUEUE.md`, the tree was rooted at `~/` and Copy path copied
  `/home/jimyao/…`: three forms of one path. Jimmy: "BE CONSISTENT". The labels beside the icons said
  what the icon and its tooltip already say, and the size is a fact to look up, not to read on every
  file.
- **Rejected:**
  - absolute paths everywhere (the tree and the path field are already `~/`);
  - `~/` shown but absolute copied (the same file read two ways, which is what Jimmy objected to);
  - `~/` on Insert too (a quoted `~/my file` does not expand in a shell).

### Revealing a file under a hidden name turns Show hidden files on

- **Decided:** 2026-11-05, design lead, from Jimmy's report that after opening
  `~/.meridian/git/…/QUEUE.md` by path the outline "didn't properly open, its still in ~/".
- **What:** the outline's one reveal (Search's Enter, and Back from a full-width file) turns Show hidden
  files on when a folder between the list's root and the file, or the file, has a name starting with `.`.
- **Why:** with the setting off the listing of `~/` has no `.meridian` row, so the reveal stopped at the
  root and left the file selected with nothing visible open. The setting is the device's, as ever, and
  stays on.
- **Rejected:**
  - showing only the hidden ancestors (listings are one per folder under one setting; a mixed outline
    needs a second listing model);
  - leaving the outline closed and saying why (the user asked to see that file).

## Server reachability (2026-11-05)

The word users see for the checking state is "connecting" (2026-11-06). Jimmy on the iPhone: "the word \"checking\" doesn't make any sense". The app is trying to connect, and the note and the terminal strip already said so. "Checking access…" stays: it names what is being checked. Rejected: "reconnecting", which is wrong at launch.

The design under the decision "A server's reachability is one state, shown on Home and read
everywhere". Jimmy's part of that entry is its quote; the rest are agents' proposals, in force as
built. The rules are in [plan.md](plan.md#reachability). Entries marked **Jimmy to confirm** carry
the design lead's recommended answer to a question put to Jimmy and not yet answered. They are in
force as built, and his answer may change them.

The same holds for three entries below: "A stuck socket recreates the web view only if the server
answers", "A slow link gets a longer connect limit" and "Last reached is saved with the workspace".
They went to him together; asked whether his "ok" was a yes, he answered "just handoff to
tech-lead", so he has said yes to none of them. The built versions also differ from what he saw:
the check starts at the third timeout rather than the second, the limit is 15 s rather than 15 to
20 s, and last reached rides on the workspace save rather than a write at page hide.

### Reachability is decided by the socket's own lifecycle, at the end of each attempt

- **Decided:** 2026-11-05, tech lead, on the fourth design review.
- **What:** the host's socket (`Host`) derives reachability where the evidence arrives. It keeps
  *trouble since* (when the first unanswered attempt of the outage began) and *last reached*, and
  decides at the end of each attempt: a `welcome` or a 4xxx close the server sent makes the server
  reachable; any other close makes it unreachable once an attempt fails at or after the 10 s
  threshold, plus one backoff step when failures come back quickly, and
  checking from reachable once 1.5 s have. Every path that opens a socket goes through one connect.
  Stopping the socket clears trouble. No timer runs for reachability. The socket's object owns the
  state for the host's whole life: a browser host that isn't admitted yet reports its admission
  check to it, by the same rows.
- **Why:** the socket already knows everything reachability needs: when an attempt began, how each
  ended, and its backoff. Copying those facts across a callback into a second state machine meant
  keeping two machines in step, and every gap three reviews found sat between them: connects that
  bypassed the one step, an abandoned attempt's clock still firing, a Retry the socket ignored
  leaving the card on "checking" for good. With one lifecycle, one connect and one owner, there is
  nothing to keep in step. An off server reaches the 10 s threshold plus one backoff step; timeouts land at
  about 10 s, while fast failures such as `tailscale serve`'s 502 can take longer.
- **Rejected:**
  - a separate reachability reducer with its own transitions table, 10 s timer and event protocol
    (attempt, open, closed, stopped), fed by the socket and by HTTP: two machines tracking one fact;
  a pure step shared by the socket and the admission check, with the state kept by whichever ran
  (two copies, with a gap at the hand-over);
  - deriving reachability from the sessions listing (only Home and the overlay list, and a listing
    says nothing while a request hangs).

### Reachability sits beside admission, not inside it

- **Decided:** 2026-11-05, design lead.
- **What:** each host has a reachability separate from its admission. Admission is whether the
  daemon lets this client in; reachability is whether it is answering now. Admission loses its
  `unreachable` kind: a browser host whose `/auth/info` gets no answer stays deciding, still retried,
  and its reachability says why.
- **Why:** the host registry runs a socket only while the host is admitted. Marking an off host
  unadmitted would stop the socket, the only thing able to notice it come back. The two also change
  for different reasons: admission on the daemon's verdict, reachability on traffic.
- **Rejected:** an `unreachable` admission in the app (stops the socket, never recovers).

### An answer is a `welcome`, a close the server sent, or `/auth/info`'s own body

- **Decided:** 2026-11-05, tech lead, on the fourth design review.
- **What:** on the socket, a `welcome` or a 4xxx close received from the server is an answer, a
  refusal included. Closes the client made itself (timeouts, a protocol error) and closes for a
  socket native never opened are not; the link marks each of those, native's 4401 for "no token"
  too, which still halts and refuses because that is a local fact. Over HTTP only the admission check counts: a 200 whose body has
  a string `hostId`, or the daemon's 503 `identity_unavailable`. No other HTTP response feeds
  reachability.
- **Why:** counting only `welcome` made an over-cap host and a refused token read "offline" while the
  daemon answered every attempt. Every other HTTP request is made while the socket is joined, so the
  socket's answer always comes too; `/auth/info` is the one request that runs without a socket, and
  its body is one only the daemon sends: native's own 404 has no `hostId`, and `tailscale serve`'s
  502 is not 200.
- **Rejected:** a `Muxen-Daemon` response header set by the daemon and forwarded by native, marking
  every daemon response as an answer (a daemon and native contract, an exception for the path-secret
  404, and an allow-list and expose-list entry in native, for one case the body already settles);
  status codes as the test (native's 404 has the daemon's body shape).

### The 10 s rule, checked when an attempt ends; failures alone don't decide

- **Decided:** 2026-11-05, design lead; checked at an attempt's end on the fourth review.
- **What:** a server turns unreachable when an attempt fails 10 s or more after the outage's first
  unanswered attempt began. That is the tab strip's former threshold, now the one copy. A quick
  failure does not turn it unreachable sooner. An open socket's idle close (25–35 s after the last
  message) turns it unreachable at once.
- **Why:** one threshold for every view, so the card, the strip and the folder view agree. A handoff
  between Wi-Fi and cellular fails a socket or two and recovers within seconds, which must not read
  offline. A powered-off host gives no failure at all, only timeouts, so a rule built on counting
  failures would miss it.
- **Accepted risk, to verify on the iPhone:** if `NWPathMonitor` reports unsatisfied, even briefly,
  during a Wi-Fi to cellular handoff, every card reads "This iPhone is offline" at that moment and
  every waiting GET fails (the views reload once the network returns). The device check decides
  whether the no-network signal needs a grace period of its own.
- **Jimmy to confirm:** 10 s, not 5 s (one connect timeout reads offline on a slow cellular link
  where the server is fine).
- **Rejected:** first failure → unreachable (flicker on handoff); the 5 s connect timeout as the
  threshold; a count of failures (an off host produces timeouts at a rate set by the backoff); a
  timer per host (the end of an attempt is where the evidence is, and an off server's attempts end
  on the 10 s mark anyway).

### The card keeps its last word until an attempt fails; only a tapped Retry shows "checking" over "offline"

- **Decided:** 2026-11-05, design lead; reshaped on the fourth review.
- **What:** from reachable, the card changes only when an attempt ends: a failure 1.5 s or more into
  the outage shows checking, and one 10 s or more in shows offline. From unreachable, automatic
  retries leave the state until an answer comes. A tapped Retry shows checking at once when it started
  an attempt or one is in flight, which then ends as any other. At launch every card is checking
  until an answer or until it turns unreachable.
- **Why:** an offline card that flips to checking on every backoff retry is noise, and so is a
  resume that flashes "checking" for 200 ms. The 1.5 s is the strip's slow-connect threshold; checked
  at an attempt's end it costs a comparison, not a re-render timer per card. A resume to an off
  server reads its last word until the first connect times out (5 s), checking, then offline at
  about 10 s.
- **Jimmy to confirm:** the last word until the first attempt fails, then checking, rather than
  "checking" 1.5 s after an unanswered attempt begins (which needs a timer per card).
- **Rejected:** showing every attempt; a 1.5 s timer from the attempt's start (a re-render timer on
  every card); keeping the last word until offline is decided (Home read "connected" for 10 s over
  an off server, the original complaint, only shorter).

### No network is applied when the state is read, not stored

- **Decided:** 2026-11-05, design lead, on the third review; applied on read on the fourth.
- **What:** while the phone reports no network, every server shows *no network* ("This iPhone is
  offline."), and only the network returning clears it. The registry applies `lifecycle.online` when
  it builds the shown state, so no view does. An unanswered attempt that ends with no network changes
  nothing; a `welcome` or server-sent 4xxx still counts as an answer. The network returning clears
  trouble.
- **Why:** stored as a state, the cause depended on event order: an answer during the outage (a LAN,
  a wrong path report) made the server reachable, and the next failed attempt read "Can't reach
  pop-os", with the wrong fix. Ignoring unanswered attempts with no network keeps that outage from
  deciding "no answer" for every server behind it, while retaining an answer that arrived anyway.
- **Rejected:** no network as a fourth state (the order problem above).

### The existing socket is the probe; nothing new is sent

- **Decided:** 2026-11-05, design lead.
- **What:** reachability learns only from attempts views already make: the listing's join while Home
  or the overlay is on screen or the host has a tab, the tab sockets, and the browser's admission
  check. A hidden page or a locked app sends nothing, the browser's admission check included.
- **Invariant this rests on:** every HTTP request to a server is made while something has joined its
  socket. Today a Files tab is a tab, and Settings and the sessions overlay open over Home, whose
  listing joins every admitted server. A screen that sent a server requests without joining its
  socket would break it: its GETs to an unreachable server would fail at once and no socket would
  be retrying, so the server would never be tried again from that screen.
- **Why:** "every byte on the network costs the user"; the backoff already exists and already runs
  while Home is up.
- **Jimmy to confirm:** a server with no tabs, while a tab of another server is on screen, isn't
  refreshed until something needs it; entering Home re-checks. The alternative is polling.
- **Rejected:** a periodic `/auth/info` probe while Home is visible (polling); native probing hosts
  from Swift and pushing the result (a second owner, and native can't see the web's socket); the
  Tailscale API (needs a key and leaves the tailnet, against the tailnet-only rule); letting the
  browser's admission check run its backoff while the page is hidden.

### One admission check, given up after 5 s

- **Decided:** 2026-11-05, tech lead, on the fourth design review.
- **What:** the registry sends `GET /auth/info` through one function, `probeInfo(handle)`, which
  gives up after 5 s. The browser's admission check uses it, and so does the
  [connect-timeout rule](plan.md#reconnect). `/auth/node/session`, the check's second request, has
  the same limit, so a server that dies between the two doesn't hang the check.
- **Why:** the admission check had no timeout, so a browser's check to an off host waited for the
  browser's own TCP timeout. 5 s matches the socket's connect timeout, so an off host's second check
  reaches the threshold at 10 s plus one backoff step, as its second connect does.
- **Rejected:** no limit (the browser's TCP timeout, tens of seconds); a separate server-check
  function beside the admission check.

### An unreachable server's GETs fail at once; there are no per-request timers

- **Decided:** 2026-11-05, design lead, on review.
- **What:** when a server's shown state becomes unreachable or no network, every GET and HEAD not
  yet finished, body included, fails as `network`, and one made while it shows either is not sent. Other methods
  are always sent and never aborted. `GET /auth/info` is exempt.
  In the app, only the scheme handler's compatibility check gets a 10 s request timeout; the proxy
  session keeps its default.
- **Why:** the abort fires on the same evidence as the state, so a request stops exactly when the
  server turns unreachable, and a request is cut short for no other reason. It
  needs no timer per request, and on a spotty link it sends no request that is bound to fail. A write
  may already have been applied, so aborting it invites a duplicate. A request timeout is per
  session, so 10 s on the proxy would also cut saves and slow live searches; the compatibility check
  is what held every request to an off host for 60 s.
- **Rejected:** a blocked GET nudging the socket (the socket is already retrying, and each nudge
  resets the backoff, so browsing an off server would hold it near one connect per 5 s; Retry is
  there); a per-GET timer; `AbortSignal.timeout(10 s)` on every request (cuts a slow answer
  from a live server); aborting writes; a 10 s timeout on the proxy session; relying on URLSession's
  60 s (up to about 2 min in the app with the compatibility check in front).

### An open socket feeds reachability on `welcome` and on close, not per message

- **Decided:** 2026-11-05, design lead, on review.
- **What:** an open socket counts as answering. `welcome` is an answer; the close carries the time of
  the last message received, which becomes the server's *last reached*. A server that goes off under
  an open socket reads offline at the socket's idle close, 25–35 s after its last message.
- **Why:** while the socket is open the server can't be anything but reachable (the link closes
  itself within 35 s of silence), so a per-message answer would only move a timestamp, on the
  terminal's hottest path.
- **Jimmy answered** ("sure", 2026-11-06), keeping "within about 35 s" for offline and approving the
  faster word: when an ask (a `watch` or a request sent; not keystrokes, resizes or pings) gets
  nothing back, no message or frame of any kind, for 3 s, the reach goes from reachable to checking, so
  Home reads "connecting" with a tab that does. Any message or frame returns it to reachable. The host
  compares the socket's last-receive time with when the ask went out when one timer fires, so nothing
  is added to the receive path but a check of one flag. Stopping the socket undoes it.
- **Rejected:** a receive callback per message that moves a timestamp; checking after one missed pong
  (it depends on the ping interval, and flips Home with nobody waiting on the server); a shorter
  heartbeat (bytes for every user, all the time).

### A stuck socket recreates the web view only if the server answers

- **Decided:** 2026-11-06, tech lead, on the sixth review. Jimmy was shown this option and sent the
  work on without objecting; he has not said yes to it in so many words.
- **What:** from the second connect timeout in a row the socket takes a backoff step as usual. From
  the third, the first on the 15 s limit, the registry also sends one `probeInfo(handle)`. The web
  view is recreated only if that check is answered and no socket was welcomed since, at most once
  per 10 minutes, and not while another server's socket is open. The limit lives in the web, in the view store, which survives a recreated
  web view. Native keeps no limit.
- **Why:** a powered-off server times out every connect, exactly like the stuck socket, but it
  answers no HTTP, and the research says HTTP stays usable and a reload restores a stuck socket
  (WebKit 308073, [ios-web.md](research/ios-web.md)). An off server therefore never reloads: offline
  lands at about 10 s, the card keeps last reached, and a Files tab keeps what it has loaded. A reload
  takes down every server's terminal, so a socket open to another server, which shows sockets work,
  declines it. The check waits for the third timeout because the first two are on the 5 s limit,
  which a live server on a slow link misses: a check then answers while the third attempt is
  about to succeed, and would reload a working app. So a real stuck socket recovers at about 25 s
  rather than 10 s. The rule is harmless if the bug doesn't occur in WKWebView, and can be deleted then.
  It assumes HTTP stays usable during a stuck socket in the app, which is unverified; if it doesn't,
  a stuck app is not recovered until the next foreground.
- **Cost accepted:** one more `/auth/info` per connect timeout from the third, about 1.3 a minute
  per off server once backed off, in the foreground, on the failure path.
- **Rejected:**
  - recreating at most once per 10 minutes with no check (the interim, in force until this entry and
    never built): an off server reloaded on most resumes, offline came at about 20 s, a reload
    dropped last reached and everything `Folders` held, and it tore down live terminals on healthy
    servers;
  - limiting native only, with no ask from it until the device check (nothing recovers a stuck socket
    in the app);
  - arming the rule only after a resume (resuming to an off box is the common case);
  - quiet mode, in which a socket that timed out twice sent `GET /auth/info` checks in place of
    connects until the server answered. Its checks replaced attempts, so it ran a state beside
    reachability for one fact, and three reviews found its gaps between the two. Here the socket's
    cadence doesn't change and the check keeps no state: it reads the socket when it returns;
  - checking from the second timeout (the slow-link reload above);
  - halting the socket when the limit declines (a server that came back stayed offline until Retry);
  - a limit in Swift as well as the web (two copies of a five-line rule across a bridge).

### A slow link gets a longer connect limit once the server is unreachable

- **Decided:** 2026-11-06, tech lead, on the sixth review. Jimmy was shown this and sent the work on
  without objecting.
- **What:** the first two attempts of an outage keep the 5 s limit. After 10 s of trouble, and for a
  server stored as unreachable, each attempt gets 15 s. A socket that has opened waits up to 15 s for
  `welcome`, and that wait ending is an ordinary unanswered close, never a connect timeout.
- **Why:** a socket reached `welcome` in 4.0 s over a proxy adding 2 s of round trip, without TLS
  (Chromium and WebKit, 2026-11-06), so a link of about 2 s round trip, less with TLS, misses 5 s on
  every attempt. With the GET guard that link would be locked out
  of Files for good, and Retry would hit the same limit: a breach of "usable on barely-there
  connections". Longer limits cost an off server nothing and send fewer attempts.
- **Rejected:** a longer limit from the first attempt (offline would land later than 10 s); a fixed
  limit (the lockout); treating `onopen` as an answer (a daemon that accepts and says nothing would
  read connected).

### Last reached is saved with the workspace

- **Decided:** 2026-11-06, tech lead, on the sixth review. Jimmy was shown this and sent the work on
  without objecting. Replaces "nothing is persisted for it" in "Home is server cards".
- **What:** each server's last reached is part of the saved workspace, by host id. Saving the
  workspace carries the latest values, which covers page hide and before a restart; nothing writes
  because a value changed. Reachability itself is never saved.
- **Why:** a kill, or a launch to an off server, would otherwise read "Not reached since muxen
  opened" about a server reached minutes ago. Writing on each save costs no new write and nothing on
  the socket's path.
- **Rejected:** writing on every `welcome` and close (storage on the connection path); keeping it in
  memory.

### Views read one shown state, and reload when it becomes reachable

- **Decided:** 2026-11-06, tech lead, on the sixth review.
- **What:** the registry exposes the *shown* state: the stored state, or no network. Every consumer
  rule is written against it. A view whose last load failed as `network` loads again when the shown
  state becomes reachable or a new socket is welcomed while it is reachable. While it shows
  anything but reachable such a view says "Waiting for pop-os", or "Can't reach pop-os" in Settings;
  a `network` failure under a reachable server offers its own "Try again". Refusals the daemon
  makes while running, a 4001 included, reach admission.
- **Why:** reviews kept finding the same gap: rules written against the stored state, while what
  users see has no network applied. Keyed on the server answering, a folder that failed during a
  no-network blip over an open socket stayed on "Waiting" for good, because no answer follows on a
  socket that never dropped: the original complaint by another route. Reloading only on reachable
  sends no GET that a Retry into an off server would have to abort.
- **Rejected:** reloading on any state leaving unreachable (a tapped Retry sends every failed view's
  GET to a server that may still be off).

### A refusal outranks offline on the card

- **Decided:** 2026-11-05, design lead, on review.
- **What:** the card shows admission that needs the user (every refused kind) above offline, then
  checking, then the listing and the notices for a daemon turning sockets away.
- **Why:** a refusal is the daemon's standing verdict and its fix (re-enrol, update) is what the user
  must do whether or not the server is on right now. A refused token also stops the socket, so the
  server's reachability is not refreshed after it; "offline" there would be stale.
- **Rejected:** offline over everything (hid the re-enrol banner behind a wrong Tailscale hint).

### One "Can't reach" for a machine that's off and for muxen that's down

- **Decided:** 2026-11-05, design lead.
- **What:** an unreachable server reads "Can't reach pop-os" with the hint "Check that it's on and
  that Tailscale is on.", whatever the cause on the far side.
- **Why:** the phone can't always tell the two apart: a WebSocket gives the same 1006 either way.
- **Jimmy to confirm:** one message; telling them apart is later work, if ever.
- **Rejected:** separate copy for "muxen isn't running" (right only where `tailscale serve`'s 502
  shows it, and wrong when the guess is wrong).

### One banner per screen, for that screen's server

- **Decided:** 2026-11-05, design lead.
- **What:** on a screen that belongs to one server the Shell shows only that server's banner, and none
  over Home, where each card carries its own server's banner as its notice. "Can't reach X" is said
  once per screen: the card on Home, the strip on a terminal tab, the banner elsewhere. A folder that
  couldn't load says "Waiting for pop-os" with no second Retry.
- **Why:** with several servers, another server's outage over this server's terminal changes nothing
  the user can do here; two Retry buttons for one fault make the user pick one.
- **Jimmy to confirm:** a tab shows only its own server's banner, where the Shell showed every host's
  banner on every screen but Home.
- **Rejected:** every host's banner on every screen; the folder body carrying its own "Can't reach"
  and Retry beside the banner.

### Unsaved text gets no special defence

- **Decided:** 2026-11-06, Jimmy.
- **What:** an edit stays on the path it opened. muxen doesn't follow a rename, warn on a delete, or
  guard a remembered edit against a second browser tab. Only the file on disk is protected: the
  ETag check, one file's text never saved into another, a save never blanking a file.
- **Why:** "unsaved data lost is... kinda par for the course". Each defence added a flag or a rule
  for a case people rarely hit.
- **Rejected:** moving edits on rename, refusing a rename onto a name with unsaved text, naming
  unsaved changes in the delete dialog, preferring the live edit at flush.

### Every view reads one derived server state

- **Decided:** 2026-11-06, tech lead.
- **What:** `serverState(host)` returns `attention | noNetwork | unreachable | checking | up`, derived
  from admission, the shown reachability and the refusal, never stored. The card, the banner, the tab
  strip and pill, Open session and Settings switch on it; each keeps its own words. A tab's own
  states (closed, session limit, detached, a failed watch) come before it. A refusal is the banner's
  alone: the strip stays quiet. On a terminal tab the banner says unreachable when the tab's own state
  fills the strip, so it is said once.
- **Why:** six views had each re-derived the order, and each had drifted: two messages for one refusal,
  a dead Retry, a tab joined after a refusal reading "Connecting", Open session spinning on a refused host.
- **Rejected:** a function returning words (the card, banner and strip word the same state differently,
  and rightly).
