# File API: listing, search, raw reads, uploads, saves

`src/fs/` serves the phone's file manager: directory listings, file bytes with Range for the viewers and
the native video player, uploads, and the text editor's save. It reads and, for an upload that names a
folder, writes any path the daemon's user can: there is no scope. A device token already runs any
command in tmux as Jimmy, so a boundary here would guard against nothing but Jimmy. Every path the file
API touches passes through one function, `fs::open`, which canonicalizes the path and returns an open
descriptor with the path it was really opened at; no route opens a client's path any other way.

The product side is [plan.md](plan.md#file-manager) and
[browser-behaviors.md](client/browser-behaviors.md#files); the scheme handler and native player that carry
these routes are [ios-shell.md](ios-shell.md#where-the-web-ui-comes-from); auth is [auth.md](auth.md).
Mechanism (the search walk and matcher, raw streaming, upload and save steps, config writes) is in
[src/fs/.context/CONTEXT.md](../../src/fs/.context/CONTEXT.md); the constants are in `src/fs/` and
`src/http/fs.rs`.

## Constants

The ones a client or the user can see:

| Constant | Value | When hit |
|---|---|---|
| listing page | 200 entries | the client asks for the next `offset` |
| directory scan | 5,000 entries read or 1 MiB of names, every entry read counted | `truncated: true`; the rest isn't listed |
| search walk | 100,000 entries read or 500 ms; queue 1 MiB of relative paths | `stopped` says which (`entries`, `time`, `queue`); the matches so far are answered |
| search matches, query | best 50; query 1 to 256 bytes | `400 bad_request` for a bad query |
| slots | scan 1, search 1, delete 1, raw 2, upload 1, save 1 | `503 busy` (the fs lane queues up to 8 waiters, then `busy` at once; `Retry-After: 1`) |
| upload size | 128 MiB | `413 too_large`; the partial file is deleted |
| save size | 1 MiB | `413 too_large` |
| body idle timeout, raw stall | 30 s | an upload or save aborts with `400`; a raw response is aborted and its slot freed |
| path in a request | 4,096 bytes, UTF-8, absolute or `~`-prefixed, no NUL | `400 bad_request` |

## The uploads folder

An upload that names no folder goes to `uploads_dir` in `config.toml` (default `~/.muxen-uploads`):
absolute, `~`, or starting with `~/`. A missing path is created by the next upload; one that is none of
those makes every upload answer `409 not_a_directory`. An upload may instead name a folder (`dir`): Files'
Paste writes into the folder it shows. Those folders are any path the daemon's user can write, which adds
writes to the reads that already had no scope; the single-device-token argument covers it. `uploads_dir` is
edited by hand or from Settings ([Server settings](#server-settings)).

**`config.toml` is read once, at startup, and again only on a reload**, as nginx and sshd do. The daemon
holds the live keys (`uploads_dir`, `search_skip`) in memory; uploads and search read that copy, never the
file. A **reload** is SIGHUP (`systemctl --user reload muxen`, the unit's `ExecReload`) or Settings' **Reload
config.toml** (`POST /settings/reload`). SIGHUP reloads only when the daemon's stdin was not a terminal at
start: a foreground run in a terminal keeps SIGHUP's default, because a reload would leave a closed
terminal's daemon orphaned holding the runtime lock. A reload reads and parses the whole file first: if it
doesn't parse, nothing changes, the error is logged at `warn` and answered (`503 config_unavailable` with
line and column in `detail`). If it parses, the live keys take the new values at once, and a restart-only
key that differs (`name`, `memory_budget_mib`, `[tmux]`, `[complete]`) is logged and listed in
`restartNeeded` on every Settings answer until the daemon restarts. A Settings save writes the file and
updates the copy in memory, so it needs no reload; a hand edit does nothing until a reload, and Settings
shows "config.toml has changed since it was loaded" with the Reload button when the file differs from the
one last loaded or written. Listing and raw reads don't use the config.

## Path resolution: `fs::open`

`open(path, home, want: Dir | File)` returns the descriptor, the canonical path and its metadata. It
checks the shape (absolute, `~` or `~/…`, at most 4,096 bytes, no NUL), resolves with `realpath` (every
symlink and `..` against the real tree, as the terminal follows them), refuses any kind but a regular file
or directory without opening a device (`not_a_file` / `not_a_directory`), opens with `O_NOFOLLOW |
O_NONBLOCK`, and reads the descriptor's real path back, so a component swapped for a symlink in between is
reported where the file actually is. Callers get the descriptor and never reopen by path. The client learns
the canonical home from a listing of `~`. `newWindow` and `newSession` `dir` use the lighter `fs::check_dir`
(shape plus `stat` finds a directory) and pass the path to tmux as given; a refusal is `error { req, code:
badRequest, message }`.

## Routes

Every route sits behind both auth layers ([auth.md](auth.md#endpoints)). A path rides in the URL path, not
the query (`/fs/raw/home/jimmy/repo/clip.mov`): the client percent-encodes each segment and the daemon
prepends `/`; `~` and `~/…` ride bare (`/fs/list/~`); `/fs/list/` lists `/`. So the native player sees the
file's extension and the Markdown viewer resolves a relative `![](img.png)` against the document's own raw
URL. A path that doesn't decode, or a bad query value (a flag such as `hidden` or `text` is `0` or `1`), is
`400 bad_request`.

### `GET /fs/list/{*path}`

Query: `offset` (default 0), `hidden=0|1` (default 0). Lists any directory, `/` included: directories
first, then by name with ASCII case folded, ties by bytes; dotfiles left out unless `hidden=1` (a hidden
directory opened by path lists normally). Past the scan cap the response says `truncated`: the directory
is too big for the phone and the terminal is the tool for it.

```text
Listing = { path: string,            // canonical
            parent: string | null,   // null only at "/"
            total: u32, offset: u32, truncated: bool,
            entries: [Entry] }
Entry   = { name: string,
            kind: "dir" | "file" | "other" | "broken",  // after following a link
            link: bool,              // the entry itself is a symlink
            size?: u64, mtime?: i64, // unix seconds; mtime absent for "broken"
            mime?: string,           // files: the type /fs/raw would send
            utf8?: false }           // present only for a non-UTF-8 name
```

Paging is by offset over a fresh scan; the daemon keeps no cursor, so a changing directory can repeat or
skip an entry, and pull-to-refresh starts over. Symlinks show their target's kind, size and mtime and are
marked `link`. Non-UTF-8 names list with U+FFFD and `utf8: false`; the web shows them greyed and not
openable, since their path can't be sent back.

### `GET /fs/search/{*path}`

Query: `q` (required, 1 to 256 bytes, not only spaces), `hidden=0|1`. The files and folders below a
folder whose path, relative to it, matches `q`: one **breadth-first walk** streams every entry through the
matcher and keeps the best 50; nothing is kept between requests. The client sends the query once typing
pauses 250 ms and aborts a request it no longer needs.

- **What it never enters:** symlinked directories (matched, never entered, so no cycles), anything off the
  root's filesystem (no `/proc`, network mounts or other disks), names starting with `.` unless `hidden=1`,
  directories matching a `search_skip` pattern (default `node_modules`), and directories tagged as caches
  under the [Cache Directory Tagging spec](https://bford.info/cachedir/) (cargo's `target/`, pip's and
  ccache's caches). A skipped directory is listed, not entered: Search can still find `node_modules` or
  `target`, and a tap goes into it, where, as the root, nothing is skipped. Errors below the root skip that
  directory; only a root error fails the request.
- **Caps:** 100,000 entries or 500 ms, whichever first, and a 1 MiB queue; the answer carries what matched
  and `stopped` names the cap. Breadth first means a capped walk has covered everything down to some depth.
- **Matching:** `q` containing `*` or `?` is a glob (Jimmy: "glob when `*`/`?` typed"): `*` within a segment,
  `?` one scalar, `**` across segments, anchored, a pattern without `/` against the last segment; globs rank
  by depth. Anything else is fuzzy: space-separated terms, each a subsequence of the path, scored fzf-style
  (bonuses at segment and word starts, adjacency and the last segment; nearer files rank first). Smart case:
  ASCII letters fold only while `q` has no uppercase. Names aren't Unicode-normalised.

```text
Search  = { path: string,                    // canonical root
            matches: [Match],                // best first, at most 50
            read: u32,                       // entries read
            stopped: "entries" | "time" | "queue" | null }   // null: the walk covered everything
Match   = Entry & { path: string,            // relative to the root, "/"-separated
                    hits: [[u16, u16]] }     // [start, end) runs of matched text, in UTF-16 code units
```

`Match` carries a listing's `Entry` fields so the client opens a result as it opens a row. The client draws
`hits` and never matches again, so the matcher lives in one place. An answer is a few KiB: a search costs
the host's walk (60 to 140 ms of one core for 67,000 to 100,000 entries, warm), not the network.

### `GET /fs/raw/{*path}`

The file's bytes, any file (a directory, FIFO, socket or device is `409 not_a_file`), with a raw slot. Headers:
`Content-Type` from the extension allowlist below, a strong `ETag` (`"<ino>-<size>-<mtime_ns>"` hex),
`Accept-Ranges: bytes`, `Cache-Control: no-store`, `Cross-Origin-Resource-Policy: same-origin`,
`X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`. The daemon sets these itself because
the native player fetches without the scheme handler; `sandbox` and non-executable types keep repository
content from running as muxen or registering as its service worker; the daemon sends no CORS headers (the web
reads `Content-Range` and `ETag` directly because the shell and raw responses share one origin).

- **Range:** one range only (`bytes=a-b`, `a-`, `-n`) → `206` with `Content-Range`; a list or unparsable header
  → `200` whole; a start at or past the end → `416 bad_range` with `Content-Range: bytes */<size>`; an end past
  the end is clamped. `If-Range` that isn't the ETag ignores the range. No `304`: nothing on the phone caches
  these. A file that shrinks under the stream aborts the response rather than cutting it short.
- **Previews:** the code and Markdown viewers read at most the first 1 MiB with Range and say the file is
  truncated; the binary viewer offers "open as text" the same way. The web loads images through a queue of 2,
  so a document with many images never meets `busy`.
- **Content types** are one allowlist (`src/fs/mime.rs`) by lowercased extension, plus a few whole names
  (`Makefile`, `Dockerfile`, `LICENSE`, `README`), and **it sends nothing a browser runs**: images (`png`,
  `jpeg`, `gif`, `webp`, `heic`, `heif`, `avif`, `bmp`, `x-icon`, `svg+xml` for `<img>`, which runs no script),
  `video/mp4`, `video/quicktime`, audio, `text/markdown`, `application/pdf`, and `text/plain` for every source,
  config, data and markup extension, **`html`, `htm`, `xhtml`, `js`, `mjs`, `css` and `xml` included**;
  anything else is `application/octet-stream`. The web picks a code viewer's language by extension, not type.
  `.m3u8` stays out ([ios-shell.md](ios-shell.md#where-the-web-ui-comes-from)).
- **Video** plays in `AVPlayerViewController` via a resource loader that adds the Bearer token; AVFoundation
  probes with `Range: bytes=0-1`, then reads ranges, and needs the `206`s, an exact type and a stable ETag.

### `POST /fs/create`

JSON `{ "dir", "name", "kind": "file" | "dir" }`, at most 16 KiB: an empty file or a new folder, never
replacing anything. `dir` opens through `fs::open(…, Dir)` (no tmpfs check, since an empty file charges
nothing); `name` is one plain name (not empty, not `.` or `..`, no `/` or NUL, and the result at most 4,096
bytes) or `400 bad_request`. `EEXIST` is `409 exists`, whatever holds the name, a dangling link included; a
folder deleted under its descriptor is `404 not_found`. `204`.

### `POST /fs/rename`

JSON `{ "dir", "name", "to" }`, at most 16 KiB: a new name in the same folder (moving to another folder is the
terminal's). Never replaces anything (`409 exists`); there is no fallback on a filesystem without a no-replace
rename (`500 internal`). A link is renamed, not what it points to. A missing `name` is `404 not_found`. `204`.

### `POST /fs/delete`

JSON `{ "dir", "name" }`, at most 16 KiB: `name` deleted for good, with no trash. A link is removed, never
followed; a folder goes with all it holds, never crossing a mount (a bind mount included where `openat2`
exists: `403 denied`) and stopping 64 levels down (`403 denied`). Any failure stops the delete and what was
removed stays gone; the client lists the folder again and says some of it may be gone. It runs to its end even
if the request goes away. Only the name asked for being absent is `404 not_found`, which the client takes as
done. Neither delete nor rename touches home, muxen's state directory or a folder above either: `403 denied`,
compared by device and inode so a path through a link meets it too. `204`.

### `POST /fs/upload`

`POST /fs/upload?name=<the client's file name>[&dir=<folder>][&text=1]`; the body is the file's bytes, not
multipart or JSON. `dir` is `~`, `~/…` or an absolute path to an existing folder (a missing one is
`404 not_found`, a file `409 not_a_directory`, a relative path `400 bad_request`); absent, the folder is
`uploads_dir`. `text=1` says the body is pasted text: the file is `pasted-YYYYMMDD-HHMMSSZ.txt` and `name` is
ignored. Otherwise the file is `YYYYMMDD-HHMMSSZ-xxxx.<ext>`: nothing of `name` but its extension (1 to 8 ASCII
alphanumerics, else `bin`) is used, so it can't carry a path, shell metacharacter or hidden name into the
folder or the path typed into the terminal. The body streams to a 0600 part file renamed into place without
replacing, so an agent never sees a half-written photo at the final name. One upload at a time (a second gets
`503 busy` at once). On Linux a destination on tmpfs or ramfs is `409 memory_backed` (its pages would stay
charged to the unit); a folder the user can't write is `403 denied`, and nothing is created. Over 128 MiB is
`413 too_large`, deleting the part file; a body that stalls 30 s or breaks answers `400 bad_request` and
deletes it. A crash leaves at most one part file, recorded in `upload-part` and deleted at the next start or
upload. Answer `201 { path, size }`, `path` the absolute canonical path, which the client inserts, quoted, into
the tab ([ios-shell.md](ios-shell.md#files-and-sharing)).

### `PUT /fs/file/{*path}`

The text editor's save: the body (at most 1 MiB) becomes the file's new bytes if the file is still the version
the client read. `If-Match` is required: the strong `ETag` from `GET /fs/raw`, or `*` to overwrite whatever
is there; a missing header, a list or a weak tag is `400 bad_request`. Answers `204` with the new `ETag`, so
the client needs no re-read. The file must exist (`404`; a save never creates); a link saves to its target and
stays a link; a folder, FIFO, socket or device is `409 not_a_file`. **Refused with `403 denied`, writing
nothing,** a file with another hard link, owned by another user or not writable (swapping a new file in would
change something the user didn't ask for; those are edited in the terminal), and a file named `.muxen-save`.
The new file keeps the old permissions without setuid, setgid or sticky. A stale `If-Match` is `412 changed`
unless the file already equals the body (a save whose answer was lost must not read as a conflict). The save
replaces by temp file and rename, so a reader sees the old file or the new one, and has its own slot, taken
before the body is read, so a slow upload never makes a save `busy`.

## Server settings

`GET /settings` and `POST /settings` read and write the keys of `config.toml` that apply without a restart, so
Settings can show and change them per server (behind both auth layers; the code is `src/config/`).

```text
ServerSettings = { searchSkip: [string] | null,   // null: no key, the default applies
                   fileChanged: bool,             // the file differs from what is running
                   restartNeeded: [string],       // restart-only keys the loaded file changed
                   uploadsDir: string | null,
                   defaults: { searchSkip: [string], uploadsDir: string } }   // the daemon's own
SettingsChange = { searchSkip?: [string] | null, uploadsDir?: string | null }
```

- **Values are the running config's**, not the file's. Keys: `search_skip` and `uploads_dir`; absent means the
  default (`["node_modules"]`, `"~/.muxen-uploads"`), and `defaults` carries them so the client keeps no copy.
  `searchSkip: []` is a set key that skips nothing; `null` is no key.
- **`POST`** takes a `SettingsChange`: a field left out is unchanged, `null` removes the key, a value sets it;
  an unknown or mistyped field is axum's 422. It answers the resulting `ServerSettings`. Validation: at most 64
  patterns of 1–255 bytes of UTF-8 with no `/` or NUL and not only `*`; duplicates dropped, order kept;
  `uploadsDir` absolute, `~` or `~/…`, at most 4,096 bytes; else `400 bad_request` and nothing is written.
- **Writing** edits only those two keys with `toml_edit`, keeping comments, order and every other key (so an
  older daemon reads a newer config), follows a symlinked `config.toml`, refuses a dangling link or unwritable
  target (`409 config_read_only`) and never writes a file that doesn't parse (`503 config_unavailable`). A
  save on a file changed by hand since load reloads it first, so it never overwrites a hand edit. Two devices
  saving at once can lose one change (the last write wins; accepted: one user, rare, visible).
- **`POST /settings/reload`** reloads as SIGHUP does and answers the resulting `ServerSettings`, or `503
  config_unavailable` with the parse error and the running config unchanged. `restartNeeded` travels with the
  running config, so GET, a save and a reload all carry it.

## Errors

JSON `{"error": "<code>"}`, from the shared `HttpError` type ([auth.md](auth.md#endpoints)). The auth
middleware also uses it for `forbidden`, `auth_required`, `auth_unavailable`, `bad_origin`, `node_refused`,
`not_enrolled` and `identity_unavailable`; axum JSON rejections use `bad_request` or `too_large` with axum's
status (400, 413, 415, 422).

| Status | `error` | Cause |
|---|---|---|
| 400 | `bad_request` | a save without a usable `If-Match`; a path that is relative, too long, has a NUL, doesn't decode, or canonicalizes to non-UTF-8; a bad query value; an upload's or save's body that stalled or broke |
| 403 | `denied` | `EACCES` or `EPERM`; a read-only or unwritable folder for an upload or create; a save of a file with another hard link, another owner, no write permission or named `.muxen-save`; a delete or rename of home, the state folder or a folder above; a delete stopped at a mount or past 64 levels |
| 404 | `not_found` | `ENOENT`, `ENOTDIR` while resolving, `ELOOP` at open |
| 409 | `exists` | a create or rename found the name taken |
| 409 | `not_a_directory`, `not_a_file` | the wrong kind for the route; a FIFO, socket or device is `not_a_file`; an upload when `uploads_dir` or `dir` isn't a directory |
| 409 | `memory_backed` | on Linux, an upload destination on tmpfs or ramfs |
| 409 | `config_read_only` | `config.toml`, or a directory on its way, is a dangling link or can't be written |
| 412 | `changed` | a save's `If-Match` no longer names the file (and it isn't already the body) |
| 413 | `too_large` | an upload over 128 MiB or a save over 1 MiB |
| 416 | `bad_range` | a range starting past the end |
| 503 | `busy` | no slot within the wait, too many waiting, or the upload slot taken; `Retry-After: 1` |
| 503 | `config_unavailable` | `/settings`: `config.toml` exists but can't be read or parsed; `detail` says where |
| 507 | `no_space` | `ENOSPC` or `EDQUOT` during an upload or a Settings save |
| 500 | `internal` | any other I/O error, including a rename on a filesystem with no no-replace support; the cause is logged, never sent |

## Limits and the memory ceiling

File I/O runs on the four-thread fs lane in the 8-thread blocking pool ([plan.md](plan.md#resource-budget)),
so a slow disk can stall the file manager but can't consume auth's two threads. Nothing is held between
requests: no listing cache, no search index, no cursor, no open descriptor. **Shutdown must not wait on a
stream:** `http::serve` aborts connection tasks after a 2 s grace, and `main` calls `HubHandle::stop` itself
([hub context](../../src/hub/.context/CONTEXT.md)), so a SIGTERM with a paused raw stream ends in 2.0 s with
exit 0.

| Item | Bound | MB |
|---|---|---|
| directory scan | 1 × (1 MiB of names + 5,000 × 32 B) | 1.2 |
| search walk | 1 × (1 MiB queue + one `getdents` buffer + 50 matches × 4 KiB) | 1.3 |
| raw responses | 2 × (64 KiB chunk + channel + 16 KiB hyper write buffer) | 1.0 |
| upload | 1 × (16 KiB hyper read buffer + 64 KiB chunk + 1 MiB of dirty pages between flushes) | 1.2 |
| save | 1 × (16 KiB hyper read buffer + the body, at most 1 MiB) | 1.0 |
| listing JSON | one page, 200 entries | 0.1 |
| **file API, excluding raw responses** | | **4.8** |

Raw responses and kernel socket buffers have separate rows in the daemon's ceiling
([daemon-core.md](daemon-core.md#the-ceiling)). Clean page cache is reclaimable and doesn't count toward
the unreclaimable ceiling; the unit sets no `MemoryHigh`, since a lower soft limit would stall allocation; the
`DONTNEED` calls keep the file API's share small. An upload's dirty pages can't be reclaimed until written,
which is why they have a row and why the flush interval is 1 MiB, not more.

## Logging

Writes at `info` by action and canonical path (an upload's final path and size, a create's path, a save's path
and size); refusals (`denied`) at `warn` with the path asked for; reads (listings, raw ranges, a search's root,
entries read and `stopped`, never `q`) at `debug` only, since one video is dozens of requests. Never file
contents, upload bytes, the client's upload `name` beyond its extension, or `config.toml`'s text (a parse error
logs the line and column).

## Open risks

- **`sandbox` and CORS on custom-scheme responses** are unverified on iOS 26
  ([ios-shell.md](ios-shell.md#open-risks)). The type allowlist holds without them.
- **The memory ceiling sits near the unit's limit** once the file API and kernel socket buffers are counted
  ([daemon-core.md](daemon-core.md#limits-and-the-memory-budget)). The budget run must read the unit's
  `memory.peak`, which counts kernel buffers and page cache, not the daemon's RSS.
- **Unit-tested only on macOS.** The fs tests pass on the Mac (APFS): the `F_GETPATH` descriptor-path lookup,
  the `RENAME_EXCL` no-replace rename and search's `O_NOFOLLOW_ANY` walk. None has served a phone from a Mac
  LaunchAgent yet, and CI builds macOS only at release, so rerun the fs tests on the Mac after changing them.
- **How many concurrent ranges AVFoundation opens** per video decides whether 2 raw slots are enough; the
  device check records it.

## Why these choices

- **One resolution function that returns a checked descriptor**, so the check-then-open race closes for one
  syscall and a later route isn't tempted to reopen by path. `O_NONBLOCK` keeps a FIFO in a repo from pinning
  a blocking thread. `openat2(RESOLVE_BENEATH)` is Linux only and refuses absolute symlinks that stay inside
  the root; `RESOLVE_IN_ROOT` resolves an absolute link to the wrong file.
- **No scope** (Jimmy: "u already have terminal access... why tf are we restricting this?"): a device token
  already runs any command in tmux. `dir` on `newWindow` and `newSession` is checked for shape only and
  passed to tmux as given, so a symlinked `~/code` keeps showing as `~/code`.
- **`config.toml` is read at startup and on a reload**, and a reload that doesn't parse changes nothing and
  says why. Re-reading per request would either hide an error behind a last-good fallback or fail closed on a
  typo and stop uploads. `auth.toml` keeps its per-check read because enrolment on another device must apply
  at once. Restart-only keys stay hand edits because a wrong tmux socket set from the phone would cut off the
  screen that fixes it.
- **Config writes** use `toml_edit` so Jimmy's comments and keys a newer daemon wrote survive (serializing
  with serde drops them), follow a symlink so a dotfiles link stays intact, re-stat before the rename to catch
  most editor saves, and refuse a dangling link rather than create files wherever it points. The daemon is
  `config.toml`'s only writer, so the save runs under the running config's own lock.
- **Listings** re-read the directory for each page and keep nothing, because sorting needs the whole
  directory and holding it between pages is state for a viewer nobody may return to. Only symlinks and
  `DT_UNKNOWN` entries are `stat`ed, and hidden names are filtered on the server so pages stay full.
- **Search walks per settled query and sends the best 50.** Measured on pop-os (warm): `~` is 4.4 million
  entries, 4.7 s to walk and 59 MB gzipped as a path list; a large repo (67,000 entries) is 70 ms and 400 KB
  gzipped. A client-side index costs hundreds of KB to MB per folder on a spotty link and can't cover `~`; a
  daemon-side index holds memory on a busy host and needs a staleness rule; a per-query walk costs a bounded
  burst and a few KiB on the wire. It skips dot names, cache-tagged directories (cargo writes one in
  `target/`; pop-os has 192 under `~`) and `search_skip` (default `node_modules`, which writes no tag); a
  folder merely named `target` stays searchable. Honouring `.gitignore` would add the `ignore` crate for what
  two defaults and a tag cover.
- **Content types are an extension allowlist** that never sends HTML, JavaScript, CSS or XML as anything but
  `text/plain`. `nosniff` makes the declared type the only type, and `mime_guess`'s table includes
  `text/html` while sniffing reads every file's first bytes on a busy disk.
- **Raw** honours single ranges only (the viewers and AVFoundation send nothing else) with an ETag from
  `stat`. A send that waits 30 s aborts the response: without it a paused player holds its slot, and the
  daemon's shutdown, forever, because hyper stops polling a body whose socket is full. Pages are dropped with
  `DONTNEED` from the response start for files over 8 MiB: with `MemoryHigh=48M`, dropping each 64 KiB chunk
  kept large readahead folios resident (a 1 GiB download left 44.6 MB cached), while dropping from the start
  kept the cache at or below 260 KB.
- **Uploads** stream a raw body (no multipart parser, no base64's +33%) to a part file renamed without
  replacing. The name uses UTC because local time needs a time-zone crate. A flush every 1 MiB bounds the
  dirty pages charged to the unit (an 8 MiB interval held up to 8.2 MB dirty in a measured 120 MiB upload).
  One upload runs at a time because each costs a hyper read buffer. The daemon records the live part file's
  path so cleanup needs no folder scan: sweeping the upload's own folder left stale files in folders never
  uploaded to again and could fail an upload on an entry it couldn't unlink.
- **A save replaces the file by temp file and rename**: writing in place keeps the inode but a crash or full
  disk mid-write leaves a torn file. Refusing a file with another hard link, another owner or no write
  permission avoids a swap that leaves the other link with old text or changes the owner. One fixed
  `.muxen-save` temp name per folder means a leftover is removed by the next save there, where `{name}.tmp`
  would delete a user's `notes.txt.tmp`.
- **Delete is permanent** after a confirmation and a folder goes with all it holds. It refuses home, the
  state folder and every folder above them by device and inode, because a check in the menu alone missed a
  path through a link. Moving to the system trash needs a copy across disks and per-OS layouts.
- **Create takes `{ dir, name }`**, so there is no path to split.
