// Assembles the native Platform (client-architecture.md §5, ios-shell.md "The bridge"). Only
// main.tsx imports this. Native owns tokens, drafts, uploads and the
// pasteboard; this adapter forwards to the bridge and turns its events into PlatformEvents.
import { Bridge, installReceiver, webkitPost, type DownloadFailure, type Post } from "./bridge";
import { createNativeTransport } from "./transport";
import { createNativeUploads } from "./uploads";
import { createViewStore } from "../viewStore";
import { refusalWords } from "../../net/refusalWords";
import type { BootResult, Platform, PlatformEvent, Preferences, SavedWorkspaces } from "../types";

const EMPTY_WORKSPACE: SavedWorkspaces = { version: 5, workspaces: [] };

export function createNativePlatform(post: Post = webkitPost): Platform {
  const bridge = new Bridge(post);
  const view = createViewStore();
  const uploads = createNativeUploads(bridge);
  const listeners = new Set<(event: PlatformEvent) => void>();
  let booted = false;
  let pending: SavedWorkspaces | null = null;

  const emit = (event: PlatformEvent): void => {
    for (const l of [...listeners]) l(event);
  };

  // Native answers with every preference it holds: the stored ones when it declined (locked, or Face ID not confirmed). A failed request leaves the page as it was.
  const choose = <K extends keyof Preferences>(name: K, value: Preferences[K]): void => {
    bridge.setPreference(name, value).then((preferences) => { emit({ type: "preferences", preferences }); }, () => undefined);
  };

  // Install before `ready`, so no event is missed.
  installReceiver((msg) => {
    switch (msg.type) {
      case "upload": uploads.receive(msg); break;
      // Before `ready` replies the page isn't listening, and the reply is newer than these.
      default: if (booted) emit(msg); // hosts, viewport, lifecycle
    }
  });

  return {
    async boot(): Promise<BootResult> {
      const boot = await bridge.ready();
      booted = true;
      return boot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    transport: createNativeTransport(bridge),
    setPreference: choose,
    storage: {
      saveWorkspace(ws) {
        const scheduled = pending !== null;
        pending = ws;
        if (!scheduled) queueMicrotask(() => { if (pending) bridge.saveWorkspace(pending); pending = null; });
      },
      drafts: {
        get: (key) => bridge.draftGet(key),
        put: (record, baseRevision) => bridge.draftPut(record, baseRevision).catch(() => "failed" as const),
        delete: (key) => bridge.draftDelete(key),
        list: () => bridge.draftList(),
      },
      view,
      async clearLocalData() {
        view.clear();
        const records = await bridge.draftList();
        await Promise.all(records.map((r) => bridge.draftDelete(r.key)));
        bridge.saveWorkspace(EMPTY_WORKSPACE);
      },
    },
    uploads,
    clipboard: {
      writeText: (text) => bridge.copy(text).then(() => "ok" as const, () => "denied" as const),
      read: (tab) => bridge.readPasteboard(tab, crypto.randomUUID()).catch(() => "denied" as const),
    },
    shortcuts: "apple",
    openURL: (url) => { bridge.openURL(url); },
    download: async (url, name) => {
      const failure = await bridge.download(url, name).catch((): DownloadFailure => ({ error: "The app didn't take the request." }));
      if (failure === null) return null;
      return failure.code === undefined ? failure.error : refusalWords(failure.code);
    },
    playVideo: (handle, path) => {
      bridge.playVideo(handle, path);
      return "handled";
    },
    haptic: (kind) => { bridge.haptic(kind); },
    setBackSwipe: (enabled) => { bridge.backSwipe(enabled); },
    editMenu: (rect) => { bridge.editMenu(rect); },
    restart: () => { bridge.recreateWebView(); },
    manageHosts: () => { bridge.manageHosts(); },
    setRelock: (value) => { choose("relock", value); },
  };
}
