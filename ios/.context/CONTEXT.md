# ios: what to know before editing

`AGENTS.md` has the rules the code relies on. [ios-shell.md](../../docs/design/ios-shell.md) is the
contract (what is native, what is web, why). This file holds mechanism the Swift can't show.

## Scheme handler and the host proxy (`Web/AppSchemeHandler.swift`)

- **Two origins.** `muxen-app://ui/` serves the bundled `WebUI/`; `muxen-app://h-{host_id}/…` proxies to
  that host's daemon over HTTPS with `Authorization: Bearer`. Each host gets its own origin, different
  from the UI's, so the UI's `script-src 'self'` never covers a daemon response and a proxied script
  can't run as the app.
- **Allowed routes only:** `/fs/*`, `/complete`, `/settings`, `POST /settings/reload` and exact `GET
  /auth/info`. The percent-encoded path and trailing slash are forwarded unchanged; a disallowed route
  never reaches the daemon. It forwards the method (`GET`, `POST`, `PUT`) and body, streams the response,
  passes `Range`, `If-Match`, `Content-Type` and returns `Content-Range`, `ETag`, `Content-Type`.
- **CORS is the handler's job.** The page fetches cross-origin, so the handler adds
  `Access-Control-Allow-Origin: muxen-app://ui` and `Access-Control-Expose-Headers: Content-Range, ETag`
  (a cross-origin page reads only safelisted response headers, so without it the file size and validator
  are invisible; the gap can't show in dev mode, where the Vite proxy makes everything same-origin). It
  answers `OPTIONS` itself and never forwards one: the daemon answers no preflight, which keeps a CORS
  path shut for browsers on the tailnet. Every proxied response also gets `Content-Security-Policy:
  sandbox` and `X-Content-Type-Options: nosniff`. After `webView(_:stop:)` it cancels the upstream request
  and never calls that task again (WebKit raises an exception if it does).
- **Compatibility gate:** the first proxied request to a host holds while the handler fetches `GET
  /auth/info` once (later requests join the check); it then goes through, or gets `409 {"error":
  "incompatible"}` if the protocol range excludes the app (`DaemonProtocol.version`, which moves with
  `PROTOCOL_VERSION`). The check gives up after 10 s, fails held requests as a network error and isn't
  remembered; only a compatible answer is kept. The web's own `/auth/info` is never held. Native asks
  `/auth/info` itself because it otherwise calls it only at enrolment.
- **Locked or not enrolled:** local `423 {"error":"locked"}` (the web reads it as `network`: nothing reached
  the server, and what failed loads again once the socket returns after the unlock) or `401
  {"error":"not_enrolled"}`. A daemon `401` revokes the cached token only if the request carried it.
- **Every native request to a daemon** (this proxy, uploads, Download, the video player) is built by
  `MuxenAppModel.request(on:path:query:)`: the saved host's `baseURL`, the path unchanged, the host's token.
  One redirect rule, `HostRequest.redirect`: follow only to the request's own origin and within the route it
  was for, carrying `Authorization` again (URLSession drops it even on the same origin, and the daemon's
  `401` would then revoke a good token); otherwise the 3xx is the answer. Native requests send no `Origin`;
  the daemon refuses a native token's request whose `Origin` is present and isn't `muxen-app://ui`.

## Web content security

The page holds the WebSocket token and can call the bridge, so untrusted file content must never run as
script in `muxen-app://ui`. A `WKNavigationDelegate` allows only the app's own document in the main frame;
every other navigation or `window.open` is cancelled, and `http`, `https` and `mailto` URLs go to
`openURL` (anything else is dropped). The `muxen` message handler rejects any message whose frame isn't the
main frame at `muxen-app://ui`. The app's assets carry a CSP header: `default-src 'self'; script-src 'self';
style-src 'self' 'unsafe-inline'; img-src 'self' muxen-app: blob: data:; media-src 'self' blob:;
connect-src 'self' muxen-app: wss:; frame-src 'none'; object-src 'none'; base-uri 'none'` (`wss:` because
each host's socket is on its own `*.ts.net` name). There is no dev-server mode or relaxed CSP path. The
Debug app enables Web Inspector; the Xcode build phase `ios/scripts/build-web.sh` builds the web UI into
`WebUI/`.

## Video (`Media/MediaLoader.swift`)

Video doesn't go through the scheme handler: custom-scheme media loading has a history of dropping `Range`
(WebKit bug 203302, fixed 2021, unverified on iOS 26). The web asks native to play; native opens
`AVPlayerViewController` on an `AVURLAsset` at `muxen-media://file/fs/raw/…`, loaded by an
`AVAssetResourceLoaderDelegate` that fetches each range itself with `MuxenAppModel.request`, so AVFoundation
never holds a token. `AVURLAssetHTTPHeaderFieldsKey` isn't public API and AVFoundation applied it to URLs a
hostile file names and to redirects (checked on iOS 26.5 and 27.0), so a reference movie sent the device
token to an arbitrary HTTPS host. Three limits: `AVURLAssetReferenceRestrictionsKey` = `forbidAll` (the raw
`NSNumber`; the Swift option set crashes AVFoundation); the delegate serves one URL, the file asked to play;
redirects follow only `HostRequest.redirect`. Only a `206` with `Content-Range` is accepted; a fetch asks for
the smaller of 1 MiB and the length asked. The player screen owns the loader and ends its fetches when it
goes; a locked app refuses new ones. `.m3u8` must stay out of the daemon's MIME table: a playlist's
segments are fetched through AVFoundation's own stack, past the loader (no token, but the host named
learns the phone's address).

## Keyboard hooks (`WebShellController.installKeyboardHooks`, every web view the app makes)

- **`AllowFocusPolicy`** answers WebKit's private `_WKInputDelegate` question "may this focus start an input
  session" with yes, so a script's `focus()` shortly after a tap still raises the keyboard. If the property
  disappears in a later iOS those focuses leave the keyboard down and the log says so.
- **`WebKitAccessoryBar`** removes the ⌃ ⌄ ✓ bar by swapping the content view's `inputAccessoryView`; left in
  place if the class path is absent. The page's `autocorrect="off"` removes the predictive strip and
  `allowsInlinePredictions = false` covers the inline kind. Writing Tools are off: Apple Intelligence's
  button sat over muxen's Copy and Paste.
- **Scroll at zero:** WebKit scrolls to reveal a focused box even with scrolling off, so the scroller's
  `contentOffset` is put back to zero. `contentInsetAdjustmentBehavior = .never`, `bounces = false`,
  `keyboardDismissMode = .none`, zoom off.
- A native screen over the page (lock, server list, Face ID) takes the keyboard down with `endEditing` and
  doesn't raise it again on uncover.
- **Edit menu over the mark:** the page sends `editMenu { rect }` and `MuxenWebView` presents its own
  `UIEditMenuInteraction` (Copy, Paste), reporting `menuCopy` or `menuPaste`. Native owns whether it is up
  (`willPresent`/`willDismiss`). `MuxenWebView` adds nothing to WebKit's own menus: a Paste item there would
  reach `pasteFromMenu` and paste into the shown terminal tab even from a dialog over it. The web view's
  `tintColor` is the accent.
- Hardware keys reach the page like any browser's; the app has no `pressesBegan`, key repeat timer or
  `UIKeyCommand`, and Cmd+T, Cmd+W, Cmd+1…9 aren't shortcuts.

## Keyboard geometry and `viewport`

Native measures the keyboard so the web never does; the web view always fills the screen and a docked
keyboard covers its bottom. On `keyboardWillChangeFrame` and `keyboardWillHide` native sends `viewport` with
`keyboardInset` (the height the keyboard will cover when it stops) and `keyboardDuration` (animation still to
run). The dock, Files' tab row and sheets rise by `--keyboard-inset` over `--keyboard-duration` on
`--ease-keyboard` (`cubic-bezier(0.25, 0.6, 0.1, 1)`, within 7 pt of the keyboard's motion on the iOS 26.5
Simulator); resizing the web view instead made WebKit lay the page out at the final size at once, so the
dock jumped ahead of the keyboard. The full `viewport` object (`layout`, `density`, `directInput`, `scheme`,
`width`, `stableHeight`, `visibleHeight`, `keyboardInset`, `safeArea`, `keyboard`, `keyboardDuration`) is in
`MuxenKit/BridgeTypes.swift` and the fixtures. Every `viewport` carries `safeArea` even with the keyboard
up. The web sizes tmux from `stableHeight`, width and the safe area only, never from a surface the keyboard
has covered, and the keyboard never resizes tmux. The web's 4 px minimum edge inset (`--term-edge`) costs a
column on a 393 pt portrait view. The tmux size sits inside every safe-area inset because a web view that
ends above the keyboard reports a zero bottom inset of its own.

## Bridge

One `muxen` message handler (`WKScriptMessageHandlerWithReply`) and the page entry
`window.__muxen.receive(messages)`. Every message and representative reply has one fixture in
`MuxenKit/Tests/Fixtures/bridge/`, decoded by both Swift and `web/platform/native/` tests. Native never
queries page state. The token stays inside `HostLink`; on refusal `hostRejected` echoes the exact presented
token to native solely for comparison and revocation. `socket { host }` returns `{url, token}`, `{locked}` or
`{notEnrolled}` at once on the main actor on every path; a message the bridge refuses is rejected and the web
treats it as no socket, so its wait has no timer. `saveWorkspace` stores the web's workspace as opaque JSON
under one key; Swift never decodes it, so a newer web build's version round-trips (native deletes the old
`muxen.workspace.v1` and `.v2` keys at launch). When the content process dies, or the web sends
`recreateWebView` (a socket stuck in CONNECTING while `/auth/info` answers; at most once per 10 minutes, a
limit the web keeps), native builds a new web view instead of reloading (a reload left the dead document in
the back list; clearing it isn't public API). `backSwipe { enabled }` turns WebKit's left-edge swipe on or
off (starts off for each new web view). User-initiated `copy` always writes the pasteboard; OSC 52 stays
disabled in the web client.

## Preferences

`UserDefaults`: appearance (System/Light/Dark), text size, relock (5 min, 1 hour default, At launch).
Appearance has one owner, SwiftUI's `.preferredColorScheme` on the root view, so lock screen, sheets,
keyboard and web agree from the first frame. Relock compares the time since background on `ContinuousClock`
(counts through sleep, can't be set back; a negative elapsed time locks). A stored value decodes field by
field; an unreadable one takes the field's default except `relock`, which takes 5 min. `setPreference` is
refused while locked, and a longer relock needs a fresh Face ID evaluation first.

## Lifecycle details

On leaving active, native covers the whole window, native screens included, with an opaque view at
`inactive`, before iOS takes the app-switcher snapshot (kept on disk); the lock screen is already opaque. On
background a short `beginBackgroundTask` lets the web close its sockets. A native screen that covers the
terminal blurs any text field and sets `Lifecycle.covered` (the server sheet) or `locked`; the web's single
watch predicate unwatches the hidden tab, and native republishes the whole lifecycle on dismissal.
`NWPathMonitor` sets `Lifecycle.online`. Every native screen goes up through `MediaController.show`: UIKit
drops a present made while another screen is up or moving, so `show` waits for a transition, refuses while
another screen is up or the app is locked (the refusal ends the request: an upload stream ends, Download
deletes its file and replies an error, a video doesn't open), and a lock takes the screen down.
Queueing a refused screen would pop a share sheet up after a video, minutes later.

## Media upload and download

- **Upload (`Uploader`):** the image becomes JPEG at quality 0.9, 2048 px longest side, posted to
  `/fs/upload?name=image.jpg`; one request at a time, at most four queued (a fifth is refused with an upload
  error), up to three retries after a `503 busy` `Retry-After`. `pickMedia { id, host }` names the
  destination and the id every `upload` event carries; native keeps no tab, so switching tabs while picking
  changes nothing and Upload works with no tab open. A dismissed picker sends a terminal `upload
  { cancelled }`; the first progress event follows the reply.
- **Download (`Downloader`):** takes `url` only if it is `muxen-app://h-{host}/fs/raw/…` for a saved host with
  no query or fragment, and fetches the same percent-encoded path with the Bearer token through the shared
  request builder. It streams to one temporary file (`URLSessionDownloadTask`, ephemeral, 30 s between bytes,
  the daemon's raw stall deadline), one at a time; before each, and after a failure, it empties
  `tmp/Downloads/` and deletes the partial `CFNetworkDownload_*` file URLSession keeps. A download still
  running after 0.5 s shows an alert with progress and Cancel. A non-200's `{"error": code}` body (read only
  under 4 KiB) gives `code`, else `http_<status>`; a `401` on the token it carried revokes that token. The file
  is renamed to `name` reduced to one path component and offered in the share sheet; when the sheet closes,
  however it closes, the file is deleted and the request replies. A lock cancels a running download and
  dismisses its alert or sheet. The file never enters the web view.
- **Share extension** (a `MuxenShare` target copying images and movies into an App Group container) waits on
  an explicit App ID; the wildcard development profile has none.

## Hosts and Add

`HostStore` keeps `{id, name, baseURL}` in `UserDefaults`; tokens are in the Keychain. The bridge sends only
`PlatformHost` (`handle`, `hostId`, `name`, `pageOrigin`), never a base URL or token. Add host is two steps:
the MagicDNS name or setup link plus an optional code (eight one-character cells in two groups of four, the
separator drawn, typing uppercases and advances, a whole-code paste with or without a dash fills them), then
the device name (prefilled from `UIDevice.current.name`). A `muxen://add?host=<origin>&code=<code>` link
validates the HTTPS origin and prefills step 1; it never sends a request until Next and Add are tapped. With a
code, Add reads `/auth/info`, posts `POST /auth/node/enroll` with the code, then posts the same route with an
empty code to mint the token (retried once), both with `Origin` and no `Sec-Fetch-*`
([auth.md](../../docs/design/auth.md#enrolment)); without a code only the mint. A wrong or expired code shows
"That code is wrong or has expired"; a node policy refusal says this device can't use muxen on this server,
with the server's reason; both stay on the device-name step, and Back keeps both fields. The link doesn't
choose a tmux session: the web owns the route and tabs. The web's Home/Settings host entry sends
`manageHosts` to present the sheet.

## Build

XcodeGen builds the project from `project.yml`; builds and tests run on the Mac (`ios/scripts/check.sh`). The
generated Info.plist has a generated launch screen (required for full device-sized windows),
`NSFaceIDUsageDescription` and `NSCameraUsageDescription`, no ATS exceptions (`*.ts.net` certificates are
publicly trusted); bundle id `com.jimmyyao.muxen`. The team is `D4K9ZT557F` (wildcard development profile,
expires 2027-10-24, no App Groups) and stays out of `project.yml`. Later: an explicit App ID for TestFlight,
App Groups, the share extension and push.
