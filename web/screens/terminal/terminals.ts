// The terminal surface and every tab's driver, outside Preact (client-architecture.md §3.2,
// §6.5, §7). The renderer and its element live for the page's life: this object owns them and
// the screen only places the element, so a screen that unmounts (an admission problem
// replaces the shell) never loses the buffer or a tab's watch. It runs the pieces no
// component should: one `TabDriver` per open tab, tmux's size from the stable box, desktop
// direct input, and (in `Pastes`) paste.
import type { AppController } from "../../app/controller";
import type { HostClient } from "../../net/hosts";
import type { InputEvent, TextSize, Viewport } from "../../platform/types";
import { acceptsInsert, type ConnectionState } from "../../tabs/connection";
import { TabDriver } from "../../tabs/driver";
import { decideKey } from "../../tabs/keymap";
import type { SessionRef, ShownWindow } from "../../proto/generated/messages";
import { createXtermView, TerminalModel, type CellSize, type PromptLine, type XtermView } from "../../term";
import { TerminalSizer } from "../../term/size";
import { ArmedModifiers } from "../../touch/armed";
import { routeHardwareKey, type RowKey } from "../../touch/keyRoute";
import { createOwnedInput } from "../../touch/owned-input";
import { Store } from "../../ui/store";
import { terminalTheme } from "../../ui/theme";
import { activeTab, allTabs, screenOf, shownTab, terminalTabOf } from "../../workspace/state";
import { failureText } from "../sessions/createSession";
import { interceptClipboard, Pastes } from "./paste";
import styles from "./Terminal.module.css";
import { RowList } from "./rowList";
import { TerminalView } from "./view";

/** What the pill and the status band read for a tab. */
export interface TabStatus {
  state: ConnectionState;
  /** When the tab stopped being live, or opened (ms since the epoch). */
  downSince: number;
  /** When the next automatic retry fires, null if none is due. */
  retryAt: number | null;
  /** The window's size has differed from this tab's for longer than the driver's wait: another terminal holds the window. */
  sizedForOther: boolean;
  /** The session's current window as the tab's latest `watching` says; null before the first. */
  shown: ShownWindow | null;
}

interface TerminalsView {
  tabs: Readonly<Record<string, TabStatus>>;
  /** The terminal has a renderer, a cell size and a tmux size: tabs can watch. */
  ready: boolean;
  /** The view is above the newest line (in the buffer or the history): the jump-to-latest control shows. */
  scrolled: boolean;
}

/** A few frames for xterm to paint and the cell to become measurable. */
const MEASURE_FRAMES = 30;
/**
 * Keys typed within this long go as one `input` message. The daemon refuses a burst of
 * separate messages with `busy` once enough are in flight, and a refused input has no reply
 * to tell the client, so a fast typist or a slow machine would lose characters.
 */
const INPUT_BATCH_MS = 8;

const instances = new WeakMap<AppController, Terminals>();

/** The viewport inputs the muxen chrome depends on; a keyboard changes none of them. */
function chromeInputsChanged(a: Viewport, b: Viewport): boolean {
  const sa = a.safeArea;
  const sb = b.safeArea;
  return a.layout !== b.layout || a.density !== b.density || a.directInput !== b.directInput || a.width !== b.width ||
    a.stableHeight !== b.stableHeight || sa.top !== sb.top || sa.right !== sb.right || sa.bottom !== sb.bottom || sa.left !== sb.left;
}

/** The one terminal surface of this app. */
export function terminalsOf(app: AppController): Terminals {
  let terminals = instances.get(app);
  if (!terminals) {
    terminals = new Terminals(app);
    instances.set(app, terminals);
  }
  return terminals;
}

export class Terminals extends Store<TerminalsView> {
  /** The element the renderer draws into; the screen places it and never creates it. */
  readonly element: HTMLDivElement = document.createElement("div");
  /**
   * The model, once the element has a size, and the views of it. The row list draws it on every input but
   * desktop's (`"xterm"`), where xterm's view does; each is created the first time it is needed, and the other
   * stays hidden and keeps parsing (an iPad that gains or loses a trackpad switches without a fetch).
   */
  private surface: { model: TerminalModel; xterm: XtermView | null; list: RowList | null } | null = null;
  private creating = false;
  private readonly drivers = new Map<string, TabDriver>();
  private readonly sizer: TerminalSizer;
  private viewport: Viewport;
  private textSize: TextSize;
  /**
   * Whether laid-out measures read the chrome off the surface. "open" from the start until ready and
   * for two frames after the chrome's inputs change; "pending" when that change found the surface hidden,
   * which the first laid-out measure then reads and closes, so a keyboard is never read as chrome.
   */
  private chromeWindow: "open" | "pending" | "closed" = "open";
  private registered: HTMLElement | null = null;
  /** The tab whose snapshot is on the surface. Another tab's content never shows under a pill that isn't its own. Closing that tab clears it. */
  private painted: string | null = null;
  /** Keys typed for one tab and one window, which is the window the tab showed when they were typed. */
  private batch: { id: string; window: number | null; events: InputEvent[] } | null = null;
  private batchTimer: ReturnType<typeof setTimeout> | undefined;
  /** muxen's own input on a phone; created the first time it is needed. */
  private owned: HTMLTextAreaElement | null = null;
  /** What remains visible above the keyboard, for the row list; null is all of it. */
  private visible: number | null = null;
  /** The shown pane is larger than the box: the renderer stays DOM. */
  private paneLarge = false;
  /** The shell's command line under the cursor, for a tap on the prompt row. */
  private promptLine: PromptLine | null = null;
  /** The touch side of looking at the shown tab: scroll, history, selection, gestures. */
  private readonly view: TerminalView;
  /** Paste, copy and inserted paths. */
  readonly pastes: Pastes;
  /** The armed ctrl or alt of the touch sources; it types through this surface. */
  readonly modifiers = new ArmedModifiers((events) => { this.type(events); });
  /** What the key row does to the compose box, set by the mounted LineField. */
  lineEditor: { insert: (text: string) => void; step: (step: -1 | 1) => void } | null = null;

  constructor(private readonly app: AppController) {
    super({ tabs: {}, ready: false, scrolled: false });
    this.viewport = app.snapshot.viewport;
    this.textSize = app.snapshot.preferences.textSize;
    this.element.className = styles.host ?? "";
    this.element.dataset["blank"] = "true"; // until the first snapshot: no pretend-live empty terminal
    this.sizer = new TerminalSizer({
      cell: () => this.activeCell(),
      // A new size redraws the rows, and a selection on them goes first.
      onChange: (size) => {
        this.view.dismissSelection();
        this.shownDriver()?.resize(size);
      },
    });
    this.pastes = new Pastes({
      app,
      driver: (id) => this.drivers.get(id),
      shown: () => this.shownTerminalTab(),
      flushInput: () => { this.flushInput(); },
      takeSelection: () => this.view.takeSelection(),
      dismissSelection: () => { this.view.dismissSelection(); },
    });
    interceptClipboard(this.element, {
      onPaste: (pasted) => { this.pastes.paste(pasted); },
      // The phone's selection is the rows' text; desktop's is xterm's own.
      selectionText: () => this.view.selectionText() || (this.surface?.xterm?.selectionText() ?? ""),
    });
    this.view = new TerminalView({
      element: this.element,
      renderer: () => this.surface?.xterm ?? null,
      list: () => this.surface?.list ?? null,
      model: () => this.surface?.model ?? null,
      theme: terminalTheme,
      fetchHistory: (start, end) => this.shownDriver()?.history(start, end) ?? null,
      send: (id, events) => { this.typeTo(id, events); },
      haptic: (kind) => { this.app.platform.haptic(kind); },
      editMenu: () => this.app.platform.editMenu,
      directInput: () => this.viewport.directInput,
      prompt: () => this.promptLine,
      owner: () => this.app.focus.snapshot.owner,
      raiseKeyboard: () => { this.app.focus.focusTarget("terminal", true); },
      onScrolled: (scrolled) => { this.update({ scrolled }); },
    });
    new ResizeObserver(() => { this.measure(); }).observe(this.element);
    app.subscribe(() => { this.sync(); });
    app.focus.subscribe(() => { this.drawCursor(); });
    app.platform.subscribe((event) => {
      // The app's edit menu over the mark.
      if (event.type === "menuCopy") this.pastes.copySelection();
      if (event.type === "menuPaste") this.pastes.pasteFromMenu();
    });
    this.sizer.setViewport(this.viewport);
    this.sync();
  }

  /**
   * A key from the key row, or a hardware key while the dock holds the keyboard:
   * route it against the live owner and armed state, then carry out the route (`ArmedModifiers.route`
   * sends the terminal ones).
   */
  key(key: RowKey): void {
    const owner = this.app.focus.snapshot.owner;
    if (owner === "none") return;
    const route = this.modifiers.route(key, owner);
    if (route.to === "focusTerminal") {
      this.app.focus.focusTarget("terminal", true);
      return;
    }
    if (route.to === "terminal") return;
    if (route.to === "line") this.lineEditor?.insert(route.text);
    else this.lineEditor?.step(route.step);
  }

  /** Places the surface in `slot`. The renderer is created once the surface has a size. */
  mount(slot: HTMLElement): void {
    if (this.element.parentElement !== slot) slot.append(this.element);
    this.measure();
  }

  /**
   * Selects a tab. A tab that is waiting to reconnect retries now: a tap on its pill is the user asking.
   * Switching tabs in the tab row keeps a raised keyboard up: it goes to the new tab's input, which is
   * the terminal, or a Files tab's path field (browser-behaviors.md "Phone dock").
   */
  activate(id: string): void {
    const { viewport, workspace } = this.app.snapshot;
    const tab = allTabs(workspace).find((t) => t.id === id);
    if (viewport.keyboard && workspace.route.kind === "tab" && tab) this.app.focus.keepKeyboardOn(tab.kind === "terminal" ? "terminal" : "path");
    this.app.dispatch({ type: "activated", id });
    const status = this.snapshot.tabs[id];
    if (status?.state.kind === "reconnecting" || status?.state.kind === "limited") this.drivers.get(id)?.nudge();
  }

  /** Makes `window` the tab's session's current window; the tab follows with the next `watching`. */
  selectWindow(id: string, window: number): void {
    if (!this.drivers.get(id)?.selectWindow(window)) this.app.notify("Couldn't switch window: the tab isn't connected");
  }

  /** The long-press menu's New window: `new-window` on the tab's session, whichever window it shows. The tab follows the session to it. */
  async newWindow(id: string): Promise<void> {
    const tab = terminalTabOf(this.app.snapshot.workspace, id);
    const client = tab && this.app.hosts.byHostId(tab.host);
    if (!tab || !client) return;
    try {
      await client.socket.request(
        (req) => ({ type: "newWindow", data: { req, session: tab.key.session } }),
        (reply) => (reply.type === "created" ? reply.data : undefined),
      );
    } catch (error) {
      this.app.notify(failureText(error, client.name ?? "the server", "open a window"));
    }
  }

  /** The band's Fit: sizes the window to this tab and so takes it from the other terminal. */
  fit(id: string): void {
    this.drivers.get(id)?.fit();
  }

  /** The tab's own Retry. */
  retry(id: string): void {
    this.drivers.get(id)?.nudge();
  }

  /** Whether `id`'s tab takes Insert path now (the driver's own rule, read from its state): a connecting tab does, and the path waits for its watch. */
  canInsert(id: string): boolean {
    const state = this.snapshot.tabs[id]?.state;
    return state !== undefined && acceptsInsert(state);
  }

  /**
   * The line field's Return: one paste with Enter, run in the same tmux group by the daemon
   * (daemon-core.md §3.4). Returns the paste's `req`, or null, with nothing sent, when the tab
   * isn't live. Its one answer goes to {@link Pastes.claim}' claimant, not to a notice.
   */
  sendLine(id: string, text: string): number | null {
    this.flushInput(); // what was typed before goes first
    return this.drivers.get(id)?.paste(text, true) ?? null;
  }

  /** Named keys for one tab, now (the line field's empty Return). False when the tab isn't live. */
  sendKeys(id: string, events: InputEvent[]): boolean {
    this.flushInput();
    return this.drivers.get(id)?.input(events) ?? false;
  }

  /** The jump-to-latest control. */
  toLatest(): void {
    this.view.toLatest();
  }

  /** What remains visible of the terminal above the dock, for the keyboard; null follows the surface. */
  setVisible(px: number | null): void {
    this.visible = px;
    this.surface?.list?.setVisible(px);
  }

  private sync(): void {
    const { viewport, workspace, preferences } = this.app.snapshot;
    // A text size changes the column count: the new fit is measured and sent as one resize.
    if (preferences.textSize !== this.textSize) {
      this.textSize = preferences.textSize;
      this.refont();
    }
    if (viewport !== this.viewport) {
      const before = this.viewport;
      this.viewport = viewport;
      this.sizer.setViewport(viewport);
      if (viewport.scheme !== before.scheme) {
        this.surface?.xterm?.setTheme(terminalTheme()); // the list's colours are CSS variables and follow the scheme by themselves
      }
      if (viewport.density !== before.density) this.refont();
      if (viewport.directInput !== before.directInput) this.applyInput();
      if (chromeInputsChanged(before, viewport)) this.openChromeWindow();
      this.measure();
    }
    const tabs = allTabs(workspace);
    for (const tab of tabs) {
      if (tab.kind !== "terminal" || this.drivers.has(tab.id)) continue;
      const client = this.app.hosts.byHostId(tab.host);
      if (client) this.open(tab.id, tab.key.session, client);
    }
    for (const [id, driver] of this.drivers) {
      if (tabs.some((t) => t.id === id)) continue;
      this.drivers.delete(id);
      if (this.painted === id) this.painted = null;
      driver.close();
      this.update({ tabs: Object.fromEntries(Object.entries(this.snapshot.tabs).filter(([key]) => key !== id)) });
    }
    // The tab on screen watches once the box is measured; every other tab rests covered. Both calls are idempotent.
    const shown = this.shownTerminalTab();
    for (const [id, driver] of this.drivers) {
      if (id === shown && this.snapshot.ready) driver.uncover();
      else driver.cover();
    }
    this.showPainted();
    // What one tab had going on the surface (a coast, a held drag, a selection) is not the next tab's.
    this.view.show(shown);
  }

  private patchStatus(id: string, patch: Partial<Pick<TabStatus, "sizedForOther" | "shown">>): void {
    const status = this.snapshot.tabs[id];
    if (status) this.update({ tabs: { ...this.snapshot.tabs, [id]: { ...status, ...patch } } });
  }

  /** On Terminal the surface shows a tab only once its own snapshot has painted; off Terminal it keeps what it holds, for the return, unless no tab is left. */
  private showPainted(): void {
    const { workspace } = this.app.snapshot;
    const onTerminal = screenOf(workspace) === "terminal";
    const blank = !allTabs(workspace).some((t) => t.kind === "terminal") || (onTerminal && this.painted !== activeTab(workspace)?.id);
    if (blank) this.element.dataset["blank"] = "true";
    else if (onTerminal) this.element.removeAttribute("data-blank");
  }

  private open(id: string, session: SessionRef, client: HostClient): void {
    const hostId = client.hostId ?? "";
    const driver = new TabDriver({
      session,
      model: {
        output: (bytes) => { this.surface?.model.output(bytes); },
        snapshot: async (snapshot) => {
          // The renderer follows the snapshot's pane alone, never the tab's own resizes: DOM before xterm grows to a pane larger
          // than the box (a canvas that size runs the phone out of memory), WebGL again only once a fitting pane is in place.
          const box = this.sizer.sizeForWatch();
          this.view.dismissSelection();
          this.paneLarge = snapshot.cols > box.cols || snapshot.rows > box.rows;
          if (this.paneLarge) this.surface?.xterm?.setWebgl(false);
          await this.surface?.model.snapshot(snapshot);
          if (!this.paneLarge && this.viewport.directInput === "xterm") this.surface?.xterm?.setWebgl(true);
          // What was fetched or selected sat above the buffer this snapshot replaced; the list takes the reset frame now, before the surface shows.
          this.view.reset();
          this.surface?.list?.update();
          // The surface now holds this tab's content, whichever tab is on screen by the time xterm finished parsing.
          this.painted = id;
          this.showPainted();
        },
      },
      host: client.socket,
      size: () => this.sizer.sizeForWatch(),
      // A tab never watches before the box is measured: tmux must not see the 80x24 placeholder.
      covered: true,
      onState: (state) => { this.stateChanged(id, hostId, session.server, state); },
      onSizedForOther: (sizedForOther) => { this.patchStatus(id, { sizedForOther }); },
      onWatching: (watching) => {
        this.patchStatus(id, { shown: watching.window });
        this.app.dispatch({ type: "watching", id, window: watching.window.name });
      },
      onNotice: (text) => { this.app.notify(text); },
      onPasteResult: (result) => { this.pastes.result(id, result); },
    });
    this.drivers.set(id, driver);
  }

  private stateChanged(id: string, hostId: string, server: string, state: ConnectionState): void {
    const now = Date.now();
    const before = this.snapshot.tabs[id];
    const down = state.kind !== "live";
    const status: TabStatus = {
      state,
      downSince: down ? (before?.state.kind !== "live" && before ? before.downSince : now) : now,
      retryAt: state.kind === "reconnecting" && state.retryInMs !== null ? now + state.retryInMs : state.kind === "limited" ? now + state.retryInMs : null,
      sizedForOther: before?.sizedForOther ?? false,
      shown: before?.shown ?? null,
    };
    this.update({ tabs: { ...this.snapshot.tabs, [id]: status } });
    if (state.kind !== "closed") return;
    // A session or server that went away closes the tab; a tab the user closed already left.
    if (state.reason === "sessionClosed") this.app.dispatch({ type: "sessionClosed", id });
    else if (state.reason === "serverExited") this.app.dispatch({ type: "serverExited", hostId, server });
  }

  /** Keystrokes for the tab on screen now. */
  private type(events: InputEvent[]): void {
    const id = this.shownTerminalTab();
    if (id !== null) this.typeTo(id, events);
  }

  /** Keystrokes for tab `id`, held for a few milliseconds to share a message; dropped if it is not the tab on screen any more. */
  private typeTo(id: string, events: InputEvent[]): void {
    if (id !== this.shownTerminalTab()) return;
    // Typing returns to the newest line.
    if (!this.view.atLatest) this.view.toLatest();
    // Keys go to the window the tab showed when they were typed, even if it follows its session to another within the batch.
    const window = this.drivers.get(id)?.windowId ?? null;
    if (this.batch && (this.batch.id !== id || this.batch.window !== window)) this.flushInput();
    if (this.batch) this.batch.events.push(...events);
    else this.batch = { id, window, events: [...events] };
    this.batchTimer ??= setTimeout(() => { this.flushInput(); }, INPUT_BATCH_MS);
  }

  /** Sends what was typed, in order, to the tab it was typed in and no other; dropped if that tab isn't watching. */
  private flushInput(): void {
    clearTimeout(this.batchTimer);
    this.batchTimer = undefined;
    const batch = this.batch;
    this.batch = null;
    if (batch) this.drivers.get(batch.id)?.input(batch.events, batch.window);
  }

  private shownDriver(): TabDriver | undefined {
    const id = this.shownTerminalTab();
    return id === null ? undefined : this.drivers.get(id);
  }

  /** The selected tab watches only while no native screen covers Terminal. */
  private shownTerminalTab(): string | null {
    const { workspace, lifecycle } = this.app.snapshot;
    return lifecycle.covered ? null : shownTab(workspace);
  }

  /**
   * The muxen chrome is whatever surrounds the surface in the keyboard-hidden layout: the stable
   * box less the surface. It changes only when layout, density, width or the safe area do
   * (client-architecture.md §5.4), so it is measured in a short window after such a change and
   * at the start; a keyboard shrinking a native web view's surface never opens one.
   */
  private openChromeWindow(): void {
    this.chromeWindow = "open";
    // Two frames: the change renders, then the surface lays out against it.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.measure();
        if (this.chromeWindow === "open") this.chromeWindow = this.element.clientWidth > 0 ? "closed" : "pending";
      });
    });
  }

  private measure(frame = 0): void {
    const { clientWidth: width, clientHeight: height } = this.element;
    const laidOut = width > 0 && height > 0;
    if (!this.surface) {
      if (laidOut) void this.createSurface();
      return;
    }
    // Hidden, only the box is unknown: the cell comes from the font, so the sizer stays current for the return.
    if (this.chromeWindow !== "closed" && laidOut) {
      const { viewport } = this;
      const { top, right, bottom, left } = viewport.safeArea;
      this.sizer.setChrome({ x: viewport.width - left - right - width, y: viewport.stableHeight - top - bottom - height });
      if (this.chromeWindow === "pending") this.chromeWindow = "closed";
    }
    this.sizer.remeasure();
    if (this.sizer.measured) {
      this.becomeReady();
    } else if (frame < MEASURE_FRAMES) {
      requestAnimationFrame(() => { this.measure(frame + 1); });
    }
  }

  private becomeReady(): void {
    if (this.snapshot.ready) return;
    this.chromeWindow = "closed";
    this.update({ ready: true });
    this.sync();
  }

  /** One cell's size from the font alone, for the view that draws now. */
  private activeCell(): CellSize | null {
    return (this.viewport.directInput === "xterm" ? this.surface?.xterm?.fontCell() : this.surface?.list?.cellSize()) ?? null;
  }

  private async createSurface(): Promise<void> {
    if (this.creating) return;
    this.creating = true;
    // The cell is measured from the font: the faces must be in.
    const style = getComputedStyle(this.element);
    const size = style.fontSize;
    await Promise.all([document.fonts.load(`${size} muxen-mono`), document.fonts.load(`bold ${size} muxen-mono`)]).catch(() => undefined);
    const model = new TerminalModel();
    this.surface = { model, xterm: null, list: null };
    model.onPromptLine((line) => { this.promptLine = line; });
    // The symbols fallback arrives after first paint: xterm's glyphs draw once its atlas is cleared.
    document.fonts.addEventListener("loadingdone", () => { this.surface?.xterm?.refreshGlyphs(); });
    this.applyInput();
    this.measure();
  }

  /** Makes the view the input calls for exist and show, and hides the other. */
  private showView(): void {
    const { surface } = this;
    if (!surface) return;
    const font = getComputedStyle(this.element);
    if (this.viewport.directInput !== "xterm") {
      if (!surface.list) {
        const list = new RowList(surface.model, this.view.listOptions);
        surface.list = list;
        this.element.append(list.element);
        list.setFont(font.fontFamily, parseFloat(font.fontSize));
        list.setVisible(this.visible);
      }
      surface.xterm?.setHidden(true);
      surface.list.setHidden(false);
      return;
    }
    surface.list?.setHidden(true);
    if (!surface.xterm) {
      const xterm = createXtermView(surface.model, this.element, {
        fontFamily: font.fontFamily,
        fontSize: parseFloat(font.fontSize),
        theme: terminalTheme(),
        openLink: (url) => { this.app.platform.openURL(url); },
      });
      surface.xterm = xterm;
      xterm.onScrolledUp(() => { this.view.scroll.scrolledChanged(); });
    }
    surface.xterm.setHidden(false);
  }

  private refont(): void {
    const { surface } = this;
    if (!surface) return;
    this.view.dismissSelection(); // a new font redraws every row
    const style = getComputedStyle(this.element);
    surface.xterm?.setFont(style.fontFamily, parseFloat(style.fontSize));
    surface.list?.setFont(style.fontFamily, parseFloat(style.fontSize));
    requestAnimationFrame(() => { this.measure(); });
  }

  /** Desktop direct input is xterm's own textarea, held by the focus controller; a phone's is muxen's owned input. */
  private applyInput(): void {
    if (!this.surface) return;
    this.showView();
    const renderer = this.surface.xterm;
    const { directInput } = this.viewport;
    const xterm = directInput === "xterm";
    // The surface's own look follows the input (Terminal.module.css); a trackpad appearing on an iPad closes a phone's selection.
    this.element.dataset["directInput"] = directInput;
    // Where the mark is the selection (the app) the rows are not selectable, so iOS's long press starts none of its own.
    this.element.toggleAttribute("data-marking", this.app.platform.editMenu !== undefined);
    this.view.dismissSelection();
    renderer?.setWebgl(xterm && !this.paneLarge);
    renderer?.setInput(
      xterm
        ? {
            input: (events: InputEvent[]) => { this.type(events); },
            copy: () => {
              const text = renderer.selectionText();
              if (text) void this.app.platform.clipboard.writeText(text);
            },
            // A keypress is a gesture, so this focus is allowed on a touch laptop too.
            leave: () => { this.app.focus.focusTarget("tabs", true); },
          }
        : null,
    );
    if (this.registered) this.app.focus.withdraw("terminal", this.registered);
    // Where muxen's own input takes the keyboard, xterm's helper textarea is inert: out of the accessibility tree, so VoiceOver cannot land on it.
    const helper = renderer?.inputElement();
    if (xterm) helper?.removeAttribute("aria-hidden");
    else helper?.setAttribute("aria-hidden", "true");
    // On a phone the keys beside the text (below) go to tmux from here.
    if (xterm) document.removeEventListener("keydown", this.hardwareKey);
    else document.addEventListener("keydown", this.hardwareKey);
    this.registered = xterm ? renderer?.inputElement() ?? null : this.ownedInput();
    this.drawCursor();
    if (!this.registered) return;
    this.app.focus.register("terminal", this.registered);
    if (xterm) this.focusIfIdle();
  }

  /**
   * The hardware keys that do not type text go to tmux (`routeHardwareKey`). The listener is on the
   * document's bubble phase and stands down for a key already claimed (`defaultPrevented`, or a
   * stopPropagation), so the line box's Enter and a menu's Escape keep theirs. Another focused
   * element, an open dialog and an IME composing keep their keys. A tab menu is not modal: its other keys go to the terminal.
   */
  private readonly hardwareKey = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;
    const held = document.activeElement;
    const free = this.shownTerminalTab() !== null && this.app.snapshot.entry.overlay === null && (!held || held === document.body);
    const route = routeHardwareKey(decideKey(event, "owned"), event, this.app.focus.snapshot.owner, free);
    if (route.to === "ignore") return;
    event.preventDefault();
    if (route.to === "row") this.key(route.key);
    else this.modifiers.input(route.events);
  };

  /** The owned input lives in the surface, so the capture-phase paste listener sees its pastes; the keyboard toggle focuses it. */
  private ownedInput(): HTMLTextAreaElement {
    if (!this.owned) {
      this.owned = createOwnedInput((events) => { this.modifiers.input(events); });
      this.element.append(this.owned);
    }
    return this.owned;
  }

  /**
   * Solid block while the terminal holds the keyboard, hollow otherwise (§7.4); a desktop's real xterm focus
   * draws itself. The look is CSS keyed to an attribute: an xterm option change would redraw every row, and
   * a selection on the rows with them.
   */
  private drawCursor(): void {
    const solid = this.viewport.directInput !== "xterm" && this.app.focus.snapshot.owner === "terminal";
    if (solid) this.element.dataset["cursor"] = "solid";
    else delete this.element.dataset["cursor"];
  }

  /**
   * Arriving at Terminal puts desktop focus in it, but the first time that happens the input
   * element may not exist yet (the fonts load first): focus it once it does, unless
   * something else, a dialog or a field, has taken the focus meanwhile.
   */
  private focusIfIdle(): void {
    const { entry, workspace } = this.app.snapshot;
    const holder = document.activeElement;
    if (screenOf(workspace) !== "terminal" || entry.overlay !== null || (holder && holder !== document.body)) return;
    this.app.focus.focusTarget("terminal");
  }
}
