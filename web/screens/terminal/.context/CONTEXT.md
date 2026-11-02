# screens/terminal

The Terminal destination. The design is client-architecture.md §5.4, §5.5, §5.10, §6.1,
§6.4, §6.5, §7.1 to §7.5.

- **`terminals.ts` owns the terminal, not the component.** It is one object per app
  (`terminalsOf(app)`) that holds the renderer's element, every tab's `TabDriver`, tmux's size,
  desktop direct input and paste. `TerminalScreen` only places the element in its slot and draws
  state, so the buffer and each tab's watch survive the screen unmounting (an admission problem
  replaces the shell) or a layout change.
- **Nothing watches before the box is measured, and only the tab on screen watches.** Drivers
  start covered. `sync()` runs on every app change and uncovers the shown tab only when
  ready (a renderer, a cell size and a tmux size) and `lifecycle.covered` is false; otherwise
  every driver stays covered, so tmux never sees the 80x24 placeholder and releases the window
  size beneath a native screen. The reducer and controller never address a driver. The first
  size goes out in that `watch`; later ones go out 150 ms after the last change (`term/size.ts`).
- **The pane keeps tmux's size, whatever the box** (§5.4). The sizer's inputs and the size sent
  stay the tab's own; the snapshot's size is drawn at the tab's font. The driver owns the
  sizing facts: `sentSize` (what the daemon last heard) and `shown.size` (the window's, from the
  last `watching`). `terminals.ts` turns a window larger than the box into the DOM renderer at
  once (`setWebgl(false)`). The band is `onSizedForOther`, raised by the driver's timer once the
  two sizes have differed for max(1 s, RTT + 0.5 s), either direction, restarted by each claiming
  send and stopped while the tab isn't live. It is presentation only: `watch` omits `claim` for the
  user's own acts (`claimNext`: set by `uncover` and by returning from background, cleared once a
  watch binds) and sends `claim: false` otherwise unless `holdsWindow()`, i.e. the last `watching`'s
  size equals `sentSize`. Nothing sends `resize` after a re-watch except a real size change, since
  `resize` claims.
- **The surface hides until a tab's own snapshot has painted** (`data-blank`), so no tab shows
  another's content, and an empty terminal never looks live. Reconnecting keeps the last content.
  `painted` records whose snapshot the surface holds; `showPainted()` blanks it on Terminal
  whenever that is not the active tab, and leaves it alone off Terminal so a return shows the
  last content until the fresh snapshot.
- **Keystrokes are batched for 8 ms.** The daemon answers a burst of separate `input` messages
  with `busy` and, with no `req`, the client never learns: characters were lost under load. The
  batch goes to the tab that was shown when the keys were typed, in order, and before any paste.
- **Input names its window when it starts, never when it finishes.** `Pastes.target()` captures the
  shown tab and its window; the edit menu's Paste takes it before the clipboard read (iOS can hold
  the read behind a prompt) and carries it through text and image upload. A closed target refuses
  with a notice; nothing is redirected to another tab or window.
- **For other lanes.** `Terminals.insertPath(id, path)` and `canInsert(id)` are the one way a
  path reaches a tab (Files, image paste): quoted, no Enter, into that tab only, once it is
  watching. The driver's own state decides (connecting and live accept; reconnecting, limited
  and closed refuse), the result is `typed`, `queued` or `refused`, and a refusal gets one
  notice. A screen that disables the action selects `canInsert` from the `terminalsOf(app)`
  store. P3 reads `term/index.ts`:
  `selectionText` and `mouseMode`, and `Terminals.setVisible`; and `tabs/keymap.ts` (`decideKey(event, "owned")`).
- **Ctrl+Shift+F leaves the terminal** (`decideKey` returns `leave`; the sink focuses the `tabs` target, the active pill's select button). Cmd combinations are the browser's, everywhere, and Ctrl+Shift+C copies everywhere.** Telling
  macOS from the rest needs `navigator`, which only `platform/` may read; no terminal key is lost
  by this (nobody sends Super+key to a shell, and `^C` still is Ctrl+C).
- `e2e/terminal/` runs a real daemon, isolated, on `e2e/shared/stack.ts`: see it for why a front proxy
  answers `/auth/info` and why the daemon runs with `--allow-login`. `pnpm e2e:real` runs it.
- **Touch looking is one object per shown tab: `view.ts`.** `TerminalView` builds the recognizer
  shell (`touchControl.ts`), `pinnedWheel.ts` (a full-screen or mouse-mode app's swipe as wheel events or
  arrows), the selection (`selection/`: the page's, and the mark) and, for desktop's xterm view only,
  `scroll.ts` (the wheel past xterm's top onto the history rows) with `history.ts` (tmux's older rows as DOM,
  chunked with a run of overlap rows that the chunk is searched for, `anchor.ts`). `Terminals` tells it the
  shown tab; a tab change, a snapshot, `visibilitychange` and a lost touch all end in `reset()`, and its
  sends are bound to the tab they began on. Add new per-tab touch state there, never on `Terminals`.
  "Shown" is one rule: selected and not covered by a native screen (`shownTerminalTab`); the view resets when
  it changes. Mouse input comes from `term/mouse.ts` (`mouseInput` holds the per-mode policy) with the
  encoding `term/xterm.ts` saw in DECSET.
- **One view on touch, keyed on `directInput`.** Every input but desktop's `"xterm"` (the app's `"native"`,
  phone Safari and the PWA's `"owned"`) draws with the row list (`rowList.ts`): one native scroller of rows
  muxen draws from the model's frames (`term/model.ts`), the lines that left the screen plus the screen as the
  newest rows. The browser scrolls it, coasts it and autoscrolls a selection; muxen writes `scrollTop` only to
  follow output at latest (`follow`), from `editAbove` and from the mark's edge autoscroll. A row is created
  once and redrawn only when its text changes, so a selection sits on rows that stay put; the rows it rewrites
  are reported (`onRewritten`) and the view closes a selection or mark between them (J7). Colours are the global
  `--term-*` variables, which follow the scheme. The host is selectable (`Terminal.module.css`, off for
  `data-direct-input="xterm"`), the long press is WebKit's and the selection is the page's
  (`selection/pageSelection.ts` reads, joins and clears it). `touchControl.ts` listens to touch events only:
  `touchstart` is never cancelled, `touchmove` only for the mark and a pinned terminal's swipe
  (`pinnedWheel.ts`: wheel events or arrows), `touchend` is for a tap, a touch on a live selection or on the
  mark's handles is not the recognizer's, a tap elsewhere only clears it, and mouse events stop at the host for
  800 ms after a touch. Nothing on or above the host may set `user-select: none`, `touch-action: none` (the
  pinned list excepted) or `-webkit-touch-callout: none`, or cancel `touchstart`: the long press would never
  begin. The one exception is the keyboard-up mark (`data-marking` on the host, set from `TerminalView.markable`, the same check that starts the mark: `Mark.available` and a
  keyboard owner hold): there the host is `user-select: none` and `-webkit-touch-callout: none`, so WebKit's
  own long press cannot start after muxen's 380 ms hold and `touchcancel` the mark; `Mark.caretAt` makes the
  rows selectable for each lookup because `caretRangeFromPoint` finds nothing in `none` text. A tap never moves focus, except native input's older rule (`tapAction`'s `raises`). The list fetches
  tmux's older rows through `historyFetcher.ts`, the procedure `history.ts` also runs: when the view is
  within four screens of its oldest row (its scroll events, or a swipe beginning, since a list shorter than its
  box never scrolls), and only below the 10,000-row cap, while not pinned, with no chunk waiting to land
  (`pending`: the one chunk a bounce defers; trims never wait, they retry next frame) and no gap row (`historyDone`: after a gap nobody knows how far
  tmux's numbering is). A chunk lands only if the oldest row is still the one it was anchored to; two misses in
  a row stop fetching until the next reset. Prepends go through `editAbove`. Desktop (`"xterm"`) keeps xterm's
  view, `scroll.ts` and `history.ts` until phase 6 of the touch-rows work; a finger does not scroll there. The
  list is created the first time a non-xterm input is shown and hidden while xterm shows (an iPad's trackpad);
  it keeps pulling frames while hidden.
- **Nothing redraws a still screen on touch.** A redraw replaces a row's text and a selection on it. The list
  rewrites only the rows whose text differs, and the cursor is a pseudo-element of its own row (`data-caret`; no overlay keeps a position that an edit above could leave stale) whose look is CSS on
  `data-cursor`, and its colours are CSS variables, so a theme change redraws no row. A resize, font change, snapshot or input switch closes a selection first.
- **Rows are runs.** `term/rows.ts` `Row`: every row comes from xterm (`term/lines.ts`; history is
  decoded by `term/decode.ts`); a wide character is a run of its own (`wide`), which the view draws two cells
  wide. The prompt-row tap counts characters (`touch/selection.ts` `charsAcross`), never `String.length`.
- **The grid is the contract.** Rows are one cell tall; copy joins rows at wrap flags, never by length.
  On desktop the history rows and the canvas both follow `renderer.cellSize()`; the list sizes from its own cell.
- **xterm's terminal may be slid and panned (desktop).** `renderer.shift` (history slide, `translate`) and the
  pan for a pane larger than the box (`transform`) both move the screen. Nothing converts a client point to a
  cell on desktop: the mouse is xterm's, and the wheel past the top is `scroll.ts`.
