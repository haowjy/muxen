// Touch gestures against a real daemon on a private tmux (3.4 and 3.7b), at phone size with
// real touch input (CDP `Input.dispatchTouchEvent`, so the browser's own pointer pipeline,
// `touch-action` included, runs). Each assertion crosses the whole path and reads what the
// pane received with `tmux capture-pane` (client-architecture.md §7.6, §11, P3b). Chromium only:
// WebKit has no touch injection beyond a tap. The device-only checks (haptic, momentum feel,
// selection handles, the system back gesture) are in g3-iphone-checklist.md.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { openSessionRow } from "../shared/home";
import { startStack, type Stack, type TmuxVersion } from "../shared/stack";

const VERSIONS = (process.env["MUXEN_E2E_TMUX"] ?? "3.4,3.7b").split(",") as TmuxVersion[];

test.use({ viewport: { width: 393, height: 852 }, hasTouch: true });
test.skip(({ browserName }) => browserName !== "chromium", "touch injection needs CDP");

/** One finger on the page, in client pixels. */
class Finger {
  constructor(private readonly cdp: CDPSession, private readonly page: Page) {}
  async down(x: number, y: number): Promise<void> {
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  }
  async move(x: number, y: number): Promise<void> {
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
  }
  async up(): Promise<void> {
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  /** Moves from (x0, y0) to (x1, y1) in `steps` events `gap` ms apart. */
  async drag(x0: number, y0: number, x1: number, y1: number, steps = 10, gap = 12): Promise<void> {
    for (let i = 1; i <= steps; i++) {
      await this.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
      if (i < steps) await this.page.waitForTimeout(gap); // no wait after the last move: a fling needs the lift close behind it
    }
  }
}

for (const version of VERSIONS) {
  test.describe(`tmux ${version}`, () => {
    test.describe.configure({ mode: "serial" });
    let stack: Stack;
    let sessions = 0;

    test.beforeAll(async () => {
      test.setTimeout(120_000);
      stack = await startStack({ tmux: version, name: `gesture-${test.info().project.name}-${version}`, memoryMiB: 72 });
    });
    test.afterAll(async () => { await stack.stop(); });

    function newSession(command = "env BASH_SILENCE_DEPRECATION_WARNING=1 PS1='$ ' bash --norc --noprofile"): string {
      const name = `g${String(++sessions)}`;
      stack.tmux("new-session", "-d", "-s", name, "-x", "100", "-y", "30", command);
      return name;
    }
    const pane = (session: string): string => stack.tmux("capture-pane", "-p", "-J", "-t", session);
    const paneIncludes = async (session: string, text: string | RegExp, timeout = 10_000): Promise<void> => {
      await expect.poll(() => pane(session), { timeout }).toMatch(typeof text === "string" ? new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : text);
    };
    const count = (session: string, needle: string): number => pane(session).split(needle).length - 1;

    async function open(page: Page, session: string): Promise<Finger> {
      await page.goto(`${stack.url}/#/`);
      await openSessionRow(page, session);
      await page.waitForFunction(() => { const host = document.querySelector("[data-rows], .xterm")?.parentElement; return host !== null && host !== undefined && !host.hasAttribute("data-blank"); });
      await page.waitForTimeout(400); // the snapshot's size settles
      return new Finger(await page.context().newCDPSession(page), page);
    }

    /** Where cell (col, row) is in client pixels: the screen is the list's newest rows, the cell as wide as the list's `--cell-width`. */
    async function cellCentre(page: Page, session: string, col: number, row: number): Promise<{ x: number; y: number }> {
      const [, rows] = stack.tmux("display-message", "-p", "-t", session, "#{pane_width} #{pane_height}").trim().split(" ").map(Number);
      const at = await page.evaluate(([index, count]) => {
        const list = document.querySelector<HTMLElement>("[data-rows]");
        const screen = [...document.querySelectorAll<HTMLElement>("[data-rows] [data-seq]")].slice(-(count ?? 0));
        const box = screen[index ?? 0]?.getBoundingClientRect();
        if (!list || !box) throw new Error("no screen");
        return { left: list.getBoundingClientRect().left, cell: parseFloat(list.style.getPropertyValue("--cell-width")), top: box.top, height: box.height };
      }, [row, rows ?? 0]);
      return { x: at.left + (col + 0.5) * at.cell, y: at.top + at.height / 2 };
    }

    /** The screen's centre column, `row` rows down. */
    const mid = async (page: Page, session: string, row = 5): Promise<{ x: number; y: number }> => {
      const [cols] = stack.tmux("display-message", "-p", "-t", session, "#{pane_width}").trim().split(" ").map(Number);
      return await cellCentre(page, session, Math.floor((cols ?? 40) / 2), row);
    };

    /** The page's selection from the start of the row holding `from` to `offset` characters into the row holding `to`. */
    async function select(page: Page, from: string, to: string, offset: number): Promise<void> {
      await page.evaluate(([fromRow, toRow, end]) => {
        const rows = [...document.querySelectorAll<HTMLElement>("[data-rows] [data-seq]")];
        const text = (needle: string | undefined): Node => {
          const row = rows.find((r) => r.textContent.includes(needle ?? ""));
          const node = row && document.createTreeWalker(row, NodeFilter.SHOW_TEXT).nextNode();
          if (!node) throw new Error(`no row with ${needle ?? ""}`);
          return node;
        };
        getSelection()?.setBaseAndExtent(text(fromRow), 0, text(toRow), Number(end));
      }, [from, to, String(offset)]);
    }

    test("a long press is the system's: no snapshot, no menu of muxen's, and nothing reaches the pane", async ({ page }) => {
      const s = newSession();
      const finger = await open(page, s);
      stack.tmux("send-keys", "-t", s, "echo alpha beta gamma", "Enter");
      await paneIncludes(s, /^alpha beta gamma$/m);
      const row = stack.tmux("capture-pane", "-p", "-t", s).split("\n").findIndex((l) => l === "alpha beta gamma");
      const at = await cellCentre(page, s, 7, row);
      const before = pane(s);
      await finger.down(at.x, at.y);
      await page.waitForTimeout(550);
      await finger.up();
      await expect(page.locator("[data-row]")).toHaveCount(0);
      await expect(page.getByRole("menuitem", { name: "Copy" })).toHaveCount(0);
      expect(pane(s)).toBe(before);
    });

    test("Copy joins a soft-wrapped command into one line, from the page's selection of the rows", async ({ page }) => {
      const s = newSession();
      await open(page, s);
      const words = Array.from({ length: 24 }, (_, i) => `word${String(i).padStart(2, "0")}`).join(" ");
      // The command line holds neither the words nor the tail as typed, so the output's rows are the only matches.
      stack.tmux("send-keys", "-t", s, "echo $(seq -f 'word%02g' 0 23); printf 'ta%s\\n' il-line", "Enter");
      await paneIncludes(s, /^tail-line$/m);
      await expect(page.locator("[data-rows]")).toContainText("tail-line");
      await select(page, "word00", "tail-line", 4);
      const copied = await page.evaluate(() => {
        const data = new DataTransfer();
        const rows = document.querySelectorAll("[data-rows] [data-seq]");
        rows[rows.length - 1]?.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
        return data.getData("text/plain");
      });
      expect(copied).toBe(`${words}\ntail`);
      // A range dragged out of the terminal keeps what is inside it; one ending at the next row's start adds no blank line.
      const copyAfter = (extend: string): Promise<string> => page.evaluate((how) => {
        const selection = getSelection();
        const rows = [...document.querySelectorAll("[data-rows] [data-seq]")];
        const tail = rows.find((r) => r.textContent.includes("tail-line"));
        if (!selection || !tail?.nextElementSibling) throw new Error("no tail row");
        if (how === "out") selection.extend(document.body, document.body.childNodes.length);
        else selection.setBaseAndExtent(tail.firstChild ?? tail, 0, tail.nextElementSibling, 0);
        const data = new DataTransfer();
        tail.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
        return data.getData("text/plain");
      }, extend);
      expect(await copyAfter("row-end")).toBe("tail-line");
      await select(page, "word00", "tail-line", 4);
      expect((await copyAfter("out")).startsWith(`${words}\ntail-line`)).toBe(true);
    });

    test("a tap elsewhere closes a selection of the rows and does nothing else", async ({ page }) => {
      const s = newSession();
      const finger = await open(page, s);
      stack.tmux("send-keys", "-t", s, "printf 'alp%s\\n' ha-beta", "Enter");
      await paneIncludes(s, /^alpha-beta$/m);
      await expect(page.locator("[data-rows]")).toContainText("alpha-beta");
      const row = stack.tmux("capture-pane", "-p", "-t", s).split("\n").findIndex((l) => l === "alpha-beta");
      const before = pane(s);
      await select(page, "alpha-beta", "alpha-beta", 5);
      expect(await page.evaluate(() => getSelection()?.toString())).toBe("alpha");
      const away = await cellCentre(page, s, 40, row + 3);
      await finger.down(away.x, away.y);
      await finger.up();
      expect(await page.evaluate(() => getSelection()?.toString())).toBe("");
      expect(pane(s)).toBe(before);
      await expect(page.getByRole("textbox", { name: "Terminal keyboard" })).not.toBeFocused(); // it closed the selection and raised nothing
    });

    test("a tap in an application with mouse mode sends a click at the cell", async ({ page }) => {
      const mouse = newSession("sh -c \"printf '\\033[?1000h\\033[?1006h'; exec cat -vt\"");
      const finger = await open(page, mouse);
      const at = await cellCentre(page, mouse, 9, 7);
      await finger.down(at.x, at.y);
      await finger.up();
      await paneIncludes(mouse, "^[[<0;10;8M^[[<0;10;8m");
      await expect(page.getByRole("textbox", { name: "Terminal keyboard" })).not.toBeFocused(); // a click, not a request for the keyboard
    });

    test("a tap on the terminal raises the keyboard inside its touchend, and the key row's toggle lowers it", async ({ page }) => {
      const shell = newSession();
      const finger = await open(page, shell);
      await paneIncludes(shell, /\$ /);
      const before = pane(shell);
      const keyboard = page.getByRole("textbox", { name: "Terminal keyboard" });
      // The page's listener on the document runs after the surface's, in the same dispatch: what holds focus now is what the tap's own handler made.
      await page.evaluate(() => {
        document.addEventListener("touchend", () => { (window as unknown as { heldAtTouchEnd: string | null }).heldAtTouchEnd = document.activeElement?.getAttribute("aria-label") ?? null; });
      });
      await expect(keyboard).not.toBeFocused();
      const far = await mid(page, shell, 8);
      await finger.down(far.x, far.y);
      await finger.up();
      await expect(keyboard).toBeFocused();
      expect(await page.evaluate(() => (window as unknown as { heldAtTouchEnd: string | null }).heldAtTouchEnd)).toBe("Terminal keyboard");
      // With it up, a tap keeps it there (the row under the prompt may move the cursor, which sends nothing at a shell's empty line).
      const near = await mid(page, shell, 1);
      await finger.down(near.x, near.y);
      await finger.up();
      await expect(keyboard).toBeFocused();
      await page.getByRole("button", { name: "Hide keyboard" }).click();
      await expect(keyboard).not.toBeFocused();
      await page.waitForTimeout(300);
      expect(pane(shell)).toBe(before);
    });

    test("a tap in vim with mouse on moves the cursor", async ({ page }) => {
      const file = `${stack.dir}/vim-text`;
      const out = `${stack.dir}/vim-pos`;
      const s = newSession(`sh -c "printf 'one\\ntwo\\nthree is longer\\nfour\\n' > ${file}; exec vim -u NONE -N -c 'set mouse=a' ${file}"`);
      const finger = await open(page, s);
      await paneIncludes(s, /three is longer/);
      const at = await cellCentre(page, s, 6, 2);
      await finger.down(at.x, at.y);
      await finger.up();
      await page.waitForTimeout(300);
      stack.tmux("send-keys", "-t", s, ":call writefile([line('.') . ':' . col('.')], '" + out + "')", "Enter");
      await expect.poll(() => (existsSync(out) ? readFileSync(out, "utf8").trim() : ""), { timeout: 10_000 }).toBe("3:7");
    });

    test("a vertical swipe scrolls the list natively, a selection survives it and output below it, and Jump to latest returns", async ({ page }) => {
      const s = newSession();
      const finger = await open(page, s);
      stack.tmux("send-keys", "-t", s, "seq 1 400 | sed 's/^/row /'", "Enter");
      await paneIncludes(s, /row 400/);
      await expect(page.locator("[data-rows]")).toContainText("row 400");
      const at = await mid(page, s, 4);
      const jump = page.getByRole("button", { name: "Jump to latest" });
      const scrollTop = (): Promise<number> => page.locator("[data-rows]").evaluate((list) => list.scrollTop);
      await expect(jump).toHaveCount(0);
      const latest = await scrollTop();
      // A selection on rows high in the list stays put through the scroll (design.md J7: scrolling redraws nothing).
      await select(page, "row 300", "row 301", 3);
      const selected = await page.evaluate(() => getSelection()?.toString());
      for (let i = 0; i < 3; i++) {
        await finger.down(at.x, at.y);
        await finger.drag(at.x, at.y, at.x, at.y + 300, 8, 6);
        await finger.up();
        await page.waitForTimeout(700);
      }
      await expect(jump).toBeVisible();
      expect(await scrollTop()).toBeLessThan(latest - 300);
      expect(await page.evaluate(() => getSelection()?.toString())).toBe(selected);
      // Output while scrolled up appends below and moves nothing.
      const held = await scrollTop();
      stack.tmux("send-keys", "-t", s, "seq 1 50", "Enter");
      await paneIncludes(s, /^50$/m);
      await page.waitForTimeout(500);
      expect(await scrollTop()).toBe(held);
      expect(await page.evaluate(() => getSelection()?.toString())).toBe(selected);
      await jump.tap();
      await expect(jump).toHaveCount(0);
      expect(Math.abs((await scrollTop()) - latest)).toBeLessThan(2000);
    });

    test("a held finger at the top: the text under it does not move while tmux's history lands above", async ({ page }) => {
      test.setTimeout(60_000);
      const s = newSession();
      stack.tmux("send-keys", "-t", s, "seq -f 'line %05g' 1 4000", "Enter");
      await paneIncludes(s, "line 04000", 30_000);
      const finger = await open(page, s);
      const probe = { x: 200, y: 440 };
      await page.evaluate(({ x, y }) => {
        const log: [string | null, number | null, number][] = [];
        (window as unknown as { log: typeof log }).log = log;
        const tick = (): void => {
          const row = document.elementFromPoint(x, y)?.closest("[data-seq]");
          log.push([row?.textContent ?? null, row ? row.getBoundingClientRect().top : null, document.querySelectorAll("[data-rows] [data-seq]").length]);
          requestAnimationFrame(tick);
        };
        tick();
      }, probe);
      await page.evaluate(() => { (window as unknown as { log: unknown[] }).log.length = 0; });
      await finger.down(200, 400);
      await finger.drag(200, 400, probe.x, probe.y, 4, 16);
      await page.waitForTimeout(2500); // the prefetch fills in chunks under the still finger
      const held = await page.evaluate(() => (window as unknown as { log: [string | null, number | null, number][] }).log);
      await finger.up();
      expect(new Set(held.map((e) => e[0])).size).toBe(1);
      expect(new Set(held.map((e) => e[1])).size).toBe(1);
      expect(new Set(held.map((e) => e[2])).size).toBeGreaterThan(1);
    });

    test("a touch on a row that output redraws still lets the view follow after the lift", async ({ page }) => {
      const s = newSession();
      const stop = join(tmpdir(), `muxen-gesture-stop-${s}-${version}`);
      rmSync(stop, { force: true });
      stack.tmux("send-keys", "-t", s, `while [ ! -e ${stop} ]; do printf '\\rtick %05d' $RANDOM; sleep 0.04; done`, "Enter");
      await paneIncludes(s, /tick \d{5}/);
      const finger = await open(page, s);
      const row = stack.tmux("capture-pane", "-p", "-t", s).split("\n").findIndex((l) => l.startsWith("tick"));
      const at = await cellCentre(page, s, 3, row);
      await finger.down(at.x, at.y);
      await page.waitForTimeout(250); // the row is redrawn under the finger, and the touch's node leaves the page
      await finger.up();
      writeFileSync(stop, ""); // the loop ends on its own, so the next command is the shell's
      await paneIncludes(s, /tick \d{5}\$ /);
      stack.tmux("send-keys", "-t", s, "seq 1 300", "Enter");
      await paneIncludes(s, /^300$/m);
      await expect.poll(() => page.evaluate(() => {
        const list = document.querySelector<HTMLElement>("[data-rows]");
        const last = [...document.querySelectorAll<HTMLElement>("[data-rows] [data-seq]")].find((r) => r.textContent.trim() === "300");
        const box = last?.getBoundingClientRect();
        return !!list && !!box && box.top >= list.getBoundingClientRect().top && box.bottom <= list.getBoundingClientRect().bottom + 1;
      })).toBe(true);
    });

    test("a finger whose end never arrived is forgotten: the next swipe in a full-screen application still sends arrows", async ({ page }) => {
      const alt = newSession("sh -c \"printf '\\033[?1049h'; exec cat -vt\"");
      const finger = await open(page, alt);
      const at = await mid(page, alt);
      // A touch that began on a row the list then replaced: its end went to a detached node, so none reached the surface.
      await page.evaluate(({ x, y }) => {
        const touch = new Touch({ identifier: 777, target: document.body, clientX: x, clientY: y });
        const host = document.elementFromPoint(x, y) ?? document.body;
        host.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
      }, at);
      for (let i = 1; i <= 2; i++) {
        await finger.down(at.x, at.y);
        await finger.drag(at.x, at.y, at.x, at.y + 160, 8, 10);
        await finger.up();
        await expect.poll(() => count(alt, "^[[A")).toBeGreaterThanOrEqual(i);
        await page.waitForTimeout(700);
      }
    });

    test("a swipe keeps sending arrows when the touched row is removed mid-swipe, and the next swipe is not ignored", async ({ page }) => {
      const alt = newSession("sh -c \"printf '\\033[?1049h'; exec cat -vt\"");
      const finger = await open(page, alt);
      const at = await mid(page, alt, 4);
      for (let i = 1; i <= 2; i++) {
        await finger.down(at.x, at.y);
        // What a redraw does to a styled row: the node the touch began on leaves the document, and its events go on to that node.
        const detached = await page.evaluate(({ x, y }) => {
          const node = document.elementFromPoint(x, y);
          if (!node || node.closest("[data-seq]") === null || node.hasAttribute("data-rows")) return false;
          node.remove();
          return !node.isConnected;
        }, at);
        expect(detached).toBe(true);
        await finger.drag(at.x, at.y, at.x, at.y + 160, 8, 10);
        await finger.up();
        await expect.poll(() => count(alt, "^[[A")).toBeGreaterThanOrEqual(i);
        await page.waitForTimeout(700);
      }
    });

    test("horizontal swipes send nothing", async ({ page }) => {
      const cat = newSession("cat -vt");
      const catFinger = await open(page, cat);
      const where = await mid(page, cat);
      await catFinger.down(where.x - 100, where.y);
      await catFinger.drag(where.x - 100, where.y, where.x + 120, where.y + 6, 8, 12);
      await page.waitForTimeout(700);
      await catFinger.up();
      await page.waitForTimeout(400);
      expect(pane(cat).trim()).toBe("");
    });

    test("in a full-screen application a swipe sends ↑/↓", async ({ page }) => {
      const alt = newSession("sh -c \"printf '\\033[?1049h'; exec cat -vt\"");
      const finger = await open(page, alt);
      const at = await mid(page, alt);
      await finger.down(at.x, at.y);
      await finger.drag(at.x, at.y, at.x, at.y + 160, 8, 10);
      await finger.up();
      await paneIncludes(alt, "^[[A");
      expect(pane(alt)).not.toContain("^[[<");
    });

    test("with mouse mode a swipe sends wheel events", async ({ page }) => {
      const wheel = newSession("sh -c \"printf '\\033[?1049h\\033[?1000h\\033[?1006h'; exec cat -vt\"");
      const wheelFinger = await open(page, wheel);
      const at = await mid(page, wheel);
      await wheelFinger.down(at.x, at.y);
      await wheelFinger.drag(at.x, at.y, at.x, at.y + 160, 8, 10);
      await wheelFinger.up();
      await paneIncludes(wheel, /\^\[\[<64;\d+;\d+M/);
      expect(pane(wheel)).not.toContain("^[[A");
    });

    test("a coast stops when the tab changes: the next tab's pane gets no arrows", async ({ page }) => {
      const s = newSession("sh -c \"printf '\\033[?1049h'; exec cat -vt\"");
      const next = newSession("cat -vt");
      const finger = await open(page, s);
      const at = await mid(page, s);
      // A hard flick: the full-screen application's coast sends arrows for seconds.
      await finger.down(at.x, at.y);
      await finger.drag(at.x, at.y, at.x, at.y + 200, 5, 6);
      await finger.up();
      await paneIncludes(s, "^[[A");
      await page.getByRole("button", { name: "All tabs" }).tap();
      await page.getByRole("button", { name: "Open session" }).tap();
      await page.getByRole("dialog", { name: "Open session" }).getByRole("button", { name: new RegExp(`^${next} \\d+ window`) }).tap();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const sent = count(s, "^[[A");
      await page.waitForTimeout(2500);
      expect(pane(next)).not.toContain("^[[");
      // The coast ended with the switch: the first session's count has stopped growing too.
      const settled = count(s, "^[[A");
      await page.waitForTimeout(500);
      expect(count(s, "^[[A")).toBe(settled);
      expect(settled).toBeGreaterThanOrEqual(sent);
    });

    // The browser has no edit menu, so no mark. The app's platform has one: this gives the browser's platform a stub, by
    // wrapping its factory in the dev server's module, and records every menu the page asks for.
    async function stubEditMenu(page: Page): Promise<void> {
      await page.addInitScript(() => { (window as unknown as { __menus: unknown[] }).__menus = []; });
      await page.route(/\/platform\/browser\/index\.ts/, async (route) => {
        const response = await route.fetch();
        const source = (await response.text()).replace("export function createBrowserPlatform(", "function createBrowserPlatformBase(");
        const wrapped = `${source}\nexport function createBrowserPlatform() { const platform = createBrowserPlatformBase(); platform.editMenu = (rect) => { window.__menus.push(rect); }; return platform; }\n`;
        await route.fulfill({ response, body: wrapped });
      });
    }

    /**
     * The mark's highlight is boxes in the list's scroller, not a DOM selection: where they stand is the only sign of it
     * in the page. The row they lie on (counting `count` rows up from the bottom) and the text under them, by cell.
     */
    const markedRows = (page: Page, count: number): Promise<{ row: number; text: string } | null> => page.evaluate((n) => {
      const boxes = [...document.querySelectorAll<HTMLElement>("[data-mark-box]")].map((b) => b.getBoundingClientRect());
      const first = boxes[0];
      if (!first) return null;
      const cell = parseFloat(document.querySelector<HTMLElement>("[data-rows]")?.style.getPropertyValue("--cell-width") ?? "0");
      const rows = [...document.querySelectorAll<HTMLElement>("[data-rows] [data-seq]")].slice(-n);
      const middle = first.top + first.height / 2;
      const row = rows.findIndex((r) => { const box = r.getBoundingClientRect(); return box.top <= middle && middle <= box.bottom; });
      const there = rows[row]?.getBoundingClientRect();
      if (!there) return null;
      const lefts = boxes.filter((b) => b.top < there.bottom && b.bottom > there.top);
      const start = Math.round((Math.min(...lefts.map((b) => b.left)) - there.left) / cell);
      const end = Math.round((Math.max(...lefts.map((b) => b.right)) - there.left) / cell);
      return { row, text: rows[row]?.textContent.slice(start, end) ?? "" };
    }, count);
    /** How many cells the mark covers, over every row it spans. */
    const markedCells = (page: Page): Promise<number> => page.evaluate(() => {
      const cell = parseFloat(document.querySelector<HTMLElement>("[data-rows]")?.style.getPropertyValue("--cell-width") ?? "0");
      return Math.round([...document.querySelectorAll<HTMLElement>("[data-mark-box]")].reduce((sum, b) => sum + b.getBoundingClientRect().width, 0) / cell);
    });

    test("the mark: every hold shows its handles and paints its highlight, and a tap elsewhere clears both", async ({ page }) => {
      const s = newSession();
      await stubEditMenu(page);
      const finger = await open(page, s);
      stack.tmux("send-keys", "-t", s, "echo alpha beta gamma", "Enter");
      await paneIncludes(s, /^alpha beta gamma$/m);
      const row = stack.tmux("capture-pane", "-p", "-t", s).split("\n").findIndex((l) => l === "alpha beta gamma");
      const at = await cellCentre(page, s, 7, row);
      const away = await mid(page, s, 20);
      const menus = (): Promise<unknown[]> => page.evaluate(() => (window as unknown as { __menus: unknown[] }).__menus);
      const before = pane(s);
      // The middle of "beta", between where the two handles stand: only the highlight can change these pixels.
      const cell = await page.evaluate(() => parseFloat(document.querySelector<HTMLElement>("[data-rows]")?.style.getPropertyValue("--cell-width") ?? "0"));
      const clip = { x: at.x - cell * 0.75, y: at.y - 6, width: cell * 1.5, height: 12 };
      const bare = await page.screenshot({ clip });
      const handles = page.locator("[data-end]");
      const boxes = page.locator("[data-mark-box]");
      const hold = async (): Promise<void> => {
        await finger.down(at.x, at.y);
        await page.waitForTimeout(550);
        await finger.up();
      };
      const tapAway = async (): Promise<void> => {
        await finger.down(away.x, away.y);
        await finger.up();
      };
      for (const round of [1, 2]) {
        await hold();
        await expect(handles).toHaveCount(2);
        await expect(handles.first()).toBeVisible();
        await expect(handles.last()).toBeVisible();
        await expect(boxes).not.toHaveCount(0);
        // The boxes' presence alone would miss a highlight that does not paint: the pixels under it must change.
        expect((await page.screenshot({ clip })).equals(bare)).toBe(false);
        // The rows are not selectable here, so the long press starts no selection of the system's beside the mark.
        expect(await page.evaluate(() => getSelection()?.toString())).toBe("");
        expect(await page.evaluate(() => getComputedStyle(document.querySelector("[data-rows]") as Element).getPropertyValue("user-select"))).toBe("none");
        expect((await menus()).filter((rect) => rect !== null)).toHaveLength(round);
        await tapAway();
        await expect(handles.first()).toBeHidden();
        await expect(handles.last()).toBeHidden();
        await expect(boxes).toHaveCount(0);
        expect((await page.screenshot({ clip })).equals(bare)).toBe(true);
        await expect(page.getByRole("textbox", { name: "Terminal keyboard" })).not.toBeFocused(); // a tap that clears the mark raises nothing
      }
      expect(pane(s)).toBe(before);
    });

    // A full-screen app repaints older text a few rows up or down when a status line grows (J7): the selection goes with it.
    // `stage` is the app's own redraw, one per Enter: the paragraph moves down, restyles in place, moves up, then is edited.
    function movingApp(): string {
      const script = join(tmpdir(), `muxen-move-${String(process.pid)}.sh`);
      writeFileSync(script, `#!/bin/bash
printf '\\e[?1049h'
paint() { out=$'\\e[H\\e[J'; for line in "$@"; do out+="$line"$'\\r\\n'; done; printf '%s' "$out"; }
paint "header" "" "" "" "alpha beta gamma" "delta epsilon" "" "" "footer"
for stage in down style up edit; do
  read -r
  case $stage in
    down) paint "header" "" "" "" "hint one" "alpha beta gamma" "delta epsilon" "" "footer";;
    style) printf '\\e[6;1H\\e[1malpha beta gamma\\e[0m';;
    up) paint "header" "" "alpha beta gamma" "delta epsilon" "" "" "" "" "footer";;
    edit) paint "header" "" "alpha beta CHANGED" "delta epsilon" "" "" "" "" "footer";;
  esac
done
read -r
`);
      return `bash ${script}`;
    }

    for (const kind of ["the mark", "the page's selection"]) {
      test(`${kind} goes with its text when the app repaints it elsewhere, and closes when the text changes`, async ({ page }) => {
        const s = newSession(movingApp());
        const marked = kind === "the mark";
        if (marked) await stubEditMenu(page);
        const finger = await open(page, s);
        await paneIncludes(s, "alpha beta gamma");
        // Which screen row the selected text is on, and what it is.
        const height = Number(stack.tmux("display-message", "-p", "-t", s, "#{pane_height}").trim());
        const selected = (): Promise<{ row: number; text: string } | null> => marked ? markedRows(page, height) : page.evaluate((count) => {
          const range = getSelection()?.rangeCount ? getSelection()?.getRangeAt(0) : undefined;
          if (!range || range.collapsed) return null;
          const rows = [...document.querySelectorAll<HTMLElement>("[data-rows] [data-seq]")].slice(-count);
          const row = rows.findIndex((r) => r.contains(range.startContainer));
          return { row, text: range.toString() };
        }, height);
        const next = async (): Promise<void> => { stack.tmux("send-keys", "-t", s, "Enter"); await page.waitForTimeout(400); };
        if (marked) {
          const at = await cellCentre(page, s, 7, 4);
          await finger.down(at.x, at.y);
          await page.waitForTimeout(550);
          await finger.up();
          expect(await selected()).toEqual({ row: 4, text: "beta" });
        } else {
          await select(page, "alpha beta", "alpha beta", 10);
          expect(await selected()).toEqual({ row: 4, text: "alpha beta" });
        }
        const text = marked ? "beta" : "alpha beta";
        await next(); // down: a row above gains text, this one moves down
        expect(await selected()).toEqual({ row: 5, text });
        await next(); // style only
        expect(await selected()).toEqual({ row: 5, text });
        await next(); // up
        expect(await selected()).toEqual({ row: 2, text });
        if (marked) await expect(page.locator("[data-end]").first()).toBeVisible();
        await next(); // the words themselves change
        expect(await selected()).toBeNull();
        if (marked) await expect(page.locator("[data-end]").first()).toBeHidden();
      });
    }

    test("the mark keeps growing under the finger at the list's bottom edge, with Jump to latest over it, until it meets the live rows", async ({ page }) => {
      // Classic Claude's shape: completed lines scroll into history above a few live rows that are redrawn every 100 ms.
      const script = join(tmpdir(), `muxen-live-${String(process.pid)}.sh`);
      writeFileSync(script, `#!/bin/bash
for i in $(seq 1 400); do echo "Completed finding $i: Amber queues keep their original input"; done
printf '\\n\\n\\n'
n=0
while true; do
  n=$((n+1))
  printf '\\e[3F\\e[J* Working... (%ss)\\n  status %s\\n  footer\\n' $n $n
  sleep 0.1
done
`);
      const s = newSession(`bash ${script}`);
      await stubEditMenu(page);
      const finger = await open(page, s);
      const box = await page.evaluate(() => { const r = document.querySelector<HTMLElement>("[data-rows]")?.getBoundingClientRect(); return r ? { top: r.top, bottom: r.bottom, left: r.left } : null; });
      if (!box) throw new Error("no list");
      for (let swipe = 0; swipe < 3; swipe++) { // read history: a real swipe down, three times
        await finger.down(box.left + 200, box.top + 100);
        await finger.drag(box.left + 200, box.top + 100, box.left + 200, box.bottom - 100, 8, 16);
        await page.waitForTimeout(80);
        await finger.up();
        await page.waitForTimeout(900);
      }
      await expect(page.getByRole("button", { name: "Jump to latest" })).toBeVisible();
      const marked = (): Promise<number> => markedCells(page);
      const x = box.left + 150;
      await finger.down(x, box.top + 150);
      await page.waitForTimeout(550);
      await finger.drag(x, box.top + 150, box.left + 270, box.bottom - 12, 12, 30); // the button's corner, on the edge
      await page.waitForTimeout(500);
      const first = await marked();
      await page.waitForTimeout(700);
      expect(await marked()).toBeGreaterThan(first + 500); // it grew while the list scrolled under the still finger
      await expect.poll(marked, { timeout: 8000 }).toBe(0); // and closed when the extension reached the live rows (J7)
      await finger.up();
    });

    test.describe("a mouse wheel on a desktop", () => {
      test.use({ viewport: { width: 1100, height: 800 }, hasTouch: false });

      test("scrolls xterm's buffer, then on past its top into tmux's history; Jump to latest follows", async ({ page }) => {
        const s = newSession();
        stack.tmux("send-keys", "-t", s, "seq 1 400 | sed 's/^/row /'", "Enter");
        await paneIncludes(s, /row 400/);
        await open(page, s); // all of it is tmux's history, none of xterm's
        const jump = page.getByRole("button", { name: "Jump to latest" });
        await expect(jump).toHaveCount(0);
        const box = await page.locator(".xterm-screen").boundingBox();
        if (!box) throw new Error("no screen");
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        for (let i = 0; i < 12; i++) {
          await page.mouse.wheel(0, -400);
          await page.waitForTimeout(150);
        }
        await expect(jump).toBeVisible();
        await expect.poll(() => page.locator("[data-history]").innerText()).toMatch(/row 3\d\d/);
        // xterm's own buffer scrolls too: new output gives it rows, and a wheel inside them shows the control.
        await jump.click();
        await expect(jump).toHaveCount(0);
        stack.tmux("send-keys", "-t", s, "seq 1 100", "Enter");
        await paneIncludes(s, /^100$/m);
        await page.waitForTimeout(300);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, -200);
        await expect(jump).toBeVisible();
        await expect(page.locator("[data-history]")).toBeHidden();
        for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 600);
        await expect(jump).toHaveCount(0);
      });
    });
  });
}
