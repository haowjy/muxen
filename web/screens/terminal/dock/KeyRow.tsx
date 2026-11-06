// The dock's key row (client-architecture.md §7.4): the keys a phone keyboard lacks, on a KeyStrip.
// Where a key goes (tmux, or the compose box that holds the keyboard) is `routeKey`'s decision;
// ctrl and alt arm the next key.
import { useApp } from "../../../app/context";
import { KeyStrip } from "../../../ui/primitives/KeyStrip";
import { useStore } from "../../../ui/store";
import { ROW_KEYS, routeKey } from "../../../touch/keyRoute";
import { terminalsOf } from "../terminals";

export function KeyRow() {
  const app = useApp();
  const terminals = terminalsOf(app);
  const { modifiers } = terminals;
  const armed = useStore(modifiers, (s) => s.armed);
  const owner = useStore(app.focus, (s) => s.owner);

  if (owner === "none") return null; // the row is mounted only while typing

  return (
    <KeyStrip
      label="Terminal keys"
      keys={ROW_KEYS.map((spec) => ({
        label: spec.label,
        aria: "aria" in spec ? spec.aria : undefined,
        repeat: "repeat" in spec && spec.repeat,
        pressed: "modifier" in spec ? armed === spec.modifier : undefined,
        // The two destinations look different: a key whose tap lands in the compose box rather than in tmux.
        acts: "key" in spec && routeKey(spec.key, owner, armed).route.to !== "terminal" ? "box" : undefined,
        // `terminals.key` routes against the live owner and armed state, not this render's: a held key fires from the render it was pressed in.
        onPress: () => { if ("modifier" in spec) modifiers.toggle(spec.modifier); else terminals.key(spec.key); },
        onDown: () => { app.platform.haptic("modifier" in spec ? "modifier" : "key"); },
      }))}
    />
  );
}
