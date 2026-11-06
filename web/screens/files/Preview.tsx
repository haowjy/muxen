import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useApp } from "../../app/context";
import { formatSize, formatTime, shorten } from "../../files/format";
import type { FileRef } from "../../files/browser";
import type { ViewerKind } from "../../files/kinds";
import type { LinkTarget } from "../../files/render/markdown";
import { Button } from "../../ui/primitives/Button";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { Icon } from "../../ui/primitives/Icon";
import { useStore } from "../../ui/store";
import { DownloadButton } from "./FileActions";
import { useShown } from "./failure";
import { fileIcon } from "./fileIcon";
import { ImageViewer } from "./ImageViewer";
import type { FilesSession } from "./session";
import type { TextPreview } from "../../files/api";
import { CodeViewer, MarkdownViewer, type Loaded } from "./TextViewers";
import styles from "./Viewers.module.css";

function Meta({ session, file }: { session: FilesSession; file: FileRef }) {
  const home = useStore(session.browser, (s) => s.home);
  return (
    <dl class={styles.meta}>
      <dt>Path</dt><dd class={styles.mono}>{shorten(file.path, home)}</dd>
      {file.size !== null && <><dt>Size</dt><dd>{formatSize(file.size)}</dd></>}
      {file.mtime !== null && <><dt>Modified</dt><dd>{formatTime(file.mtime)}</dd></>}
      {file.mime && <><dt>Type</dt><dd class={styles.mono}>{file.mime}</dd></>}
    </dl>
  );
}

/** A viewer that loads by URL starts unless the server is off or the phone offline, as the guard sends a GET, and once started is never cut short (plan.md "Requests"). */
function Waits({ session, children }: { session: FilesSession; children: ComponentChildren }) {
  const shown = useShown(session);
  const started = useRef(false);
  if (shown !== "unreachable" && shown !== "noNetwork") started.current = true;
  return started.current ? <>{children}</> : <EmptyState icon="alert" title={`Waiting for ${session.hostName}`} />;
}

/** Video and audio: native's player opens on arrival; the browser plays them inline over Range requests. */
function MediaViewer({ session, file }: { session: FilesSession; file: FileRef }) {
  const app = useApp();
  const [mode, setMode] = useState<"checking" | "handled" | "inline">("checking");
  useEffect(() => {
    setMode(app.platform.playVideo(session.handle, file.path) === "handled" ? "handled" : "inline");
  }, [app, session.handle, file.path]);
  const url = session.browser.api.rawUrl(file.path);
  if (mode === "checking") return null;
  if (mode === "inline") {
    return (
      <div class={styles.media}>
        {(file.mime ?? "").startsWith("audio/")
          ? <audio controls preload="metadata" src={url} aria-label={file.name} />
          : <video controls playsInline preload="metadata" src={url} aria-label={file.name} />}
      </div>
    );
  }
  return (
    <div class={styles.panel}>
      <Meta session={session} file={file} />
      <Button variant="primary" onClick={() => { app.platform.playVideo(session.handle, file.path); }}>Play {file.name}</Button>
    </div>
  );
}

/** A file muxen has no viewer for: what it is, and a big Download and Open as text. */
function Unsupported({ session, file, onAsText }: { session: FilesSession; file: FileRef; onAsText: () => void }) {
  const home = useStore(session.browser, (s) => s.home);
  const size = file.size !== null ? formatSize(file.size) : null;
  return (
    <div class={styles.unsupported}>
      <div class={styles.card}>
        <h2 class={styles.cardTitle}><Icon name={fileIcon(file.name, file.mime)} size={20} class={styles.cardIcon} /><span>{file.name}</span></h2>
        <p class={styles.why}>muxen can't preview this kind of file.</p>
        <dl class={styles.meta}>
          {file.mime && <><dt>Type</dt><dd>{file.mime}</dd></>}
          {size !== null && <><dt>Size</dt><dd>{size}</dd></>}
          {file.mtime !== null && <><dt>Modified</dt><dd>{formatTime(file.mtime)}</dd></>}
          <dt>Path</dt><dd class={styles.mono}>{shorten(file.path, home)}</dd>
        </dl>
        <div class={styles.cardActions}>
          <DownloadButton big url={session.browser.api.rawUrl(file.path)} name={file.name} size={size} />
          <Button variant="quiet" onClick={onAsText}>Open as text</Button>
        </div>
      </div>
    </div>
  );
}

/** The viewer for `kind`, under the file's header (`FileView`), which owns the viewer's controls. */
export function Preview({ session, file, text, kind, plain, wrap, onAsText, onLink }: { session: FilesSession; file: FileRef; text: Loaded<TextPreview>; kind: ViewerKind; plain: boolean; wrap: boolean; onAsText: () => void; onLink: (target: LinkTarget) => void }) {
  const api = session.browser.api;
  return (
    <div class={styles.viewer}>
      {kind === "code" && <CodeViewer key={file.path} session={session} text={text} file={file} wrap={wrap} plain={plain} />}
      {kind === "markdown" && <MarkdownViewer key={file.path} session={session} text={text} file={file} onLink={onLink} />}
      {kind === "image" && <Waits key={file.path} session={session}><ImageViewer session={session} url={api.rawUrl(file.path)} name={file.name} /></Waits>}
      {kind === "media" && <Waits key={file.path} session={session}><MediaViewer session={session} file={file} /></Waits>}
      {kind === "binary" && <Unsupported session={session} file={file} onAsText={onAsText} />}
    </div>
  );
}
