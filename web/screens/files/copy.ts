// Copying from Files: a path (in the form the screen shows: `~/…` under home) or a file's text. A copy chosen from a menu has no
// button left on screen to confirm it, so a notice names what was copied.
import type { AppController } from "../../app/controller";
import { shorten } from "../../files/format";

/** Copies `text`, then says `notice` when given; false, with the refusal said, when the browser refused the clipboard. */
export async function copyText(app: AppController, text: string, notice: string | null = null): Promise<boolean> {
  if ((await app.platform.clipboard.writeText(text)) !== "ok") {
    app.notify("Couldn't copy: this browser refused clipboard access");
    return false;
  }
  if (notice !== null) app.notify(notice);
  return true;
}

/** Copies `path` as the screen shows it (`~/…` under `home`, else absolute), and says so. */
export async function copyPath(app: AppController, path: string, home: string | null): Promise<void> {
  const shown = shorten(path, home);
  await copyText(app, shown, `Copied ${shown}`);
}
