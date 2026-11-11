# Muxen browser and mobile interaction contract

The interaction contract for every client surface: what the user sees and does, and why. Layout
measurements, keymaps and caches belong to the code
([Files](../../../web/screens/files/.context/CONTEXT.md), the terminal's
[context](../../../web/screens/terminal/.context/CONTEXT.md)). Device-specific gates remain: the touch
implementation still needs checking on an iPhone. [README.md](README.md) says which doc wins.

## Product boundaries and vocabulary

- The phone browser supports installation as a PWA with standalone launch; installation is optional
  for use. It shares browser behaviour, preserves local drafts offline and never queues terminal
  commands for later execution ([browser setup](browser-setup.md)).
- Three environments: desktop browser, mobile browser, native iPhone app. Shared workspace
  behaviour; platform-specific navigation and input. No three independent terminal implementations.
  The native app has a host registry; a browser/PWA is bound to its page origin. A multi-server
  browser workspace needs an origin/auth design first ([connection roadmap](connection-roadmap.md)).
- **Host** is the server (pop-os). **Session** is a real tmux session. A terminal tab opens one
  tmux session, as `tmux attach` does: it shows the session's current window (that window's active
  pane) and follows it when the current window changes, whichever client changed it. A Files tab
  holds one folder or file preview on a host.
- Session lists use actual session names. A terminal tab's label is the session name, then the
  current window's name in regular weight; a Files tab uses its folder or file name, and "~" at the
  host's home. One function names a tab, so it reads the same in its pill, the overview, the dock's
  line field and a notice. A label never names the host.
- Minimal product: no custom shortcut system, command palette, expanded sidebar, split-pane
  management, connection-type choices or app-drawn keyboard (the dock's key row supplements the
  system keyboard).
- Existing-session selection is distinct from creation; opening an existing session never creates
  another shell. Closing a muxen tab only detaches; only Kill window and Kill session, each behind a
  confirmation, end tmux state (not built: [daemon-core.md](../daemon-core.md#the-tabs-tmux-commands-not-built)).
- Connecting may resize a real tmux window; the setup must not suggest muxen is read-only or
  isolated.

## Platform layout

A **workspace** is a server's open tabs, in the order the user gave them, and the tab it last
showed. Each server has one for now; the model keeps a workspace its own record so a second later is
another record, not a remodel (Jimmy: "maybe in the future we can have multiple workspaces"). Two
levels, the same screens going forward and back:

1. **Home** lists the workspaces. A row opens the workspace's last tab.
2. **A tab** (terminal or Files) fills the screen, with the workspace's **tab row**.

**The tab overview** lists one workspace's tabs and adds, reorders and closes them. It is not a
level: over a tab it is the tab list, opened from All tabs, and Back closes it onto the tab it was
opened over or the one picked in it. A workspace with no tab shows it in the tab's place, reached from
Home.

Back from a tab is Home, landing on the nearest earlier Home entry, so folders drilled into never add
a stop. Back walks out of the shown Files tab's folders only: switching tabs drops the earlier tab's.
**Swipe back:** in the app a left-edge swipe is Back everywhere except a terminal tab with nothing
over it, where it is off (the web tells the shell with `backSwipe { enabled }`). Over a terminal it
closes what is over it; a Files tab steps out to the parent folder, then Home. Phone Safari owns its
edge swipe, so there a swipe on a terminal goes Home. Pages put Back at the top left of their header
on every layout; only a tab keeps ‹ at the bottom, in the dock's tab row.

**Workspace state.** A workspace record has its id, its server's host id, its tabs in order and its
last-shown tab; the route is Home, a workspace's overview or a workspace's tab, so there is no
separate "active tab" to disagree with it. An event that adds a tab names the workspace. The order
and last tab are saved per device. A workspace's last terminal tab is where Insert path and uploads
go, from a Files tab too; when it closes, the nearest remaining terminal tab (right neighbour first)
takes over. Removing a server removes its workspace and tabs; nothing in tmux changes. A workspace in
an earlier saved format is discarded whole at boot: muxen starts at Home with no tabs.

| Surface | Desktop browser | Phone browser / PWA / iPhone app |
| --- | --- | --- |
| Tab row | One top row: ‹, the workspace's tabs, +. | One bottom row: ‹, tabs, +, and Show keyboard while the keyboard is down; it stays in place when the keyboard is up, above the compose box and key row. |
| Terminal | All space below the top row. Direct physical-keyboard input; no dock. | Full-bleed above the dock. |
| Adding a tab | + opens a menu under it: Open session, Open files. | The same menu above it, with the keyboard up or down. |

Use the measured visible viewport and keep controls unobscured. Mobile controls target at least
44 px of touch area. The bottom row sits at the bottom safe area without a blank band (the inset only
while the keyboard is down). The tab row and key row scroll horizontally; names truncate.

## Visual treatment

- Settings offers System / Light / Dark on every surface; dark uses a true-black terminal and neutral
  greys. The choice is kept by the platform (browser local storage, a blocked store falls back to
  System; the app's preferences, applied to its lock screen and sheets before the web loads).
- Settings offers the terminal text size: Small, Default, Large, Larger (1 px under, today's, 2 and
  4 px over). It takes effect when a tab is next shown, fit in the one claim every shown tab sends, so
  no second resize follows.
- Blue is the selection/accent; green is reserved for connected status. Menus use the theme's raised
  surface; a press outside an open menu closes it, and on touch only closes it, so the control under
  the finger doesn't also act.
- Every screen has the same 44 pt header (`ScreenBar`): back icon at the top left where there is a
  parent, a 17 pt left-aligned title, the screen's controls at the end. Home is a centred column on
  desktop. No large or centred titles.
- A terminal tab's session name is bold, its window name regular; a phone pill shows the session
  alone. Truncate the window name first. Icon-only controls have accessible names and tooltips.
- Loading, empty, offline, error, refused-session, enrolment and permission states are distinct;
  failures must not look like empty content. Reduced motion shortens durations. No middle-dot
  separators in chrome or copy.

## Home

Home lists the workspaces, one row each: the server's name, its connection status in its status
colour, and how many tabs are open (Jimmy: "home should only list the workspaces"). No sessions or
files. A row opens the workspace on its last tab (an empty one opens its overview). One server and
several use the same rows; a single server does not auto-navigate past Home. An offline server's tabs
stay open. A restored terminal tab reads "Connecting…" until a listing proves its session, or
"Reconnecting…" while unreachable. Phone Safari Home offers Add to Home Screen instructions. No
servers shows enrolment instructions and Add server. If a server's tmux isn't running its row says so;
muxen never starts it.

**A row's status word**, from its server's shown state ([plan.md](../plan.md#reachability)) and
admission, the first that applies:

1. **needs attention** when admission needs the user (not enrolled, token refused, incompatible, wrong
   origin, origin refused, device refused), even if the server has stopped answering.
2. **offline** when the shown state is unreachable. The note says when it was last reached ("Last
   reached 4 min ago.", or "Not reached since muxen opened.") and how to fix it ("Check that it's on
   and that Tailscale is on."), with Retry; with no network it says "This iPhone is offline." ("This
   device is offline." in a browser) with no Retry.
3. **connecting** when the shown state is checking ("Connecting to pop-os…"), or admission is
   undecided on a server that answers (the banner "Checking access…" after 10 s). The shown state is
   also checking while an open socket has had no answer to an ask for 3 s.
4. Otherwise **connected**, with a note if tmux isn't running, and the card's notice while the daemon
   is turning sockets away (over the cap, or unable to decide, 4503).

The same shown state reaches every other view of the server; none decides it for itself.

**Server banners.** A screen that belongs to one server (a tab, its overview) shows that server's
banner only; other servers' problems show on Home. Admission that needs the user comes first;
otherwise an unreachable server's banner reads "Can't reach pop-os" with the hint and Retry (no
network: "This iPhone is offline.", no Retry). A terminal tab shows neither: its status strip says the
same with the same Retry, unless the tab's own state fills the strip (closed, session limit, detached,
failed watch), and then the banner says it, so it is said once. A refusal is the banner's alone: the
strip stays quiet and the pill reads disconnected. The Shell shows no banner over Home: each card
carries its own notice. Every Retry for a server is the same one
([plan.md](../plan.md#reachability)). A daemon connection-cap refusal (close 4005) reads "Too many
connections to pop-os" with "Close muxen in another browser or the app, then retry" and Retry; the
tabs keep their own "Reconnecting".

**Settings** is a separate screen from the gear in Home's header, with appearance, terminal text
size, a section per server, this device/browser and local-data controls. The app also offers the
Face ID relock setting ([auth.md](../auth.md#swift-side-keychain-item-and-app-lock)); the browser has
none. Clear local data deletes drafts and saved workspaces on this device, leaving open tabs until
closed. Remove this device is available only where the host admits this device as a tailnet node.

**A server's settings** hold what that server's `config.toml` applies without a restart
([fs.md](../fs.md#server-settings)): **Search skips** (folder name patterns Search lists but doesn't
enter; default `node_modules`; a list with Remove, Add and Reset) and **Uploads folder** (default
`~/.muxen-uploads`). They are read from the server each time Settings opens; nothing is kept on the
device. A change saves at once (Remove, Add, Reset) or when a field is committed, one save at a time
per server, each built from the server's previous answer, and the section redraws from the answer so
every device sees the same; closing Settings mid-save lets the save finish. A save that fails says why
beside the field and keeps the typed value. When `config.toml` was edited by hand since load, the
section says so with **Reload config.toml**, or shows the parse error and leaves the running values;
restart-only keys (`name`, `memory_budget_mib`, `[tmux]`, `[complete]`) that changed are listed until
restart. An unreachable server shows "Can't reach <name>" in place of its values, with the server's
one Retry.

**Where a launch opens.** A launch (reload, bookmark, copied link, the app after iOS killed it) opens
the place the page's address names, else the route last shown, else Home. The address reads `#/`,
`#/tabs`, `#/term/<session>` or `#/files/<path>` (a folder ends in `/`, a path under home reads `~/…`).
It names no server, since a browser page talks to its own origin's host; the app opens its saved
route. A session no tab follows shows the overview; a Files place no tab shows opens a new Files tab
there. The page opens above Home, so Back goes to Home. A setup link (`#code=…`) opens Home. The
address is rewritten, without a history entry, when what it names changes. The cost: file paths and
session names enter browser history, which iCloud and Google sync.

## Terminal

- Selecting a tab activates it; other tabs stay open, and switching preserves the terminal and
  process. Opening a session already represented by a tab activates it. Identity is server/session
  IDs, not mutable names.
- **The tab follows its session.** When the current window changes (the laptop's prefix-n, the
  window switcher, a window exiting, a script), the tab shows the new window: its snapshot replaces
  the old in place and the label changes; the tab, its draft and its place stay. Typing, the line
  field, paste and an inserted path go to the window the tab is showing on this screen, so keys sent
  just before a change made elsewhere still reach the window the user was looking at.
- Closing the active tab activates its right neighbour, else the left. Only the active tab shows ×,
  and every tab keeps space for one, so changing tabs never moves the others. Closing the last tab
  shows the tab overview. Cancelling a creation dialog restores focus to its opener.
- Connection status shows only when not live: reconnecting/error is visible in text, with Retry, and
  distinct from tab selection and the bell dot. Disconnect never silently closes tabs; viewing Home or
  Files never kills tmux.
- A tab the daemon refused for its session limit reads "session limit" in the error colour with the
  daemon's message and Retry, and retries with a growing delay; Retry asks at once and keeps the delay.
- The terminal stays blank until the shown tab's own snapshot paints. tmux is never sized before the
  renderer has measured a cell.
- Desktop keys go to tmux by name: Shift+Enter sends the modified-Enter bytes once; IME composition
  sends nothing until it ends. Cmd combinations and F5, F6, F11, F12 stay the browser's;
  Ctrl+Shift+C copies the selection as logical lines. Ctrl+Shift+F leaves the focused terminal for
  the tab row (focus lands on the active tab; Enter returns); Settings lists it under Keyboard.
  Keystrokes are batched for 8 ms into one input message. tmux prefix keys sent by muxen reach the
  pane, not tmux's key tables.
- Paste sends one `paste` message and is refused over 256 KiB, saying so. An image paste uploads, then
  types the quoted path into the tab it was pasted in if that tab is connected when the upload ends;
  otherwise a notice says the file is in Files.
- **Sizing.** A window takes the size of whichever terminal acted on it last
  ([daemon-core.md](../daemon-core.md#sizing)). Opening or returning to a tab, typing, pasting,
  rotating, Fit, and choosing or creating a window size the shown window to exactly this screen,
  larger or smaller than the laptop's terminal; typing in another terminal takes it back and the tab
  stays live. A tab that merely stays on screen never takes it back, and neither does a reconnect
  after a blip unless the tab held the window before. A window sized for another terminal is drawn at
  this screen's font from the left edge (wider content cut at the right, taller content following
  the cursor); a smaller one sits top-left. When the window's size (from `watching`) has differed
  from the size this screen sent for longer than the wait (one second, or the last ping round trip
  plus half a second, whichever is longer, restarted at each claiming send), the band on the
  terminal's top edge says "Sized for another terminal" with **Fit**. Reconnecting and error states
  replace the band.
- Scroll, paste, mouse, focus, reconnect, tmux geometry and keyboard viewport behaviour need
  verification on real desktop browsers, phone browsers and the iPhone app.

## Tab row

The tab row holds ‹ (Home), the workspace's tabs as pills in order, +, and All tabs; on the phone,
Show keyboard while the keyboard is down. Every pill is filled; the active one is tinted with its
status colour (label and circled × in that colour); others have a muted label and the attention dot
when they have one. Every pill is the same width and keeps space for ×, so changing tabs never moves
the others (Jimmy: "the tabs change size... they should be consistent... look at termius's"). The row
scrolls horizontally, scrolls the active pill into view, and the next pill peeks. A tap switches tabs
and leaves the keyboard up or down as it was; with it up, it goes to the new tab's input. The tab
row's controls are filled and the key row's keys are plain text, so the two never read alike.

**+** opens a small menu anchored to it: **Open session**, **Open files**. It opens over the tab with
the keyboard up or down and does not lower it; a tap outside, Escape or Back closes it.

**Long press on a pill** opens the tab's menu. A terminal tab's:

- **Windows** (on the tab on screen, for a session with more than one): the windows in index order,
  "index: name", the shown one filled; a tap runs `select-window` on the session, so every attached
  client moves with it. Then **New window** (`new-window`).
- **Move to start**, **Move to end**; **Close tab** (detaches only: `unwatch`).
- **Rename session**, **Kill window** (only when the session has more than one) and **Kill session**
  (danger colour, last, each behind a confirmation naming what ends) are **not built**; the menu has
  none until the daemon commands exist ([daemon-core.md](../daemon-core.md#the-tabs-tmux-commands-not-built)).

A Files tab's menu: **Copy path** (in the path field's form), Move to start, Move to end, Close tab.
On desktop the same menu opens on right-click, Shift+F10 or the menu key; ↑ ↓ move, Escape closes and
returns focus to the pill. On touch the menus never move the keyboard.

## Tab overview

One workspace's page. Its header has the workspace's name and Back (named for where it goes). Below,
one row per tab in order: an icon, the label and a line of detail (a terminal's window and how long
since its last activity or bell, from the latest listing with no request of its own; a Files tab's
path when it says more than the label); the last-shown tab is filled. Rows, never previews: a preview
would stream every tab's screen (Jimmy). A tap opens the tab; a ═ handle drags a row to a new place in
the order (the handle only, so scrolling never reorders); a swipe left reveals Close, a full swipe
closes, a hovering pointer shows ×. Under the rows: **Open session** and **Open files**; an empty
workspace shows only these with a line saying it has no tabs. The workspace's bell and tmux-coverage
notes show here.

## Adding tabs

**Open session** is one screen, "new or attach" (Jimmy). A field, "Session name", heads this
server's sessions not open in this workspace, each with its window count and last activity, from a
listing fetched when the screen opens and refreshed on `sessionsChanged`. Typing filters locally. A
tap opens a session as a tab; it never creates a shell. The last row creates: with text no session
has, **Create "infra2"**; with the field empty, **New session** puts the caret in the field ("Type a
name for the new session") and creates nothing (Jimmy: "if u click 'new session' - it doesn't ask u
for a name"). Return does what the first row does. Typing the name of a session already open
activates its tab. New-or-attach is the client's rule over the listing: a listed name attaches and an
unlisted one sends `newSession`; a "duplicate session" refusal re-lists and attaches (tmux's
`new-session -A` fails from the daemon on an existing name). A new session starts in `~`; its tab
opens from the next listing that contains it, and after 5 s the screen says it was created but hasn't
appeared. A refused name shows the daemon's reason under the field. Creating is not offered when the
server has no tmux server, and is disabled with its reason while the server can't be reached.

**Open files** opens a new Files tab at `~/` (Jimmy: "it should just always start at ~/"); its path
field goes anywhere else.

## Bell attention

An attention dot on tab pills, overview rows and Open session rows marks a terminal bell since this
device last showed that tab; the daemon side is [daemon-core.md](../daemon-core.md#bell-attention) and
the product rule [plan.md](../plan.md#reading-on-a-small-screen). It is not a connection indicator.

- **Seen is per device and saved.** The device keeps, per session, the bell mark it last showed (the
  `mark` in the `sessions` listing and the `bell` message); a tab shows the dot while its session's
  mark differs. The tab on screen counts as shown: while a tab is active on a visible page an arriving
  mark is recorded at once and no dot appears; a hidden page or backgrounded app shows the dot. A tab
  that becomes active records the current mark. An overlay over a terminal (the + menu, the long-press
  menu) leaves the tab shown.
- **Seen survives a reload and relaunch**: saved with the workspace, keyed by host id, tmux server
  instance and session, so a bell rung while the app was away shows its dot on return. Each listing
  drops marks of gone sessions; Clear local data resets them to the current marks. Two pages of one
  origin each save; the last writer wins.
- **A session with no seen mark** takes the first mark it learns as its baseline (no dot), unless this
  page has already listed that host: its counter then started at 0, so any mark is a bell not yet
  shown. A `bell` message arriving before the page's first listing of the host doesn't count as
  listed. One rule for a listing and a `bell` message, a restarted tmux included.
- **Not tracked, in words, never a silent dot-free tab.** `covered: false` for a session reads "tmux
  settings hide bells in this session"; `available: false` for the server (and a `listSessions` that
  fails with a tmux error other than "no server") reads "Bell tracking unavailable on this host" on
  the server's Home row and overview. Both are text, not dots, and clear when a later message says
  otherwise.

## Files

Any number of Files tabs can be open, even on one server. Each remembers its own folder or preview
and is labelled by that name. A Files tab can open any folder or file the daemon's user can read, `/`
included; there is no scope and no favorites (Jimmy). Open files starts at `~/`.

Each tab presents one folder list under one header line. At rest the line reads where the user is;
typed into, it narrows the rows. On a desktop the list is an outline with folders opening in place
and a Preview panel beside it; on the phone, tapping rows browses one folder at a time (Jimmy: "a on
desktop, B on phone"). Mechanism (cache, request pacing, narrowing, search, reveal, keymap) is in
the [Files context](../../../web/screens/files/.context/CONTEXT.md).

**The header line.** The path line, then the folder's controls: a desktop shows Search, Upload, Paste
and Refresh as icons, then ⋯; the phone shows the path, Search and ⋯, with Upload, Paste and Refresh
inside ⋯. ⋯ (Folder options) holds Copy path, Show hidden files (Cmd/Ctrl+Shift+. toggles it on a
desktop), New file and New folder.

**The path line** is one plain string in mono: the folder's path (`~/…` under `$HOME`) with its
trailing `/`, exactly the text the field starts with (Jimmy: "it should just be 1 line string").
Nothing in it is a link; clickable segments were a fat-finger trap on a phone. A click or tap makes it
the field with the last folder's name and `/` selected, so Delete leaves the parent's path and the
list shows that parent; typing replaces the selection and narrows. Editing is a history entry; Cancel,
Escape and Back restore the path and stay. Hiding the keyboard only lowers it: the edit and its text
stay. It has no keyboard shortcut: `/` is Search's, and Cmd+L belongs to the browser's address bar.

**Narrowing and Go.** While the field is edited, the list shows the typed parent's rows whose names
match the typed last segment (exact name first, then prefix, then substring), plus a `..` first row
that steps the field to the parent. Return, or Go, opens the selected row (a folder is entered, a file
opened); with nothing selected it opens the folder the text names; a name that matches nothing says
"Nothing named x in ~/repos" and opens nothing. Opening adds a history entry, so Back returns to the
folder the user left. The list narrows what is loaded: a folder held only in part says "Matches are
from the first 200 of 1,840 entries" with **Load the rest**; one the daemon cut short says it is too
big to list in full. Cost on a spotty network: one listing per folder, never one per keystroke.

**The desktop outline.** Each folder row has a disclosure chevron; an open folder's rows sit under it,
indented. A click on a file selects it and the Preview panel shows it; a click on a folder selects it
and opens or closes it in place and leaves the panel on what it shows (Jimmy: a folder replacing the
preview "shouldn't happen in the first place"). A double-click elsewhere on a row, or Enter, goes in
(a folder becomes the list's root, a history entry; a file opens). `..` goes up on one click. The
folder list is one focus-holding control: arrows move the selection, Right/Left open and close or
move to the first row/parent, Enter goes in, Backspace or Cmd/Ctrl+Up goes up, Home/End jump. A tab
keeps at most 32 open folders. Per-tab open folders, selection and preview are forgotten on reload.

**The Preview panel (desktop)** is on or off by one toggle that never moves (Jimmy: "I usually like it
when the close stays in the same place so u can tap to open tap to close without moving the mouse").
Space toggles it while the list has the keys. On, it follows the selected file once the selection has
stayed put for 200 ms, under one header line (path, the viewer's controls, Copy path, Download,
Insert ▾, ⋯, expand, toggle). Only a file moves the panel: a folder, `..` or a folder's last row
leaves it as it is. With no file it shows the folder's README, else a card with what it holds. The
divider drags and moves with arrow keys; double-click returns it to the default. Off, the list takes
the window's width and the same rows show size and age as right-aligned columns, with no Kind column
or stripes (Jimmy: "dont just copy finder"). On/off and the divider width are remembered per device.

**Full width** is a file as its own place (a history entry): the expand button, or a double-click or
Enter on a file. Its header starts with Back named for the folder it was opened from; Back or Escape
returns to that list as it was, the file selected and its folders open. A file opened by its path (the
path field, a `#/files/` address, a link, a restored tab) is the same place, and Back reveals it:
the folders between the list's root and the file open and its row is selected and scrolled into view,
turning Show hidden files on if a name on the way is hidden (Jimmy: "its folder didn't properly open,
its still in ~/").

**Search** finds files and folders below the folder on screen, by name, at any depth, fuzzy, or a
glob when `*` or `?` is typed, with recents when empty (Jimmy chose all three). It is its own place,
not the path line: the magnifier, and `/` or Cmd/Ctrl+P on a desktop. Opening it is a history entry
naming the folder, so Back, Escape and Cancel close it; it is kept per tab and folder, so Back finds
the query and rows as they were. Matching is the daemon's ([fs.md](../fs.md#get-fssearchpath)). The
query is sent after typing pauses 250 ms; the previous rows stay, quieted, under "Searching". Results
show the matched letters marked and their folder relative to the searched one; they are the daemon's
best 50, best first, under "3 matches". Enter, or a tap or Go on the phone, opens the selected row
(a folder entered, a file opened). On a desktop a click selects, the panel follows a row the user
selected (never one an answer selected, so a query costs no file read), and Enter or a double-click
closes Search and reveals the row in the outline. When the walk stopped at a cap the list ends with
one line ("Searched the first 100,000 entries.", "Search stopped after half a second.", "Search
stopped: too many folders to keep track of.", each followed by "Search from a deeper folder to see
the rest."), never as an error; nothing matched and fully walked: "Nothing below ~/repos matches x".
**Recents:** with the field empty, the files opened on this device from this host below the searched
folder, most recent first, under "Opened recently"; the host keeps 20; Clear local data forgets them;
with none, "Files you open show here." A query past 256 bytes isn't sent and says so. Errors read as
a listing's do, with Try again.

**Browsing.**

- On the phone folders open their contents; every folder but `/` starts with a `..` row. A folder
  moved or deleted since the tab showed it says "This folder no longer exists" with its `..` still
  working. The system back gesture goes back, not up. Files open a preview (full width on a desktop);
  Back returns to the list it was opened from. Returning to a Files tab restores its folder or preview.
- Folders and files read apart at a glance: a folder has the only coloured icon and a medium-weight
  name; a file has a muted icon for its kind and a regular name. Folders come first. Names starting
  with `.` are dimmed. A phone row shows a chevron for folders, size for files and no age. The age is
  one short form (`12m`, `3h`, `6d`, `4mo`, `2y`). The selection is a fill: blue while the keys move
  it, neutral otherwise.
- A link that can't open says why ("Broken link", "Not a file") and is disabled. Further pages load as
  the end of the list nears the screen, with "Show more (N left)" as the fallback. Hidden files show
  from ⋯ › Show hidden files or the quiet toggle under the list; the choice is remembered on this
  device for every Files tab and server (view memory). Clear local data forgets it.
- **Pull to refresh** on the phone reloads the folder from its first page; a desktop has Refresh.
- **New file and New folder** are in ⋯ for the folder on screen and in a folder row's menu. A desktop
  opens a name field among the rows; the phone a small dialog with Cancel and Create. Return creates,
  Escape cancels. A refusal keeps the field and name with the words under it ("That name is already
  taken.", "That name can't be used.", or the refusal's own). On success "Created <name>"; the entry is
  selected (desktop) or marked (phone).
- **Rename and Delete** are the last rows of a row's menu, for a file, folder or link (a broken link's
  menu has only Copy path, Rename, Delete); home and the folders above it offer neither. **Rename**
  edits in place on a desktop and opens a dialog on the phone, with the name selected up to its
  extension. **Delete** asks ("Delete notes.txt?"; a folder adds "Everything in this folder is deleted
  as well."), with focus on Close so Return alone never deletes, and is permanent. A refusal stays in
  the dialog. Moving a file to another folder is done in the terminal.
- **A row's menu** opens on right-click (which selects the row), Shift+F10 or the menu key, or a held
  touch on the phone. It holds Open, Open in new tab, New file here and New folder here (folders),
  Copy path, Download with the size (files), "Insert path into" with this server's terminal tabs,
  Rename, Delete. The `..` row has none.
- **A file's header** is one line: Back named for the folder, the icon and name, the viewer's controls
  (Wrap lines, Copy text for text), **Copy path**, **Download**, **Insert into terminal ▾**, and ⋯
  (**File options**: Edit, Info with type, line count, size, modified time and path). No text labels
  beside icons (Jimmy).
- **One path form** (Jimmy: "BE CONSISTENT"): a path reads `~/…` under the host's `$HOME` and absolute
  elsewhere, in headers, Info, the can't-preview card and everywhere Copy path copies. Insert into
  terminal is the exception: it sends the absolute path, because a quoted `~/my file` doesn't expand
  in a shell.
- **Download** works on any file: a browser's own `<a download>` on `/fs/raw`; in the app native
  fetches the file (progress and Cancel for a large one) and opens the share sheet
  ([ios-shell.md](../ios-shell.md#files-and-sharing)).
- **Edit** is in ⋯ on a text file that would survive a save byte for byte; the file stays read-only
  until Edit is picked ([plan.md](../plan.md), "Editing").
- Previews: code, Markdown (sanitized; relative links open the file here), images (zoom and pan),
  video and audio, and a card for a file muxen can't show, with **Download** and **Open as text**.
  Mermaid diagrams render lazily in strict mode and sanitized, and need the network.
- Loading and failure never look like an empty list: a spinner with words, or the refusal in plain
  words with "Try again".
- **While its server isn't reachable**, a Files tab keeps what it has loaded; what it can't load shows
  "Waiting for pop-os" with no Retry of its own (the server's banner has it). When the shown state
  becomes reachable, every folder and preview whose last load failed as `network` loads again by
  itself ([plan.md](../plan.md#reachability)).
- Permissions, size limits and errors are [fs.md](../fs.md). New file, New folder, Rename and Delete
  are the only writes besides upload and paste.

## Persistence and input

- Small view settings are remembered per device, apart from the workspace: Show hidden files, the
  Preview panel's state and width, and the files opened per host. One owner, `app/viewMemory.ts`; a
  value another build wrote that doesn't parse is the default.
- Navigation between Home, the overview and tabs preserves open tabs and process state. Each Files tab
  keeps its folder or preview across reload.
- The listing refreshes on entry and on debounced `sessionsChanged` while visible; no polling and no
  network search per keystroke. Fetch when Open session opens, when a long-press menu opens without a
  listing newer than the last `sessionsChanged`, and on reconnect. Tabs are pruned only from
  authoritative listings for the matching host and tmux endpoint: a listing from an endpoint decides
  all that endpoint's tabs; a different tmux run closes the old run's tabs; a null listing (no
  server) decides nothing. One notice reports closures.
- Restored terminal tabs use validated session identities; an unavailable session is never silently
  replaced with a same-named session from another server. A workspace saved before tabs followed
  sessions is discarded whole. The workspace also saves each workspace's last terminal tab and its
  server's home folder (learned from the `~` listing Open files makes), so a Files tab at home reads
  "~" at once.
- Disabled controls say why beside them and take no tap; a button blocked by work in flight is busy
  instead ("Adding…"). Closed tabs keep their unsent draft (at most 32, oldest first).

## Phone dock

On touch, Terminal is full-bleed above a dock shared by the browser, PWA and native app. The tab row
is the dock's bottom row with the keyboard down, ending with the keyboard control. With it up, the tab
row stays where it is (Show keyboard becomes Hide keyboard), and the compose box and a text-only key
row sit under it, on the keyboard, in Termius's order (Jimmy). A Files tab reached with the keyboard
down shows the tab row with Show keyboard. The terminal pans above the keyboard so its last row meets
the visible area's bottom, or the cursor row does if the cursor would go off the top; never past the
last row when every row fits, nor while scrolled into history. tmux is sized with the tab row and
keyboard down; showing the keyboard never resizes it.

**The keyboard is sticky**: only the keyboard control lowers it (Jimmy). Scrolling, tapping the
terminal, switching tabs, opening a menu and a reconnect leave it up. Switching to a Files tab with it
up gives it to the tab's path field; switching back gives typing to terminal input. The overview and
Home lower it.

- **Compose box.** One logical line, placeholder "Type or dictate a line", growing from one to five
  lines, then scrolling. A textarea everywhere, with autocorrect, capitalization, spellcheck and
  smart punctuation off. Return (labelled "return"/Send) sends the text then Enter to the active
  tab's shown window as one `paste` with `enter: true`, clears it and keeps focus. Empty Return sends
  Enter. An undelivered line returns to the draft with its reason (a resend could run it twice); a
  disconnected tab keeps the draft and says "Not connected". Each tab's draft survives keyboard hide,
  navigation and reload. Delivery rules:
  [terminal-interaction-design.md](terminal-interaction-design.md#the-dock-line-field-key-row-and-one-keyboard-toggle).
- **Paste.** One line is inserted for editing; text with a line break goes to the terminal as one
  paste without Enter, with a notice; an image takes the image paste route. Clipboard reads capture
  the tab and window before a system prompt.
- **Key row.** Fixed, horizontally scrolling, text-only: esc, tab, ←, ↑, ↓, →, ctrl, alt, `|`, `~`,
  `/`, `-`, ⇧tab, ⏎, then the chords ^R, ^Z, ^C. The order serves agent CLIs first and opens esc, tab
  (Jimmy: "the first row should guarantee esc | tab"); ^C is last because it is "kinda dangerous" in
  the first slots. ^S isn't offered: it is XOFF, which stops all output until ^Q. While the box owns
  focus, unmodified ← and → move its caret and esc returns focus to the terminal; ↑, ↓, ^R, ^C, tab and
  other controls go to tmux. Arrows repeat while held. ctrl and alt arm the next key, shown pressed
  until used or tapped again. A key-row tap does not move focus, except esc leaving the box. The row is
  the same with a hardware keyboard.
- **Focus cues.** Terminal target: solid terminal cursor, an idle box without a caret. Line target:
  box ring and caret, visible Send, hollow terminal cursor. Exactly one active typing cursor.
- **Terminal taps.** A tap raises the keyboard (made in the tap's own `touchend`, since iOS raises the
  keyboard only for a focus made in the gesture); in an app that asked for mouse reporting it is a
  click and raises nothing; with a selection up, a tap elsewhere closes it and raises nothing
  ([terminal-interaction-design.md](terminal-interaction-design.md)). Scroll and selection don't toggle
  the keyboard.
- **Safari's form accessory bar** may sit between the key row and the keyboard in the browser/PWA; Done
  lowers the keyboard. The app hides it (`WebKitAccessoryBar`).

## File upload and path insertion

In a Files tab, upload uses the file picker into the configured uploads folder. Several files may be
picked; one uploads at a time and at most four are held ("Wait for the current uploads to finish."); a
file over 128 MiB is refused before it is sent. A row shows progress and a × that cancels (the server
deletes what it received); when done it offers the saved name, **Insert into terminal ▾** and Preview,
and the screen stays in the folder. **Insert** opens "Insert path into": this server's terminal tabs,
the default first (the tab the upload began in for an upload's offer, else the workspace's last
terminal tab; Cmd/Ctrl+I on a file sends the path there with no menu). Choosing inserts the
shell-escaped absolute canonical path without Enter, then returns to that terminal. It never executes
the path.

A tab still restoring or whose connection failed is listed but disabled, saying why. With no terminal
tab the menu says "Open a terminal tab first". The target tab and the window it shows are captured on
click: the path goes to that window even if the tab has since followed its session elsewhere, and
fails visibly if the window has closed, never into a different tab. A tab that hasn't had its first
`watching` types the path into the window its first `watching` names. A name holding a control
character (CR, LF, ESC, ^C) is never inserted; a notice sends the user to the terminal.

**Paste into a folder.** A Files tab showing a folder has **Paste** (an icon on a desktop, an item in ⋯
on the phone; Cmd/Ctrl-V while Files' keys are free). It reads the clipboard inside the tap and creates
a file: an image named like any upload (`YYYYMMDD-HHMMSSZ-xxxx.<ext>`; the app re-encodes HEIC to
JPEG), text as `pasted-YYYYMMDD-HHMMSSZ.txt` holding exactly the text. A name is never reused (`-2`,
`-3`). It uses the upload pipeline's limits and errors; a failure is a notice and leaves nothing
behind. "Pasting…", then "Pasted <name>"; "Nothing to paste" for an empty clipboard. The new row is
selected (desktop) or marked (phone). The path is typed nowhere.

**Image paste into a focused terminal** uses the same pipeline: capture the exact target tab and window
at paste start, upload, then insert the quoted absolute path into that window without Enter. If the
target is gone or disconnected when the upload completes, the file stays in Files and the failure is
reported; never redirected to another tab. In the app the page can't upload a `File`, so a paste
event carrying an image makes the page read the pasteboard through native (`readPasteboard`). Browser
image clipboard access depends on a user gesture; unsupported access gets an explanation and the Files
upload route.

## Offline and updates

The service worker serves the shell from its cache. With no network the host card reads offline with
"This device is offline." and open tabs "Reconnecting…"; with a network and no answer, offline with
when the server was last reached. Nothing shows a pretend live terminal and nothing typed is queued.
The worker never intercepts `/ws`, `/auth`, `/fs`, `/complete`, `/debug` or a non-GET request.

A new build installs in the background and waits. Home and Files show "Update ready" with Update,
never over the terminal; only the window that taps Update reloads, another shows "Reload to finish
updating". A window whose build the host no longer has fails to fetch a lazy chunk and shows "Update
required" with Reload, never over the terminal.

## Keyboard ownership and navigation history

Desktop terminal focus owns keys only while terminal input is focused; session search, creation forms
and Files controls own their input. Escape is intercepted only while an overlay is open. Tab
activation, terminal return and overlay dismissal restore terminal focus on desktop, never stealing
from a focused text field. Only focus that must raise the software keyboard happens synchronously in
the gesture; a phone dialog must not unexpectedly raise its keyboard.

Browser-reserved shortcuts are accepted, not intercepted; which combinations reach the page must be
probed in Jimmy's browsers before shipping. Browser/site navigation is never hijacked to mimic a
native terminal. The on-screen keyboard lacks Esc, Ctrl, Tab and arrows; the key row supplies them.
The file editor has no keyboard owner of its own: the keyboard control under a Files tab raises it
first, and its row holds only keys that mean something in text. Escape doesn't leave the file while an
edit is open.

Navigation: Home, overview, Terminal/Files transitions, folder drill-in, preview and modals create
reversible history entries; Back closes the top sheet/preview before leaving its parent. Opening or
switching terminal tabs adds none. Back never kills a tmux session. The native shell follows the same
logical hierarchy without URL history.

## Clipboard and touch selection

Browser copy preserves logical line breaks, not terminal soft-wrap boundaries. Paste preserves
multiline text through the paste protocol (`load-buffer` then `paste-buffer -p -d`); it is not
converted to Enter key events and plain paste appends no extra Enter. tmux adds bracketed-paste markers
only when the application requests that mode, so without it embedded newlines can execute shell
commands; no "paste never executes" guarantee is made.

The selection and gesture contract is [terminal-interaction-design.md](terminal-interaction-design.md).
On the phone, selection is iOS's own on the terminal's rows drawn as page text: a long press selects a
word with iOS's handles and menu, and Copy joins soft wraps into logical lines. In the app, keyboard
up or down, the keyboard never drops for a selection: a hold of about 380 ms marks the word with
muxen's highlight, two handles extend it, and iOS's edit menu shows Copy and Paste; a tap elsewhere
or output redrawing the marked rows clears it. In a browser the hold with the keyboard up does nothing.
A touch sends no mouse event, in mouse-mode apps too (Jimmy). Vertical swipes in alternate-screen apps
still send ↑/↓ or wheel events. Real iPhone Safari and app checks remain required.

## Why these choices

Jimmy's words are quoted where they are the reason.

**Workspaces and tabs**

- Home lists workspaces only and the overview lists tabs as rows, because a half-height picker with a
  tab chip that blended into the key row opened two pickers for one job and made finding a file take
  four steps. Rows reorder by a drag handle because the pills scroll sideways.
- Open session is new-or-attach as the client's rule over the listing, not tmux's `new-session -A`,
  which fails from the daemon on an existing name ("open terminal failed: not a terminal", tmux 3.8).
- Close only detaches; Kill window and Kill session sit behind a confirmation that names what ends:
  Jimmy wanted to detach or kill from a tab, "just they have to confirm it".
- The tab row's controls are filled and the key row's keys are plain text, so the tab selector "clearly
  reads as a control". The keyboard control stays the tab row's last control in both keyboard states so
  it never moves.
- Back is at the top on pages and the dock's ‹ on tabs: at the top on a tab it would cost a terminal row
  and be a reach on a large phone. Every page shares one header row so screens stop drifting apart.
- One banner per screen, for that screen's server: another server's outage over this server's terminal
  changes nothing the user can do, and two Retry buttons for one fault make the user pick. A refusal
  outranks offline on the card, because its fix (re-enrol, update) is what the user must do whether or
  not the server is on, and a refused token stops the socket so a reachability beside it would be
  stale. One "Can't reach pop-os" covers a machine that's off and muxen that's down: a WebSocket gives
  the same 1006 either way. The checking state reads "connecting" ("the word 'checking' doesn't make
  any sense").

**Keyboard and input**

- The keyboard is sticky because typing like Termius is the benchmark. A tap on the terminal raises it
  inside its own `touchend`.
- The compose box is one logical line and Return sends text plus Enter, as one `paste` with
  `enter: true` so the Enter cannot run without its paste. A separate Insert and second Enter cost a
  tap each time.
- Every text box has autocorrect, autocapitalization and spellcheck off, set as attributes: Preact
  assigns a JSX prop to the element's property, and WebKit's `autocorrect` property is a boolean, so
  `"off"` became true. The file editor follows the rule "for now"; Jimmy found it debatable there.
- ^S is not offered: it is XOFF (measured on tmux 3.4), and inside a raw-mode TUI it is an ordinary
  key, so the same key would behave two ways.
- Ctrl+Shift+F leaves a focused terminal on desktop: a terminal can't tell Ctrl+Shift+letter from
  Ctrl+letter, so shells lose nothing, and none of Chrome, Firefox or Safari defines it. Ctrl+Shift+L
  (Edge's paste and go), U and E (GTK's input methods), Y (Firefox downloads) and Escape (shells and vim
  need it) were ruled out.
- The app's Face ID relock is selectable (5 minutes, 1 hour, at launch) because frequent prompts
  annoyed; "At launch" is one unlock per process launch, not removal of the Keychain item's Face ID
  protection. A change that loosens the interval needs a fresh Face ID evaluation: the page alone
  shouldn't weaken a security control.
- Dialogs say only what the user can't see: "Discard your changes?" and "Delete notes.txt?" need no
  body. A verb says what happens ("is deleted", never "goes").

**Files**

- Files has no scope: a device token already runs any command in tmux, so a boundary would guard against
  nothing but Jimmy ("u already have terminal access... why tf are we restricting this?"). It cost a
  folders-only view, a "not added" state and an "Add this folder" flow.
- A desktop's list is an outline with a Preview panel; the phone keeps one folder per screen. At most
  32 folders stay open per tab because each pins a listing against the cache's bounded entries.
- Delete is permanent, behind a confirmation ("permanent with confirm could be fine for now"); the
  system trash needs a copy across disks, a trash that fills and per-OS layouts, and remains the likely
  next step. Only-empty-folders was ruled out because the common wish is `node_modules`.
- An edit stays on the path it opened, and unsaved text gets no special defence ("unsaved data lost
  is... kinda par for the course"); only the file on disk is protected.
- Download in the app is a bridge request because the page's `<a download>` does nothing in the app's
  web view; the progress alert appears only after 0.5 s so a small file doesn't flash it.
- Mermaid ships outside the service worker's precache and the shell budget, so diagrams need the
  network; the worker reports a 404 for an `/assets/` file it has no copy of and the app raises
  "Update required" with Reload.
- Search walks per settled query and the daemon sends the best 50 ([fs.md](../fs.md#get-fssearchpath)).
