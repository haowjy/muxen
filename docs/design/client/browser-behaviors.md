# Muxen browser and mobile interaction contract

Status: interaction contract for the client redesign; implementation and device-specific gates remain. This contract supersedes conflicting navigation and layout rules in the earlier plan. The workspace, its tab row and the phone dock are specified below; their touch implementation remains to verify on an iPhone. See [README.md](README.md) for precedence and Mac setup.

Interactive mockup: [mockups/index.html](mockups/index.html). It predates this redesign; where its navigation or layout differs from this contract, the contract wins. All sessions, terminal text, files, and creation are fictional; reload resets mock data. This mockup never connects to tmux. Do not use a live server with personal sessions for input probes.

## Product boundaries and vocabulary

- Phone browser must support installation as a PWA with standalone launch; installation is optional for use, not for implementation scope. It shares browser behavior, preserves local drafts offline, and never queues terminal commands for later execution. See [browser setup](browser-setup.md) for research and gates.
- Three environments: desktop browser, mobile browser, native iPhone app. Shared workspace behavior; platform-specific navigation and input. No three independent terminal implementations. The native app has a host registry; a browser/PWA is currently bound to its page origin. A unified multi-server browser workspace and its Add server route need an origin/auth design before implementation; do not relax the existing browser boundary ([connection roadmap](connection-roadmap.md)).
- Host is the server, e.g. pop-os. Session is a real tmux session, e.g. a1 or bio2. A session contains windows; one of them is its current window. A terminal tab opens one tmux session, as `tmux attach` does: it shows the session's current window (that window's active pane) and follows it when the current window changes, whichever client changed it. A Files tab holds one folder or file preview on a host.
- Session lists use actual session names. A terminal tab's label is the session name, then the current window's name in regular weight; a Files tab uses its current folder or file name, and "~" at the host's home. One function names a tab, so it reads the same in its pill, the overview, the dock's line field and a notice. A workspace is one server's, so a label never names the host.
- Minimal initial product. No custom shortcut system, command palette, expanded desktop sidebar, split-pane management, SSH/SFTP/serial connection choices, or app-drawn keyboard: the dock's key row supplements the system keyboard and never replaces it.
- Existing-session selection must be clearly distinct from session creation. Opening an existing session never creates another shell. Closing a muxen tab only detaches; only Kill window and Kill session, each behind a confirmation, end tmux state.
- Connecting may resize a real tmux window. The setup must not suggest muxen is read-only or isolated when connected to the user's server.

## Platform layout

A **workspace** is a server's open tabs, in the order the user gave them, and the tab it last
showed. Each server has one workspace for now; the model keeps a workspace its own record, owned
by a server, so a second one on the same server later is another record, not a remodel (Jimmy,
2026-10-30: "maybe in the future we can have multiple workspaces"). Every surface has two levels,
and the same screens going forward and back (Jimmy, 2026-10-31: "going from home completely skips the
workspace selection, and going back u have to go to the workspace slection"):

1. **Home** lists the workspaces. A row opens the workspace's last tab.
2. **A tab** (terminal or Files) fills the screen, with the workspace's **tab row**.

**The tab overview** lists one workspace's tabs, and adds, reorders and closes them. It is not a level:
over a tab it is the tab list, opened from the tab row's All tabs, and Back closes it onto the tab it
was opened over, or onto the tab picked in it. A workspace with no tab shows it in the tab's place,
reached from Home; a tab opened from there takes its place, so it is never a stop on the way back.

Back from a tab is Home. It lands on the nearest earlier Home entry, so folders drilled into on the
way never add a stop. Back walks out of the shown Files tab's folders only: switching tabs drops the
earlier tab's, so the history is Home, then the tab and its folders.

**Swipe back.** In the app, a swipe from the left edge is Back everywhere except on a terminal tab with
nothing over it, where it is off (Jimmy, 2026-10-31: "that obiously shouldn't happen at the terminal"): the
web tells the shell with `backSwipe { enabled }` as the screen changes, and the shell turns WebKit's
back-forward gesture on or off. Over a terminal (the tab list, Open session, Settings) it closes what is
over it; a Files tab steps out to the parent folder, then Home. Phone Safari owns its edge swipe and
cannot be told no, so there a swipe on a terminal goes Home, as ‹ does.

**Back's place.** Where a tab has the dock (touch), every screen puts Back and its controls in a bottom
bar the dock's height, where the dock's tab row has its ‹: Home (Settings, at the row's end), the tab
overview and page dialogs (Settings, Open session); their titles stay at the top. With a mouse, Back is
in each screen's header (Jimmy, 2026-10-31: "the back button jumps from top to bottom").

**Workspace state.** A workspace record has its own id, its server's host id, its tabs in order and
its last-shown tab; today each host has exactly one, made when the server is first known. The route is Home,
a workspace's overview, or a workspace's tab, and it names the workspace: the tab on screen is that
workspace's last-shown tab, so there is no separate "active tab" to disagree with it. An event that
adds a tab (Open session, Open files) names the workspace it adds to. Reordering is one event that moves a
tab to an index; the order and the last tab are saved per device with the rest of the workspace.
Each workspace's last terminal tab is where Insert path and uploads go, from a Files tab too; when
that tab closes, the nearest remaining terminal tab (right-hand neighbour first) takes over. When
a server is removed, its workspace and tabs go with it; nothing in tmux changes. A workspace saved
in the earlier single-strip format is discarded whole at boot, as earlier formats were: muxen
starts at Home with no tabs, and the sessions are one Open session away.

| Surface | Desktop browser | Phone browser / PWA / iPhone app |
| --- | --- | --- |
| Tab row | One top row: ‹, the workspace's tabs, +. No rail. | One bottom row: ‹, the workspace's tabs, +, and Show keyboard while the keyboard is down. It stays in place when the keyboard is up, above the compose box and the key row. |
| Terminal | All space below the top row. Direct physical-keyboard input; no dock. | Full-bleed above the dock. |
| Adding a tab | + opens a menu under it: Open session, Open files. The tab overview has the same two actions. | + opens the same menu above it, with the keyboard up or down. |

Safe areas and browser chrome are real platform constraints. Use the measured visible
viewport and keep controls unobscured. Mobile controls target at least 44 px of touch
area; the dock's visible controls may be smaller. Seat the bottom row at the bottom
safe area without a blank band; add that inset only while the keyboard is down. The tab
row and the key row scroll horizontally. Names truncate rather than widening the
screen. Safari's own toolbar remains below the bottom row, and its form accessory sits
between the key row and keyboard. Standalone PWA mode has no Safari toolbar.

## Visual treatment

- Settings offers System / Light / Dark on every surface. System follows the system
  appearance; Light and Dark override it. Dark uses a true-black terminal and neutral
  greys rather than blue-tinted terminal surfaces. Native and web appearance agree.
  The choice is kept by the platform: the browser's local storage (a blocked or empty
  store falls back to System and the control still works for that page), the app's own
  preferences, which it applies to its lock screen, sheets and keyboard before the web loads.
- Settings offers the terminal text size: Small, Default, Large, Larger, which are 1 px
  under today's size (12 px touch, 13 px compact) and 2 and 4 px over it. Large and Larger
  fit about a seventh and a quarter fewer columns on a phone; Small gains one in twelve. Settings opens over Home, which
  shows no window, so the new size takes effect when a tab is next shown: it is fit to this screen
  at that size, in the one claim every shown tab already sends: the size comes from the font, which is
  known while the terminal is hidden, so no second resize follows.
- Blue is the selection/accent channel; green is reserved for connected status. Selected
  rows use a blue-tinted fill and weight. Connection state is distinct from selection.
- Menus and the tab overview use the current theme's raised surface. A press outside an open menu closes it; on touch that tap only closes it, as on iOS, so the row or control under the finger doesn't also act. A toast floats above the dock
  without covering its controls.
- Home is a centered column on desktop, with width `min(720px, 100% - 2 gutters)`.
  Every screen and full-screen page (Home, the tab overview, Settings, Open session) has the
  same 44 pt header row, `ScreenBar`: a back icon at the top left where the screen has a parent,
  on every layout (only a tab keeps Back at the bottom, in its dock's tab row), the 17 pt title
  left-aligned in the column, the screen's own controls at the end, and a rule under it. No large titles, no centred titles.
- A terminal tab's session name is bold and its current window name regular, separated
  by spacing, including for a one-window session; a phone pill shows the session alone. Truncate the window name first. A Files
  tab is labelled by its folder or open file, and a tab at the host's home reads "~". Icon-only controls have accessible
  names and tooltips on hover and keyboard focus.
- Interactive controls share a 2 px focus ring with a 2 px offset. Spacing, type, radii
  and icon sizes use one scale per property; icons are Lucide's (`lucide-preact`), 16, 20 or 24 px.
- Loading, empty, offline, error, refused-session, enrolment and permission states are
  distinct; failures must not look like empty content. Reduced motion shortens duration
  tokens. Do not globally force transitions to 1 ms.

## Home

Home lists the workspaces, one row each: the server's name, its connection status in its
status colour, and how many tabs are open (Jimmy, 2026-10-30: "home should only list the
workspaces"). Home lists no sessions or files. A row opens that workspace on the tab it last
showed; a workspace with no tabs opens its tab overview. One and several servers use the same
rows; a single server does not auto-navigate past Home. Add server leads to enrolment. An
offline server's row shows when it was last reached and Retry, distinct from an empty one; its
tabs remain open, reading reconnecting. A restored terminal tab reads “Checking…” until a listing
proves its session, or “Reconnecting…” while unreachable. Phone Safari Home also offers Add to
Home Screen instructions.

No servers shows enrolment instructions and Add server. If a server's tmux is not running,
its row says so; muxen never starts Jimmy's tmux server. Server management includes adding,
removing and re-enrolling a server. Settings is a separate screen reached from the gear in Home's header, on every layout, with
appearance, terminal text size, this device/browser and local-data controls. The app also
offers the Face ID relock setting ([auth.md](../auth.md#swift-side-keychain-item-and-app-lock));
the phone browser has no Face ID setting. Clear local data deletes
drafts and the saved workspaces on this device, leaving currently open tabs until closed;
destructive actions confirm independently. Remove this device is available only where the
host admits this device as a tailnet node. Settings has Back to Home.

**Where a launch opens.** A launch (a reload, a bookmark, a copied link, or the app after iOS
killed it) opens the place the page's address names, else the route last shown, saved with the
workspaces, else Home. The address reads `#/` (Home), `#/tabs` (the tab overview),
`#/term/<session>` or `#/files/<path>`: a folder ends in `/`, a path under home reads `~/…`, and
any other path drops its leading `/` (`#/files/etc/hosts`). It names no server, since a browser page
talks to its own origin's host only; the app has no address and opens its saved route. A session no
tab follows shows the overview; a Files place no tab shows opens a new Files tab there. The page is
opened above Home, so Back goes to Home. A server that is down is explained on the tab
("Can't reach the server", with Retry). A setup link (`#code=…`) opens Home. Returning from the
background keeps the screen the user left. The address is rewritten, without a history entry,
when what it names changes (a session renamed).

## Terminal

- Selecting a tab activates it; other tabs remain open. Opening a session already represented by a tab activates that tab. Implementation identity must use server/session IDs, not mutable display names.
- **The tab follows its session.** When the session's current window changes (prefix-n on the laptop, the window switcher below, a window exiting, a script), the tab shows the new window: its snapshot replaces the old one in place and the label changes. The tab, its draft and its place in the tab order stay. Typing, the line field, paste and an inserted path go to the window the tab is showing on this screen, so keys sent just before a change made elsewhere still reach the window the user was looking at. Opening or activating a tab enters Terminal through the router; desktop focus lands on the terminal after that screen is rendered.
- Closing the active tab activates its right-hand neighbour, or the left-hand neighbour if it was last. Only the active tab shows ×, in the tab row on every surface; every tab keeps the space for one, so changing tabs never moves the others. It closes that muxen tab, never its tmux session or process. Scroll the active tab into view. Closing the last tab shows the tab overview. Creation-dialog cancellation/Escape restores focus to its opener.
- The tab row's ‹ and the system back gesture go to Home, preserving open tabs and the active tab. + opens Open session and Open files.
- Switching tabs preserves the terminal and running process.
- Terminal output is not editable mock text masquerading as live input. The prototype says it is sample content and sends no input.
- On the terminal, show connection status only when not live. Reconnecting/error is visible in text, with Retry, and is distinct from active-tab selection and the bell dot. Home's workspace rows still show live or offline status.
- Real connection states inherit the existing reconnect contract: disconnect does not silently close tabs; reconnect/error appears with the affected tab; viewing Home/Files must not kill tmux.
- When the daemon refuses a socket for its connection cap (close code 4005), the host banner says “Too many connections to pop-os” with “Close muxen in another browser or the app, then retry” and a Retry button, until a socket is welcomed. It is a host problem: the tabs keep their own “Reconnecting” state and the socket keeps its normal backoff.
- Scroll behavior, paste, mouse handling, focus delivery, reconnect, server identity, tmux geometry ownership, and keyboard viewport behavior require implementation-phase verification. No claim of those working is made from static mockups.

- Desktop keys go to tmux by name: Shift+Enter sends the modified-Enter bytes once, and IME composition sends nothing until it ends. Cmd combinations and F5, F6, F11 and F12 stay the browser's on every platform; Ctrl+Shift+C copies the selection as logical lines on every platform. Ctrl+Shift+F leaves the focused terminal for the tab row (focus lands on the active tab; Enter returns), handled before the key is sent; Settings lists it under Keyboard. Keystrokes are batched for 8 ms into one input message.
- Paste sends one paste message and is refused over 256 KiB, saying so. An image paste uploads, then types the quoted path into the tab it was pasted in, if that tab is connected when the upload ends; otherwise a notice says the file is in Files.
- A tab the daemon refused for its session limit reads “session limit” in the error colour, shows the daemon's message and Retry, and retries with a growing delay. Retry asks at once and keeps the delay.
- The terminal stays blank until the shown tab's own snapshot paints, so another tab's content never sits under a pill that is not its own. tmux is never sized before the renderer has measured a cell.
- A window takes the size of whichever terminal acted on it last. Opening or returning to a tab, typing, pasting, rotating, Fit, and choosing or creating a window in the window switcher size the shown window to exactly this screen's size, whether the laptop's terminal is larger or smaller; typing in another terminal (the laptop) takes it back, and the tab stays live. A tab that just stays on screen never takes it back, and neither does a reconnect after a network blip, unless the tab held the window before it. When the tab follows a window change made elsewhere (the laptop's prefix-n, a window exiting, a script), the new window keeps the size it had until this screen acts on it. The window left behind goes to the laptop's size after its prefix-n; after a change no terminal made, it takes the size the window had when muxen attached to the session, until a terminal types there. The same holds when this screen stops holding a window and nobody else acts there (the tab leaves the screen, the connection drops): it takes the size it had when muxen attached, until the laptop types. A window sized for another terminal is drawn at this screen's own font from the left edge: wider content is cut off at the right, and taller content follows the cursor, as it does above the keyboard. A window smaller than the screen sits in the top-left corner on the terminal background. Whenever the window's size (from `watching`, the whole window, not a split pane) has differed from the size this screen sent for longer than the wait, larger or smaller, the band on the terminal's top edge says “Sized for another terminal” with Fit, which sizes the window to this screen. While this screen holds the window the two sizes match, so there is no band; the wait, one second or the last measured ping round trip plus half a second, whichever is longer, restarted at each claiming send (opening, typing, pasting, rotating, Fit, choosing a window), keeps it from flashing while a claim's resize is on its way over a slow link. Reconnecting and error states replace the band.

## Tab row

The tab row holds ‹ (Home), the workspace's tabs as pills in workspace order, +,
and All tabs (the tab list); on the phone,
Show keyboard ends it while the keyboard is down. Every pill is filled; the active one is tinted with its
status colour, its label and its circled × in that colour; other pills have a muted label and the
attention dot when they have one (Jimmy, 2026-10-30, after Termius's tabs).
Every pill is the same width, whatever its label, and keeps space for ×, so changing tabs never moves the others (Jimmy, 2026-10-30: “the tabs change size... they should be consistent... look at termius's”): the pills share the strip between a minimum and a maximum width, past the minimum the row scrolls, and on the phone they fill the row between ‹ and +. A phone pill shows the session or folder name only; the window is in the tab overview and the pill's menu. The row scrolls
horizontally, the active pill is scrolled into view, and the next pill peeks when more remain.
A tap switches tabs and leaves the keyboard up or down as it was; with it up, it goes to the
new tab's input (Phone dock). ‹ goes to Home; All tabs opens the tab list over the tab.
The tab row's controls (‹, pills, +, the keyboard control) are filled, one height and one corner
radius; the key row's keys are plain text, so the two never read alike (Jimmy, 2026-10-30).

**+** opens a small menu anchored to it, in the popover look: **Open session**, **Open files**.
It opens over the tab with the keyboard up or down and does not lower it; a tap outside,
Escape or Back closes it.

**Long press on a pill** opens the tab's menu, anchored to the pill. A terminal tab's menu:

- **Windows**: on the tab on screen, for a session with more than one window, its windows in index
  order, “index: name”, the shown one filled; a tap runs tmux's `select-window` on the session, so every
  attached client moves with it (it rides the tab's watch, which only the shown tab has). Then **New window** (`new-window`), for any session.
- **Rename session** (`rename-session`), edited in place, with the daemon's reason on refusal.
- **Move to start**, **Move to end**.
- **Close tab**: detaches only (`unwatch`); tmux keeps the session.
- **Kill window** (only when the session has more than one window) and **Kill session**: last,
  apart from the rest, in the danger colour, each behind a confirmation that names what ends
  (“Kill session infra? Its 3 windows and their processes end.”). Nothing kills without it.

A Files tab's menu: **Copy path**, Move to start, Move to end, Close tab.

On desktop the same menu opens on right-click, and on Shift+F10 or the menu key on a focused
pill; ↑ ↓ move through it, Escape closes it and returns focus to the pill. An action that
switches tabs leaves focus on the terminal. Move to start and Move to end are the keyboard way to
reorder. The + menu closes the same way and returns focus to +. On touch the menus never move
the keyboard.

tmux prefix keys sent by muxen reach the pane, not tmux's key tables.

## Tab overview

The tab overview is one workspace's page: the tab list over a tab, opened from the tab row's All tabs, or
the page of a workspace with no tab, reached from Home. Its header has the workspace's name (the server's
name for now) and Back, named for where it goes (the tab under the list, or Home), at its top left on
every layout. A tap on a row, Open session and Open files close the list onto that tab. Below it, one row per tab in
workspace order: an icon for the kind, the label, and a line of detail (a terminal's window and
how long since its last activity or bell, from the latest listing, with no request of its own; a
Files tab's path, shortened under home, when that says more than the label); the workspace's last-shown tab's row is filled.
A list of rows, never previews of the terminals: a preview would stream every tab's screen
(Jimmy, 2026-10-30).

- A tap on a row opens that tab.
- A row's ═ handle drags it to a new place in the order, which is the tab row's order. Dragging
  starts on the handle only, so scrolling the list never reorders it.
- A swipe left reveals Close, and a full swipe closes; a pointer that hovers shows × instead.
  Closing only detaches and never touches tmux.
- Under the rows: **Open session** and **Open files**. An empty workspace shows only these,
  with a line saying it has no tabs.
- The workspace's bell and tmux-coverage notes (Bell attention, below) show here.

## Adding tabs

**Open session** is one screen, “new or attach” (Jimmy, 2026-10-30).
A field heads it, “Session name”, over this server's sessions that are not open in this
workspace, each with its window count and last activity, from a listing fetched when the screen
opens and refreshed on `sessionsChanged`. Typing filters the list locally, with no request per
keystroke. A tap on a session opens it as a tab and makes it active; it never creates a shell.
The list's last row creates: with text no session has, **Create “infra2”**. With the field empty it reads
**New session** and asks for a name: it puts the caret in the field, which says "Type a name for the new
session", and creates nothing (Jimmy, 2026-10-31: "if u click “new session” - it doesn't ask u for a
name"). A session tmux would name is not offered. Return does what the first row does. Typing the name of a
session already open here activates its tab. New-or-attach is the client's rule over the
listing: a listed name attaches and an unlisted one sends `newSession`; a “duplicate session”
refusal (another client created it first) re-lists and attaches. tmux's `new-session -A` is not
used: from the daemon it fails on an existing name. A new session starts in `~`. Its tab opens from the
next listing that contains it; after 5 seconds, say it was created but has not appeared. A refused
name shows the daemon's reason under the field. Creating is not offered while the server has no
tmux server, which muxen never starts, and is disabled with its reason while the server can't be
reached. Loading, empty, offline and refused states are distinct.

**Open files** opens a new Files tab at `~/` and makes it active (Jimmy, 2026-10-30: “it should
just always start at ~/”). Its path field goes anywhere else (Files).

## Bell attention

An attention dot on tab pills, tab overview rows and Open session rows marks a terminal bell since this
  device last showed that tab; mechanism and coverage limits are in
  [plan.md](../plan.md) (Bell attention). It is not a connection-status indicator.
  - **Seen is per device and saved.** The device keeps, per session, the bell mark it last showed
    (the `mark` in the `sessions` listing and the `bell` message, daemon-core.md §5.3),
    and a tab shows the dot while its session's mark differs from that. The tab on
    screen counts as shown: while a tab is the active tab on a visible page, an
    arriving mark is recorded as seen at once and no dot appears for it; a hidden page
    or a backgrounded app shows nothing, so the tab is not on screen and the dot
    appears. A tab that becomes the active tab records the current mark. An overlay over a
    terminal tab (the + menu, the long-press menu) leaves the tab visible, so it still counts as shown.
  - **Seen survives a reload and a relaunch.** The marks are saved with the workspace (keyed by
    host id, tmux server instance and session), so a bell rung while the page or app was away
    shows its dot on return. Each listing drops the marks of sessions that are gone; Clear
    local data resets them to the current marks. Two pages of one origin each save: the last
    writer wins, so a dot cleared in one page can return in the other after a reload.
  - **A session this device has no seen mark for** takes the first mark it learns as its
    baseline (no dot), unless this page has already listed that host (on any tmux
    instance): every session there was then got a seen mark, so this one's counter started
    after that, at 0, and any mark is a bell not yet shown. A `bell` message arriving before
    the page's first listing of the host doesn't count as listed. One rule for a listing
    and for a `bell` message, a restarted tmux included.
  - **Not tracked, in words, never a silent dot-free tab.** When the listing or a
    `bell` message says `covered: false` for a session, its row says "tmux settings hide
    bells in this session". When the `bell` message carries `available: false` for the
    server (the daemon cannot read tmux's bell state), the server's Home row and its tab overview say "Bell tracking unavailable on this host". A `listSessions` that fails with a tmux error (not "no server") says the same. Both are plain text
    lines, not dots, and clear when a later message or listing says otherwise.

## Files

Any number of Files tabs can be open, even on the same server. Each remembers its own folder or file preview locally and is labelled by that folder or file name. A Files tab can open any folder or file the daemon's user can read, `/` included; there is no scope. Open files starts a new tab at `~/`, and its path field, which works like a browser's address bar, goes anywhere else. There are no favorites (Jimmy, 2026-10-30).

Each Files tab presents one folder list under one header line. At rest the line reads where the user is; typed into, it narrows the folder's rows. On a desktop the list is an outline, its folders opening in place; on the phone tapping rows browses one folder at a time (Jimmy: "a on desktop, B on phone").

```text
phone, at rest                           phone, the path line tapped (keyboard up)
┌──────────────────────────────────┐     ┌──────────────────────────────────┐
│ ~/repos/muxen/               ⌕ ⋯ │     │ [ ~/repos/▒muxen/▒     ] Cancel  │  last folder selected
│ ▢ ..                             │     │ ▢ ..                             │
│ ▣ docs                         › │     │ ▣ docs                         › │
│ ▣ src                          › │     │ ▣ src                          › │
│ ▤ Cargo.toml              2.1 KB │     │ ▤ Cargo.toml              2.1 KB │
│ ▤ README.md               9.8 KB │     │──────────────────────────────────│
│ Show hidden files                │     │ iOS keyboard, Return key "go"    │
│ ‹ (muxen) (claude) (~/repos) + ⌨ │     │                                  │
└──────────────────────────────────┘     └──────────────────────────────────┘

desktop, at rest
│ ~/repos/muxen/              [Search] [Upload] [Paste] [Refresh] [⋯] │
```

**The header line.** One line per folder, on both layouts: the path line, then the folder's controls. A desktop shows Search, Upload, Paste and Refresh as icons, then ⋯. The phone's line has room for the path, Search and ⋯ only, so Upload, Paste and Refresh are in ⋯ there. ⋯ (Folder options) holds Copy path first, then Show hidden files (a check while on; on a desktop its shortcut beside it, as Cmd/Ctrl+Shift+. toggles it with no menu open). The folder's name is the page's heading for assistive technology; on screen the tab and the path say it.

**The path line** is one plain string at rest, in mono: the folder's path (`~/…` under `$HOME`) with its trailing `/` (`/` at the top), exactly the text the field starts with. Nothing in it is a link or a button, and there is no copy icon after it (Jimmy: "it should just be 1 line string"; ⋯ › Copy path copies the folder's path). A click or tap anywhere on it makes it the field, with the last folder's name and its `/` selected (`muxen/` in `~/repos/muxen/`), so Delete leaves `~/repos/` and the list shows that folder; typing replaces the selection and narrows. Nothing in the list is highlighted at first, so Enter right away stays where it is, with no new history entry. iOS places the caret at the tap point after focus, so the selection is set again on the next frame and once more after the tap settles (taps while already editing place the caret normally). Editing is a history entry, so Back ends it before it leaves the folder; Cancel beside the field restores the path and stays, as Escape and Back do. Hiding the keyboard, or a tap elsewhere, only lowers it: the edit and its text stay, with Cancel, and a tap on the field resumes typing. The path line has no keyboard shortcut: a click is the way in. `/` is left for Search, and Cmd+L is not taken: whether Chrome and Safari let a page have it is unchecked on real browsers, and the address bar is the browser's. The field turns autocorrect, auto-capitalization and spellcheck off and sets `enterkeyhint="go"`. It keeps the ordinary text keyboard: the iPhone's URL keyboard has `/` on its first layer but no space bar, and folder names can hold spaces.

**The desktop outline.** A desktop's folder list is a tree: each folder row starts with a disclosure chevron (turned down while open), and an open folder's rows sit under it, indented 16px a level, with a 1px guide line under each open folder's chevron (quiet until the pointer is over the list). A click looks: it selects the row, and the Preview panel shows it (a folder's summary, a file's viewer). The disclosure is the one pointer target that opens and closes a folder in place (each click toggles it; its hit area runs 6px past the chevron on each side); ArrowRight and ArrowLeft do the same from the keys. A double-click or Enter goes in: a folder becomes the list's root (a history entry, as before), a file opens. `..` goes up on one click. The phone keeps one folder per screen: a tap opens a row.

- **One listing per open folder.** A folder is listed when it first shows open (its record in the host's folder cache, the one browsing and the path field share), and kept while it shows; closing and opening it again costs nothing. A folder past one page ends in "Show more (N left)", which asks for its next page; one still loading says "Loading", one refused says why with "Try again", an empty one "Empty", one the daemon cut short "Too big to list in full". Show hidden files applies to every open folder (each is listed again with `hidden=1`). The host's folder cache asks for at most two pages at once, first or later, and queues the rest, the folder on screen, the Preview panel's, the path field's and a reveal's ahead of the outline's (a folder the outline queued first moves ahead when the user asks for it): the daemon scans one folder at a time and refuses a request past a few waiting, so a burst (Show hidden over 30 open folders, a reveal down a deep path of big folders) would end in busy errors and crowd out the file the user is reading.
- **Bounded.** A Files tab keeps at most 32 folders open. Opening one makes it and the open folders holding it the newest; past 32, the folder opened longest ago that doesn't show (it sits in a closed folder, or outside the list's root) closes first, else the oldest that shows, never one holding the folder just opened. Only open folders whose parents are open too are listed and pinned.
- **Per tab, never history.** The open folders (by absolute path, so one stays open when the root moves into or above it) are kept per Files tab, the selection per tab and root, in the host's Files session (`screens/files/session.ts`, 64 of each, least recently set first); a reload forgets them.

**The Preview panel (desktop).** Beside the outline sits the Preview panel, which is on or off (Jimmy: "it should be like a 'preview' bar thing"); there is no × on it and nothing closes it but its toggle.

```text
desktop, panel on                                                  desktop, panel off
│ ~/repos/muxen/   ⇪ ⎘ ⟳ ⋯ ┃ ▤ docs/plan.md 64 KB  ⧉ ⤓ ▸▾ │ ⤢ [▣] │      │ ~/repos/muxen/                         ⇪ ⎘ ⟳ ⋯ │ [▢] │
│ ▢ ..                     ┃ (the file's viewer, or the       │      │ ▢ ..                                               │
│ ⌄ ▣ docs             43m ┃  folder's README or facts)       │      │ ⌄ ▣ docs                                       43m │
│   │ ▤ plan.md  64 KB 43m ┃                                  │      │   │ ▤ plan.md                          64 KB   43m │
```

- **The toggle never moves** (Jimmy: "I usually like it when the close stays in the same place so u can tap to open tap to close without moving the mouse (also I'm fine with it just being an icon)"). It is an icon button (the panel-right icon) named and tooltipped for what a click does, "Hide preview" or "Show preview", tinted with the accent on the pressed fill while the panel is on; no `aria-pressed`, which would read "Hide preview, pressed". It is the last control of the Files header line, 8px from the window's right edge, past a rule, on the same pixels on and off: it is one control placed at the line's right end over both layouts, and the bar under it (the list's line with the panel off, the panel's with it on) leaves it room, so it stays put by construction and stays mounted across a toggle. Space toggles it while the list has the keys (the list, or nothing, focused; a focused button or viewer keeps Space, and in a field Space types); a held Space toggles once. Toggling leaves the keys on the list. A file full width has no toggle.
- **On, it follows the selection** once the selection has stayed put for 200 ms, so a held arrow key makes no read per row; a viewer's read for a row it has left is aborted. A file shows its viewer under one header line: its name (its folder below the list's root before it, quiet), its size, the viewer's controls, Copy path, Download and Insert ▾, then the expand button (Open full width) and the toggle. A folder shows its summary: a header line with its name, Copy path and Insert ▾ (no Upload: an upload goes to the uploads folder, not the folder shown, and the list's header has Upload and Paste), then its README (`README.md` or `.markdown`, any case) rendered under the README's own name, which opens it; without one, a card with what it holds ("2 folders, 5 files", or "1,840 entries" when not all listed), when it changed (from its parent's listing, when held), its path, and "Go into <folder>". With nothing, `..` or a folder's last row selected, the panel shows the folder the list starts at, without "Go into". A folder the panel shows is listed once and kept while shown (a folder clicked in the outline already is).
- **The divider** between list and panel drags, and is a separator with the keys: ArrowLeft and ArrowRight move it 16px (64px with Shift), Home and End to the ends, and a double-click returns it to the default, which follows the window again. The list is at least 300px and at most 60% of the window, so the panel keeps the rest; it starts at a third of the window, 400 to 600px.
- **Off, the list takes the window's width, its rows stopping at 960px**: the same rows (name, then size and age as right-aligned columns at the row's right end, the row's hover and selection fills spanning it to tie them), with no column headings, Kind column or stripes (Jimmy: "dont just copy finder"). The rows sit left-aligned under the path, so a size stays near its name on a wide window and turning the panel on or off moves no row sideways; the header line still spans the window, the toggle at its right end. A click still only selects.
- **Remembered per device:** on or off, and the divider's width (`app/viewMemory.ts`).
- **Full width** is a file as its own place (a history entry): the expand button, or a double-click or Enter on a file, panel on or off. Its header starts with Back named for the folder whose list it was opened from; Back (or Escape) is history Back to that list, which returns as it was with the file selected and its folders open. After a reload there is no such entry, and Back goes to the file's own folder, with the file selected. Expanding the panel's file, and Back or Escape to it, read it no second time: the view leaving hands its text to the one taking its place, which takes it once. Nothing else keeps a text, so a file shown again later (a tab switch, a selection, the browser's Back) is read fresh.

**The list's keyboard (desktop).** The folder list is one control that holds focus (a click on a row focuses it, Tab reaches it); its rows are items of it, not focusable themselves, and the selected row is named by `aria-activedescendant` and filled. ArrowDown and ArrowUp move the selection over the rows on screen and stop at the ends (from nothing, Down takes the first row and Up the last), Home and End take the first and last. ArrowRight opens a closed folder, else moves to its first row; ArrowLeft closes an open folder, else moves to the folder holding the row. Enter goes into the selected row (or acts on an open folder's last row: Show more, Try again), and Backspace or Cmd/Ctrl+ArrowUp goes up one folder. The folder the key opened (or its parent) takes the keys, so Enter and Backspace can be chained. On the phone a tap opens a row without selecting it, so a phone shows no selection. The rules are `files/outline.ts`'s (pure, with the rows to draw and the selection moves); `FolderList.tsx` wires keys and focus.

**Shortcuts (desktop).** Files' shortcuts (Cmd/Ctrl+I on a file, Cmd/Ctrl+Shift+. on a folder and in Search, Cmd/Ctrl+V on a folder, `/` and Cmd/Ctrl+P for Search, Space for the Preview panel, Escape out of a file full width or Search) are one keymap, `screens/files/keymap.ts`, with one rule for when keys are free: no dialog or menu is open, no text field has focus (unless the shortcut is one a field allows), and nothing earlier claimed the key. Every Files shortcut registers there; a key two components register goes to the one mounted last. A shortcut that is one printed character (`/`, Space) is matched by the character, whatever keys type it: Shift+7 on a German layout, AltGr on some Windows layouts; Cmd or Ctrl held for themselves make it another key. A shortcut is written for the keyboard: ⌘ and ⇧ on a Mac, iPad or iPhone, Ctrl and Shift elsewhere (`Platform.shortcuts`, `useChordLabel`), and is shown only beside the control whose shortcut it is: the default tab in a file's own Insert ▾ menu shows ⌘I, the upload offer's and a row's menu don't.

**Narrowing.** While the field is being edited, the list shows the rows of the typed parent folder (the folder the text names through its last `/`) whose names match the typed last segment, folders and files alike, ASCII case folded as the daemon sorts them. The name typed whole comes first, then names that start with the segment, then names that contain it, each in the daemon's order. The first row is `..`, which steps the field to the parent folder (`~/repos/` becomes `~/`; `~/` becomes `/home/`) and is absent at `/`; it takes a tap like the other rows. There is no line naming the parent: the field says where you are. While the last segment is empty (right after a `/`) the list shows all of the parent's rows and none is selected; once a character is typed the first match is selected. There is no ghost text and no accepting a name into the field: Tab and `/` are typed as they are. ArrowDown and ArrowUp (the focus stays in the field) move the selection, including onto the `..` row. A tap on a row opens it and ends editing, a folder as a folder and a file as a file. The row takes the tap without taking focus from the field, so the keyboard stays up until the place opens. Typing a path to another folder (`~/repos/many/fo`) narrows that folder's rows once its listing has arrived. A name starting with `.` asks for the hidden listing, whatever the toggle says.

**Go** (the keyboard's Return, Enter on desktop) opens the selected row and ends editing: a folder is entered, a file opened. With nothing selected (the text ends in `/`, or is `.` or `..` last) it opens the folder the text names; the folder already on screen stays, with no new entry. With a name that matches nothing in a folder held in full it says “Nothing named x in ~/repos” under the field and opens nothing. A name that matches nothing in a folder not held in full is asked of the host once (a probe), which opens it if it exists; if it does not, the field says nothing in the loaded entries matches and offers the rest. In a folder not held in full, a partial name that matches a loaded row opens that row, even if the exact name sits on a page not loaded; the note and **Load the rest** are on screen to say so. Opening adds a history entry, as a tap into a folder does, so Back returns to the folder the user left.

**Anywhere.** The field narrows any directory the daemon's user can read, from one `/fs/list` listing per folder, the same as browsing.

**A folder not held in full.** The list narrows only what is loaded. When the typed folder holds fewer entries than it has (browsing loaded one page of 200 of 1,840), the list says “Matches are from the first 200 of 1,840 entries” with a **Load the rest** button, which pages the remaining entries in, one request each, and then narrows all of them. Nothing is loaded on a keystroke. A folder the daemon cut short at its scan cap says “This folder is too big to list in full. Matches are from what was listed.” and offers nothing more.

**Cost on a spotty network: one listing per folder, never one per keystroke.** Narrowing filters a listing the client already holds. Naming another folder (a typed `/`, a pasted path) asks for that folder's first page once, after typing pauses 250 ms, and only for the folder the field names when it settles; answers for a folder the field has left are never shown, and are kept in the cache. Listings are held per host for the Files session, one record per folder (keyed by path and the hidden flag) holding every page loaded so far, whether the field or browsing loaded it; a page browsing loads joins the record the field reads. The records are bounded by the entries held in all (10,000, each folder counting one more), the least recently used going first, and a folder on screen is never dropped. Showing a folder that is cached (opening it from the field, switching to another Files tab, Back or Forward, returning to a preview's folder) costs no request, and returning to a file already probed does not probe again. A failed listing is asked for again when the field next names that folder, and Try again asks at once. Pull-to-refresh and muxen's own uploads drop the affected ones. Only the first page is asked for a folder the field names; more pages load when browsing scrolls to them or the user taps Load the rest. While a listing loads, the list says “Loading”; a refusal shows in plain words with "Try again", never as an empty list.

**Hidden files** are left out of the narrowed rows unless the typed segment starts with `.` (that folder is then asked for with `hidden=1`, cached separately) or the hidden-files toggle is on.

**Search** finds files and folders below the folder on screen, by name, at any depth (Jimmy: "a
separate 'search' to 'search' for a file"; he chose fuzzy, a glob when `*` or `?` is typed, and recents
when empty). It is its own place, not the path line: the magnifier, the first control after the path on
the folder's header line on both layouts (on the phone between the path and ⋯; shown while the folder's
rows are, not while it loads, is refused or is gone), and on a desktop `/` or
Cmd/Ctrl+P (registered in Files' keymap, so they don't fire while typing; Cmd/Ctrl+P is taken from the
browser's Print only while Files has the keys, and pressed in Search's field it stays there). Opening it
is a history entry over the folder, naming that folder, so Back closes it, and Escape and Cancel too.
While it is open its field is the header line and its rows replace the folder's, which stay as they were
underneath. A Search is kept per tab and folder (`screens/files/session.ts`), so a Back onto its entry
finds the query, the rows and the scroll as they were.

- **The field** says what it searches ("Search ~/repos/muxen"), starts with the magnifier, turns
  autocorrect, auto-capitalization and spellcheck off (iOS would capitalize the first letter and turn on
  case-sensitive matching), has the keyboard's Search key, and shows which mode the text is in at its
  end: Fuzzy, or Glob (in the accent) once it has `*` or `?`. Matching is the daemon's
  ([fs.md](../fs.md#get-fssearchpath)): fuzzy terms separated by spaces, smart case, nearer files first.
  Cancel ends it on both layouts, as it ends the path field. The field takes the keyboard inside the tap
  on the magnifier.
- **Asking.** The query is sent after typing pauses 250 ms, as the path field's listing is; a request
  the field has moved past is aborted, and its answer, if it lands, is never shown. Until the new
  answer arrives the previous rows (the recents, at first) stay, quieted, under "Searching". Text that
  returns to what the rows answer asks nothing. Hidden files are searched while the folder's Show
  hidden files is on, and a change to it (Cmd/Ctrl+Shift+. works in Search's field too) searches again
  at once, dropping a request made under the old setting. A query past the daemon's 256 bytes is not
  sent; the list says "A search can be at most 256 bytes long." in place of the rows.
- **Results** are rows like a folder's: icon, name with the matched letters marked (the accent, and
  heavier), and the folder it is in, relative to the searched one, in mono, quiet; on the phone that
  folder is a second line (the searched folder's name for a row directly in it), with the age at the
  row's end. They are the daemon's best 50, best first, under "3 matches" ("The best 50 matches" at
  50). Each new answer selects its first row, for Enter. ArrowUp and ArrowDown move the selection while
  the field keeps the keys; Enter acts on it (Enter pressed before the answer lands acts on the answer). On the
  phone a tap (or Go) opens the row: a folder is entered, a file opened full screen; Back returns to
  the results, with the query and scroll kept. On a desktop a click selects the row, as in the outline; the
  Preview panel follows a row you selected (a click or an arrow key), never the one an answer selected,
  and shows the folder until then, so a query costs no read of its top file; Enter or a double-click closes Search and reveals the row in the
  outline, its folders opened and the list holding the keys. A reveal loads each folder's pages down to
  the row (a folder past one page may sort it later), stopping once the pages sort past where the row
  would be (it was deleted since) or a page is refused, and the Preview panel keeps showing the result
  meanwhile.
- **Stopped.** When the walk stopped at a cap the list ends with one line: "Searched the first
  100,000 entries.", "Search stopped after half a second." or "Search stopped: too many folders to keep
  track of.", each followed by "Search from a deeper folder to see the rest.", never as an error. With
  no rows above it, "Nothing matches x in what was searched." comes first. Nothing matched and the walk
  covered everything: "Nothing below ~/repos matches x".
- **Recents.** With the field empty, Search lists the files opened on this device from this host below
  the searched folder, most recent first, under "Opened recently", each with how long ago it was opened
  (the row has no size: the file may have changed since). The host keeps its 20 most recent (view
  memory, per host id; Clear local data forgets them). A file counts as opened when you open it: full
  width, full screen on the phone, Enter or a double-click on a result, or a row you selected that stays
  in the Preview panel; never a row the app selected (an answer's first row, the row a tab kept). The
  phone selects none of them (a tap is the way in); a desktop selects the first, for Enter. With none: "Files you open show here."
- **Errors** read as a listing's do, in plain words with Try again, in place of the rows; offline, the
  field stays and the list says the host can't be reached. The Preview panel shows the folder meanwhile.

**Browsing by tap** is unchanged at rest:

- Opens the current folder as a list. Returning from terminal preserves folder/preview context.
- On the phone folders open their contents, not an accordion; a desktop's open in place (above). Every folder but `/` starts with a `..` row (a folder icon without its fill, `..` in mono, named "Up to <parent>" for assistive technology), which moves up; at `/` there is none. A folder that was moved or deleted since the tab last showed it says “This folder no longer exists” with its `..` row (the parent of its path) still working. The system/browser back gesture goes back, not up.
- Files open a preview (on a desktop, full width). Back from a preview returns to the list it was opened from (its containing folder on the phone).
- **Rows.** Folders and files read apart at a glance: a folder has the only coloured icon (the accent's stroke over `--color-folder-fill`) and a medium-weight name; a file has a muted icon for its kind (text, data, config, lock, script, code, image, video, audio, binary, by extension and then type) and a regular name. Folders come first, and on a desktop a 6px gap sets them off from the files. Names starting with `.` are dimmed. A desktop row is 28px: icon, name, then the size (files only) and the age in tight right-aligned columns (68px, 44px) beside it, so a date sits by its name; rows have a hover fill and no borders. The age is one short form (`12m`, `3h`, `6d`, `4mo`, `2y`) in tabular figures, in full text colour when it changed within a day, with the exact time on hover. A phone row is 48px, edge to edge under hairlines: folders end in a chevron (they drill in), files show their size and never a chevron, and ages stay off the row. The selection is a fill with no outline: blue while the keys move it (the list holds focus, or the path field drives it), neutral otherwise.
- Returning to a Files tab restores its folder or preview; the in-app back button goes up one place, and the browser's Back returns to the previous one without a new request when its folder is still loaded.
- A link that cannot open says why (“Broken link”, “Not a file”) and is disabled. A folder past the daemon's scan cap says it is too big to list in full. Further pages load as the end of the list nears the screen, with “Show more” as the fallback. Hidden files are shown from ⋯ › Show hidden files, Cmd/Ctrl+Shift+. on a desktop, or the quiet toggle under the list; the choice is remembered on this device, for every Files tab and server (`app/viewMemory.ts`, the page's localStorage: not Preferences, which cross the iOS bridge, and not the workspace). Clear local data forgets it.
- **Pull to refresh** on the phone: a touch that lands with the list at its top and moves down brings a round chip down over the list's top edge (the finger moves twice as far as the chip); released past 64px it reloads the folder from its first page, with a spinner in the chip until the listing lands. It reads touches without cancelling any, so iOS's rubber band stays the list's own. With reduced motion the chip's arrow doesn't turn. A desktop has Refresh on the path line.
- **A row's menu** opens on right-click on a desktop (which selects the row), Shift+F10 or the menu key on the selected row, and a held touch on the phone (450 ms, which leaves the row unselected and opens nothing when the finger lifts). It holds Open (Go into folder, for a folder), Open in new tab, Copy path, Download with the size (files) and "Insert path into" with this server's terminal tabs, the last one used first: the Insert menu's rows. The `..` row has none. Escape returns focus to the list; any press outside the menu, on the list included (a scroll starting, another row), closes it.
- **A file's header** is one line. A desktop's: Back named for the folder ("‹ muxen"), the file's icon, name and size (the exact time on hover), the viewer's controls (Wrap lines for text), then **Copy path**, **Download** and **Insert into terminal ▾** as ghost buttons whose labels drop where the line runs short. The phone's: Back, the name, then Copy path, Download and Insert as icons, and ⋯ for the viewer's controls. Copy path copies the absolute path and confirms in place: the button turns into a green check for 1.6 s ("Copied" on a desktop) with a screen-reader status; a copy chosen from a menu, with no button left on screen, says "Copied <path>" in a notice instead. Download works on any file. In a browser it is the browser's own: a same-origin `<a download>` on `/fs/raw` (`Platform.download`). In the iPhone app, where a web view's download goes nowhere, native fetches the file, with progress and Cancel for a large one, and opens the share sheet (Save to Files, AirDrop, another app) ([ios-shell.md](../ios-shell.md#files-and-sharing)); a failure reads "Couldn't download <name>: <why>" in the notice.
- **The code frame.** Text and code run edge to edge on the sunken surface under the header's rule, in mono at the small text size (13px, 12px on the phone) with a 1.7 line height: each line is numbered in a gutter that stays put while a long line scrolls sideways (one sticky column of numbers, not a sticky number per line, which made a large file slow to scroll; wrapped, each line carries its own number), and the numbers are generated content, so neither a selection nor a copy takes them. **Wrap lines** is a switch (an icon on a desktop, pressed while on; a check in ⋯ on the phone, where it starts on). **Copy text** copies what was read and confirms in place; a file past the first 1 MiB copies only that much, and a notice says "Copied the first 1.0 MB of <name>". The phone shows the language, the line count, the size and the age above the code. Markdown reads at a 72-character measure, centred.
- **A file muxen can't show** (binary, by its type) gets a card: its icon and name, "muxen can't preview this kind of file.", its type, size, time and path, then a big **Download <size>** and **Open as text**.
- Previews: code (14 grammars, plain text for the rest), Markdown (relative links open the file here, web links go to the browser, an address link hands off to the mail app; an allowlist of prose, lists, tables, code, links and images is sanitized with DOMPurify, and no click inside it navigates the page itself), images (zoom and pan), video and audio (inline in the browser; native keeps its own player), and binary files (the card above). Markdown Mermaid diagrams render with a lazily loaded renderer in strict mode, with rendered output sanitized by DOMPurify. Each diagram's place reads “Loading diagram…” until it renders; if it can't, the code block returns with the reason after it.
- Loading and failure never look like an empty list: a spinner with words, or the refusal in plain words with “Try again”.
- Permissions, size limits, and error handling remain governed by [fs.md](../fs.md). Upload/path insertion route is specified below. No delete/move/rename controls are added.

## Persistence and input

- Small view settings are remembered per device, apart from the workspace: Show hidden files, the Files Preview panel's on or off and its divider's width, and the files opened per host (Search's recents). One typed owner, `app/viewMemory.ts`, over `PlatformStorage.view` (the page's localStorage, read synchronously at boot, never sent to native; blocked storage keeps the value for the page's life). A server's Files reads it when that server's Files first opens in a page life, so a toggle made on another server shows there after a reload. A value another build wrote that doesn't parse is the default.
- Navigation between Home, the tab overview and tabs preserves open tabs and process state. Each Files tab retains its own folder or preview, including across reload, locally on that device.
- Home/list refresh runs on entry and on debounced sessionsChanged while visible; there is no polling or network search per keystroke. Fetch when Open session opens, when a long-press menu opens without a listing newer than the last `sessionsChanged`, and on reconnect, and prune tabs only from authoritative listings for the matching host and tmux endpoint. A listing from the same endpoint decides all that endpoint's tabs, including live tabs: matching sessions from the same tmux run remain; a different run at that endpoint closes the old run's tabs. A scratch endpoint is never touched by the main-endpoint listing, and a null listing (no server) decides nothing. One notice reports closures. The hub serializes one-shot requests and answers an overlapping request with `busy`, so a listing cannot straddle a window-creation reply. Explicit user retry handles list errors.
- Restore terminal tabs after reload using validated session identities and Files tabs with their own host and saved folder or preview. An unavailable session must not be silently replaced with a same-named session from another server. A workspace saved before tabs followed sessions (format version 1, window tabs) is discarded whole at boot, and so are drafts keyed by its window tabs: muxen starts at Home with no tabs. Each workspace's last terminal tab is saved too, so Insert path after a reload still goes where it went before, and so is its server's home folder (learned from the listing of `~` that Open files makes anyway), so a Files tab at home reads "~" at once.
- Mockup state is deliberately in-memory. Changing preview-platform selector is a presentation-only reset to Home, not a production control. Full reload returns fictional defaults.
- Touch input follows Phone dock below. Desktop click-to-focus is unchanged.
- Tab display keeps the session name visible and spends what width is left on the current window's name, which truncates first. Full combined name is the tooltip and accessible label. Window rows use the actual tmux window index, not array position; mock indices are illustrative. The server/session identity, not label, owns tab state through renames and window changes.
- Icon-only controls have accessible names/tooltips. Disabled controls must explain why: every disabled button shows its reason beside it, and takes no tap; a button blocked by work in flight is busy instead, its label saying so (“Adding…”) with no second reason; loading/error states must not look like an empty list.

## Phone dock

On touch, Terminal is full-bleed above a dock shared by the browser, PWA and native app.
The tab row (Tab row, above) is the dock's bottom row with the keyboard down, ending with the
keyboard control. With it up, the tab row stays where it is, its keyboard control in the same place
(Show keyboard becomes Hide keyboard), and the compose box and a text-only key row sit under it, on
the keyboard, the same order as Termius (Jimmy, 2026-10-30).
A Files tab or preview reached with the keyboard down shows the tab row with Show keyboard. The terminal pans above the keyboard-up
controls so its last row meets the bottom of the visible area;
if that would put the cursor above the area's top, the cursor row meets the bottom instead.
It never pans past the last row, when every row fits, or while scrolled into history. tmux
is sized with the tab row and keyboard down; showing the keyboard never resizes it.

```text
keyboard down                              keyboard up
terminal, full-bleed       $ █             terminal, panned       $ █
───────────────────────────────            ───────────────────────────────────
‹ (a1 ×) (b1) (notes.md) + [⌨]             ‹ (a1 ×) (b1) (notes.md) +
bottom safe area                           [ Type or dictate a line          ]
                                           esc tab ← ↑ ↓ → ctrl alt | ~ / - ⇧tab ⏎ ^R ^Z ^C … [⌨↓]
                                           iOS keyboard
                                           (Safari's ⌃ ⌄ Done bar sits above it)
```

The keyboard is sticky: only the keyboard control lowers it (Jimmy, 2026-10-30). Scrolling,
tapping the terminal, switching tabs in the tab row, opening the + or long-press menu and a
reconnect all leave it up. Switching to a Files tab with the keyboard up gives it to that tab's
path field, which starts editing (the compose box and key row give way to the field's own
keyboard); switching back to a terminal tab gives typing back to terminal input, keyboard still up
(Jimmy, 2026-10-30: “b is fine”). Going to the tab overview or Home lowers it, since they have no
input.

- **Sizes.** Row items 34 px tall, key-row keys 32 px, with touch areas extended to the
  row's height where they meet. The compose box font is 16 px to avoid Safari zoom.
  Add the bottom safe area only while the keyboard is down, with no blank band between
  the controls and the inset or keyboard.
- **Compose box.** The line field is one logical line, placeholder “Type or dictate a
  line”, wrapping and growing from one to five visual lines, then scrolling inside.
  It remains visible while typing to tmux, idle without a caret; tapping it gives the
  keyboard to the line. It is a textarea in the browser, the PWA and the app alike, with
  autocorrect, capitalization, spell checking and smart punctuation off. Return (the
  key reads "return") or Send sends the
  text then Enter to the active tab's shown window, clears it and keeps focus in the
  box. Empty Return sends Enter. An undelivered line returns with its reason; a
  disconnected tab keeps the draft and says “Not connected”. Each tab's draft survives
  keyboard hide, navigation and reload. Delivery rules:
  [terminal-interaction-design.md](terminal-interaction-design.md#the-dock-line-field-key-row-and-one-keyboard-toggle).
- **Paste.** One line is inserted for editing; text holding a line break goes to the
  terminal as one paste without Enter, with a notice; an image takes the image paste
  route. Clipboard reads capture the tab and window before a system prompt; if the
  target changes, paste falls back to that captured terminal target instead of editing
  the new line. An IME candidate Return remains with the editor.
- **Key row.** A fixed, horizontally scrolling text-only row: esc, tab, ←, ↑, ↓, →,
  ctrl, alt, `|`, `~`, `/`, `-`, ⇧tab, ⏎, then the chords ^R, ^Z, ^C. Keys are plain text with no fill until pressed. The order serves agent CLIs first (esc interrupts, arrows walk menus); no chord sits in the first slots, ^Z is never beside ⏎, and ^C is last (Jimmy, 2026-10-29). ^S and ^Q are not offered: ^S freezes a terminal with flow control on. While the box owns focus, unmodified ← and →
  move its caret and unmodified esc returns focus to the terminal; ↑, ↓, ^R, ^C, tab and other
  terminal controls go to tmux. Distinguish the two destinations visually. In terminal
  mode the controls go to tmux. Arrows repeat while held; ↑, ↓ and ^R use the shell's
  own history. Character keys go where typing goes. ctrl and alt arm the next key,
  shown pressed until used or tapped again; an armed chord goes to tmux. Except for
  esc leaving the box, a key-row tap does not move focus. The row is the same with a
  hardware keyboard attached.
- **Keyboard control.** Show keyboard in the tab row raises terminal input; Hide
  keyboard in the key row lowers either target. The control's state follows focus and
  system dismissal. Tapping the terminal or esc while composing
  returns typing to tmux without lowering the keyboard.
- **Focus cues.** Terminal target: solid terminal cursor; the idle box has no caret and
  shows its draft or placeholder. Line target: box ring and caret, visible Send, hollow
  terminal cursor, and Return labelled Send. There is exactly one active typing cursor.
- **Terminal taps.** A tap on the terminal raises the keyboard: terminal input takes it,
  from the box too, and the key row's toggle lowers it. In an application that asked for mouse
  reporting the tap is a click and raises nothing. With terminal input already holding the
  keyboard, a tap on an OSC 133 input row moves the prompt cursor. With a selection or mark up,
  a tap elsewhere closes it and raises nothing
  ([terminal-interaction-design.md](terminal-interaction-design.md), "One gesture owner").
  The focus is made in the tap's own `touchend`, since iOS raises the keyboard only for a focus
  made in the gesture. Scroll and selection do not toggle the keyboard (it is sticky, above).
- **Safari's form accessory bar.** The phone browser/PWA may put its own ⌃ ⌄ Done bar
  between muxen's key row and the keyboard; the page cannot remove it. Done lowers the
  keyboard and the toggle follows. The app hides the bar (`WebKitAccessoryBar`).

## File upload and path insertion

In a Files tab, upload uses the browser/native file picker into the configured uploads folder. Several files may be picked at once; one uploads at a time and at most four are held, and a fifth is refused with “Wait for the current uploads to finish.” A file over 128 MiB is refused before it is sent. Completion adds a row to the list, with progress while running, then the saved name, **Insert into terminal ▾** and Preview; the screen does not navigate away from the folder. A file's header has the same control, the one Insert everywhere. It opens "Insert path into": this server's terminal tabs, the default first and then the rest in tab order. The default is the tab the upload began in for an upload's offer, else the workspace's last terminal tab (Workspace state); Cmd/Ctrl+I on a file's view sends the path there with no menu (whether Safari lets a page take Cmd+I is unchecked). Choosing a tab inserts a shell-escaped absolute canonical path into it without Enter, then returns to that terminal. It never executes the path.

A tab still restoring from a saved workspace, or one whose connection failed, is listed but disabled, saying why ("Restoring", "Not connected"). With no terminal tab on the server the menu says "Open a terminal tab first"; files still remain accessible. If the target disappears or disconnects, insertion fails visibly without sending into a different tab: the action is disabled while the target is reconnecting, refused for the session limit or closed, and a path still waiting for its watch is dropped with a notice if the watch fails. A tab that is still connecting, or live but not on screen, takes the path and types it when it is watching; the one eligibility rule is the driver's, shared by Files and image paste. A name holding a control character (CR, LF, ESC, ^C) is never inserted, because typed into a pane it would submit or act as a key; the notice sends the user to the terminal. The target tab and the window it shows are captured on click, not selected by matching names; the path goes to that window even if the tab has since followed its session elsewhere, and fails visibly if the window has closed. A tab that has not had its first `watching` yet (still connecting or restoring) has no window to capture, and types the path into the window its first `watching` names. Returning to the Files tab preserves its preview context.

### Paste into a folder

A Files tab showing a folder has **Paste** on its header line: an icon beside Upload on a desktop, an item in ⋯ on the phone. It reads the clipboard inside the tap (the app through `pasteInto`; a browser through the async Clipboard API, where it is allowed) and creates a new file in that folder: an image as a file named like any upload (`YYYYMMDD-HHMMSSZ-xxxx.<ext>`; the app re-encodes HEIC to JPEG as for a photo), text as `pasted-YYYYMMDD-HHMMSSZ.txt` holding exactly the text. On a desktop, Cmd/Ctrl-V does the same with the clipboard the paste event carries, whenever the folder is showing and Files' keys are free (no dialog, such as Settings or the session list, and no menu is open, and no text box has focus: the path field keeps its own paste). The button and the keys are one path, `uploads.paste(handle, dir, signal, pasted?)`: the browser uploads `pasted` or else reads the clipboard; the app ignores `pasted` and reads the pasteboard. A name is never reused: a clash gets `-2`, `-3`. The upload goes to the folder the tab shows, by its canonical path, through the same pipeline, limits and errors as an upload (unwritable folder, `memory_backed`, `too_large`, `busy`), worded by one table for the browser and the app (the app passes the daemon's error code in its `upload` event): a failure is a notice and leaves nothing behind. While it runs a notice says "Pasting…", then "Pasted <name>" (or "Couldn't paste: <reason>"; "Nothing to paste" for an empty clipboard). The listing reloads, and the new row is marked selected and scrolled into view, if it is in the pages loaded (a folder of more than 200 entries may sort it below them). The path is typed nowhere and no Insert path offer is made: Insert path on the file's preview stays the way to use it. The marking goes away on any navigation or refresh.

Browser image paste into a focused terminal follows the same upload pipeline. Capture the exact target tab and the window it shows at paste start, upload supported image bytes into the configured uploads folder, then insert the quoted absolute canonical path into that same window through that tab, without Enter, even if the tab has since followed its session to another window. If the target is gone or disconnected when upload completes, keep the uploaded file available in Files and report the insertion failure; never redirect to a different active tab. Ordinary text paste remains terminal paste. In the app the page cannot upload a `File`: a paste event that carries an image (the line box's or the terminal input's) makes the page read the pasteboard through native instead (`readPasteboard`), the route the mark's Paste uses, so every image paste in the app is one path. Clipboard access depends on a user paste gesture and browser capabilities; unsupported image clipboard access gets an explanation and the Files upload route. This preserves the photo-paste MVP; actual clipboard handling remains a real-browser verification gate, not simulated by this mockup.

## Offline and updates

The service worker serves the shell from its cache. On an offline launch the host card says “Can't reach pop-os” (the name is the last one saved), open tabs read “Reconnecting…”, and the listing shows its offline state. Nothing shows a pretend live terminal and nothing typed is queued. The worker never intercepts `/ws`, `/auth`, `/fs`, `/complete`, `/debug` or a non-GET request.

A new build installs in the background and waits. Home and Files show “Update ready” with Update, never over the terminal; only the window that taps Update reloads. Another window shows “Reload to finish updating” with Reload, and keeps running its own build until then. A window whose build the host no longer has (two builds behind, or one behind when it opens its first diagram, since diagram files are not precached) fails to fetch a lazy chunk and shows the designed “Update required” with Reload, in the same place and never over the terminal.

## Keyboard ownership and navigation history

Desktop terminal focus owns keys only while terminal input is focused. Session search, creation forms, and Files controls own their own input. Overlay handling intercepts Escape only while an overlay is open; otherwise Escape belongs to terminal input. Tab activation, terminal return, and overlay dismissal restore terminal focus on desktop. Focus must not steal input from a focused text field. Only focus that must raise the software keyboard needs to happen synchronously inside the user's gesture. Other focus transitions may wait until navigation or the dialog has rendered; a phone dialog must not focus a text field and unexpectedly raise its keyboard.

Accept browser-reserved shortcuts rather than adding a custom shortcut system or promising interception. Which combinations reach the page must be probed in Jimmy’s browsers before shipping; this contract does not claim an exhaustive reserved-key list. Browser/site navigation must never be intentionally hijacked to mimic a native terminal.

The ordinary on-screen keyboard lacks Esc, Ctrl, Tab and arrows; the dock's key row supplies them in the browser, the PWA and the app alike.

Proposed browser history rule: Home, tab overview and Terminal/Files transitions, folder drill-in, preview, and modal opening create reversible navigation entries; Back closes the top sheet/preview before leaving its parent destination. Opening or switching terminal tabs does not add browser history entries. Back must not kill a tmux session. Real history/swipe behavior remains an implementation gate; the static prototype uses explicit back/close controls only. Native shell follows the same logical hierarchy without browser URL history.

## Review scope and implementation gates

Review the whole proposed interaction system, including usefulness, visual consistency, accessibility, naming, navigation state, missing behavior, and conformance to Jimmy's reference screenshots. Do not mistake mockup code for the proposed production architecture.

This contract changes the original native-only product direction; plan.md and
decisions.md record the current direction. Browser admission and static-shell rules are
specified in [auth.md](../auth.md) and [browser setup](browser-setup.md). The web client
is being implemented in stages, so a mockup or skeleton does not certify production
behavior. Keep the dev proxy's injected owner identity out of production auth, and never
expose the test harness as a released client.

Mockup approval is not production verification. Test real desktop input, phone-browser
keyboard/viewport behavior, and the native app on hardware separately. Coherent reviewed
commits go directly to `main` after the required preflight; there is no PR flow during
the initial build.

## Visual copy rule

Do not use middle-dot separators in app chrome, labels, headings, or descriptive copy. Separate metadata with layout/spacing or write a short phrase. The bell attention dot is distinct from connection status, which uses text for reconnect/error states and accessible labels; its mechanism is in plan.md (Bell attention).

## Text clipboard behavior

Proposed browser copy preserves logical line breaks, not terminal soft-wrap boundaries. Paste preserves multiline clipboard text through the existing paste protocol; it is not converted into a sequence of Enter key events, and plain paste does not append an extra Enter. The daemon already uses load-buffer then paste-buffer -p -d. tmux adds bracketed-paste markers only when the receiving application requests that mode. Without bracketed-paste handling, embedded newlines can execute shell commands; no blanket “paste never executes” guarantee is made. Real browser clipboard/line-wrap behavior must be tested during implementation.

Terminal context uses a bold primary session name, regular window name, and smaller muted host separated with spacing, without literal “on” or dot separators.

## Touch and clipboard research gate

The interaction contract is [terminal-interaction-design.md](terminal-interaction-design.md). On the phone, selection is iOS's own on the terminal's rows, drawn as page text: a long press selects a word with iOS's handles and menu, muxen draws nothing of it, and Copy joins soft wraps into logical lines; a tap elsewhere or a redraw of the selected rows closes it, and a scroll does not (a drag of a handle to the list's edge autoscrolls). In the app, keyboard up or down, the keyboard never drops for a selection: a hold of about 380 ms marks the word under the finger with muxen's highlight, the finger and two handles extend it, and iOS's edit menu shows Copy and Paste over it; a tap elsewhere or output redrawing the marked rows clears it (output never pauses); a scroll hides the menu until a tap inside the mark, and the mark autoscrolls near the list's top and bottom edges. In a browser the hold with the keyboard up does nothing. Elsewhere, Paste on the phone is the line box's. A touch sends no mouse event, in mouse-mode apps too (Jimmy, 2026-10-24). Vertical swipes in alternate-screen apps still send ↑/↓ or wheel events. Copy must preserve logical newlines, not visual wraps. Real iPhone Safari and app selection, keyboard and clipboard checks remain required.
