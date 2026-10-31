# Rename: tether → muxen

**Goal:** the product, its code, its docs and its installs say `muxen`; nothing a user or
agent meets says `tether`, except the dated history (old decision text in git, archived work, session logs).

**Decided (Jimmy, 2026-10-31):** the name is `muxen` ("all your tmux, in your pocket", many
muxes, like oxen). It serves anyone who runs tmux; anything can extend it by notifying the app
(`muxen notify`), and Meridian is one such caller. Rename everything now, before the first release
and before push notifications tie a bundle ID to Apple. Logged in `docs/design/decisions.md`.

**Status (2026-10-31):** tab-chip merged into main (8a52964), then the swap landed as one commit,
code and docs together. Remaining: the machine runbook (§1), the GitHub repo, the local folder,
dotfiles, and current KB pages (kb-lead). This work item and `.meridian/` history keep the name
`tether-mvp`; docs link into it by that path.

How the swap was done: a case-aware replace (`TETHER`/`Tether`/`tether` → `MUXEN`/`Muxen`/`muxen`)
over tracked files outside `.meridian/` and generated agent dirs, `git mv` for 12 paths, then hand
fixes: links into `.meridian/work/tether-mvp/` restored, the rename decision's own wording, the
released 0.0.1 changelog section restored, one ASCII mockup (the typed prefix `te|ther`), `cargo fmt`
(the shorter name reflowed lines), `xcodegen` for `ios/Muxen.xcodeproj`. Every hit was the
product's name; "tether" never appears as the ordinary word.

Meridian finds this project by `meridian.toml`'s `[project] id`, not by path, so moving the folder
keeps sessions and work. Move it only when no session runs in it, then `git worktree repair` for
worktrees such as `~/repos/tether-tab-chip`.

## Mapping

| Form | Before | After |
|---|---|---|
| word, binary, crate, dirs | `tether` | `muxen` |
| Swift/type case | `Tether`, `TetherKit`, `TetherApp` | `Muxen`, `MuxenKit`, `MuxenApp` |
| env vars | `TETHER_*` | `MUXEN_*` |
| bundle ID | `com.jimmyyao.tether` | `com.jimmyyao.muxen` |
| web scheme | `tether-app://ui` | `muxen-app://ui` |
| repo | `haowjy/tether`, `~/repos/tether` | `haowjy/muxen`, `~/repos/muxen` |
| App Store name | — | "muxen" (subtitle "all your tmux, in your pocket"); check display case then |

Inventory command (tracked files, generated agent dirs and `.meridian/` excluded):
`git ls-files | grep -v -E '^\.(meridian|claude|agents|codex|cursor|opencode|pi)/' | xargs grep -il tether`
→ 220 files, ~1,850 occurrences (2026-10-31): web 79, src 45, docs 31, tests 28, ios 23,
.github 5, contrib 4, plus Cargo.toml/lock, README, CHANGELOG, AGENTS.md, scripts/preflight.sh,
examples/record-tmux-fixtures.rs.

## The places, by risk

### 1. Persisted or live state: renaming strands what's already there

The swap is mechanical everywhere else; these need a runbook step, because something on a real
machine holds the old name. No compatibility code reads the old names: one user, pre-release
(dev-principles: delete the old path). Each gets a one-time manual step instead.

| Name | Where it lives | What breaks | Step |
|---|---|---|---|
| `@tether-bell` user option, the appended `alert-bell` hook, `tether-server-changed` marker, `tether-<tag>` paste buffers | Jimmy's live tmux server | old hook keeps firing into a dead option; muxen appends its own | Stop tether cleanly first (it removes its hook on stop); then `tmux set-option -gu @tether-bell` per session, check `show-hooks -g alert-bell` |
| `~/.config/tether/config.toml` (`$XDG_CONFIG_HOME`) | dev box, Mac | muxen starts with defaults | `mv` to `~/.config/muxen` |
| `~/.local/state/tether` (`lock`, enrolled devices/tokens) | dev box, Mac | devices unenrolled | Re-enroll (tokens change prefix anyway, below) |
| `$XDG_RUNTIME_DIR/tether/{serve,local}.sock` | dev box | Tailscale Serve still proxies the old socket path | Re-point `tailscale serve` at `.../muxen/serve.sock` (setup does this; verify) |
| `tether-` token prefix (`src/auth/mac_front.rs`), `tether.auth.` WS subprotocol prefix (`src/auth/mod.rs`) | issued tokens, every client | old tokens rejected | Re-enroll each device |
| systemd `tether.service`, launchd `com.jimmyyao.tether.plist`, `~/Library/Logs/tether.log` | dev box, Mac | two daemons, or old one keeps the sockets | `systemctl --user disable --now tether`, `launchctl bootout`, delete unit/plist; install muxen's |
| `~/.cargo/bin/tether` | dev box, Mac | stale binary on PATH | `rm` after installing muxen |
| `contrib/shell/tether.{zsh,bash}` (`__tether_*` functions, `TETHER_NO_HISTORY_APPEND`) | sourced from Jimmy's dotfiles by path (`~/gitrepos/tether/contrib/shell/…`) | shell startup errors when the path moves | Update the `source` line in dotfiles in the same sitting |
| iOS bundle ID; Keychain `tether.tokens`, `tether.tokens.expected`; UserDefaults/localStorage `tether.hosts.v1`, `tether.drafts.v2`, `tether.workspace.v2`, `tether.preferences`, `tether.lastStuckReload` | iPhone | new bundle ID installs a second app with empty state | Install muxen, re-add hosts, re-enroll, delete the old app. Drafts and workspace are lost (acceptable pre-release) |
| `~/.cache/tether-tmux/<ver>` | test tmux builds on dev box/Mac | rebuilt on next test run | none, or `mv` to save the build |

### 2. Contracts between parts: rename both sides in the one commit

- WebSocket protocol id `tether.v1` (daemon ↔ web), auth subprotocol `tether.auth.`.
- Bridge: `window.__tether`, `window.__tether.receive`, message handler names (Swift ↔ web);
  fixtures in `ios/TetherKit/Tests/Fixtures/{bridge,auth}/` emitted by Rust tests.
- Web scheme `tether-app` in `AppSchemeHandler.swift`, `WebShellController.swift` (origin checks,
  CORS `Access-Control-Allow-Origin: tether-app://ui`).
- Test env vars `TETHER_TMUX`, `TETHER_TMUX_TESTS`, `TETHER_E2E_*`, `TETHER_SOCKET`,
  `TETHER_DEV_TOKEN`, `TETHER_PORT`, `TETHER_PREFLIGHT_EXPORT`, `TETHER_TMUX_FIXTURE_VERSION`:
  scripts, CI and the web e2e harness.

### 3. Build and release

- `Cargo.toml` package/bin name, `Cargo.lock`; release artifacts (`tether-linux-x64`…) in
  `.github/workflows/release.yml`; `.github/actions/web-toolchain`, PR template, workflows README.
- `scripts/preflight.sh`, `scripts/manually-release.sh`, `scripts/setup-hooks.sh`.
- `web/package.json` name; `ios/project.yml` (target names, bundle ID, `Tether.xcodeproj`
  is generated from it), `ios/TetherKit/Package.swift`; regenerate the Xcode project.
- File and directory renames: `ios/Tether/`, `ios/TetherKit/`, `TetherApp.swift`,
  `contrib/tether.service`, `contrib/com.jimmyyao.tether.plist`, `contrib/shell/tether.*`.
- New Apple setup: explicit App ID `com.jimmyyao.muxen` (TestFlight, App Groups, push).
  Do it after the rename, not before.

### 4. Docs and agent guidance (prose)

- `docs/design/**` (31 files), `README.md`, `AGENTS.md`, `ios/AGENTS.md`, every `.context/`,
  `docs/releasing.md`, `CHANGELOG.md` (new `[Unreleased]` bullet for the rename; released
  sections, if any, keep their old text).
- `decisions.md`: rename the product in current entries too. The log holds decisions in force,
  and an entry saying `tether notify` would mislead; the rename entry records the old name.
- Example paths with `tether` in them (`/home/j/repos/tether`, `~/gitrepos/tether`) become the new
  checkout paths.
- `.meridian/kb/`: current pages get the new name (kb-lead, after the swap). Archived work,
  `.meridian/work/**` history and session logs stay as written.
- Words that aren't the product: check before replacing (`tether-shaped` in prose, test names
  like `withdraw_is_noop_without_its_tether_handler`); a blind `s/tether/muxen/` is mostly right
  but each hit gets read.

### 5. Outside the repo

- GitHub: rename `haowjy/tether` → `haowjy/muxen` (GitHub redirects the old URL; update
  `origin` anyway). Repo secrets and branch protection carry over.
- Local folder `~/repos/tether` and worktrees (`~/repos/tether-tab-chip`, …): Meridian keys this
  project by path — check `meridian` still finds its sessions and work after the move before
  moving; if it doesn't, keep the folder name and rename only the repo.
- Dev box checkout path (`~/repos/tether` / `~/gitrepos/tether` per the docs: confirm which).
- Jimmy's dotfiles (`source` line above), any shell aliases.

## Order

1. Land or park in-flight work: the tech lead's session (c419) commits to `main` in this checkout;
   the swap touches nearly every file. Agree a quiet window, then do the swap from a clean tree.
2. One commit: code + docs + file renames + regenerated Xcode project; preflight full,
   `cargo +1.85 check`, iOS build, web e2e.
3. Probe on the real machines: install muxen on the dev box and Mac (runbook §1), re-point
   Tailscale Serve, real tmux 3.4 and 3.8 bell hook check, iPhone install + enroll.
4. Rename the GitHub repo, then the local folder (after the Meridian check), then dotfiles.
5. Apple: explicit App ID, then push notifications design (`muxen notify` → APNs → open the tab).

## Open

- Display name: lowercase `muxen` (`PRODUCT_NAME` in `ios/project.yml`), as tether was written.
