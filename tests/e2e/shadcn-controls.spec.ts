import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await expect.poll(async () => {
    try {
      return (await page.request.get("/api/health")).ok();
    } catch {
      return false;
    }
  }).toBe(true);
  await page.goto("/login");
  await page.getByLabel("Email").fill("qa@sendry.local");
  await page.getByLabel("Password").fill("TestPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
});

test("uses shared shadcn selects and date-time picker", async ({ page }) => {
  await page.goto("/campaigns/new/whatsapp");
  const purpose = page.getByRole("combobox", { name: "Purpose", exact: true });
  await expect(purpose).toHaveAttribute("data-slot", "select-trigger");
  await purpose.click();
  await page.getByRole("option", { name: "Marketing", exact: true }).click();
  await expect(purpose).toContainText("marketing");

  await page.goto("/campaigns/cmp_draft");
  await page.getByRole("button", { name: /^(2 audience|2)$/ }).click();
  await page.getByRole("checkbox", { name: "Product updates 5 active · 8 total", exact: true }).first().check();
  await page.getByRole("button", { name: /^(4 send|4)$/ }).click();
  await page.getByRole("button", { name: "Choose date and time", exact: true }).click();

  const dateTime = page.getByRole("button", { name: "Date and time", exact: true });
  await expect(dateTime).toHaveAttribute("data-slot", "popover-trigger");
  await dateTime.click();
  await expect(page.locator('[data-slot="calendar"]')).toBeVisible();
  const time = page.locator('input[data-slot="input"][type="time"]');
  await time.fill("14:30");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await dateTime.click();
  await expect(time).toHaveValue("14:30");
});

test("uses shared shadcn inputs for file uploads", async ({ page }) => {
  await page.goto("/files");
  await expect(page.locator('input[data-slot="input"][type="file"]')).toHaveCount(1);

  await page.goto("/campaigns/cmp_draft");
  await page.getByRole("button", { name: /^Add attachment/ }).click();
  const attachments = page.getByRole("dialog", { name: "Campaign attachments" });
  await expect(attachments.locator('input[data-slot="input"][type="file"]')).toHaveCount(1);
});
