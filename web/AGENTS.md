# web/

The client's behaviour is specified in
[docs/design/client/README.md](../docs/design/client/README.md), which says which doc wins.
[README.md](README.md) has the commands.

- **One owner per piece of state.** Workspaces and a Files tab's place (written only from
  `navigated`): `workspace/` (pure reducer; one parser for its saved form,
  `workspace/saved.ts`). Sockets, admission and reachability: `net/hosts.ts`, decided in
  `net/host.ts`. Navigation: `app/router.ts`, the only writer of browser history. Focus:
  `app/focus.ts`, the only caller of `.focus()` and `.blur()`. The listing:
  `app/listing.ts`, the only sender of `listSessions`. Persistence: `app/persist.ts`;
  per-device view settings: `app/viewMemory.ts`. Screens reach them through `useApp()`.
- **Every view of a server reads one state.** Only `Host` decides reachability: add no
  other timer for it, and feed it no HTTP response but the browser's admission check. A
  view showing a server's status switches on `serverState` (`net/hosts.ts`) rather than
  working it out from `admission` and `shown`. A server's GETs go through `client.fs` or
  `client.settings`, which refuse them while the server is unreachable
  ([plan.md](../docs/design/plan.md#reachability), "Requests"). A view that failed as
  `network` reloads from `hosts.recovered`. The state table:
  [net/.context/CONTEXT.md](net/.context/CONTEXT.md).
- **Environment lives only in `platform/`**; only `main.tsx` imports `platform/browser/`.
  `lint/rules.js` enforces it, and `lint/rules.test.ts` proves each rule fails on a
  seeded violation: change a rule and its case together.
- **Raw `<button>`, `<input>`, `<textarea>` live only in `ui/primitives/`** (and the two
  input owners and the hidden file input). Colour goes through `ui/tokens/semantic.css`.
  Each screen styles itself with a CSS module.
- **Every state, not the one in the mockup.** A new screen ships its loading, empty,
  error and offline states, and a harness fixture (`harness/<lane>/`) to look at it in
  both layouts.
- **The iOS bridge** is `platform/native/bridge.ts`; its `BRIDGE_VERSION` must equal
  native's `BridgeContract.version`, and `bridge.test.ts` decodes every fixture in
  `ios/MuxenKit/Tests/Fixtures/bridge/`, the contract's one copy.
