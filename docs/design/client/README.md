# Client design

Start here when implementing the desktop browser, the phone browser/PWA, or the iPhone
app. They share one web client; the iPhone app hosts it in a native shell.

## Which doc wins

The [interaction contract](browser-behaviors.md) governs layout and behavior on every
surface: Home lists the workspaces (a server's tabs), a workspace's tab overview lists
its tabs, and a tab shows the tab row (‹, tabs, +), at the top on desktop and at the
bottom on the phone. Files is a tab. With the keyboard up the phone's tab row stays and
the compose box and key row sit under it. Where another client doc or a subsystem spec
disagrees with the contract, the contract wins.

Subsystem invariants (security, resource budgets, tmux ownership) still apply to every
client. Suggestion strips and dedicated media controls are deferred.

## Read in order

1. [Interaction contract](browser-behaviors.md): navigation, sessions, tabs, files,
   creation, focus, naming, minimal controls, visual rules.
2. [Touch, clipboard, the line field](terminal-interaction-design.md): the touch and
   clipboard design, measured constraints, and real-device checks.
3. [Browser setup](browser-setup.md): the PWA delivery contract (hosting, platform
   boundaries, offline drafts, updates). Authentication is in [auth.md](../auth.md).
4. [Connection roadmap](connection-roadmap.md): the delivery order and the
   security gates before any access beyond the tailnet.
5. The product [plan](../plan.md), [native shell](../ios-shell.md),
   [daemon and protocol](../daemon-core.md), [auth](../auth.md) and [files](../fs.md).

The native app is in `ios/`; start with [ios/AGENTS.md](../../../ios/AGENTS.md). Its
design is [ios-shell.md](../ios-shell.md), including signing and distribution; the
checks it still needs on the phone are that spec's
[device checklist](../ios-shell.md#device-checklist).

## Research evidence

- [Primary sources](terminal-interaction-sources.md).
- [Isolated tmux 3.4 paste/wrap probe](terminal-interaction-probe.md).
- [Pinned xterm 6.0.0 source study and headless probe](terminal-selection-source-research.md).

The daemon reconstructs active-grid soft wraps in restore bytes and sends a packed wrap
map with each history chunk, so copy joins wrapped rows into logical lines; verify with
the headless and real-tmux checks listed in [src/tmux/AGENTS.md](../../../src/tmux/AGENTS.md).
Still to verify on a real iPhone: tap versus scroll versus long-press arbitration (so
selection never sends a remote click), selection and clipboard in Safari and WKWebView,
streaming-output selection stability, Unicode, multiline and trailing-newline paste,
IME and dictation, storage failure, keyboard hide/show/rotation and hardware input. tmux
3.8 fixtures are not recorded yet. Paste uses tmux's mode-aware paste route; embedded
newlines can execute commands even when no extra Enter is appended. Line-field drafts
need stable target identity, local save-failure feedback, and no automatic retry after
uncertain delivery.
