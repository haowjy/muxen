# setup

Keep OS-specific branches inside `systemd.rs` and `launch_agent.rs` (the `platform`
alias in `mod.rs`); the shared sequence in `mod.rs` stays platform-neutral, and neither
executor may bypass its preflight checks. `checks.rs` and `install.rs` are pure policy;
build them on Linux and macOS.

- Setup mutates no unit, plist, Tailscale Serve config or grant until every check has
  run and no error finding remains.
- Foreground setup opens the daemon (budget, runtime directory, flock, binds, state
  store, auth) before granting the operator; `Opened::run` starts serving only after
  the whole sequence succeeds. Background setup and teardown detect a terminal run by
  probing that same runtime flock: add no other single-instance mechanism.
- Foreground setup never installs a service or enables linger; stopping it leaves Serve
  published. On a Mac, plain setup refuses and only `--background` installs the
  LaunchAgent.
- Teardown stops a running service before removing its file, withdraws only a
  matcher-recognized Serve handler (also when no service is installed), and keeps auth
  state, config and drop-ins.
- Serve config rewrites go through the shared planner in `auth::publish`, not a
  setup-specific path.

Executor and runtime-probe gates need real hosts; unit tests don't simulate them. Rules
and probe limits: `docs/design/setup.md`; user-facing behavior: `docs/running.md`.
Update both with behavior changes.
