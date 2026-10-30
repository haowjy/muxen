import { expect, type Page } from "@playwright/test";

/** Home, with its workspace row. */
export async function goHome(page: Page, stackUrl: string): Promise<void> {
  await page.goto(`${stackUrl}/#/`);
  await expect(page.getByRole("heading", { name: "tether" })).toBeVisible();
}

/** The workspace's tab overview from Home: its row opens the last tab, or the overview when there is none, and the tab row's ‹ goes from a tab to it. */
export async function openOverview(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^pop-os/ }).first().click();
  const back = page.getByRole("button", { name: "Back to the tab overview" });
  if (await back.isVisible().catch(() => false)) await back.click();
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
