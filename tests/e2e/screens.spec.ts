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

    const tree = page.getByRole("tree", { name: "Folders" });
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    await expect(page.getByRole("searchbox", { name: "Find a folder" })).toHaveCount(0); // compact
    await tree.getByRole("checkbox", { name: "Read Work", exact: true }).click();
    await expect(page.locator(".toast")).toContainText("Reading Work from now on");
    await page.getByRole("button", { name: "Expand Work" }).click();
    await expect(tree.getByRole("checkbox", { name: "Hiring, read through Work" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
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

test.describe("first run on a computer already set up with jotted", () => {
  test("no welcome, prepare finishes setup, the steps say what was found", async ({ page }) => {
    await fake(page, "reset");
    await fake(page, "setup", "tools-missing");
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Set up Jotted" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your handwriting, as a to-do list" })).toHaveCount(0);
    await expect(page.locator(".setup-step", { hasText: "rmapi" })).toContainText("done");
    await expect(page.getByText("Everything was already set up on this computer")).toBeVisible();
    await page.getByRole("button", { name: "Open Jotted" }).click();
    await expect(row(page, "Book the retro room")).toBeVisible();
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
  const treeRow = (page: Page, name: string) => page.getByRole("treeitem", { name: new RegExp(`^${name}\\b`) });
  const box = (page: Page, name: string) => page.getByRole("checkbox", { name: `Read ${name}`, exact: true });
  const chip = (page: Page, label: string) => page.locator(".chip", { has: page.getByRole("button", { name: `Stop reading ${label}`, exact: true }) });

  test.beforeEach(async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Notebooks" }).click();
    await expect(page.getByRole("tree", { name: "Folders" })).toBeVisible();
  });

  test("ticks a folder: a chip, from now on, and the sidebar's Watching", async ({ page }) => {
    await expect(chip(page, "Books & PDFs")).toHaveCount(0);
    await box(page, "Books & PDFs").click();
    await expect(box(page, "Books & PDFs")).toHaveAttribute("aria-checked", "true");
    await expect(chip(page, "Books & PDFs")).toBeVisible();
    await expect(treeRow(page, "Books & PDFs")).toContainText("from now on");
    await expect(page.locator(".watching")).toContainText("Books & PDFs");
    await expect(page.locator(".toast")).toContainText("Reading Books & PDFs from now on");
  });

  test("ticks a parent: its subfolders are read through it, and their own chips go", async ({ page }) => {
    await expect(box(page, "Journal")).toHaveAttribute("aria-checked", "mixed");
    await expect(chip(page, "Journal › Travel")).toBeVisible();
    await box(page, "Journal").click();
    await expect(page.locator(".toast")).toContainText("Reading Journal, which now covers Travel");
    await expect(chip(page, "Journal")).toContainText("+1 inside");
    await expect(chip(page, "Journal › Travel")).toHaveCount(0);
    const travel = page.getByRole("checkbox", { name: "Travel, read through Journal" });
    await expect(travel).toHaveAttribute("aria-disabled", "true");
    await expect(treeRow(page, "Travel")).toContainText("via Journal");
    await travel.click({ force: true }); // aria-disabled: still clickable, to say why
    await expect(page.locator(".toast")).toContainText("Read through Journal. Untick it to choose these one by one.");
    await expect(page.locator(".toast").getByRole("button", { name: "Undo" })).toHaveCount(0);
    await expect(travel).toHaveAttribute("aria-checked", "true");
  });

  test("Undo puts the previous ticks back", async ({ page }) => {
    await box(page, "Journal").click();
    await expect(chip(page, "Journal")).toBeVisible();
    await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
    await expect(chip(page, "Journal")).toHaveCount(0);
    await expect(chip(page, "Journal › Travel")).toBeVisible();
    await expect(box(page, "Travel")).toHaveAttribute("aria-checked", "true");
    await expect(box(page, "Journal")).toHaveAttribute("aria-checked", "mixed");

    await chip(page, "Home").getByRole("button", { name: "Stop reading Home" }).click();
    await expect(chip(page, "Home")).toHaveCount(0);
    await expect(page.locator(".toast")).toContainText("Stopped reading Home");
    await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
    await expect(chip(page, "Home")).toBeVisible();
  });

  test("From now on and Everything stick", async ({ page }) => {
    await treeRow(page, "Work").click();
    const modes = page.getByRole("radiogroup", { name: "Which pages of Work" });
    await expect(modes.getByRole("radio", { name: /Everything/ })).toHaveAttribute("aria-checked", "true");
    await modes.getByRole("radio", { name: /From now on/ }).click();
    await expect(page.locator(".toast")).toContainText("Work: only new writing");
    await expect(modes.getByRole("radio", { name: /From now on/ })).toHaveAttribute("aria-checked", "true");
    // Work's documents read in full already: nothing to skip there.
    await expect(page.locator(".detail")).toContainText("Already read in full, so nothing is skipped: 1:1 Priya, 1-1 Adam.");

    await page.reload();
    await page.getByRole("button", { name: "Notebooks" }).click();
    await treeRow(page, "Work").click();
    await expect(treeRow(page, "Work")).toContainText("from now on");
    await expect(modes.getByRole("radio", { name: /From now on/ })).toHaveAttribute("aria-checked", "true");
    await modes.getByRole("radio", { name: /Everything/ }).click();
    await expect(page.locator(".toast")).toContainText("Work: older pages count too");
    await page.reload();
    await page.getByRole("button", { name: "Notebooks" }).click();
    await expect(treeRow(page, "Work")).toContainText("everything");
  });

  test("search finds a nested folder and opens its parent; Being read hides unticked folders", async ({ page }) => {
    await expect(treeRow(page, "Hiring")).toHaveCount(0); // Work is closed
    await page.getByRole("searchbox", { name: "Find a folder" }).fill("hir");
    await expect(treeRow(page, "Hiring")).toBeVisible();
    await expect(treeRow(page, "Hiring").locator("mark")).toHaveText("Hir");
    await expect(treeRow(page, "Work")).toHaveAttribute("aria-expanded", "true");
    await expect(treeRow(page, "Home")).toHaveCount(0);
    await page.getByRole("searchbox", { name: "Find a folder" }).fill("xyz");
    await expect(page.getByText("No folder called “xyz”.")).toBeVisible();
    await page.getByRole("searchbox", { name: "Find a folder" }).press("Escape");
    await expect(treeRow(page, "Home")).toBeVisible();

    await page.getByRole("button", { name: "Being read" }).click();
    await expect(treeRow(page, "Books & PDFs")).toHaveCount(0);
    await expect(treeRow(page, "Journal")).toBeVisible(); // partial: Travel inside is read
    await expect(treeRow(page, "Travel")).toBeVisible();
  });

  test("keyboard: arrows move and select, Space ticks, ← goes to the parent", async ({ page }) => {
    await box(page, "Home").click(); // untick it, to tick it again from the keyboard
    await expect(box(page, "Home")).toHaveAttribute("aria-checked", "false");
    await page.getByRole("searchbox", { name: "Find a folder" }).focus();
    await page.keyboard.press("ArrowDown"); // the first folder
    await page.keyboard.press("ArrowDown");
    await expect(treeRow(page, "Home")).toBeFocused();
    await expect(treeRow(page, "Home")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Space");
    await expect(box(page, "Home")).toHaveAttribute("aria-checked", "true");

    await treeRow(page, "Work").click();
    await page.keyboard.press("ArrowRight"); // open
    await expect(treeRow(page, "Work")).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowRight"); // first child
    await expect(treeRow(page, "1-1")).toBeFocused();
    await expect(page.getByRole("heading", { name: "1-1", level: 2 })).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(treeRow(page, "Work")).toBeFocused();
    await page.keyboard.press("ArrowLeft"); // close
    await expect(treeRow(page, "Work")).toHaveAttribute("aria-expanded", "false");
  });

  test("the detail panel: breadcrumbs, Go to, subfolders and documents", async ({ page }) => {
    await page.getByRole("button", { name: "Expand Work" }).click();
    await treeRow(page, "Hiring").click();
    const detail = page.locator(".detail");
    await expect(detail).toContainText("Read because Work is ticked. To choose this folder on its own, untick Work.");
    await expect(detail).toContainText("Documents in this folder · 1");
    await expect(page.locator(".thumb", { hasText: "Interview loop" })).toContainText("not read yet");
    await detail.getByRole("button", { name: "Go to Work" }).click();
    await expect(page.getByRole("heading", { name: "Work", level: 2 })).toBeVisible();
    await expect(detail).toContainText("Jotted reads Work and the 2 folders inside it: 3 documents.");
    await expect(detail).toContainText("Documents in this folder · 1"); // not its subfolders
    await detail.locator(".subfolder", { hasText: "1-1" }).click();
    await expect(page.getByRole("heading", { name: "1-1", level: 2 })).toBeVisible();
    await detail.getByRole("button", { name: "Work", exact: true }).click(); // the breadcrumb
    await expect(page.getByRole("heading", { name: "Work", level: 2 })).toBeVisible();

    await treeRow(page, "Meeting Notes").click();
    await expect(detail).toContainText("Documents in this folder · 3");
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
