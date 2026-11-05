// One server's section of Settings (browser-behaviors.md "A server's settings"): what its
// config.toml keeps and applies without a restart, read from the server each time Settings opens
// and drawn as it answers. Nothing is kept on the device. Saves go one at a time, in order, each
// built from the server's latest answer, so quick taps can't reorder.
import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { HostClient } from "../../net/hosts";
import { HttpRefusal } from "../../net/http";
import { refusalWords } from "../../net/refusalWords";
import type { ServerSettings, SettingsChange } from "../../proto/generated/messages";
import { Button } from "../../ui/primitives/Button";
import { IconButton } from "../../ui/primitives/IconButton";
import { Spinner } from "../../ui/primitives/Spinner";
import { TextField } from "../../ui/primitives/TextField";
import styles from "./Settings.module.css";

type Load = { kind: "loading" } | { kind: "unreachable" } | { kind: "loaded"; settings: ServerSettings };

/** What the last Reload said, until the next one. */
type Reloaded = { kind: "broken"; where: string | null } | { kind: "restart"; keys: string[] } | { kind: "failed"; words: string };

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

export function ServerSection({ host }: { host: HostClient }) {
  const name = host.name ?? host.entry.name ?? "the server";
  const headingId = useId();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [saving, setSaving] = useState(0);
  const [adding, setAdding] = useState("");
  const [skipError, setSkipError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<string | null>(null);
  const [uploadsError, setUploadsError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [reloaded, setReloaded] = useState<Reloaded | null>(null);
  // The server's latest answer, which the next save in the queue builds on.
  const latest = useRef<ServerSettings | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const api = host.settings;

  const answered = (settings: ServerSettings): void => {
    latest.current = settings;
    setLoad({ kind: "loaded", settings });
  };

  const read = (): void => {
    setLoad({ kind: "loading" });
    api.read().then(answered, () => { setLoad({ kind: "unreachable" }); });
  };
  useEffect(read, [api]);

  const why = (error: unknown): string => {
    if (!(error instanceof HttpRefusal) || error.code === "network") return `Can't reach ${name}. Nothing changed.`;
    if (error.code === "config_unavailable") return `config.toml on ${name} doesn't parse${error.detail ? `: ${error.detail}` : ""}. Fix it there.`;
    return refusalWords(error.code);
  };

  /** Queues a save; `change` sees the server's latest answer and returns null to skip. Resolves true if it saved. */
  const save = (change: (now: ServerSettings) => SettingsChange | null, failed: (words: string) => void): Promise<boolean> => {
    const run = queue.current.then(async () => {
      const now = latest.current;
      const body = now && change(now);
      if (!body) return false;
      setSaving((n) => n + 1);
      try {
        answered(await api.save(body));
        return true;
      } catch (error) {
        failed(why(error));
        return false;
      } finally {
        setSaving((n) => n - 1);
      }
    });
    queue.current = run.then(() => undefined);
    return run;
  };

  const reload = async (): Promise<void> => {
    setReloading(true);
    try {
      const answer = await api.reload();
      answered(answer.settings);
      setUploads(null);
      setReloaded(answer.restartNeeded.length > 0 ? { kind: "restart", keys: answer.restartNeeded } : null);
    } catch (error) {
      if (error instanceof HttpRefusal && error.code === "config_unavailable") setReloaded({ kind: "broken", where: error.detail ?? null });
      else setReloaded({ kind: "failed", words: why(error) });
    } finally {
      setReloading(false);
    }
  };

  return (
    <section class={styles.section} aria-labelledby={headingId}>
      <h3 id={headingId} class={styles.heading}>{name}</h3>
      {load.kind === "loading" && (
        <p class={styles.loading}><Spinner label={`Loading ${name}'s settings`} /> Loading…</p>
      )}
      {load.kind === "unreachable" && (
        <div class={styles.unreachable}>
          <p class={styles.detail}>Can't reach {name}.</p>
          <Button variant="secondary" onClick={read}>Try again</Button>
        </div>
      )}
      {load.kind === "loaded" && (() => {
        const { settings } = load;
        const skips = settings.searchSkip ?? settings.defaults.searchSkip;
        const busy = saving > 0;
        const failSkip = (words: string): void => { setSkipError(words); };
        const add = (): void => {
          const pattern = adding.trim();
          if (pattern === "") return;
          if (pattern.includes("/")) { setSkipError("A folder name, without /."); return; }
          if (/^\*+$/.test(pattern)) { setSkipError("That would skip every folder."); return; }
          setSkipError(null);
          void save((now) => {
            const list = now.searchSkip ?? now.defaults.searchSkip;
            return list.includes(pattern) ? null : { searchSkip: [...list, pattern] };
          }, failSkip).then((saved) => { if (saved) setAdding(""); });
        };
        const remove = (pattern: string): void => {
          setSkipError(null);
          void save((now) => ({ searchSkip: (now.searchSkip ?? now.defaults.searchSkip).filter((p) => p !== pattern) }), failSkip);
        };
        const typed = uploads ?? settings.uploadsDir ?? "";
        const commitUploads = (): void => {
          if (uploads === null) return;
          const wanted = uploads.trim() === "" ? null : uploads.trim();
          if (wanted === settings.uploadsDir) { setUploads(null); return; }
          if (wanted !== null && !wanted.startsWith("/") && !wanted.startsWith("~/")) {
            setUploadsError("Start with / or ~/.");
            return;
          }
          setUploadsError(null);
          void save(() => ({ uploadsDir: wanted }), setUploadsError).then((saved) => { if (saved) setUploads(null); });
        };
        return (
          <>
            <p class={styles.detail}>Kept in config.toml on {name}. A change applies at once, on every device.</p>
            {settings.fileChanged && (
              <div class={styles.notice} role="status">
                <p>config.toml has changed since muxen loaded it.</p>
                <Button variant="secondary" busy={reloading} onClick={() => { void reload(); }}>
                  {reloading ? "Reloading…" : "Reload config.toml"}
                </Button>
              </div>
            )}
            {reloaded?.kind === "broken" && (
              <p class={styles.error} role="alert">
                config.toml doesn't parse{reloaded.where ? `: ${reloaded.where}` : ""}. muxen keeps the values below until it does.
              </p>
            )}
            {reloaded?.kind === "restart" && (
              <p class={styles.detail} role="status">Restart muxen to apply: {reloaded.keys.join(", ")}</p>
            )}
            {reloaded?.kind === "failed" && <p class={styles.error} role="alert">{reloaded.words}</p>}

            <div class={styles.field}>
              <h4 class={styles.label}>Search skips</h4>
              <p class={styles.detail}>Folders Search lists but doesn't look inside. A folder name, or <code>*</code> and <code>?</code> to match part of one.</p>
              {skips.length === 0 ? (
                <p class={styles.detail}>Search looks inside every folder.</p>
              ) : (
                <ul class={styles.patterns}>
                  {skips.map((pattern) => (
                    <li key={pattern} class={styles.pattern}>
                      <code>{pattern}</code>
                      <IconButton icon="close" label={`Remove ${pattern}`} aria-disabled={busy || undefined} onClick={() => { if (!busy) remove(pattern); }} />
                    </li>
                  ))}
                </ul>
              )}
              <TextField label="Add a folder" value={adding} onInput={(v) => { setAdding(v); setSkipError(null); }} onCommit={add} error={skipError} />
              {!same(skips, settings.defaults.searchSkip) && (
                <Button variant="quiet" class={styles.reset} busy={busy} onClick={() => { setSkipError(null); void save(() => ({ searchSkip: null }), failSkip); }}>
                  Reset to {settings.defaults.searchSkip.join(", ")}
                </Button>
              )}
            </div>

            <div class={styles.field}>
              <TextField
                label="Uploads folder"
                placeholder={settings.defaults.uploadsDir}
                value={typed}
                onInput={(v) => { setUploads(v); setUploadsError(null); }}
                onCommit={commitUploads}
                hint={`Where Upload and pasted images land. Empty means ${settings.defaults.uploadsDir}.`}
                error={uploadsError}
              />
            </div>
            {busy && <p class={styles.loading}><Spinner label="Saving" /> Saving…</p>}
          </>
        );
      })()}
    </section>
  );
}
