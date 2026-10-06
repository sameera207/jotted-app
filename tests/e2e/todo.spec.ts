import { expect, test, type Page } from "@playwright/test";

const fake = (page: Page, ...args: string[]) => page.request.post("/__jotted/fake", { data: { args } });
const jotted = (page: Page, ...args: string[]) => page.request.post("/__jotted/run", { data: { args } });
const row = (page: Page, text: string) => page.locator(".row", { hasText: text });

test.beforeEach(async ({ page }) => {
  await fake(page, "reset");
  await page.goto("/");
  await expect(row(page, "Book the retro room")).toBeVisible();
});

test("shows the open items with where they came from", async ({ page }) => {
  await expect(page.locator(".row[data-id]")).toHaveCount(7);
  await expect(row(page, "Draft the Q4 hiring plan")).toContainText("Work › 1:1 Priya · p11");
  await expect(row(page, "Tag the 0.2 release")).toContainText("Added in Jotted");
  await expect(row(page, "Confirm the offsite venue")).toContainText("→ Someone else");
  await expect(page.getByText("Written on the To-do · row 2")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Synced with your reMarkable" })).toBeVisible();
});

test("filters by status and by whose", async ({ page }) => {
  await page.getByRole("radio", { name: "Others" }).click();
  await expect(page.locator(".row[data-id]")).toHaveCount(2);
  await page.getByRole("radio", { name: "Mine" }).click();
  await expect(page.locator(".row[data-id]")).toHaveCount(5); // the unclear one shows in Mine
  await page.getByRole("radio", { name: "Done" }).click();
  await page.getByRole("radio", { name: "Everyone" }).click();
  await expect(row(page, "Water the plants")).toBeVisible();
});

test("ticks an item, and it stays ticked", async ({ page }) => {
  await page.getByRole("checkbox", { name: "Done: Draft the Q4 hiring plan" }).click();
  await expect(row(page, "Draft the Q4 hiring plan")).toHaveCount(0);
  await page.reload();
  await page.getByRole("radio", { name: "Done" }).click();
  await expect(page.getByRole("checkbox", { name: "Reopen: Draft the Q4 hiring plan" })).toBeVisible();
});

test("adds an item from the empty row", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "New item" });
  await input.fill("Call the bank");
  await input.press("Enter");
  await expect(row(page, "Call the bank")).toContainText("Added in Jotted");
  await expect(input).toHaveValue("");
  await expect(page.locator(".nav-on .nav-count")).toHaveText("8");
});

test("edits an item's text inline", async ({ page }) => {
  await row(page, "Tag the 0.2 release").getByRole("button", { name: "Tag the 0.2 release", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Item text" });
  await field.fill("Tag the 0.3 release");
  await field.press("Enter");
  await expect(row(page, "Tag the 0.3 release")).toBeVisible();
  await page.reload();
  await expect(row(page, "Tag the 0.3 release")).toBeVisible();
});

test("dismisses an item", async ({ page }) => {
  await row(page, "Draft the Q4 hiring plan").hover();
  await page.getByRole("button", { name: "Not an action: Draft the Q4 hiring plan" }).click();
  await expect(row(page, "Draft the Q4 hiring plan")).toHaveCount(0);
});

test("retries while the reMarkable is busy", async ({ page }) => {
  await fake(page, "fail", "items done", "busy", "2");
  await page.getByRole("checkbox", { name: "Done: Draft the Q4 hiring plan" }).click();
  await expect(row(page, "Draft the Q4 hiring plan")).toHaveCount(0);
  await page.waitForTimeout(3500); // retried after 1 s and 2 s: still done, no banner
  await expect(page.locator(".banner")).toHaveCount(0);
  await page.reload();
  await expect(row(page, "Draft the Q4 hiring plan")).toHaveCount(0);
});

test("undoes a tick that fails, with the error by the row", async ({ page }) => {
  await fake(page, "fail", "items done", "not_found", "1");
  await page.getByRole("checkbox", { name: "Done: Draft the Q4 hiring plan" }).click();
  await expect(row(page, "Draft the Q4 hiring plan")).toContainText("fake not_found");
  await expect(page.getByRole("checkbox", { name: "Done: Draft the Q4 hiring plan" })).toBeVisible();
});

test("shows Reconnect when the cloud can't be reached", async ({ page }) => {
  await fake(page, "fail", "check", "not_connected", "1");
  await page.getByRole("button", { name: "Check now" }).click();
  const banner = page.locator(".banner");
  await expect(banner).toContainText("Couldn't reach the reMarkable cloud");
  await expect(banner.getByRole("button", { name: "Reconnect" })).toBeVisible();
});

test("Check now shows Checking… until the check finishes", async ({ page }) => {
  await page.getByRole("button", { name: "Check now" }).click();
  await expect(page.getByText("Checking…")).toBeVisible();
  await expect(page.getByText("Synced with your reMarkable just now")).toBeVisible();
});

test("changes made elsewhere arrive live", async ({ page }) => {
  await jotted(page, "items", "add", "Added from the terminal");
  await expect(row(page, "Added from the terminal")).toBeVisible();
  await jotted(page, "items", "done", "1");
  await expect(row(page, "Book the retro room")).toHaveCount(0);
  await fake(page, "event", "source.error", JSON.stringify({ message: "The tablet went away" }));
  await expect(page.locator(".banner")).toContainText("The tablet went away");
});

test("works from the keyboard", async ({ page }) => {
  await page.keyboard.press("n");
  await expect(page.getByRole("textbox", { name: "New item" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".row[data-id]").last()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Space"); // ticks "Confirm the offsite venue"
  await expect(row(page, "Confirm the offsite venue")).toHaveCount(0);
});

test.describe("Clear done", () => {
  /** Every command the page runs, as its args. */
  const commands = (page: Page) => {
    const seen: string[][] = [];
    page.on("request", (r) => r.url().endsWith("/__jotted/run") && seen.push(r.postDataJSON().args));
    return seen;
  };
  const freshRuns = (seen: string[][]) => seen.filter((a) => a[0] === "todo");

  test.beforeEach(async ({ page }) => {
    // Start with nothing done: the seed's two done items reopened.
    await jotted(page, "items", "reopen", "8");
    await jotted(page, "items", "reopen", "9");
    await expect(page.locator(".nav-on .nav-count")).toHaveText("9");
  });

  test("is disabled until something is done", async ({ page }) => {
    const button = page.getByRole("button", { name: "Clear done" });
    await expect(button).toBeDisabled();
    await page.getByRole("checkbox", { name: "Done: Draft the Q4 hiring plan" }).click();
    await expect(button).toBeEnabled();
  });

  test("prints a fresh list after confirming", async ({ page }) => {
    const seen = commands(page);
    await page.getByRole("checkbox", { name: "Done: Draft the Q4 hiring plan" }).click();
    await page.getByRole("button", { name: "Clear done" }).click();
    const dialog = page.getByRole("dialog", { name: "Print a fresh list?" });
    await expect(dialog).toContainText("only the 8 open items");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Print fresh list" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".banner")).toContainText("Printed a fresh list with 8 open items");
    expect(freshRuns(seen)).toEqual([["todo", "--fresh"]]);
    // Done items stay done.
    await page.getByRole("radio", { name: "Done" }).click();
    await expect(row(page, "Draft the Q4 hiring plan")).toBeVisible();
  });

  test("Cancel and Escape run nothing", async ({ page }) => {
    const seen = commands(page);
    await page.getByRole("checkbox", { name: "Done: Draft the Q4 hiring plan" }).click();
    const button = page.getByRole("button", { name: "Clear done" });
    await button.click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(button).toBeFocused();
    await button.click();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Print fresh list" })).toBeFocused();
    await page.keyboard.press("Tab"); // focus stays in the dialog
    await expect(page.getByRole("dialog").getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(freshRuns(seen)).toEqual([]);
  });

  test("shows Reconnect when the cloud can't be reached", async ({ page }) => {
    await fake(page, "fail", "todo", "not_connected", "1");
    await page.getByRole("checkbox", { name: "Done: Draft the Q4 hiring plan" }).click();
    await page.getByRole("button", { name: "Clear done" }).click();
    await page.getByRole("button", { name: "Print fresh list" }).click();
    const banner = page.locator(".banner");
    await expect(banner).toContainText("Couldn't reach the reMarkable cloud");
    await expect(banner.getByRole("button", { name: "Reconnect" })).toBeVisible();
  });

  test("isn't there when the To-do document is off", async ({ page }) => {
    await jotted(page, "settings", "set", "todo_enabled", "false");
    await expect(page.getByRole("button", { name: "Clear done" })).toHaveCount(0);
  });
});
