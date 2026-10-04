// Setup, Settings, Notebooks, Where it came from and the menu bar popover, on the fake CLI.
import { expect, test, type Page } from "@playwright/test";

const fake = (page: Page, ...args: string[]) => page.request.post("/__jotted/fake", { data: { args } });
const row = (page: Page, text: string) => page.locator(".row", { hasText: text });
const setting = (page: Page, title: string) => page.locator(".setting", { hasText: title });

async function open(page: Page) {
  await fake(page, "reset");
  await fake(page, "claude", "connected");
  await page.goto("/");
  await expect(row(page, "Book the retro room")).toBeVisible();
}

test.describe("first run", () => {
  test.beforeEach(async ({ page }) => {
    await fake(page, "reset");
    await fake(page, "setup", "incomplete");
    await page.goto("/");
  });

  test("welcome, then every setup step, then the list", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Your handwriting, as a to-do list" })).toBeVisible();
    await expect(page.getByText("Tick the three you need to continue")).toBeVisible();
    for (const need of ["A reMarkable with cloud sync", "Your reMarkable account", "An API key for a language model"]) {
      await page.getByRole("checkbox", { name: need }).click();
    }
    await page.getByRole("button", { name: "I have these. Set up" }).click();

    await expect(page.getByRole("heading", { name: "Set up Jotted" })).toBeVisible();
    const step = (title: string) => page.locator(".setup-step", { hasText: title });
    await expect(step("rmapi")).toContainText("done"); // setup prepare ran on entering
    await expect(page.getByText("step 3 of 6")).toBeVisible();

    const code = page.getByRole("textbox", { name: "One-time code" });
    await code.fill("abcdefgh");
    await page.getByRole("button", { name: "Connect", exact: true }).click();

    const key = page.getByLabel("Anthropic API key");
    await key.fill("not-a-key");
    await page.getByRole("button", { name: "Check key" }).click();
    await expect(page.getByRole("alert")).toContainText("refused the key");
    await expect(key).toHaveValue(""); // never kept
    await key.fill("sk-ant-test-1234");
    await page.getByRole("button", { name: "Check key" }).click();

    await expect(step("The Jev plugin")).toHaveClass(/setup-step-on/);
    await page.getByRole("button", { name: "Skip this" }).click();

    await page.getByRole("checkbox", { name: "Read Work" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(row(page, "Book the retro room")).toBeVisible();
  });

  test("goes straight to Setup once the welcome was seen", async ({ page }) => {
    for (const need of ["A reMarkable with cloud sync", "Your reMarkable account", "An API key for a language model"]) {
      await page.getByRole("checkbox", { name: need }).click();
    }
    await page.getByRole("button", { name: "I have these. Set up" }).click();
    await expect(page.getByRole("heading", { name: "Set up Jotted" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Set up Jotted" })).toBeVisible();
  });
});

test.describe("settings", () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Settings" }).click();
  });

  test("shows the device, the model and the key hint", async ({ page }) => {
    await expect(setting(page, "reMarkable")).toContainText("Connected through reMarkable Cloud");
    await expect(setting(page, "Language model")).toContainText("Claude · Anthropic");
    await expect(setting(page, "API key")).toContainText("sk-ant-…3f2a");
  });

  test("changes how often it checks, and it sticks", async ({ page }) => {
    await page.getByRole("combobox", { name: "Check for new writing" }).selectOption("300");
    await page.reload();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("combobox", { name: "Check for new writing" })).toHaveValue("300");
  });

  test("turning off the To-do document makes the list one sheet", async ({ page }) => {
    await page.getByRole("switch", { name: "Keep a To-do document on the tablet" }).click();
    await page.getByRole("button", { name: "To-do", exact: false }).first().click();
    await expect(page.locator(".sheet-meta")).not.toContainText("page 1 of");
  });

  test("replaces the key; a refused one says so by the field", async ({ page }) => {
    await setting(page, "API key").getByRole("button", { name: "Replace" }).click();
    const key = page.getByLabel("Anthropic API key");
    await key.fill("wrong");
    await page.getByRole("button", { name: "Check key" }).click();
    await expect(page.getByRole("alert")).toContainText("refused the key");
    await key.fill("sk-ant-newkey-9999");
    await page.getByRole("button", { name: "Check key" }).click();
    await expect(setting(page, "API key")).toContainText("…9999");
  });

  test("adds and removes Jev", async ({ page }) => {
    await setting(page, "Jev, from TypeSafe").getByRole("button", { name: "Add key" }).click();
    await page.getByLabel("TypeSafe API key").fill("ts_live_abcd");
    await page.getByRole("button", { name: "Check key" }).click();
    await expect(setting(page, "Jev, from TypeSafe")).toContainText("On:");
    await setting(page, "Jev, from TypeSafe").getByRole("button", { name: "Remove" }).click();
    await expect(setting(page, "Jev, from TypeSafe")).toContainText("Optional");
  });

  test("reconnects the reMarkable", async ({ page }) => {
    await setting(page, "reMarkable").getByRole("button", { name: "Reconnect" }).click();
    await expect(page.getByRole("heading", { name: "Reconnect your reMarkable" })).toBeVisible();
    await page.getByRole("textbox", { name: "One-time code" }).fill("qwertyui");
    await page.getByRole("button", { name: "Replace the connection" }).click();
    await expect(row(page, "Book the retro room")).toBeVisible();
  });
});

test.describe("notebooks", () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Notebooks" }).click();
  });

  test("shows folders, reads a new one, and from when", async ({ page }) => {
    const journal = page.locator(".folder", { hasText: "Journal" });
    await expect(journal).not.toHaveClass(/folder-on/);
    await journal.getByRole("checkbox", { name: "Read Journal" }).click();
    await expect(journal).toHaveClass(/folder-on/);
    await expect(journal.getByRole("radio", { name: "Everything" })).toHaveAttribute("aria-checked", "true");
    await journal.getByRole("radio", { name: "From now on" }).click();
    await expect(journal.getByRole("radio", { name: "From now on" })).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".watching")).toContainText("Journal");
  });

  test("shows a folder's documents, blank when Jotted hasn't read them", async ({ page }) => {
    await page.getByRole("button", { name: "Meeting Notes", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Meeting Notes" })).toBeVisible();
    const thumbs = page.locator(".thumb");
    await expect(thumbs.filter({ hasText: "Weekly sync" }).locator("img")).toBeVisible();
    await expect(thumbs.filter({ hasText: "Planning offsite" }).locator(".page-blank")).toBeVisible();
    await expect(thumbs.filter({ hasText: "Planning offsite" })).toContainText("not read");
  });
});

test.describe("where it came from", () => {
  test.beforeEach(async ({ page }) => open(page));

  test("shows the page and how Jotted read the line", async ({ page }) => {
    await row(page, "Book the retro room").getByRole("button", { name: /Weekly sync/ }).click();
    const peek = page.locator(".peek");
    await expect(peek).toContainText("Weekly sync");
    await expect(peek).toContainText("page 3 of 7");
    await expect(peek).toContainText("Yes, 93% sure · judged by Claude");
    await expect(peek.locator("img.peek-image")).toBeVisible();
    await expect(row(page, "Book the retro room")).toHaveClass(/row-selected/);
    await page.keyboard.press("Escape");
    await expect(peek).toHaveCount(0);
  });

  test("marks it someone else's, by name", async ({ page }) => {
    await row(page, "Draft the Q4 hiring plan").getByRole("button", { name: /1:1 Priya/ }).click();
    await page.getByRole("button", { name: "Someone else's" }).click();
    const name = page.getByRole("textbox", { name: "Whose is it?" });
    await name.fill("Priya");
    await name.press("Enter");
    await expect(row(page, "Draft the Q4 hiring plan")).toContainText("→ Priya");
  });

  test("Not an action dismisses it and closes", async ({ page }) => {
    await row(page, "Draft the Q4 hiring plan").getByRole("button", { name: /1:1 Priya/ }).click();
    await page.locator(".peek").getByRole("button", { name: "Not an action" }).click();
    await expect(row(page, "Draft the Q4 hiring plan")).toHaveCount(0);
    await expect(page.locator(".peek")).toHaveCount(0);
  });

  test("an item from Claude shows its excerpt instead of a page", async ({ page }) => {
    await page.getByRole("button", { name: "Accept: Send Dana the rollout plan" }).click();
    await row(page, "Send Dana the rollout plan").getByRole("button", { name: /from Claude/ }).click();
    const peek = page.locator(".peek");
    await expect(peek).toContainText("Sam to send Dana the rollout plan by Friday");
    await expect(peek.getByRole("button", { name: "Open the source" })).toBeVisible();
  });
});

test.describe("menu bar popover", () => {
  test.beforeEach(async ({ page }) => {
    await fake(page, "reset");
    await page.goto("/#tray");
  });

  test("shows the open count, every open item of yours, proposals and who you're waiting on", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /To-do · 7 open/ })).toBeVisible();
    // 7 open: 5 of yours as rows, and the 2 someone else's under "Waiting on".
    await expect(page.locator(".tray-list .checkbox")).toHaveCount(5);
    await page.getByRole("textbox", { name: "Quick add" }).fill("One more");
    await page.getByRole("textbox", { name: "Quick add" }).press("Enter");
    await expect(page.locator(".tray-list .checkbox")).toHaveCount(6);
    await expect(page.getByRole("button", { name: "2 proposed by Claude" })).toBeVisible();
    await expect(page.getByText("Waiting on 2 items")).toBeVisible();
  });

  test("a handwritten item's source opens Where it came from", async ({ page }) => {
    // Opening the main window happens in the app (src-tauri/src/tray.rs); here, that it's a button.
    await expect(page.getByRole("button", { name: "Weekly sync · p3" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Added here" })).toHaveCount(0); // typed here: no page
  });

  test("quick add and tick", async ({ page }) => {
    const add = page.getByRole("textbox", { name: "Quick add" });
    await add.fill("Buy stamps");
    await add.press("Enter");
    await expect(page.getByRole("heading", { name: /8 open/ })).toBeVisible();
    await page.getByRole("checkbox", { name: "Done: Book the retro room for Thursday" }).click();
    await expect(page.getByRole("heading", { name: /7 open/ })).toBeVisible();
  });
});

test("Claude on another data folder isn't shown as connected", async ({ page }) => {
  await fake(page, "reset");
  await fake(page, "claude", "other-data");
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const claude = setting(page, "Claude Desktop");
  await expect(claude).toContainText("Claude reads another Jotted data folder");
  await claude.getByRole("button", { name: "Use this app's Jotted" }).click();
  await expect(claude).toContainText("Connected.");
});
