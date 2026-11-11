# src/http: accept loop, connection bounds, static shell

`AGENTS.md` has the rules the code relies on. Why the bounds are what they are:

- **`server.rs` owns its accept loop** instead of calling `axum::serve`: the memory bound needs
  hyper's buffer size, and axum 0.8 builds each connection with hyper's defaults and no hook (at
  those defaults 61 connections could hold about 25 MiB). It accepts on `serve.sock` and
  `local.sock` under `$XDG_RUNTIME_DIR/muxen/` and shares 64 permits between them; with none free it
  stops accepting and the kernel's listen backlog holds newcomers, where only tailscaled and
  Jimmy's own processes can queue. Peer credentials aren't inspected: the socket selects the front
  and the private runtime directory limits who can connect.
- **Why 64:** the per-route caps (one scan, two raw, one upload, one save, four `/complete`, four
  shell, whois 2 + 16 waiting, the auth lane's two threads, the sockets) sum to about 60 with the two
  idle connections tailscaled keeps pooled for 90 s. The backstop must stay above that sum so a
  native reconnect never queues behind a browser's page load; reaching it means a flood.
- **HTTP/1.1 only** (tailscaled proxies plain-HTTP backends over 1.1) with `max_buf_size` 16 KiB
  (it bounds the read and write buffer alike; a larger head is 431) and a **100 s header-read
  timeout**, which also closes idle keep-alive connections. It is above tailscaled's 90 s idle
  timeout so tailscaled always closes first: Go doesn't retry a POST on a connection the daemon is
  closing, so a shorter timeout would turn a rare enrolment or upload into a 502.
- The I/O wrapper forwards `poll_write_vectored` so hyper keeps queueing body `Bytes` instead of
  copying them into its write buffer. Accepted sockets use small kernel buffers (`small_buffers`):
  cgroup accounting includes socket buffers, and a stalled loopback reader let 4 MiB queue in one
  default sender buffer.
- **Shutdown:** each connection task runs in a `JoinSet` and selects between the connection and a
  shutdown `watch`; on the signal it calls `graceful_shutdown()` and keeps polling, closes upgraded
  sockets with 4004, and at the 2 s deadline aborts every task still in the set, so a stalled raw
  response can't outlive `serve`. axum spawns upgraded sockets outside the `JoinSet`, so one that
  misses the deadline still holds a `Ctx`.
- **Static shell:** `build.rs` runs the web production build and embeds deterministic gzip and raw
  variants, bounded to 192 files, 8 MiB total and 1.5 MiB per file (a larger bundle fails the
  build). Only explicitly routed files (`/`, manifest, `sw.js`, icons, `/assets/*`) are served; an
  unknown path is a 404, never an `index.html` rewrite. Hashed assets cache immutably; the root,
  manifest and service worker are `no-cache` with ETags. Four responses stream at once, 16 wait in
  arrival order, and a 30 s no-progress write aborts a stalled client. The manifest's name is
  `muxen <host>`.
