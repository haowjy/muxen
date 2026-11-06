# web/

The client's design is `tether-mvp/design/client-architecture.md` in the Meridian work dir (haowjy/docs `muxen/work/`); read §3
(layout and lint rules), §6 (state owners) and §11 (lanes and the hand-off protocol) before
adding a file. [README.md](README.md) has the commands.

- **One owner per piece of state.** Workspaces (one per host: its tabs of both kinds in order, its
  last tab and last terminal tab), and a Files tab's place (written only from `navigated`):
  `workspace/` (pure reducer); its saved form has one parser, `workspace/saved.ts`. Sockets, admission and reachability:
  `net/hosts.ts`, decided in `net/host.ts`. Navigation: `app/router.ts`, the only writer of browser history (routes
  `home | overview | tab`, a tab opened from Home sitting above its overview in history; the screen
  is derived by `screenOf`). Focus:
  `app/focus.ts`, the only caller of `.focus()` and `.blur()`. The listing: `app/listing.ts`,
  the only sender of `listSessions`. Persistence: `app/persist.ts`; per-device view settings (Show hidden, the Files Preview panel and its width, the files opened per host for Search's recents): `app/viewMemory.ts`. Screens reach them through
  `useApp()` and call their own cores directly.
- **Every view of a server reads one state.** Only `Host` decides reachability, when an attempt ends: add no timer for it,
  and feed it no HTTP response but the browser's admission check. A view showing a server's status switches on `serverState`
  (`net/hosts.ts`) and keeps its own words; it doesn't work out the order from `admission` and `shown` itself. A server's GETs
  go through `client.fs` or `client.settings`, from a screen whose server has a joined socket (a tab, or the listing under
  Home and its overlays). Without one, each GET is refused while the server is unreachable and no socket is retrying to bring
  it back ([plan.md](../docs/design/plan.md#reachability), "Requests"). A view that failed as `network` reloads from `hosts.recovered`.
- **Environment lives only in `platform/`.** Nothing outside it names an environment, touches
  `navigator`, `indexedDB`, `visualViewport` and the like, or imports an adapter; only
  `main.tsx` imports `platform/browser/`. `lint/rules.js` enforces all of it and
  `lint/rules.test.ts` proves each rule fails on a seeded violation: change a rule and its
  case together.
- **Raw `<button>`, `<input>`, `<textarea>` live only in `ui/primitives/`** (and the two input
  owners and the hidden file input). Colour goes through `ui/tokens/semantic.css`; screens read
  spacing, radius, type and duration scales directly. Each screen styles itself with a CSS module.
- **No `·`, `•` or `●` in copy**; `scripts/checks.mjs source` fails on them.
- **Every state, not the one in the mockup.** A new screen ships its loading, empty, error and
  offline states, and a harness fixture (`harness/<lane>/`) to look at it in both layouts.
- The iOS shell's bridge is `platform/native/bridge.ts` (its version is `BRIDGE_VERSION`, equal to native's `BridgeContract.version`); `bridge.test.ts` decodes
  every fixture in `ios/MuxenKit/Tests/Fixtures/bridge/`, the contract's one copy.

Changes to W0-owned files (`ui/`, `workspace/`, `app/`, `net/`, `platform/types.ts`,
`harness/index.ts`, repo config) go through the hand-off protocol in §11, not a direct edit.
