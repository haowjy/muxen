# complete

`POST /complete`'s core ([complete.md](../../docs/design/complete.md)): what the
suggestion strip offers for the text before the cursor. It knows nothing of axum and
never touches tmux or the hub; `http/complete.rs` is the thin adapter.

Rules the code relies on, which are easy to break:

- **Never log typed text:** not `before`, `after` or `cwd`, not history lines or
  per-line counts, not chips, not carapace's arguments or output. The per-request debug
  line carries the word source's kind and counts only. A parser's error message quotes
  its input, so a failure logs a fixed kind and a position (`Failure::Json`), never
  serde's `Display`. carapace's stderr tail is logged only for `--list`.
- **A chip only extends what is typed, and the shell reads it literally:** every source
  matches by prefix, and every chip is built by `chip()` in `mod.rs`, which drops control
  characters and escapes through `context::literal`, except history's text, which is
  shell syntax Jimmy wrote. Never build a `Chip` elsewhere. A quoted leading `~` comes
  back from the lexer as `./~` so paths and carapace don't take it for `$HOME`.
- **History's memory is bounded by distinct lines, not bytes:** `SCORED` caps the dedup
  map (its comment proves the cap can't change the 10,000 kept). A per-entry or
  per-distinct-line structure over the whole 1 MiB read breaks the allowance: 1 MiB of
  short distinct lines is 150,000 of them.
- **Blocking work runs on one of two lanes** (`src/blocking.rs`), the permit moved into
  the closure: the index lane for history, the `PATH` scan and resolving the carapace
  binary; the dir lane for `check_dir` and listings (`newWindow`'s `dir` check shares
  it). Never hold `state`'s lock across I/O: clone the `Arc`, release, work, swap.
- **One carapace run at a time, owned by the runner task.** Requests only `ask`; a
  dropped request kills nothing, a newer key kills the run in flight (`Group`'s drop
  sends `SIGKILL` to the process group), and every finished run is cached. Under systemd
  (`INVOCATION_ID`) every run goes through `systemd-run --scope`; `--description` keeps
  the typed words out of the user journal.
- **The idle drop frees everything** in `State` and `carapace::Shared` together, five
  minutes after the last request. New state goes in one of those two, or it outlives the
  drop. The once-per-process log flags are the exception.
- **Large allocations are single buffers** (`Packed`, the read buffer, the run's output)
  so they are mmapped and go back to the kernel when freed; the unit pins glibc's mmap
  threshold for that (`contrib/muxen.service`).
- The `mod.rs` tests need `bash` and build `Settings::new` with a test `Environment`,
  never the developer's.
