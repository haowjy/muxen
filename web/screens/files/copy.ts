// Copying from Files: a path (absolute, as a shell takes it) or a file's text. A copy chosen from a menu has no
// button left on screen to confirm it, so a notice names what was copied.
import type { AppController } from "../../app/controller";
import { shorten } from "../../files/format";

/** Copies `text`; false, with the refusal said, when the browser refused the clipboard. */
export async function copyText(app: AppController, text: string): Promise<boolean> {
  if ((await app.platform.clipboard.writeText(text)) === "ok") return true;
  app.notify("Couldn't copy: this browser refused clipboard access");
  return false;
}

/** Copies the absolute `path`, and says so (`home` shortens what the notice shows). */
export async function copyPath(app: AppController, path: string, home: string | null): Promise<void> {
  if (await copyText(app, path)) app.notify(`Copied ${shorten(path, home)}`);
}
