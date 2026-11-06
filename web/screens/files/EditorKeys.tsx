import { useApp, useAppView } from "../../app/context";
import { ROW_KEYS, type RowKeySpec } from "../../touch/keyRoute";
import { KeyStrip } from "../../ui/primitives/KeyStrip";
import { useStore } from "../../ui/store";
import type { FilesSession } from "./session";

/** The terminal's keys that mean something in text: not its modifiers or chords, or Esc and Return. */
const inText = (spec: RowKeySpec): spec is Extract<RowKeySpec, { key: unknown }> =>
  "key" in spec && ("text" in spec.key || /^(Left|Right|Up|Down|Tab|BTab)$/.test(spec.key.name));

const KEYS = ROW_KEYS.filter(inText);

/** The key row, above the keyboard, while the editor holds it. */
export function EditorKeys({ session }: { session: FilesSession }) {
  const app = useApp();
  const live = useStore(session.edits, (s) => s.live);
  const keyboard = useAppView((v) => v.viewport.keyboard);
  if (!live || !keyboard) return null;
  return (
    <KeyStrip
      label="Editing keys"
      keys={KEYS.map((spec) => ({
        label: spec.label,
        aria: spec.aria,
        repeat: spec.repeat ?? false,
        onPress: () => { live.editor.press(spec.key); },
        onDown: () => { app.platform.haptic("key"); },
      }))}
    />
  );
}
