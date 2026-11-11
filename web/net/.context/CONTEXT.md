# web/net: reachability mechanism

The behaviour (the four shown states, Retry, what views do with them) is
[plan.md](../../../docs/design/plan.md#reachability). This file holds the rules that decide it, which the
code in `host.ts` and `hosts.ts` implements.

The host's socket keeps two times: *trouble since* (when the first unanswered attempt of the current outage
began) and *last reached* (when the daemon last answered: now while the socket is open; once it closes or
stops, the time of the last message it received). Every path that opens a socket (a tab joining, a request,
a nudge, Retry, the foreground, a backoff step) goes through one connect, which notes when the attempt began.
Reachability changes only on the rows below; the one timer is the open socket's, for an unanswered ask.

| When | The socket next | Reachability |
|---|---|---|
| `welcome` | Open | Reachable, last reached now; trouble cleared |
| Server closes with 4401 or 4001 | Halted (re-enrol, update) | Reachable, last reached now; trouble cleared. Admission shows the refusal |
| Server closes with any other 4xxx (4005 over the cap, 4503 can't decide now) | One backoff step; in a browser, a 4503 stops the socket and the admission check takes over | Reachable, last reached now; trouble cleared |
| An open socket's idle close (25–35 s after its last message) | One backoff step | Unreachable, last reached = its last message, trouble since = the close. With no network: as the next row |
| Any other close: a connect timeout, an error (1006), a clean close, the link's own 4003, a socket that opened and got no `welcome`, native opening no socket (1006, or 4401 when it holds no token, which also halts and refuses) | One backoff step, or the connect-timeout rule | Unanswered. Trouble since = this attempt's start (the close, for a socket that was open), if unset. Then unreachable if 10 s have passed since then; from reachable, checking if 1.5 s have; else unchanged. A socket that was open also sets last reached to its last message |
| An open socket, reachable, has heard nothing for 3 s after an ask (a `watch`, or a request sent; keystrokes, resizes and pings are not asks) | Open | Checking. Any message or frame on that socket, a pong included, returns it to reachable. The idle close and the rows above still apply. Stopping the socket undoes it |
| A connect starts (any path above) | Connecting | Unchanged |
| Stop: nothing needs the socket, background, host removed, or browser admission check paused | Stopped | Unchanged (a checking set by an unanswered ask returns to reachable: nothing was proven), but last reached = the last message of a socket that was open; trouble cleared |

- An attempt is answered by a `welcome` or by a 4xxx close the server sent. The socket marks every close the
  client made itself, native's no-token 4401 among them; those are unanswered.
- At launch every server is checking until an answer or until it turns unreachable. Last reached comes back
  from the saved workspace, saved per server with it, so it survives a kill or reload and adds no write of
  its own.
- A quick failure changes nothing on its own: a Wi-Fi to cellular handoff fails a socket or two and
  reconnects within seconds, so it never reads offline, and one that recovers within 1.5 s keeps its last
  word. With fast failures, offline appears at the 10 s threshold plus one backoff step. An off server's first
  connect times out at 5 s (checking) and its second, sent at once, at about 10 s (offline).
- The unanswered-ask rule is how a tab that reads "Connecting" and Home agree within seconds when a server
  goes off under an open socket, rather than 25–35 s apart. A slow reply that comes with output or pongs
  inside the 3 s changes nothing. A live terminal on screen gains no banner from it.
- From unreachable, automatic attempts leave the state alone until an answer arrives. Stopping clears
  trouble, including when a browser admission check is paused, so a page hidden or an app locked mid-outage
  decides nothing: the first attempt after it starts a new outage.
- A browser host that isn't admitted yet has no socket running; its admission check is its attempt, reported
  to the same socket by the same rows: `GET /auth/info`, then `/auth/node/session`, each given up after 5 s.
  It is answered by a 200 whose body has a string `hostId`, or by the daemon's 503 `identity_unavailable`;
  anything else (`tailscale serve`'s 502, no response, the 5 s limit) is unanswered. It isn't sent while the
  page is hidden.
- **No network:** while the phone reports none, every server shows no network (not stored: it overlays any
  state) and only the network returning clears it. An unanswered attempt then changes nothing; a `welcome` or
  a 4xxx the server sent still counts as an answer. The network returning clears trouble.
- **Requests:** every HTTP request to a server is made while something has joined its socket (a Files tab is
  a tab; Settings and the sessions overlay open over Home, whose listing joins every admitted server); the
  admission check and `GET /auth/info` are exempt. When the shown state becomes unreachable or no network,
  every GET and HEAD not yet finished fails at once as `network`; one made while it shows either is not
  sent. When it becomes reachable, or the server answers a new socket while reachable, every view whose last
  load failed as `network` loads again by itself. Image, video and audio files load by URL outside these
  rules. Other methods (a settings save, an enrolment, an upload) are always sent and never aborted.
- **Retry** is `app.retryHost`: reset the backoff, connect the socket if it isn't already connecting (a
  connect under 5 s old is kept; an older one is replaced, since a tap shouldn't wait out a 15 s limit on a
  server that has just come back), check admission again if undecided, and list sessions again. It shows
  checking over unreachable while an attempt is under way; while the socket is open, stopped or has nothing
  joined it changes nothing.
