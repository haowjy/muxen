# web/screens/files: what to know before editing

The user-visible contract is [browser-behaviors.md](../../../../docs/design/client/browser-behaviors.md#files);
the daemon side is [fs.md](../../../../docs/design/fs.md). This file holds mechanism the code can't show.

## Listings and the folder cache

- **One listing per folder, never one per keystroke.** `files/folders.ts` keeps one record per
  host per folder (keyed by path and the hidden flag) holding every page loaded so far, shared by
  browsing, the outline and the path field. Records are bounded by entries held (`MAX_ENTRIES`, each
  folder counting one more); least recently used goes first and a folder on screen is never dropped.
  A cached folder costs no request. A failed listing is asked again when something next names it;
  pull-to-refresh and muxen's own writes drop the affected records.
- **Request pacing.** The cache asks for at most two pages at once and queues the rest; the folder on
  screen, the path field's and a reveal's go ahead of the outline's. The daemon scans one folder at a
  time and refuses past a few waiting, so Show hidden over 30 open folders would otherwise end in
  `busy` and crowd out the file being read.
- **The outline** (desktop): a Files tab keeps at most 32 open folders; opening one makes it and its
  ancestors newest; past 32, the oldest that doesn't show (inside a closed folder, or outside the
  list's root) closes first, else the oldest that shows, never one holding the folder just opened.
  Only open folders whose parents are open are listed and pinned. Open folders (by absolute path),
  the selection and the Preview file are per tab, in the host's Files session
  (`screens/files/session.ts`, 64 of each, least recently set first); a reload forgets them.
  `files/outline.ts` is the pure rules; `FolderList.tsx` wires keys and focus.
- **Keymap.** Every Files shortcut registers in `screens/files/keymap.ts`, one rule for when keys
  are free: no dialog or menu open, no text field focused (unless the shortcut allows it), nothing
  earlier claimed the key; the one registered last wins. A one-character shortcut (`/`, Space) is
  matched by character, not key code, so non-US layouts work.

## Path field and narrowing

- Click or tap makes the line the field with the last folder's name and `/` selected. iOS places the
  caret after focus, so the selection is re-applied on the next frame and once after the tap settles.
  Editing is a history entry (Back ends it before it leaves the folder). Autocorrect, capitalization
  and spellcheck are off and `enterkeyhint="go"` is set. It keeps the ordinary text keyboard: the URL
  keyboard has no space bar and folder names hold spaces.
- Narrowing filters the typed parent's rows by the last segment: the whole name first, then names that
  start with it, then names that contain it, ASCII case folded, each in the daemon's order. Naming
  another folder asks for its first page once, after typing pauses 250 ms, only for the folder the
  field names when it settles. A name starting with `.` asks for the hidden listing.
- **Go** opens the selected row; with none selected it opens the folder the text names. A name that
  matches nothing in a folder held in full says so; in a folder not held in full the host is asked
  once (a probe), and a partial name that matches a loaded row opens that row.
- A folder not held in full says "Matches are from the first N of M entries" with **Load the rest**
  (one request per page); a folder the daemon cut at its scan cap says it is too big and offers
  nothing more.

## Search

Sent after typing pauses 250 ms; a request the field has moved past is aborted and its answer never
shown; the previous rows stay, quieted, until the new answer. A query past 256 bytes is not sent.
Search is kept per tab and folder in the Files session, so Back finds the query, rows and scroll. The
Preview panel follows only rows the user selected, never the one an answer selected, so a query costs
no file read. A reveal (Enter or double-click on a result, or Back from a file opened by path) loads
each folder's pages down to the row, stopping once the pages sort past where the row would be or a
page is refused, and turns Show hidden files on when a folder on the way or the file has a hidden name.
Recents: the 20 most recent files opened from this host (view memory, per host id); a file counts as
opened only when the user opens it, never when the app selects a row.

## Preview panel and full width

The panel follows the selected file once the selection has stayed put 200 ms (a held arrow key makes
no read per row; a viewer's read for a row it left is aborted). It keeps its file per tab and root
through Search, the toggle, another tab or a folder gone into and left, and lets it go only when the
folder is held in full and no longer lists it. With no file it shows the folder's README or a summary
card. Expanding the file, and Back or Escape to it, read no second time: the view leaving hands its
text to the one taking its place, once; nothing else keeps a text. The toggle is one control placed at
the header line's right end over both layouts, so it never moves between on and off. On/off and the
divider width live in view memory (`app/viewMemory.ts`: the page's localStorage, read synchronously at
boot, not Preferences, which cross the iOS bridge, and not the workspace).

## Writes

- New file/folder: one request at a time; a success closes the form at once and the landing goes on
  without it (the entry is still selected when it lands). A name starting with `.` turns Show hidden
  files on. After a refused create the folder is listed again so a create whose answer was lost shows
  its row.
- Delete is permanent and asks first, with focus on Close so Return alone never deletes; once it
  runs it can't be stopped, so Cancel reads Hide. Home and the folders above it offer neither Rename
  nor Delete, and the daemon refuses them and muxen's state folder.
- Paste into a folder and upload share one pipeline (`uploads.paste(handle, dir, pasted?)`): the
  browser uploads `pasted` or reads the clipboard; the app ignores `pasted` and reads the pasteboard
  through native. A name is never reused (`-2`, `-3`).
- Edit keeps unsaved state on the Files session, so a save's answer that lands after the view has gone
  finds its edit by path. The latest changed edit per host is written to view memory only on a
  flush, not per keystroke (up to 1 MiB each).

## Viewers

Code uses 14 grammars and plain text for the rest. Markdown is sanitized with DOMPurify; relative
links open the file here, web links go to the browser, and no click inside it navigates the page.
Mermaid renders with a lazily loaded renderer in strict mode, outside the service worker's precache
and shell budget (about 1 MB on every install for a feature most documents don't use), so diagrams
need the network and a missing chunk raises "Update required". The code frame keeps one sticky gutter
column rather than a sticky number per line (that made large files slow to scroll), and line numbers
are generated content so neither a selection nor a copy takes them. Download in the app is a bridge
request ([ios-shell.md](../../../../docs/design/ios-shell.md#files-and-sharing)); a browser uses
`<a download>` on `/fs/raw`.
