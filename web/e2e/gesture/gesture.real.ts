// Touch gestures against a real daemon on a private tmux (3.4 and 3.7b), at phone size with
// real touch input (CDP `Input.dispatchTouchEvent`, so the browser's own pointer pipeline,
// `touch-action` included, runs). Each assertion crosses the whole path and reads what the
// pane received with `tmux capture-pane` (client-architecture.md §7.6, §11, P3b). Chromium only:
// WebKit has no touch injection beyond a tap. The device-only checks (haptic, momentum feel,
// selection handles, the system back gesture) are in g3-iphone-checklist.md.
import { existsSync, readFileSync } from "node:fs";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { openSessionRow } from "../shared/home";
import { startStack, type Stack, type TmuxVersion } from "../shared/stack";

const VERSIONS = (process.env["TETHER_E2E_TMUX"] ?? "3.4,3.7b").split(",") as TmuxVersion[];

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
      await this.page.waitForTimeout(gap);
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
      await page.waitForFunction(() => { const host = document.querySelector(".xterm")?.parentElement; return host !== null && host !== undefined && !host.hasAttribute("data-blank"); });
      await page.waitForTimeout(400); // the snapshot's size settles
      return new Finger(await page.context().newCDPSession(page), page);
    }

    /** Where cell (col, row) is in client pixels, from the screen's box and the pane's size. */
    async function cellCentre(page: Page, session: string, col: number, row: number): Promise<{ x: number; y: number }> {
      const [cols, rows] = stack.tmux("display-message", "-p", "-t", session, "#{pane_width} #{pane_height}").trim().split(" ").map(Number);
      const box = await page.locator(".xterm-screen").boundingBox();
      if (!box || !cols || !rows) throw new Error("no screen");
      return { x: box.x + ((col + 0.5) * box.width) / cols, y: box.y + ((row + 0.5) * box.height) / rows };
    }

    /** The screen's centre column, `row` rows down. */
    const mid = async (page: Page, session: string, row = 5): Promise<{ x: number; y: number }> => {
      const [cols] = stack.tmux("display-message", "-p", "-t", session, "#{pane_width}").trim().split(" ").map(Number);
      return await cellCentre(page, session, Math.floor((cols ?? 40) / 2), row);
    };

    /** The page's selection from the start of the row holding `from` to `offset` characters into the row holding `to`. */
    async function select(page: Page, from: string, to: string, offset: number): Promise<void> {
      await page.evaluate(([fromRow, toRow, end]) => {
        const rows = [...document.querySelectorAll<HTMLElement>(".xterm-rows > div")];
        const text = (needle: string | undefined): Node => {
          const row = rows.find((r) => r.textContent.includes(needle ?? ""));
          const node = row && document.createTreeWalker(row, NodeFilter.SHOW_TEXT).nextNode();
          if (!node) throw new Error(`no row with ${needle ?? ""}`);
          return node;
        };
        getSelection()?.setBaseAndExtent(text(fromRow), 0, text(toRow), Number(end));
      }, [from, to, String(offset)]);
    }

    test("a long press is the system's: no snapshot, no menu of tether's, and nothing reaches the pane", async ({ page }) => {
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
      await expect(page.locator(".xterm-rows")).toContainText("tail-line");
      await select(page, "word00", "tail-line", 4);
      const copied = await page.evaluate(() => {
        const data = new DataTransfer();
        const rows = document.querySelectorAll(".xterm-rows > div");
        rows[rows.length - 1]?.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
        return data.getData("text/plain");
      });
      expect(copied).toBe(`${words}\ntail`);
    });

    test("a tap elsewhere closes a selection of the rows and does nothing else", async ({ page }) => {
      const s = newSession();
      const finger = await open(page, s);
      stack.tmux("send-keys", "-t", s, "printf 'alp%s\\n' ha-beta", "Enter");
      await paneIncludes(s, /^alpha-beta$/m);
      await expect(page.locator(".xterm-rows")).toContainText("alpha-beta");
      const row = stack.tmux("capture-pane", "-p", "-t", s).split("\n").findIndex((l) => l === "alpha-beta");
      const before = pane(s);
      await select(page, "alpha-beta", "alpha-beta", 5);
      expect(await page.evaluate(() => getSelection()?.toString())).toBe("alpha");
      const away = await cellCentre(page, s, 40, row + 3);
      await finger.down(away.x, away.y);
      await finger.up();
      expect(await page.evaluate(() => getSelection()?.toString())).toBe("");
      expect(pane(s)).toBe(before);
    });

    test("a tap in an application with mouse mode sends a click at the cell", async ({ page }) => {
      const mouse = newSession("sh -c \"printf '\\033[?1000h\\033[?1006h'; exec cat -vt\"");
      const finger = await open(page, mouse);
      const at = await cellCentre(page, mouse, 9, 7);
      await finger.down(at.x, at.y);
      await finger.up();
      await paneIncludes(mouse, "^[[<0;10;8M^[[<0;10;8m");
    });

    test("a tap on the terminal never raises or lowers the keyboard", async ({ page }) => {
      const shell = newSession();
      const finger = await open(page, shell);
      await paneIncludes(shell, /\$ /);
      const before = pane(shell);
      const keyboard = page.getByRole("textbox", { name: "Terminal keyboard" });
      const far = await mid(page, shell, 8);
      const near = await mid(page, shell, 1); // the row under the prompt
      for (const at of [far, near]) {
        await finger.down(at.x, at.y);
        await finger.up();
      }
      await page.waitForTimeout(500);
      expect(pane(shell)).toBe(before);
      await expect(keyboard).not.toBeFocused();
      await keyboard.focus();
      for (const at of [far, near]) {
        await finger.down(at.x, at.y);
        await finger.up();
      }
      await expect(keyboard).toBeFocused();
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

    test("a vertical swipe scrolls the buffer and tmux's history with momentum, and Jump to latest returns", async ({ page }) => {
      const s = newSession();
      stack.tmux("send-keys", "-t", s, "seq 1 400 | sed 's/^/row /'", "Enter");
      await paneIncludes(s, /row 400/);
      const finger = await open(page, s); // opened after: all of it is tmux's history, none of xterm's
      const at = await mid(page, s, 4);
      await expect(page.getByRole("button", { name: "Jump to latest" })).toHaveCount(0);
      for (let i = 0; i < 6; i++) {
        await finger.down(at.x, at.y);
        await finger.drag(at.x, at.y, at.x, at.y + 300, 8, 6);
        await finger.up();
        await page.waitForTimeout(700);
      }
      await expect(page.getByRole("button", { name: "Jump to latest" })).toBeVisible();
      const history = await page.locator("[data-history]").innerText();
      expect(history).toMatch(/row 3\d\d/);
      // Momentum: a flick keeps going after the finger lifts.
      const top = async (): Promise<number> => (await page.locator("[data-history]").boundingBox())?.y ?? 0;
      await finger.down(at.x, at.y + 200);
      await finger.drag(at.x, at.y + 200, at.x, at.y + 380, 6, 8);
      await finger.up();
      const lifted = await top();
      await page.waitForTimeout(120);
      const later = await top();
      expect(later).toBeGreaterThan(lifted);
      await page.getByRole("button", { name: "Jump to latest" }).tap();
      await expect(page.getByRole("button", { name: "Jump to latest" })).toHaveCount(0);
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
      await page.getByRole("button", { name: "Back to the tab overview" }).tap();
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
