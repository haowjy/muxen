import { useEffect, useState } from "preact/hooks";
import { useApp } from "../../app/context";
import { formatSize, formatTime } from "../../files/format";
import { describeError, type FileRef } from "../../files/browser";
import type { ViewerKind } from "../../files/kinds";
import type { LinkTarget } from "../../files/render/markdown";
import type { HttpRefusal } from "../../net/http";
import { Button } from "../../ui/primitives/Button";
import { ImageViewer } from "./ImageViewer";
import type { FilesSession } from "./session";
import { CodeViewer, MarkdownViewer } from "./TextViewers";
import styles from "./Viewers.module.css";

function Meta({ file }: { file: FileRef }) {
  return (
    <dl class={styles.meta}>
      <dt>Path</dt><dd class={styles.mono}>{file.path}</dd>
      {file.size !== null && <><dt>Size</dt><dd>{formatSize(file.size)}</dd></>}
      {file.mtime !== null && <><dt>Modified</dt><dd>{formatTime(file.mtime)}</dd></>}
      {file.mime && <><dt>Type</dt><dd class={styles.mono}>{file.mime}</dd></>}
    </dl>
  );
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
      <Meta file={file} />
      <Button variant="primary" onClick={() => { app.platform.playVideo(session.handle, file.path); }}>Play {file.name}</Button>
    </div>
  );
}

/** The viewer for `kind`, under the file's header (`FileView`), which owns the viewer's controls. */
export function Preview({ session, file, kind, plain, wrap, onAsText, onLink }: { session: FilesSession; file: FileRef; kind: ViewerKind; plain: boolean; wrap: boolean; onAsText: () => void; onLink: (target: LinkTarget) => void }) {
  const describe = (error: HttpRefusal): string => describeError(error, session.hostName);
  const api = session.browser.api;
  return (
    <div class={styles.viewer}>
      {kind === "code" && <CodeViewer key={file.path} api={api} file={file} wrap={wrap} plain={plain} describe={describe} />}
      {kind === "markdown" && <MarkdownViewer key={file.path} api={api} file={file} onLink={onLink} describe={describe} />}
      {kind === "image" && <ImageViewer key={file.path} url={api.rawUrl(file.path)} name={file.name} />}
      {kind === "media" && <MediaViewer key={file.path} session={session} file={file} />}
      {kind === "binary" && (
        <div class={styles.panel}>
          <Meta file={file} />
          <Button onClick={onAsText}>Open as text</Button>
        </div>
      )}
    </div>
  );
}
