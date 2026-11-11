# muxen

Phone-first client for tmux on a dev server, over Tailscale. A Rust daemon bridges
tmux control mode to a native iOS app that hosts a web UI. The design is in
`docs/design/`: `plan.md` is the product spec and the index of the subsystem specs,
each with the reasons for its larger choices. Read the spec before changing or adding
a subsystem, and read an area's `AGENTS.md` before changing that area.

## Invariants

A change that breaks one makes a different product: stop and ask Jimmy first. The
reasons and the details are in `docs/design/plan.md`, "Invariants".

- **tmux is the source of truth.** muxen is a window onto Jimmy's tmux, never its
  owner: tmux's life never depends on muxen's.
- **Usable on spotty, barely-there connections.** Every byte and round trip on the
  network costs the user; reconnecting must be cheap.
- **Light on a busy host.** The dev box runs many processes. muxen's CPU and memory
  stay small, bounded, and capped where Jimmy chooses.
- **Content from disk or tmux never runs as the app.** Rendered Markdown and Mermaid
  are sanitized; proxied files are served sandboxed.

Product rules (`plan.md`, "Product rules") are Jimmy's standing decisions and change
only when he says so. Among them: muxen is reachable only from Jimmy's tailnet; it
serves several servers; hosts are POSIX (Linux, macOS), since tmux doesn't run on
Windows.

## How work lands

Commit straight to `main` in the primary checkout: no PRs, feature branches or
worktrees. The rigor PRs would carry stays:

- **Spec before code.** Settle a subsystem's spec in `docs/design/` before building
  it. Specs state the current rule and why, as current truth; git history is the
  archive.
- **Code standards** are `plan.md`, "Code structure and standards". Get a review of
  each subsystem's design and code before moving on.
- **Probe the real thing.** Verify against real tmux (3.4, the oldest supported, and
  3.8), a real iPhone, and the resource budget measured on the dev box. Passing tests
  is not enough.
- **One change per commit**, with `docs/design/` and any `.context/` notes it makes
  wrong updated in the same commit. The pre-push hook runs `scripts/preflight.sh full`
  on each pushed branch tip only, so a commit mid-range can fail while the tip passes:
  preflight each commit on a clean export (`git archive`) before pushing.
- Add a bullet under `CHANGELOG.md` `[Unreleased]` for each user-visible change.

A push to `main` never releases. Cut a release only when Jimmy asks, with
`scripts/manually-release.sh`; it is the only way to create a `v*` tag, and the
pre-push hook blocks any other. Never push with `--no-verify` unless told to.
Mechanics: `docs/releasing.md`.

`meridian mars sync` rewrites `.claude/`, `.codex/`, `.cursor/`, `.opencode/`, `.pi/`
and `.agents/`: don't edit them.

## Commands

```bash
scripts/setup-hooks.sh        # once per clone: installs the pre-push hook
scripts/preflight.sh full     # fmt, clippy -D warnings, test, release build
pnpm --dir web install        # the web client; commands in web/README.md
```

The crate's minimum Rust is 1.85 (`rust-version` in Cargo.toml) and the pinned
toolchain is newer, so syntax stabilised later (let chains, 1.88) passes preflight and
fails CI's MSRV job. Check with `cargo +1.85 check --locked --all-targets`.

Use pnpm, never npm, in `web/`; don't add a `package-lock.json`.
