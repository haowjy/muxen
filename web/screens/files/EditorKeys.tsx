import { useApp, useAppView } from "../../app/context";
import { ROW_KEYS } from "../../touch/keyRoute";
import { KeyStrip } from "../../ui/primitives/KeyStrip";
import { useStore } from "../../ui/store";
import type { FilesSession } from "./session";

/** The terminal's key row, as far as its keys mean something in text, above the keyboard while the editor holds it. */
export function EditorKeys({ session }: { session: FilesSession }) {
  const app = useApp();
  const live = useStore(session.edits, (s) => s.live);
  const keyboard = useAppView((v) => v.viewport.keyboard);
  if (!live || !keyboard) return null;
  const { editor } = live;
  return (
    <KeyStrip
      label="Editing keys"
      keys={ROW_KEYS.flatMap((spec) => ("key" in spec && editor.presses(spec.key) ? [{
        label: spec.label,
        aria: spec.aria,
        repeat: spec.repeat ?? false,
        onPress: () => { editor.press(spec.key); },
        onDown: () => { app.platform.haptic("key"); },
      }] : []))}
    />
  );
}
