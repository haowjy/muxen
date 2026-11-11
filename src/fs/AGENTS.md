# fs

The file API's core ([fs.md](../../docs/design/fs.md)): plain functions over files
re-read per request; no cache, no cursor, no descriptor kept between requests. It knows
nothing of axum: `http/fs.rs` parses requests, takes slots and builds responses.

Rules the code relies on, which are easy to break:

- A client's path reaches the disk only through `open`, which returns a descriptor and
  its real path. There is no scope: any path the daemon's user can read opens, as in the
  terminal. Read and write through that descriptor (`pread`, `statat`, `openat`,
  `renameat`), never by joining a path and opening it again. Path completion
  (`src/complete/`) opens through it too; `check_shape` is also `/complete`'s `cwd` check.
- Every blocking call runs on the fs lane (`Slots::lane`, `src/blocking.rs`), which moves
  the thread's permit into the closure; the scan, search and raw slots wait in that
  lane's queue. Work under a slot goes through `Slot::run`, which moves the permit into
  the lane work too, so a request dropped mid-call frees nothing until its work ends.
  Never hold a permit in the handler around `lane.try_run`. Only the raw producer and a
  save hold a permit themselves (`Slot::acquire`). tokio's `fs` feature is off
  (`tokio::fs::File`'s buffer grows to 2 MiB). Take an fs thread last and release it
  before waiting for any other slot.
- A save (`PUT /fs/file`) takes its slot *before* reading the body, then moves the
  permit into the one lane call that resolves and writes (`save::save`): the slot bounds
  the 1 MiB buffer and the one temp name per folder. It refuses, writing nothing, a file
  with another hard link, owned by another user, or not writable, since the rename would
  change what the user didn't ask for. Never write the file in place.
- Search opens each directory below its root only through `search::Below`, and a delete
  each folder below the one named; both go through `open::Beneath` (`openat2` with
  `RESOLVE_BENEATH | NO_SYMLINKS | NO_XDEV` on Linux, `O_NOFOLLOW_ANY` and a device check
  on macOS). The walk runs under `Slots::search`, so an aborted search can't overlap the
  next. A skipped folder (a `search_skip` pattern, a cache tag) is offered to the matcher
  and never queued; the root is never skipped. The matcher lives only here: the client
  draws `hits` and never matches.
- An upload's `dir` opens through `open` like a read; without it, uploads land in the
  running config's `uploads_dir` (`App::config`, `src/config/live.rs`). Nothing here
  reads `config.toml`: it is read at startup and on a reload only. Linux uploads reject
  tmpfs/ramfs with `memory_backed` from the opened destination descriptor, before the
  part file exists.
- The in-flight part file is recorded in `upload-part` (state dir); `upload::reap`
  deletes the file it named on the fs lane, unawaited, at startup and before each
  upload, never failing either. User folders are touched only from lane work, never
  inline or under the slot, and no folder is scanned. That is safe only because the
  upload slot lives in `Part` until its cleanup has cleared the record, and the runtime
  lock keeps a second daemon out.
- Every file written whole goes through `files::Temp` (`src/files.rs`). `Temp::create`
  unlinks a leftover of its name, so the temp name of a replacing write (`files::Target`)
  must be one nothing of the user's can have: a save refuses a file named `.muxen-save`.
  `Temp` isn't deleted on drop, since a drop may happen on the runtime thread: a part
  file is discarded on the fs lane, and every "has this file changed" check is a
  `files::Stamp`. The exception is a paste file (`write_private`, `src/http/ws.rs`): a
  new 0600 file, removed if its write fails.
- `DONTNEED` must cover whole folios: the raw producer drops from the response's first
  byte to the current position, and the upload drops the whole file after each
  `fdatasync`. A chunk-sized drop drops nothing (readahead builds large folios).
- Every wait has a deadline except the upload's `fdatasync`. A part file is deleted on
  every failure, including a request dropped mid-body (`Part`'s `Drop`).
- Logs carry paths, sizes and codes, never file contents, upload bytes, the client's
  upload name, or `config.toml`'s text: a parse error is logged by line and column, never
  by the parser's message, which quotes the text.

The model behind these rules, and mechanism the code doesn't show, is in `.context/CONTEXT.md`.
