# auth

Request admission and durable device state ([auth.md](../../docs/design/auth.md)). The
listener front selects the lane: native tokens work on local and Serve fronts; enrolled
nodes work only on Linux `serve.sock` and the Mac Loopback front. `publish.rs` holds the
raw-JSON Serve plans and compare-and-swap loop shared by Mac publication, setup and
teardown; all plans are judged by the canonical-origin rule used for admission.

Rules the code relies on, which are easy to break:

- Every write of `auth.toml` goes through `Store::update`: it holds the state
  directory's flock for the whole read-modify-write, lands through `files::Temp::replace`,
  and writes nothing when nothing changed. A file that doesn't parse is never overwritten;
  a row with unknown fields is refused alone and preserved unchanged by later writes.
  Name allocation checks refused rows too.
- Checks re-read `auth.toml`, so `muxen device remove` reaches a running daemon with no
  IPC and closes a live socket at its next 10 s check. Don't add a device cache.
- Only native token hashes are stored. A native token minted by an enrolled node also
  stores the node's ID and owner login; every native check and live-socket re-check must
  find a node row with the same ID and login in the same `auth.toml` read. That
  invariant, not the delete-path cleanup, is what revokes the token. The node lane has no
  cookie or portable credential.
- Never log tokens, path secrets, codes or file contents. On Mac the path secret lives in
  the Serve proxy target; `ServeTarget` and handler `Debug` redact it, and the logged
  origin carries only the public authority.
- Whois is never cached between requests. Keep address-family, node-eligibility and
  login-match decisions in `node.rs`.
- The tailnet-state cell (`identity.rs`) is shared because status and Serve config are
  read together. A stale value starts or joins a fill and waits; only a failed read lets
  a held value serve until it is 30 s old. Don't make LocalAPI availability a daemon
  startup gate.
- Mac publication exposes one `watch<PublicationState>` to the front and `/auth/info`;
  while it is waiting, tailnet-state observations must not report a missing origin.
- Store operations block on disk and run on the auth lane (`src/blocking.rs`): a hung
  mount must not take the runtime thread or other lanes.
