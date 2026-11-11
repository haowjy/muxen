# src/tmux: what to know before editing

Reasons behind the larger choices are in [daemon-core.md](../../../docs/design/daemon-core.md).
Probe evidence is in `docs/design/research/`. The code and recorded fixtures say the rest.

## Invoking tmux

- Every invocation is `tmux -u -N [-L|-S] …` from `Endpoint::command`, with `TMUX` unset.
  `-N` makes a missing server an error instead of a started one; `-u` stops tmux 3.4 turning
  non-ASCII and line breaks in format output into `_` under a non-UTF-8 locale.
- The control client is `attach-session -t '$S' -f pause-after=3` over pipes (no pty). Its
  first line is `display-message -p '<version, pid, start_time, window size, client name>'`;
  the reply gives the server instance (`<pid>-<start_time>`) and the client's own name, then
  the session sets `refresh-client -C <W>x<H>` and only then reports `Ready`. One line can't do
  both: `refresh-client -C` doesn't expand formats.
- Below tmux 3.4 the client stops with `TmuxTooOld`; an unparseable version counts as newest.
- Format strings separate fields with a raw TAB; the field holding user text goes last and is
  split with `splitn`.
- One group per written line, never empty (an empty line detaches), at most `MAX_IN_FLIGHT`
  outstanding. Closing is dropping the line sender: stdin closes, 1 s, then kill.

## Parser

- Inside a `%begin` block every line is body until `%end`/`%error` with the same `N` and `F`.
  Unknown notifications are `Line::Unknown`; a line over the cap is `Line::TooLong`, never an error.
- **Open hole:** a body line (captured pane text, a raw window name) that equals the matching
  `%end T N F` ends the block early, and the rest of the real body then parses as top-level
  lines (forged `%output`, `%exit`). `N` is guessable by anything that can write to a pane.
- A flag-1 `%begin` with no group pending is fatal (`UnexpectedReply`): the parser would swallow
  every later line, so a respawn is the only clean recovery.
- Subscription values reach the stream outside a block: see Subscriptions.

## Session

- Replies match by position: a flag-1 block belongs to the oldest pending group, which completes
  after one `%end` per command; `%error` completes it at once (tmux skips the rest of a list).
  Flag-0 blocks (the attach reply, hooks) are dropped unheld.
- Reply bodies of one group are held up to 1 MiB; past it the group fails `TooLarge` and the
  client survives.
- **Wanted panes.** `Snapshot` wants a pane, `Release` unwants and pauses it. Output from an
  unwanted pane with no pause in flight is dropped and the pane paused (`refresh-client -A
  '%P:pause'`). Never `'%P:off'`: it crashes tmux 3.2a–3.6b with output queued. A pause waits for
  a reply slot when over the in-flight cap; pause tracking lasts only while a pause is in flight.
- **Release invalidates the pane's outstanding snapshot attempts at request time.** None is
  re-sent (a snapshot list starts with `continue`, which would resume the released pane), and each
  answers `Done { Err(Released) }` when its group ends. So every snapshot tag is answered, in
  stream order, and the hub needs no knowledge of what a Release invalidates.
- **Gap:** a `%pause` muxen didn't request for a wanted pane means tmux dropped bytes. It is
  loss only when tmux queued output for a stalled muxen past `pause-after`; with only control
  clients attached tmux stops reading the pane instead, so a stall shorter than 3 s loses
  nothing (blocks already queued keep ageing).
- **Torn snapshot:** `%output` for its own pane between its first and last reply, or a second
  `<STATE>` read that isn't byte-identical to the first. Re-sent up to 3 attempts, then `Torn`.
  A hook with `run-shell` (waits) lets output in mid-list; `display-message -p` only adds a flag-0
  block and is harmless.
- **Notifications:** `%session-window-changed` goes to every control client for every session;
  only the one naming the client's own session becomes `CurrentWindow`. Own-session
  `%session-changed` (attach, own take) is dropped; another session's becomes `SessionChanged`
  (tmux moved the client under `detach-on-destroy off`). `%client-session-changed` is dropped.
  `swap-window` without `-d` changes the current window with no notification: see Subscriptions.
- `%exit` after `Ready` is `Exit`; before `Ready` it is `Fatal(StartupExit)` (a startup crash,
  never a detach).

## Commands

- `command.rs` is the only place command text is built. User arguments go in single quotes
  (`'` as `'\''`) after doubling every `#`; control characters are rejected. Never send a control
  client a command that waits (`run-shell`, `if-shell`, `wait-for`, `confirm-before`,
  `command-prompt`).
- **Locate never errors:** on 3.4 and 3.7b `display-message -t` a missing session succeeds with
  empty target fields; an empty `session_id` means gone. It includes the session name (escaped by
  tmux, so before the tabbed window name) so a control-client-cap refusal can name sessions.
- `SelectWindow` is `select-window -t '$S:@W' ; switch-client -c '<client>' -t '$S' ;
  refresh-client -C '@W:CxR'`: naming the session stops a linked window resolving to another
  session; the take follows the select because a control client's `select-window` makes no client
  `latest`, and a vote ahead of the select reflows the window twice.
- Input and paste target `-t @W` (the window the tab showed), so keys can't race an active-pane
  change. Text goes as `send-keys -H` hex (≤ 512 bytes per command), named keys by name; key names
  must match the regex in `command.rs`, and `tests/fixtures/proto/keys.json` lists every name the
  clients send. tmux 3.4 types `S-Enter` as text, so Shift+Enter goes as CSI-u bytes.
- **Paste:** buffer `muxen-<tag>` (tags are unique across control clients because buffer names are
  server-wide). `paste-buffer -d` deletes only on success, so every failed paste group is followed
  by a separate `delete-buffer` group whose error is ignored. `load-buffer` of a missing file
  succeeds on 3.4 and the group fails at `paste-buffer`. With `enter` the list begins with
  `copy-mode -q` and ends with `send-keys Enter`; a failed paste never gets its Enter, and an
  `error` can follow a landed paste only if the window vanished between the two.
- **Paste files** are 0600 files in `$XDG_RUNTIME_DIR/muxen/` (tmpfs, charged to muxen), held as a
  `PasteFile` with a slot. The daemon empties the directory at startup only after the runtime lock
  and both sockets are held: a second daemon started by mistake must not delete in-flight pastes.
- **History:** a group of `#{history_size} #{pane_height}` before and after two `capture-pane`
  calls (`-e -N -T` physical rows and `-J` logical rows, one lookahead row). Unequal bounds
  answer `Torn`. The core replays tmux's clamping so the first returned row has its true line
  number, and derives the wrap bitmap by aligning the two captures; an unmatched boundary stays unset.

## Snapshot

One command list: `continue`, `<STATE>`, the `-e -N` active capture, the two history-pairing
captures, the pending-parser capture (`-P -C`), the alternate-screen capture (`-a -q`), then
`<STATE>` again. tmux queues pane bytes before parsing them and keeps replies and output in one
ordered queue per client, so output before the first reply is in the capture and output after the
last reply is live. Stream order is the boundary.

- `continue` goes first (resumes a paused pane). `-q` lets a pane without an alternate screen
  succeed. The `<STATE>` re-read goes last; a size-only check would miss a hook's `send-keys -R`.
  The `<STATE>` field list is a per-version table in `snapshot.rs`.
  `mouse_all_flag` is `?1003`; `mouse_any_flag` only says some mouse mode is on.
- `compose` builds restore bytes for a freshly reset `cols × rows` terminal so the clients carry no
  restore logic. Order: wrap off; saved primary grid and alternate-screen entry when
  `alternate_on`; active grid painted with CUPs, wrap-mapped soft boundaries replayed through one
  wrapped glyph so xterm.js sets `isWrapped`; tab stops, scroll region, origin mode; modes; cursor;
  the pending parser bytes. Every position from tmux is clamped to the pane so odd input can't panic.
- Not restorable from 3.4: SGR pen, character sets, cursor shape, title, bracketed paste, focus
  reporting; a pending wrap (restore clamps `cursor_x == cols` to `cols-1`); the primary screen's
  region and tab stops behind an alternate screen; a saved cursor after `?47h`/`?1047h`.
- Zoomed panes take sizes from the visible layout of `%layout-change`.
- Check a change to `compose` against `vt100` (the tests) and, by hand, `@xterm/headless` with the
  Unicode 11 addon as `web/term/` uses it; `vt100` has no autowrap, insert mode or tab stops.

## Sizing

A window takes the size of the client that acted last (tmux's `latest`). The owner **votes** the
watch's size with `refresh-client -C '@W:CxR'` and **takes** `latest` first with a same-session
`switch-client` in the same group (3.4 recalculates before the switch sets `latest`, so the vote
after it is what resizes). Claim rules live in the hub (`src/hub/.context/CONTEXT.md`); here, only
what tmux does:

- A control client's `send-keys` and `select-window` never make it `latest`; its `switch-client` to
  its own session does. A vote caps each dimension whoever is `latest`.
- A take is a real `switch-client`: `client-session-changed` hooks run once per take; the session's
  activity time advances; the laptop's subscription entry doesn't change, so a take never reads as
  another client's act.
- Under `window-size` other than `latest`, a take changes nothing and the vote only caps.
- The owner stays `latest` where it took after its vote clears, so the window keeps the owner's
  client size until a terminal acts there or the owner detaches.

## Subscriptions

- Window subscription: `refresh-client -B 'w<W>:@W:<acts>|<cwd>'`; `Unsubscribe` is
  `refresh-client -B 'w<W>'`. `<acts>` has one `name.activity.WxH.flags;` entry per non-control
  tmux client whose current window is `@W`. It reads `#{client_height}` before `#{client_name}`:
  3.4 lists a newly accepted client in `L:` before it has a name, and expanding the name there
  dereferences NULL ([crash probe](../../../docs/design/research/tmux-subscription-format-crash.md)).
- `<cwd>` is `#{pane_current_path}` or empty when it holds a control character, because tmux
  writes the value into one line unescaped and a line feed would forge `%exit`. The empty value
  reaches the hub as no cwd. `#{s/[[:cntrl:]]/…/}` prints empty for every path on 3.4 and 3.8,
  so it can't sanitize.
- `Session` splits at the first `|`, keeps each window's last entries, and emits `Acted` when an
  entry is new or changed (activity, size, a client arriving), not when one leaves, not for a
  focus-out (only `focused` drops from the flags) and not for `ignore-size`. The first value after
  the `Subscribe` reply is the baseline; a value between `Unsubscribe` and the next `Subscribe`'s
  reply is dropped. tmux checks once a second, so faster changes collapse and an act reports
  0.5–1 s late.
- Current-window subscription `refresh-client -B 'c::#{window_id}'` catches `swap-window`. Its
  first value is reported too; one naming the session's last window is dropped.

## One-shots (`oneshot.rs`)

Argv, no shell, no quoting layer: tmux takes each argument literally except one ending in `;`
(ends the command) or equal to `;` (separates commands, as `List` uses). A user's name or dir gets
every `#` doubled and a trailing `;` sent as `\;`; control characters or a non-UTF-8 path are
`BadRequest`. One at a time, 2 s timeout, 1 MiB stdout cap. Errors: both no-server messages and the
`muxen-server-changed` guard are `NoServer`; other non-zero exits `Command`; `Timeout`, `Spawn`,
`TooLarge`, `BadReply`.

- `List` is `<install> ; display-message -p '#{version}\t#{pid}\t#{start_time}' ; list-windows -a
  -F …`. Every field is tmux-generated or numeric except the window name, which passes through
  `#{s/<LF>/\\n/:window_name}` so one line is one window; a line that doesn't parse is `BadReply`.
  `#{n:…}` can't frame the name (3.4 escapes control characters only on output).
- **Bell hook** at fixed index `alert-bell[9100]`: `-ga` would take the first free index and muxen
  couldn't tell its entry from a user's. `<install>` is `set-option -goq` (empty-only, silent on an
  occupied index, steady state writes nothing). `AdoptBellHook` (hub start) rewrites an older
  build's entry (`<ours>` = `#{m:set-option -F @muxen-bell*,#{alert-bell[9100]}}`); `RemoveBellHook`
  (shutdown) unsets only while `<ours>`. Check and write are one list. `<ours>` reads through the
  most recent session, so a session-level hook hides the entry and both skip safely. Read only
  indexed elements: unindexed `#{alert-bell}` is empty on 3.4 and joined on 3.8.
- `covered` per window is `#{&&:#{&&:<ours>,#{monitor-bell}},#{==:#{bell-action},any}}`.
- **`NewWindow` carries the server instance** and `new-window` is preceded by `if-shell -F
  '#{!=:#{pid}-#{start_time},<server>}' muxen-server-changed`: session ids restart at `$0` per
  server, and the hub's cached instance can be stale or unknown. It runs without `-d`, so the new
  window becomes current.
- Never send `respawn-pane` over control mode: with a flooding pane it killed the tmux server 4 of
  4 runs. tmux 3.4 also crashes on a window change and a kill of the same session in one list while
  a control client is attached; keep session-follow and kills in separate groups.

## Pump

`spawn` can't fail: a failed start arrives as `Exited` with the stderr tail and no bytes before it.
`Exited` is always last. The line channel is as deep as `MAX_IN_FLIGHT`, so `try_send` can't find
it full. While `out.send` waits the pump reads no stdout (tmux queues and eventually pauses) and
keeps writing stdin. It batches reads under sustained output (the gate in `pump.rs`): waking per
tmux write cost 44.8% of a core on a numbered-line flood, 2.0% batched.
