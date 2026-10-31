import { expect, type Page } from "@playwright/test";

/** Home, with its workspace row. */
export async function goHome(page: Page, stackUrl: string): Promise<void> {
  await page.goto(`${stackUrl}/#/`);
  await expect(page.getByRole("heading", { name: "tether" })).toBeVisible();
}

/** The workspace's tab overview from Home: its row opens the last tab, or the overview when there is none; from a tab, All tabs opens the tab list over it. */
export async function openOverview(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^pop-os/ }).first().click();
  const all = page.getByRole("button", { name: "All tabs" });
  if (await all.isVisible().catch(() => false)) await all.click();
  await expect(page.getByRole("button", { name: "Open session" })).toBeVisible();
}

/** Opens `name` from the overview's Open session screen; the tab opens behind it as it closes. */
export async function openSessionRow(page: Page, name: string): Promise<void> {
  await openOverview(page);
  await page.getByRole("button", { name: "Open session" }).click();
  const screen = page.getByRole("dialog", { name: "Open session" });
  await screen.getByRole("button", { name: new RegExp(`^${name} \\d+ windows?`) }).first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
