# Changelog

All notable changes to muxen are recorded here. CI promotes `[Unreleased]` to a
version section on release.

## [Unreleased]

- Touch: the terminal scrolls natively through tmux's history as one list, and a selection stays while you scroll. This covers the iPhone app (both inputs) and phone Safari. A fling is one continuous scroll; older lines load as you near the top, and dragging a selection's handle (or the keyboard-up mark) to the top or bottom edge scrolls on. Output that rewrites a selected row still closes the selection. In the app's default input the long press now selects with iOS's own handles and menu, not muxen's Copy and Paste bubble. On a desktop with a touchscreen (and an iPad with a trackpad), a finger no longer scrolls the terminal until desktop moves to the same list; the wheel and trackpad work as before.
- tether is now muxen. The command is `muxen`, config lives in `~/.config/muxen`, and the iPhone app is a new app (`com.jimmyyao.muxen`). Before installing, run `tether teardown` on each host, then `muxen setup`, re-enroll each device, and update any shell config that sources `contrib/shell/tether.zsh` or `tether.bash`.
- In the iPhone app's web keyboard test, holding a word in the terminal with the keyboard up marks it without lowering the keyboard: drag your finger or the two handles to extend it, then iOS's Copy and Paste menu appears over it (tap the mark to show or hide the menu, tap elsewhere to clear it). With the keyboard down, iOS's own selection menu gains a Paste item. The app's selection handles use muxen's accent colour. Output keeps running, so a mark on rows that redraw goes away.
- In phone Safari and the app's web keyboard test, a long press on terminal text with the keyboard down selects it with iOS's own handles and menu, and Copy joins a wrapped command into one line. A tap on the terminal no longer raises or lowers the keyboard: only the keyboard button does, and the cursor looks hollow or solid without redrawing the screen. With the keyboard up a long press still selects nothing. On a phone the terminal now draws as text rather than a picture, and the selection colour in dark mode is the accent blue, on the desktop too.
- In Open session, New session asks for a name: with the Session name box empty it puts the cursor there instead of creating a session tmux names. Creating or opening a session from the tab list now shows that tab, no longer the tab list.
- In the iPhone app, swiping from the left edge goes back, the same as ‹: a tab to Home, the tab list back to its tab, a Files folder to its parent. It is off on a terminal with nothing over it, so it never fights the terminal. The swipe turns on once the page has shown a screen, and a web view restarted after a crash starts with no earlier page to swipe to. Phone Safari is unchanged: its own edge swipe can't be turned off.
- Navigation has two levels. A server on Home opens the tab you last had there, and ‹ in a tab goes back to Home, no longer through the tab overview. The tab overview opens over the tab from the tab row's new All tabs button, and picking a tab, Open session or Open files there closes it onto that tab. On the phone and iPad, Back is always at the bottom left, where the tab row's ‹ is: Home, the tab overview, Settings and Open session have a bottom bar, and Home's Settings gear moved into it.
- In phone Safari and the app's web keyboard test, hardware Ctrl chords, Tab and the up and down arrows typed in the line box go to the terminal, as in the app; with no box focused, a hardware keyboard types into the terminal too: characters, Enter, Backspace, chords, Escape, Tab and arrows. A key a dialog, a menu or the line box's Enter already handled is not sent as well. Ctrl+letter follows the keyboard layout (Ctrl+A on AZERTY is Ctrl-A).
- In phone Safari and the app's web keyboard test, a hardware Ctrl+[, Ctrl+/ and Option+punctuation (Option+. in bash) now reach tmux as they do in the app, and the key row's armed ctrl and alt do the same for the next punctuation key. Hardware Ctrl+Shift+letter is named with the capital (`C-A`), as in the app; an armed ctrl with a capital typed still sends Ctrl-C.
- Icons are now Lucide's: Settings is a gear (it was a sun-like circle with rays), and Hide keyboard is a keyboard with a slash through it.
- On an iPhone in Safari (and in the app's web keyboard test), every text box (the line box, the Files path box, the enrol screen's code box, and the Device name, Session name and search fields) no longer shows a row of word predictions or autocorrects your typing: autocorrect was meant to be off on the first three, and was being switched on; the others never turned it off. The line box's Return key reads return instead of Send.
- In the iPhone app, a long press on a word in the terminal selects it and shows muxen's Copy and Paste again, anywhere on a full screen; it used to select nothing. A long press no longer lowers the keyboard: it stays as it was, and with it up the dock stays drawn above it. Apple Intelligence's Writing Tools button no longer appears over the selection. A tap anywhere on a selection closes it, so the next long press always starts a new one; a tap on the selected word used to leave it up and the next long press did nothing.
- In the iPhone app, a long press on terminal text selects the word under your finger when the press fires, with fewer cases of Paste alone: deep scrollback and long wrapped lines no longer push the pressed row out of the selection, and the text no longer shifts by a row's fraction when selection starts on a long terminal.
- In the iPhone app, the dock slides up and down with the keyboard instead of jumping to its keyboard-up place before the keyboard moves and dropping out as it closes, and switching to a Files tab no longer makes the page jump as if a keyboard were coming. With Reduce Motion on, the dock moves at once.
- In the iPhone app, selecting terminal text shows only muxen's Copy and Paste; iOS's own Copy, Look Up and Translate bar no longer appears behind it.
- In the iPhone app, holding delete while typing into the terminal keeps deleting until you let go; it used to delete one character. After about two seconds it slows to iOS's word steps, about six characters a second.
- In the iPhone app, text typed in the compose box and not sent no longer goes to tmux when you tap the terminal and type. The box keeps it: go back to the box and it is still there.
- Tabs now live in a workspace, one per server. Home lists the workspaces (a server's name, its status and how many tabs are open) and a row opens the tab you last had there, or the tab overview when it has none. The overview lists the tabs with their window and how long ago they were active, reorders them by their ≡ handle, closes one by swiping it left (or with × on a computer), and has Open session and Open files. A tab shows a tab row: ‹ back to the overview, the tabs (long-press, right-click or Shift+F10 on one for Windows and New window, Move to start or end, Close tab, and Copy path on a Files tab), + for Open session or Open files, and on the phone Show keyboard. With the keyboard up the tab row stays and the line box and key row sit under it; the keyboard stays up when you switch tabs, a Files tab takes it in its path field, and only the keyboard button lowers it. Open session is one screen: type a name to filter the sessions not open here, tap one to attach, or Create a new one; a name tmux already has attaches. Open files always starts at `~`. The key row's keys are plain text until pressed, so they no longer look like the tab row's buttons. The picker, the current-tab button and favorites in the app (the star in a Files tab and the favorites list) are gone, and so is New session's start directory. **Saved tabs from the earlier build are discarded once at the first launch:** muxen opens at Home with no tabs, and your sessions are one Open session away.
- The terminal no longer shows a grey scrollbar slider down its right edge when it scrolls; it still scrolls by touch, wheel and keys as before.
- Favorites are gone from the daemon: `/fs/favorites`, `/fs/favorites/add`, `/fs/favorites/remove` and `/fs/uploads-dir` no longer exist, and nothing writes `config.toml` any more (the `config_read_only` error went with the writer). A `favorites` key in `config.toml` is now ignored, like any unknown key. `uploads_dir` is still read from the file on every upload, and an unreadable file still answers uploads with `503 config_unavailable`; edit it by hand.
- The key row now runs esc, tab, Shift-tab, ctrl, alt, the arrows, `|` `~` `/` `-`, then `^C` `^R` `^S` `^Q` `^Z` and Return: a keyboard's left edge first, then the keys a command needs, then the control chords. `^S` freezes a shell's output until `^Q`, so `^Q` is there beside it. Home's server card lists at most three open tabs, closes one by swiping it left (or with its × on a computer), and its row to everything else is now "All sessions and files".
- Files opens any folder or file you can read, `/` included, like the terminal; every folder but `/` starts with a "‹ parent" row. The folders you added are now favorites, listed in the picker after Home (`~`); a star in a Files tab's header adds or removes one. In the Go to folder field the caret lands at the end when you start editing, there is no "in <folder>" line, and a "‹ .." row steps up a folder. **Rename `roots` to `favorites` in `config.toml`** (the old key is no longer read).
- On an iPhone, tapping a search box or a dialog field (Find a session, New session, Add server) no longer zooms the page in: every text field is now 16 px, the size below which Safari zooms.
- One picker opens a session or a Files folder everywhere: a full-width search and a compact Sessions / Files switch under it (on the phone at the bottom of the sheet, in thumb reach, above the keyboard when it is up, with the open tabs as the last row). Creating is each list's last row: **New session** (a form that replaces the list, with the start directory completing like the Files tab's path field; the new session opens behind the picker, which stays) and, on Files, the search takes a path (`~` or `/`) and opens a new Files tab there, with "Open a folder…" to start one. Files rows are Home, then the favorites A to Z, then Uploads; a row activates the Files tab already at that folder, else opens one, and reads "open" like a session row when a tab has it; a favorite whose folder is gone shows "Missing" with a × to remove it. With one server the list has no "On …" heading. It is the desktop + popover and the phone sheet at half height; Home's "All sessions and files" row lands on a tab and opens the sheet over it. No pick closes the picker: a session, window or folder row, Create, a typed path and the tabs in its bottom strip all put the tab on screen behind it, and the picker stays on its list (closing it leaves you on that tab). Home's card has at most three tab rows and one "All sessions and files" row, with the session count, in place of "All N sessions" and "Files", and "Browse files" is gone. On the phone, Home moved to the bottom bar, before the current-tab button, on terminal and Files tabs.
- Files on a phone: a long name no longer pushes the current-tab button's count and chevron off the screen (it truncates the name), the full path of a previewed file wraps so its name can be read, a disabled button such as Insert path shows why beside it ("Open a terminal tab first"), tapping a folder in the Go to folder list opens it instead of only filling the field, and a Markdown diagram shows "Loading diagram…" until it draws instead of its source.
- A terminal bell in any tmux session puts a dot on that session's tab, its row in the session lists, Home's tab rows and the current-tab button, until you open the tab on that device (the tab you are looking at never gets one), even when the bell rang while the page or app was closed. muxen reads bells with one tmux `alert-bell` hook it installs while the daemon runs, only while a device is connected, so a bell shows within about 5 seconds. A session whose tmux settings hide bells says so, and a host that can't read tmux says "Bell tracking unavailable on this host". Claude Code rings only with `"preferredNotifChannel": "terminal_bell"`, and Codex inside tmux only with `notification_method = "bel"` under `[tui]` in `~/.codex/config.toml` (it sends OSC 9 by default); [running.md](docs/running.md) has the details and limits.
- The session list stays correct when a tmux window name contains a line break (tmux 3.4 allows it): the break shows as `\n`, and a listing the host can't read as a whole is an error instead of a list with windows missing.
- Settings has an Appearance choice (System, Light or Dark) and a terminal text size (Small,
  Default, Large, Larger). The choice is kept on the device and applies everywhere, including the
  app's lock screen and sheets. Dark is a true-black terminal with neutral greys, no blue tint. The
  next terminal you open is fit to your screen at the new text size.
- In the app, Settings sets when Face ID asks again after the app has been in the background: after
  5 minutes, after 1 hour (the new default) or only at launch. A longer wait asks for Face ID
  first, and the background time can no longer be defeated by setting the clock back.
- In the browser, Send no longer sends a line while an IME is still composing it, as in the app.
- Home is now a card per server: its name and status, the tabs you have open on it and one
  "Sessions and files" row that lands on a tab and opens the picker sheet over it. A server that can't be
  reached says when it was last reached and offers Retry; one where tmux isn't running says so.
  Settings moved behind the gear in Home's header, and Add to Home Screen moved onto Home.
  Clear local data now stays cleared: the tabs open at that moment are not saved again, so
  they don't return after the app goes to the background.
- Mermaid diagrams render in Markdown previews, in the app's light or dark theme. A wider
  diagram scrolls inside its own box; one that doesn't parse stays as a code block with the
  reason under it. The diagram code downloads the first time a document has a diagram; a page
  running an older version than the host shows "Update required" with Reload when that download is gone.
- On the phone, the terminal's bar is now the current tab's name, the open-tab count and
  Show keyboard; the tab strip and + moved into the sessions sheet. The button opens a
  half-height sheet over the tab with search, every server's sessions and the open
  tabs at the bottom. Tapping a tab switches to it behind the sheet and the sheet stays;
  Back, Escape or a tap outside closes it. The
  active session lists its windows under its row, with the shown one marked.
- On the phone with the keyboard up, the compose box is always visible above the key row, and
  the key row (esc ← ↑ ↓ → ⇧tab tab ^C ^R ctrl alt ⏎ | ~ / -, Hide keyboard fixed at its end)
  replaces the bar. While the box holds the keyboard, ← and → move its caret by one character,
  esc returns typing to the terminal and every other control reaches tmux; the keys that act on the
  box are marked. Tapping the terminal does only that: it hands typing back without lowering the keyboard, with no click or cursor move. A Send button sits beside the box while it holds the keyboard and acts as Return.
  The terminal cursor is solid while it takes typing, hollow while the box does, and the idle box
  shows no caret. The app's bridge moves to v6 (`lineCaretStep`, `lineSubmit`), so update the app with the web.
- The sessions sheet and the desktop + popover read "here" only for the tab on screen; on
  Home the open sessions all read "open". The desktop's "New window" dialog is gone with
  its only entry point: create windows with tmux's `prefix c`.
- On the desktop, + now opens a popover under the top row, in place of the centred dialog:
  search (already focused) and every server's sessions.
  The active session lists its windows under its row, replacing the windows button on the
  tab. Choosing anything closes it; Escape or a click outside leaves the tab as it was.
- Files opens as tabs, any number of them, each remembering its own folder or preview
  across a reload. Home's Files button opens a new one at that server's folders, and a
  folder's first row goes up to its parent. On the desktop, navigation is now one top row
  (Home, every tab, +, the server) above whichever screen shows, in place of the left
  rail. The app opens on Home even with saved tabs. Tabs saved by earlier builds are not
  restored once; their drafts are kept.
- Files and completions work in the iOS app again: the app no longer says a server
  "speaks a different version" when both use the same protocol.
- On the phone, a long-press on the terminal now highlights the word under your finger
  at once, and dragging while held extends the selection; the arrow pad is gone. ← and →
  join ↑ and ↓ in the key row, repeating while held. A tap on the cursor's row, or the
  row above or below it, opens the keyboard.
- With the keyboard up, the terminal now keeps bottom status and footer rows visible; a
  cursor near the top remains visible instead of being pushed off-screen.
- A tab whose tmux client can't start no longer sits on `Connecting...`: after one retry
  it ends with an error naming the cause, including a version mismatch when known.
- Enrolling in the browser asks for the code as eight cells, `▢▢▢▢ – ▢▢▢▢`, with the
  dash drawn rather than typed, and asks for the device name on the next screen.
- An enrolled phone can mint the app's native token without spending another code;
  removing the node revokes that token too.
- A setup link opened in Safari on the phone hands its host and code to the muxen app
  before anything else happens in the browser, and the app enrols the phone: one code
  admits the app, Safari and the PWA on that phone. Add server waits for Next and Add.
- The phone now has one keyboard: the dock toggle types directly to tmux, while tapping
  the line box edits the draft through the same native responder. Predictions are off for
  the app's line; Return is Send for the line and Return for the terminal. The box grows and
  wraps to five lines before scrolling inside, while remaining one logical line.
- An armed ctrl or alt sends a chordable single-character line insert to tmux; punctuation
  and multi-character inserts stay in the line instead of becoming bare terminal input.
- A native line restored after a refused send or a remote draft change now stays intact
  as you keep typing.
- The app no longer leaves a keyboard-height gap under the dock: the native shell moves
  its web view above the keyboard, so it reports no covered page and the web stops
  rising by the keyboard a second time. Sheets and toasts sat in the same gap.
- Setup's link, QR code and terminal clipboard now include the one-time enrolment code
  in the URL fragment, so scanning or opening the link enrols a browser without typing
  the code. `muxen enroll` prints the bare MagicDNS name for the iOS app and a
  code-bearing browser link.
- Tabs follow tmux sessions. Home and pickers list sessions; the window switcher selects
  or creates a window, and laptop window changes move the tab too. Typing, pasting or
  Fit takes the window at muxen's size, even when the laptop is smaller. The sizing
  band shows differences in either direction.
- Update the daemon and clients together: this build requires daemon protocol 2 and
  native bridge 5. Old window-based tabs, drafts and saved workspace are discarded
  on first launch; enrolled servers and credentials remain.
- Files finds folders by typing a path: one field at the top completes the folders as you type
  (ghost text, tap a row or press `/`, Tab or → to accept, Go to open), without a request per
  keystroke. `~` outside your folders lists your home folder with rows marked "not added", and
  opening one offers "Add this folder". This replaces the "Add a folder" dialog.
- The "Update ready" and "Reload" banners now sit inside the app shell, so showing one no longer
  makes the page scroll or pushes the bottom of the screen out of view.
- `muxen setup` publishes muxen on your tailnet and prints its link, a QR code of it and
  an enrolment code. On Linux it runs muxen in the terminal until Ctrl-C, leaving the
  Serve entry in place; `muxen setup --background` installs the systemd user service, or
  the LaunchAgent on a Mac, where plain setup refuses. Every check runs before it changes
  anything, and a rerun changes only what differs.
- `muxen teardown` removes an installed service and only muxen's Serve handler, keeping
  enrolled devices and configuration; with no service installed it withdraws the handler.
- muxen can host on a Mac with the Tailscale app (`muxen serve --publish`, from a LaunchAgent).
  When it can't publish, it names the conflict (Funnel, a TCP forward, or another app's handler).
- Serve refusals on Linux name the actual conflict too.
- An iOS app: the web UI bundled in a native shell that holds each server's token behind
  Face ID (one unlock for every server, locking after five minutes away), owns the keyboard
  (hardware keys go straight to the terminal: Esc, Ctrl and Option as Meta, held arrows
  repeat), rides the dock on the keyboard, and adds photos, the camera and pasted images to
  uploads. Settings > Servers, or "Add a server" with none, opens the native server sheet.
- Touch gestures on the phone terminal. A swipe scrolls with momentum, through tmux's history
  past what the phone holds, with a "Jump to latest" button; in `less`, `vim` and other
  full-screen applications it sends ↑/↓ or mouse wheel events. A tap clicks in an application
  that asked for the mouse and otherwise does nothing (it never raises or lowers the keyboard).
  Press and hold buzzes: keep holding and drag for an arrow pad that repeats while held, or let
  go to select the word under your finger, drag its handles further, and Copy (the lines you
  copied, not the screen's wraps) or Paste from the menu. Horizontal swipes are left to the
  system back gesture. On a desktop the mouse wheel carries on past the top of what the browser
  holds into tmux's history, and "Jump to latest" shows there too.
- Phone dock and session switcher: on a touch phone Terminal ends in one row (tab chip, line
  field, keyboard toggle) with a key row (esc, arrows, ^R, ^C, tab, ctrl, alt, | ~ / -) above
  it while the keyboard is up. Return in the line field sends the line and Enter together,
  each tab keeps its own draft across tab switches and reloads, a refused line comes back
  marked "Not sent", and the tab chip opens a sheet with the open tabs, every session, the
  current session's windows with New window, search and New session.
- A window takes the size of whichever terminal acted on it last. Opening or returning to
  a tab, typing, pasting and rotating size it to the phone; typing in another terminal (the
  laptop) takes it back, and a reconnect after a network blip leaves it with the laptop
  unless the phone still held it. A window sized for another terminal, larger or smaller, is
  drawn at the phone's own font from the left edge (wider content cut off at the right, taller
  content following the cursor); after about a second the terminal's top edge says "Sized for
  another terminal" with Fit, which sizes the window to the phone.
- Home, the session picker and Settings: open tabs, a search over sessions,
  New session (with an optional start directory), every listing state
  (loading, offline, refused, no tmux server, stale with Retry), and Settings with Remove
  this device, Clear local data and Add to Home Screen steps. An offline launch says "Can't
  reach <host>" and its tabs read "Reconnecting…".
- Terminal: a tab strip and terminal surface sized from the window, desktop keyboard input
  by tmux key name (Shift+Enter, named keys, IME), paste and image paste, a status band
  with Retry, and a "session limit" state that shows the daemon's message and retries.
- Terminal paste now reports "Not sent" for refusals and "May not have been sent" when tmux
  or the connection stops before confirming it; paste is never retried automatically. A
  paste with Enter quits pane modes first so Enter reaches the program.
- Files: browse folders, preview code, Markdown, images, video and audio, upload several
  files with progress, and "Insert path into <tab>" for an upload or an open file. Adding a
  root now means editing `config.toml` on the host.
- PWA: install muxen from Chromium or Safari, open Home offline from the cached shell, and
  see "Update ready" on Home; a new version waits for your tap and only that window reloads.
- Closing a tab now ends its watch on the daemon, so tabs no longer stop connecting after
  two closes; a failed watch backs off and shows the daemon's message; a resize while a tab
  is connecting is sent once it connects; a create on a slow connection waits for its reply
  instead of failing at 5 s.
- Files: Markdown is cut down to an allowlist and cannot navigate the page, a second Upload
  tap no longer uploads files twice, files over 128 MiB are refused before sending, names with
  control characters are never inserted, Insert path is disabled while the tab is
  reconnecting, and `mailto:` links open the mail app.
- PWA: a missing cached file falls back to the network, Update works after a hard reload, and
  the page is not cached with a CSP that omits the socket's origin.
- Files: opened first (at `#/files` before the host's name is known), its messages name the host
  ("Can't reach pop-os") instead of staying "the server" for the page's life.
- Image paste and Files' Insert path follow one rule: a tab still connecting takes the path and
  types it once it is watching (image paste used to refuse it), and a reconnecting, limited or
  closed tab refuses it with one notice.
- A host at its connection cap (the daemon's close code 4005) shows "Too many connections to
  pop-os" with Retry on the host banner, as the spec says; tabs used to read only "Reconnecting".
- Terminal: Ctrl+Shift+F leaves a focused terminal for the tab strip, so a keyboard user can
  reach the rail-less controls; Enter on a tab returns. Settings lists it under Keyboard.
- Terminal keyboard shortcuts match their physical letters, so Ctrl+Shift+C/F work on non-Latin layouts.
- Terminal: the selected tab's watch pauses while a native screen covers Terminal and resumes
  with a fresh snapshot when Terminal returns.
- Settings: a finished Remove this device or Clear local data closes Settings in Safari too.
- The session-limit message says "1 tmux session" when the limit is one.
- Show refused auth row names in device listing, list nodes by stored ID, and send
  the native welcome and manifest without waiting for a tailnet refresh.
- Use pnpm 10.23.0 to install, build and check the web client.
- Serve the browser/PWA shell from the daemon over private Unix sockets and admit
  browsers as enrolled tailnet nodes. Native device-token auth is unchanged; `muxen
  device list/remove` now includes node devices. **Breaking upgrade:** run `sudo
  tailscale serve --bg --https=443 unix:/run/user/<uid>/muxen/serve.sock` to replace
  the old loopback target; until then the iOS app gets HTTP 502. The old `port` config
  key is ignored.
- Rebuild the web client's skeleton: one Platform interface with browser and test adapters,
  admission read from the daemon at every launch, a design system of owned primitives with
  light and dark themes, and Playwright with axe over every route. `scripts/preflight.sh full
  --commit <sha>` now gates a clean export of exactly that commit, and the pre-push hook uses
  it. The shell build is held to size budgets.
- Preserve trailing spaces at soft-wrap boundaries when copying scrollback.
- Keep soft-wrap boundaries in scrollback that contains hyperlinks; one link no longer
  makes a whole history chunk copy as hard line breaks.
- Avoid joining scrollback chunks captured across a tmux history change.
- Repaint soft-wrapped snapshot rows when tmux and xterm disagree on glyph width.
- Add a startup memory budget (`memory_budget_mib`, default 72 MiB) that scales tmux
  session/socket caps and completion, plus a half-core CPU cap. Re-copy
  `contrib/muxen.service` to apply `MemoryMax=72M`, no `MemoryHigh`, the 10 ms CPU
  quota period and exit-78 restart prevention. Session-limit messages name the host
  and tmux sessions holding the slots; uploads to tmpfs/ramfs are refused.

- Keep Meridian work notes and knowledge base in repo-local paths for cross-machine handoffs.

- Record Tailscale-first, public-HTTPS follow-up and multi-server settings roadmap.

- Document browser deployment research and required phone PWA installation, offline drafts, and update behavior.

- Save browser/iPhone design, interactive mockups, clipboard research, and Mac handoff in `docs/design/client/`.

- A window or session created from another tmux client (a laptop terminal) shows up
  in the window list right away.
- Tapping a URL in the terminal opens it in Safari. Window lists fail fast with
  "Can't reach …" and a Try again button when the connection drops.
- A hung disk (a dead NFS server, a stuck automount) no longer stalls the device
  check behind it: the daemon's blocking threads are split into lanes (file API 4,
  completion indexes 1, directory checks 1, auth and pastes 2), so a hung mount stops
  only the file manager and path completion. A new window or session whose start
  directory can't be checked within 300 ms is refused rather than left waiting, and an
  enrolment that gets no thread within 10 s answers `503 busy`.
- Every HTTP error code is one `HttpError` type, generated into
  `web/proto/generated/messages.ts` with `ErrorBody`. An oversized `POST /auth/enroll`
  body now answers `413 too_large`, as the other routes do (it said `bad_request`).
- Suggestion strip: history, command, flag and path suggestions above the
  keyboard at a shell prompt (needs the shell snippet).
- File manager: browse project folders and uploads from the tab's folder; view
  code, Markdown, images and file details; manage folders in Settings.
- Completion for the suggestion strip (`POST /complete`): chips from shell history
  (bash, zsh or fish, ranked by recency and frequency), commands on `PATH`, carapace
  for subcommands, flags and values, and directory listings for paths. A chip only
  extends what is typed and never holds a control character, and a command, file or
  carapace value is escaped so the shell reads exactly that name (`~` and `=`
  included); history lines go in as written. Under systemd each
  carapace run gets its own transient scope, so its memory never counts against
  muxen's; everything completion holds is freed five idle minutes after the last
  request. `[complete]` in `config.toml` sets the history file, the interactive
  shell's `PATH` and the carapace binary. The unit now pins glibc's mmap threshold
  so freed memory returns to the kernel.
- Uploads flush every 2 MiB instead of 8 MiB, so far less dirty page cache sits in
  muxen's memory limit during an upload.
- The fs and completion request and response types are generated into
  `web/proto/generated/messages.ts`.
- The file API (`/fs/*`): project roots and an uploads folder set from the app and
  saved in `config.toml` (comments and unknown keys kept, a symlinked file written
  at its target, a symlink to nothing refused and left alone), directory listings and a
  `$HOME` folder picker, file bytes with Range for the viewers and the native video
  player, and photo uploads. Every path is checked against the roots on the descriptor
  actually opened, so `..`, symlinks out of a root and FIFOs are refused. A new window
  or session's start directory must be an existing absolute directory. Every accepted
  socket uses 64 KiB kernel buffers, and shutdown no longer waits on a stalled
  response.
- The app restores the last tab on screen and keeps the cursor row visible when
  the keyboard opens, without resizing tmux.
- Visual web UI: tab bar with connection states, session sheets, new window and
  session, jump to bottom, dark and light themes, bundled Nerd Font.
- Added `tmux::Session`, the pure tmux control client: startup and client size,
  reply matching with the in-flight cap, pausing panes nobody watches, snapshots that
  are retried when a tmux hook tears or changes the pane mid-list, gaps, layouts, cwd
  subscriptions, and typed commands for locate, votes, history, input and paste (a
  failed paste leaves nothing in tmux's buffers). Tested against recorded tmux 3.4
  streams.
- Added the snapshot restore-byte composer (`tmux::snapshot::compose`): bytes that
  rebuild a pane's screen (primary and alternate), cursor, modes, scroll region and
  tab stops in a freshly reset terminal, so clients carry no restore logic.
  `Event::Snapshot` now carries the pane size and these bytes. Checked against
  `vt100` and tmux's own capture on recorded styled, scroll-region and
  alternate-screen panes.
- Added the tmux bridge's I/O: the control-client pump (`tmux::pump`), which moves
  bytes between a `tmux -C` process and the hub and closes it on request, and one-shot
  commands (`tmux::oneshot`) for the session listing, Locate, and new windows and
  sessions, with a 2 s timeout and a "no server" answer. Every invocation passes `-N`
  (never starts a server) and `-u` (names and paths stay UTF-8 whatever the locale).
  Tested against a real tmux with `MUXEN_TMUX_TESTS=1`.
- Added the wire protocol (`proto`): the JSON messages, binary frames, version range
  and close codes, with the web's TypeScript types generated into
  `web/proto/generated/` and checked for staleness by `cargo test`.
- Added the hub: the daemon's core that turns the phone's watches into tmux work. It
  finds each watched window's session and attaches one control client per session,
  follows windows that move between sessions, catches a tab up by snapshot on open,
  resize, pane change or overflow, and reports closed windows, sessions and servers.
  A detached control client ends its tabs; a crashed one is restarted once. Every byte
  to a connection is bounded by its credit, so a slow phone starves only its own tab,
  which catches up by snapshot.
- The control-client pump reads tmux's output in batches: a pane flooding short lines
  costs the daemon about 2% of a core instead of 47%. Typing echo is unchanged when
  idle, and up to about 3 ms later while a pane floods.
- A history request whose rows exceed tmux's 1 MiB reply cap is retried by the hub
  with half the rows, down to one row, so the client gets a shorter `historyChunk`
  instead of an error and asks again from where it ends.
- muxen runs as a daemon: `muxen serve` listens on `127.0.0.1` (port 7850 by
  default, from `~/.config/muxen/config.toml`) for `tailscale serve` to publish, and
  serves the WebSocket the web UI drives tmux through. It refuses to start if Funnel
  exposes its port, accepts only your Tailscale login, and requires an enrolled
  device's token on everything but enrolment. Idle with no phone connected it uses
  about 4 MB and no CPU. `docs/running.md` covers setup; `contrib/muxen.service` is
  the systemd user unit. Stopping it lets each tmux control client exit on its own
  rather than killing it.
- Added phone enrolment: `muxen enroll` prints a one-time code (10 minutes, 5 wrong
  tries) for the app's Add host, and `muxen device list|add|remove` manages enrolled
  devices. A removed device's open sockets close within 10 s. The daemon keeps only
  hashes, in `~/.local/state/muxen/`. If `auth.toml` can't be read or parsed (a hand
  edit gone wrong), every token check fails until it is fixed, but as "auth
  unavailable" (close 4503, HTTP 503), which the app retries with the token it has,
  not as a revoked token.
- Tabs for windows closed or moved outside muxen now update promptly even when they
  aren't on screen: the daemon sends `sessionsChanged` when tmux closes a window no
  tab is watching (once per burst, so killing a session sends one), and the web
  re-lists.
- History requests report tmux's true clamped line numbers, stop cleanly above retained
  history, and detect a changed history range around the capture.
- Preserve soft wraps across snapshots and scrollback for copy: snapshot restore rebuilds
  xterm's wrap state in the daemon, and history chunks carry a packed wrap map that the
  client uses to join wrapped rows.

## [0.0.1] - 2026-10-22

- Minimum supported Rust version is 1.85 (edition 2024).
- Project scaffold: `tether --version`, CI, and label-driven releases that publish
  static Linux (x86_64, aarch64) and macOS arm64 binaries to GitHub Releases.
