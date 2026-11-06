// One server's section of Settings (browser-behaviors.md "A server's settings"): what its
// config.toml keeps and applies without a restart, read from the server each time Settings opens.
// The host's `SettingsClient` owns the server's answer and the queue of saves, so a save outlives
// the screen; this draws it and keeps only what is being typed. Every change is built from the
// server's latest answer when its turn comes, so quick taps can't undo each other.
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { serverState, type HostClient } from "../../net/hosts";
import { refusalWords } from "../../net/refusalWords";
import type { HttpRefusal } from "../../net/http";
import type { ServerSettings } from "../../proto/generated/messages";
import { admissionCopy, offlineWords } from "../../ui/hostProblem";
import { Button } from "../../ui/primitives/Button";
import { IconButton } from "../../ui/primitives/IconButton";
import { Spinner } from "../../ui/primitives/Spinner";
import { TextField } from "../../ui/primitives/TextField";
import { useStore } from "../../ui/store";
import { Section } from "./Section";
import styles from "./Settings.module.css";

/** The daemon's limits (fs.md "Server settings"), checked here so a refusal has words. */
const MAX_PATTERNS = 64;
const MAX_PATTERN_BYTES = 255;
const MAX_UPLOADS_DIR_BYTES = 4096;

const bytes = (text: string): number => new TextEncoder().encode(text).length;
const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const skipsOf = (settings: ServerSettings): string[] => settings.searchSkip ?? settings.defaults.searchSkip;

/** Why a pattern can't be added to `skips`, in words; null if it can. */
function patternProblem(pattern: string, skips: readonly string[]): string | null {
  if (pattern.includes("/")) return "A folder name, without /.";
  if (/^\*+$/.test(pattern)) return "That would skip every folder.";
  if (bytes(pattern) > MAX_PATTERN_BYTES) return "A folder name of at most 255 bytes.";
  if (!skips.includes(pattern) && skips.length >= MAX_PATTERNS) return `At most ${String(MAX_PATTERNS)} folders. Remove one first.`;
  return null;
}

/** Why `dir` can't be the uploads folder, in words; null if it can. */
function uploadsProblem(dir: string): string | null {
  if (!dir.startsWith("/") && dir !== "~" && !dir.startsWith("~/")) return "Start with / or ~.";
  if (bytes(dir) > MAX_UPLOADS_DIR_BYTES) return "At most 4,096 bytes.";
  return null;
}

/** Which control takes focus once the answer that removes the one holding it is drawn. */
type Refocus = { after: "remove"; pattern: string; index: number } | { after: "reset" };

export function ServerSection({ host, name }: { host: HostClient; name: string }) {
  const app = useApp();
  const client = host.settings;
  const view = useStore(client, (v) => v);
  const touch = useAppView((v) => v.viewport.density === "touch");
  const [adding, setAdding] = useState("");
  const [addProblem, setAddProblem] = useState<string | null>(null);
  // What is typed in Uploads folder; null: the field shows the server's value.
  const [uploads, setUploads] = useState<string | null>(null);
  const [uploadsProblemWords, setUploadsProblem] = useState<string | null>(null);
  const skipField = useRef<HTMLDivElement>(null);
  const refocus = useRef<Refocus | null>(null);

  useEffect(() => { client.read(); }, [client]);
  // A server that answers again fills in what could not load.
  useEffect(() => app.hosts.recovered(host.entry.handle, () => {
    if (client.snapshot.settings === null || client.snapshot.unreachable) client.read();
  }), [app, client, host.entry.handle]);

  const why = (failed: HttpRefusal | null): string | null => {
    if (!failed) return null;
    if (failed.code === "network") return `Can't reach ${name}. Nothing changed.`;
    if (failed.code === "config_unavailable") return `config.toml on ${name} doesn't parse${failed.detail ? `: ${failed.detail}` : ""}. Fix it there.`;
    return refusalWords(failed.code);
  };

  const settings = view.settings;
  const skips = settings ? skipsOf(settings) : [];

  // A Remove or Reset hid the control that held focus. After Remove, the next row's Remove takes it,
  // else the previous row's, else the Add field; after Reset, the Add field. Never the field on
  // touch, where focusing it raises the keyboard: the first row's Remove instead.
  useLayoutEffect(() => {
    const wanted = refocus.current;
    const field = skipField.current;
    // Not before the answer that hides the control is drawn.
    const shown = wanted?.after === "remove" ? skips.includes(wanted.pattern) : settings !== null && !same(skips, settings.defaults.searchSkip);
    if (!wanted || !field || shown) return;
    refocus.current = null;
    const removes = [...field.querySelectorAll<HTMLElement>("li button")];
    const input = touch ? null : field.querySelector<HTMLElement>("input");
    const next = wanted.after === "remove" ? (removes[wanted.index] ?? removes[wanted.index - 1] ?? input) : (input ?? removes[0] ?? null);
    app.focus.refocus(next);
  });

  const state = serverState(host);
  if (state.kind === "attention" || state.kind === "noNetwork") {
    const words = state.kind === "noNetwork" ? offlineWords(host.entry.pageOrigin === null) : admissionCopy(state.admission, name, host.entry.pageOrigin === null)?.title;
    return (
      <Section title={name}>
        <p class={styles.detail}>{words}</p>
      </Section>
    );
  }
  if (state.kind === "unreachable" || view.unreachable) {
    return (
      <Section title={name}>
        <div class={styles.unreachable}>
          <p class={styles.detail}>Can't reach {name}</p>
          <Button variant="secondary" onClick={() => { app.retryHost(host.entry.handle); client.read(); }}>Try again</Button>
        </div>
      </Section>
    );
  }
  if (!settings) {
    return (
      <Section title={name}>
        <p class={styles.loading}><Spinner label={`Loading ${name}'s settings`} /> Loading…</p>
      </Section>
    );
  }

  const add = (): void => {
    const pattern = adding.trim();
    if (pattern === "") return;
    const problem = patternProblem(pattern, skips);
    setAddProblem(problem);
    if (problem) return;
    void client.save("searchSkip", (now) => {
      const list = skipsOf(now);
      return list.includes(pattern) ? null : { searchSkip: [...list, pattern] };
    }).then((saved) => { if (saved) setAdding(""); });
  };
  // A failed save leaves its control where it was, with focus.
  const keepFocusIfFailed = (saved: boolean): void => { if (!saved) refocus.current = null; };
  const remove = (pattern: string, index: number): void => {
    refocus.current = { after: "remove", pattern, index };
    void client.save("searchSkip", (now) => {
      const list = skipsOf(now);
      return list.includes(pattern) ? { searchSkip: list.filter((p) => p !== pattern) } : null;
    }).then(keepFocusIfFailed);
  };
  const reset = (): void => {
    refocus.current = { after: "reset" };
    void client.save("searchSkip", (now) => (now.searchSkip === null ? null : { searchSkip: null })).then(keepFocusIfFailed);
  };
  const commitUploads = (): void => {
    if (uploads === null) return;
    const wanted = uploads.trim() === "" ? null : uploads.trim();
    const problem = wanted === null ? null : uploadsProblem(wanted);
    setUploadsProblem(problem);
    if (problem) return;
    void client.save("uploadsDir", (now) => (now.uploadsDir === wanted ? null : { uploadsDir: wanted }))
      .then((saved) => { if (saved) setUploads(null); });
  };

  const skipError = addProblem ?? why(view.failed.searchSkip);
  const uploadsError = uploadsProblemWords ?? why(view.failed.uploadsDir);
  const reloadError = why(view.failed.reload);
  return (
    <Section title={name}>
      {settings.fileChanged && (
        <div class={styles.notice}>
          <p role="status">config.toml has changed since muxen loaded it.</p>
          <Button variant="secondary" busy={view.reloading} onClick={() => { client.reload(); }}>
            {view.reloading ? "Reloading…" : "Reload config.toml"}
          </Button>
        </div>
      )}
      {view.broken && (
        <p class={styles.error} role="alert">
          config.toml doesn't parse{view.broken.where ? `: ${view.broken.where}` : ""}. muxen keeps the values below until it does.
        </p>
      )}
      {settings.restartNeeded.length > 0 && (
        <p class={styles.detail} role="status">Restart muxen to apply: {settings.restartNeeded.join(", ")}</p>
      )}
      {reloadError && <p class={styles.error} role="alert">{reloadError}</p>}

      <div class={styles.field} ref={skipField}>
        <h4 class={styles.label}>Search skips</h4>
        <p class={styles.detail}>Folders Search lists but doesn't look inside. A folder name, or <code>*</code> and <code>?</code> to match part of one.</p>
        {skips.length === 0 ? (
          <p class={styles.detail}>Search looks inside every folder.</p>
        ) : (
          <ul class={styles.patterns}>
            {skips.map((pattern, index) => (
              <li key={pattern} class={styles.pattern}>
                <code>{pattern}</code>
                <IconButton icon="close" label={`Remove ${pattern}`} onClick={() => { remove(pattern, index); }} />
              </li>
            ))}
          </ul>
        )}
        <TextField
          label="Add a folder"
          value={adding}
          onInput={(v) => { setAdding(v); setAddProblem(null); client.dismiss("searchSkip"); }}
          onCommit={add}
          error={skipError}
          // Disabled while empty without a reason beside it: the empty field it sits in is the reason.
          action={<Button variant="secondary" disabled={adding.trim() === ""} onClick={add}>Add</Button>}
        />
        {!same(skips, settings.defaults.searchSkip) && (
          <Button variant="quiet" class={styles.reset} onClick={reset}>
            Reset to {settings.defaults.searchSkip.join(", ")}
          </Button>
        )}
      </div>

      <div class={styles.field}>
        <TextField
          label="Uploads folder"
          placeholder={settings.defaults.uploadsDir}
          value={uploads ?? settings.uploadsDir ?? ""}
          onInput={(v) => { setUploads(v); setUploadsProblem(null); client.dismiss("uploadsDir"); }}
          onCommit={commitUploads}
          hint={`Where Upload and pasted images land. Empty means ${settings.defaults.uploadsDir}.`}
          error={uploadsError}
        />
      </div>
      {view.saving > 0 && <p class={styles.loading}><Spinner label="Saving" /> Saving…</p>}
    </Section>
  );
}
