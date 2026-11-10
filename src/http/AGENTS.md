# http

The daemon's HTTP surface over its private fronts. Nothing here names a tmux type; the
node lane's pure policy is in `src/auth/node.rs`.

Rules the code relies on, which are easy to break:

- Every route, including shell and fallback paths, stays behind the Tailscale check.
  `Front::UnixServe` gates on `Host: localhost`; `Front::Loopback` checks its raw
  request-target path secret in constant time and the published authority before
  routing, and refuses absolute-form URIs and duplicate `Host`/`X-Forwarded-Host`. A
  path-secret miss is an empty 404 before headers or route work. The shell and
  `/auth/info` skip device admission so a cold launch can load. Keep `Front` derived from
  the listening socket, never from request headers.
- A node-lane request is judged before handler work: canonical origin and request
  metadata, one tailnet `X-Forwarded-For`, whois, node rules, then the device row. Never
  trust these headers on `local.sock`; it is the dev/native front.
- A bad native token never falls back to node admission. A browser is tokenless, and its
  node lane is available only on the Unix Serve front or the Mac Loopback front.
- Native-token minting must stay out of browser script's reach. `/auth/enroll` refuses
  browser Origin/fetch metadata; `POST /auth/node/enroll` with an empty code is for the
  native client only and refuses any `Sec-Fetch-Site`, `-Mode` or `-Dest` header, and
  only an already enrolled node may mint. The minted native row is bound to the node, so
  removing the node revokes it. Keep the non-empty-code browser enrolment path separate.
- `shell.rs` streams only the build-time embedded asset manifest; unknown paths never
  fall back to `index.html`.
- Use `Refusal`/`HttpError` (`error.rs`) for route errors and status/header mapping;
  don't hand-build error JSON or duplicate HTTP-code maps. Handlers return
  `Result<_, Refusal>` and use `?`.
- In `ws.rs`, every `ToConn` goes into the `Outbox`, and `take_credit()` goes back as
  `FromConn::Credit` whenever it is non-zero. The connection's own JSON (welcome, pong, a
  paste's refusal) is never charged; it waits in `own`, and while `own` is full the
  socket isn't read.
- The write future holds no state: the frame and the unflushed charges live in `Conn`,
  so `select!` can drop the future at any await without losing either.
- The periodic device re-check runs outside the socket I/O loop, so a slow LocalAPI call
  cannot stall terminal reads and writes.
- `server.rs` takes one of 64 shared permits before either socket accept and stores it
  in the I/O wrapper, so an upgrade keeps it until the socket closes.
- Shutdown is bounded: stalled responses are dropped at the 2 s connection deadline; a
  WebSocket left running keeps its `Arc<Ctx>`, so `main` ends the hub with
  `HubHandle::stop` rather than waiting for every handle to drop.
- Nothing here calls the blocking pool except through `App::lanes` (`src/blocking.rs`):
  `newWindow`/`newSession` `dir` is checked with `fs::check_dir` on the dir lane, and
  paste files are written on the auth lane.
- Slot and waiter limits use `PermitPool`; don't add another semaphore-plus-waiter.
  Blocking work under a slot runs through `Slot::run`, which moves the permit into the
  lane work. `PUT /fs/file` takes the permit before the body and moves it in itself
  (`src/fs/AGENTS.md`).
