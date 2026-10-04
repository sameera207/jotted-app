// Claude Desktop from the app (specs/Claude-Desktop-spec.md › Testing), on the fake CLI. The
// fake keeps Claude's settings in its own state: no test touches a real Claude Desktop file.
import { expect, test, type Page } from "@playwright/test";

const fake = (page: Page, ...args: string[]) => page.request.post("/__jotted/fake", { data: { args } });
const jotted = (page: Page, ...args: string[]) => page.request.post("/__jotted/run", { data: { args } });
const row = (page: Page, text: string) => page.locator(".row", { hasText: text });
const panel = (page: Page) => page.locator("#proposals");
const card = (page: Page) => page.locator(".claude-card");

async function open(page: Page, claude: string) {
  await fake(page, "reset");
  await fake(page, "claude", claude);
  await page.goto("/");
  await expect(row(page, "Book the retro room")).toBeVisible();
}

test("connects from Settings, then disconnects", async ({ page }) => {
  await open(page, "not-configured");
  await page.getByRole("button", { name: "Settings" }).click();
  const claude = page.locator(".setting", { hasText: "Claude Desktop" });
  await expect(claude).toContainText("Not connected");
  await claude.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText("Connected. Quit and reopen Claude Desktop to use Jotted there.")).toBeVisible();
  await expect(claude).toContainText("Disconnect before you remove Jotted");
  await claude.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("Disconnected. Quit and reopen Claude Desktop.")).toBeVisible();
  await expect(claude).toContainText("Not connected");
});

test("the admin switch reconnects with admin tools", async ({ page }) => {
  await open(page, "connected");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("switch", { name: "Let Claude change what Jotted reads" }).click();
  await expect(page.locator(".setting", { hasText: "Claude Desktop" })).toContainText("with admin tools");
});

test("sets how Claude adds items", async ({ page }) => {
  await open(page, "connected");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("radio", { name: "Ask me first" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("radio", { name: "Ask me first" })).toHaveAttribute("aria-checked", "true");
});

test("offers Claude after setup, and Not now hides it for good", async ({ page }) => {
  await open(page, "not-configured");
  await expect(card(page)).toContainText("Use Jotted from Claude Desktop");
  await card(page).getByRole("button", { name: "Not now" }).click();
  await expect(card(page)).toHaveCount(0);
  await page.reload();
  await expect(row(page, "Book the retro room")).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

test("the card connects", async ({ page }) => {
  await open(page, "not-configured");
  await card(page).getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText("Connected. Quit and reopen Claude Desktop to use Jotted there.")).toBeVisible();
  await expect(card(page)).toHaveCount(0);
});

test("no card without Claude Desktop", async ({ page }) => {
  await open(page, "not-installed");
  await page.waitForTimeout(500);
  await expect(card(page)).toHaveCount(0);
});

test("offers to repair a stale entry at start-up, and repairs it", async ({ page }) => {
  await open(page, "missing");
  const banner = page.locator(".claude-banner");
  await expect(banner).toContainText("Claude Desktop can't find Jotted");
  await banner.getByRole("button", { name: "Repair" }).click();
  await expect(page.getByText("Connected. Quit and reopen Claude Desktop to use Jotted there.")).toBeVisible();
  await expect(banner).toHaveCount(0);
});

test("Not now on the repair banner changes nothing", async ({ page }) => {
  await open(page, "missing");
  await page.locator(".claude-banner").getByRole("button", { name: "Not now" }).click();
  await expect(page.locator(".claude-banner")).toHaveCount(0);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator(".setting", { hasText: "Claude Desktop" })).toContainText("Needs repair");
});

test("shows proposals above the sheet, with their source", async ({ page }) => {
  await open(page, "connected");
  await expect(panel(page)).toContainText("Proposed by Claude (2)");
  await expect(page.locator(".nav-on")).toContainText("2 proposed");
  const dana = panel(page).locator(".proposal", { hasText: "Send Dana the rollout plan" });
  await expect(dana).toContainText("Doc · Platform sync, 29 Sep");
  await expect(dana).toContainText("Sam to send Dana the rollout plan by Friday");
  await expect(dana.getByRole("button", { name: "Open" })).toBeVisible();
  const priya = panel(page).locator(".proposal", { hasText: "Review the Q4 budget draft" });
  await expect(priya).toContainText("→ Priya");
  await expect(priya.getByRole("button", { name: "Open" })).toHaveCount(0); // no link
  await expect(row(page, "Send Dana the rollout plan")).toHaveCount(0); // not on the sheet
});

test("a proposal arrives by event, is accepted, and goes on the sheet", async ({ page }) => {
  await open(page, "connected");
  await jotted(page, "items", "add", "Book flights for the offsite", "--propose", "--agent",
    "--source-kind", "calendar", "--source-key", "evt-offsite-2026", "--source-title", "Team offsite");
  await expect(panel(page)).toContainText("Proposed by Claude (3)");
  await page.getByRole("button", { name: "Accept: Book flights for the offsite" }).click();
  await expect(row(page, "Book flights for the offsite")).toContainText("from Claude · Calendar · Team offsite");
  await expect(panel(page)).toContainText("Proposed by Claude (2)");
});

test("Accept all puts every shown proposal on the sheet", async ({ page }) => {
  await open(page, "connected");
  await panel(page).getByRole("button", { name: "Accept all" }).click();
  await expect(row(page, "Send Dana the rollout plan")).toBeVisible();
  await expect(row(page, "Review the Q4 budget draft")).toContainText("→ Priya");
  await expect(panel(page)).toHaveCount(0);
});

test("dismisses a proposal", async ({ page }) => {
  await open(page, "connected");
  await page.getByRole("button", { name: "Dismiss: Send Dana the rollout plan" }).click();
  await expect(panel(page)).toContainText("Proposed by Claude (1)");
  await page.reload();
  await expect(panel(page)).toContainText("Proposed by Claude (1)");
});

test("accepted in Claude meanwhile: the panel catches up without an error", async ({ page }) => {
  await open(page, "connected");
  await jotted(page, "items", "accept", "10");
  await expect(panel(page)).toContainText("Proposed by Claude (1)");
  await expect(row(page, "Send Dana the rollout plan")).toBeVisible();
});

test("Review in Settings opens the panel", async ({ page }) => {
  await open(page, "connected");
  for (let i = 0; i < 3; i++) {
    await jotted(page, "items", "add", `Proposal ${i}`, "--propose", "--agent", "--source-kind", "chat", "--source-key", `k${i}`);
  }
  await expect(panel(page)).toContainText("Proposed by Claude (5)");
  await expect(panel(page).locator(".proposal")).toHaveCount(0); // collapsed past 3
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator(".setting", { hasText: "Proposals waiting" })).toContainText("5 of 200");
  await page.locator(".setting", { hasText: "Proposals waiting" }).getByRole("button", { name: "Review" }).click();
  await expect(panel(page).locator(".proposal")).toHaveCount(5);
});
