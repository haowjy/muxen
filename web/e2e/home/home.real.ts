import { expect, test, type Page, type WebSocket } from "@playwright/test";
import { goHome, openOverview } from "../shared/home";
import { startStack, type Stack, type TmuxVersion } from "../shared/stack";

// Home, the overview, Open session and creation against a real daemon and a real tmux (3.4 and 3.7b), in both
// browsers. Each version starts its own isolated stack (e2e/shared/stack.ts); the tests share
// it and run in order, since they share its tmux server.
const VERSIONS = (process.env["TETHER_E2E_TMUX"] ?? "3.4,3.7b").split(",") as TmuxVersion[];
test.use({ viewport: { width: 1440, height: 900 } });

for (const version of VERSIONS) {
  test.describe(`tmux ${version}`, () => {
    test.describe.configure({ mode: "serial" });
    let stack: Stack;

    test.beforeAll(async () => {
      test.setTimeout(120_000);
      stack = await startStack({ tmux: version, name: `home-${test.info().project.name}-${version}` });
      stack.tmux("new-session", "-d", "-s", "alpha", "-n", "editor");
      stack.tmux("new-window", "-t", "alpha", "-n", "shell");
    });
    test.afterAll(async () => { await stack.stop(); });

    const home = (page: Page): Promise<void> => goHome(page, stack.url);
    const screen = (page: Page) => page.getByRole("dialog", { name: "Open session" });
    const sessionRow = (page: Page, name: string) => screen(page).getByRole("button", { name: new RegExp(`^${name} \\d+ windows?`) }).first();

    test("Open session lists the real sessions, and opening one makes its tab", async ({ page }) => {
      await home(page);
      await openOverview(page);
      await page.getByRole("button", { name: "Open session" }).click();
      await expect(sessionRow(page, "alpha")).toContainText("2 windows");
      await sessionRow(page, "alpha").click();
      await expect(page).toHaveURL(/#\/tab$/);
      // The tab's pill carries the session's current window, the one tmux made current with new-window.
      await expect(page.locator("[aria-current='true']").first()).toHaveAttribute("aria-label", /^alpha shell/);
      // Back from the tab is Home: the overview it was opened from is not a stop.
      await page.goBack();
      await expect(page).toHaveURL(/#\/$/);
      // The row opens the tab it last showed: no duplicate, and Open session no longer offers alpha.
      await page.getByRole("button", { name: /^pop-os/ }).first().click();
      await expect(page).toHaveURL(/#\/tab$/);
      await page.getByRole("button", { name: "All tabs" }).click();
      await page.getByRole("button", { name: "Open session" }).click();
      await expect(sessionRow(page, "alpha")).toHaveCount(0);
    });

    test("creates a session, and its tab opens", async ({ page }) => {
      await home(page);
      await openOverview(page);
      await page.getByRole("button", { name: "Open session" }).click();
      await page.getByRole("textbox", { name: "Session name" }).fill("made-here");
      await page.getByRole("button", { name: "Create “made-here”" }).click();
      await expect(page).toHaveURL(/#\/tab$/);
      expect(stack.tmux("list-sessions", "-F", "#{session_name}")).toContain("made-here");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });

    test("a tab closes when its session is killed", async ({ page }) => {
      stack.tmux("new-session", "-d", "-s", "doomed", "-n", "only");
      await home(page);
      await openOverview(page);
      await page.getByRole("button", { name: "Open session" }).click();
      await sessionRow(page, "doomed").click();
      await expect(page).toHaveURL(/#\/tab$/);
      await page.getByRole("button", { name: "All tabs" }).click();
      await expect(page.getByRole("button", { name: /^doomed/ })).toBeVisible();
      stack.tmux("kill-session", "-t", "doomed");
      await expect(page.getByRole("button", { name: /^doomed/ })).toHaveCount(0);
    });

    test("one listSessions per reconnect", async ({ page }) => {
      const sockets: { ws: WebSocket; lists: number }[] = [];
      page.on("websocket", (ws) => {
        if (!ws.url().endsWith("/ws")) return; // Vite's own hot-reload socket
        const entry = { ws, lists: 0 };
        sockets.push(entry);
        ws.on("framesent", (f) => { if (typeof f.payload === "string" && f.payload.includes('"listSessions"')) entry.lists++; });
      });
      await home(page);
      await expect.poll(() => sockets[0]?.lists).toBe(1);
      // The daemon goes away and comes back: the page reconnects once and asks once.
      await stack.stopDaemon();
      await expect.poll(() => sockets[0]?.ws.isClosed()).toBe(true);
      await stack.startDaemon();
      await expect.poll(() => sockets.length, { timeout: 30_000 }).toBeGreaterThan(1);
      await expect.poll(() => sockets.at(-1)?.lists, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
      await page.waitForTimeout(1500);
      expect(sockets.at(-1)?.lists).toBe(1);
    });
  });
}
