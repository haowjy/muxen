# tmux core

Pure: no process, filesystem, clock or shared state, except `pump.rs` (one task per
`tmux -C` process) and `oneshot.rs`. `Endpoint::command` builds, never runs, the one
`tmux -u -N` invocation both use. `command.rs` is the only place tmux command text is
built; the formats it asks tmux to print live in `reply.rs` beside their parsers.
Unknown protocol lines are non-fatal. Never log raw pane output or reply bodies.

`tests/support/fake_tmux.rs` reads the command text `command.rs` writes: change the two
together.

Tests replay recorded streams and require `Session` to write exactly the recorded lines
(`.in`). Re-record when command output changes:
`cargo run --example record-tmux-fixtures -- --out tests/fixtures/tmux/3.4` (for 3.7b:
`--tmux <path> --out tests/fixtures/tmux/3.7b`). Session tests default to the 3.4
fixtures; `MUXEN_TMUX_FIXTURE_VERSION=3.7b` selects the other. The `snapshot-*` fixtures
also feed the `vt100` restore tests in `snapshot.rs`.

`tests/tmux_real.rs` runs `Session` and the one-shots against private tmux servers. It is
skipped unless `MUXEN_TMUX_TESTS=1` (`MUXEN_TMUX` picks the binary; the Gap test needs
`script`); run it, under `nice -n 10`, after any change here.
