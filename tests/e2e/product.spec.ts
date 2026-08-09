import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("qa@sendry.local");
  await page.getByLabel("Password").fill("TestPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
});

test("navigates the primary product areas", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: /good|overview|performance/i }).first(),
  ).toBeVisible();
  for (const label of [
    "Campaigns",
    "Audiences",
    "Automations",
    "Inbox",
    "Templates",
    "Channels",
    "Files",
    "Rules",
    "Settings",
  ]) {
    await page.goto(`/${label.toLowerCase()}`);
    if (label === "Inbox" && (page.viewportSize()?.width ?? 1024) < 768) {
      await expect(page.getByPlaceholder(/Reply on/i)).toBeVisible();
      continue;
    }
    await expect(
      page
        .getByRole("heading", {
          name: new RegExp(label === "Rules" ? "Rules & safety" : label, "i"),
        })
        .first(),
    ).toBeVisible();
  }
});

test("opens the app-shell dropdown menus without crashing", async ({ page }) => {
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  await expect(page.getByText("Notifications", { exact: true })).toBeVisible();
  await expect(page.getByText("View delivery activity", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  if ((page.viewportSize()?.width ?? 1024) < 768) {
    await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  }

  await page.getByRole("button", { name: "Atlas", exact: true }).click();
  await expect(page.getByText("Brands", { exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Atlas", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /QA Admin/ }).click();
  await expect(page.getByText("qa@sendry.local", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("Account settings", { exact: true })).toBeVisible();
});

test("opens search with macOS and Windows keyboard shortcuts", async ({ page }) => {
  const searchInput = page.getByPlaceholder("Search Sendry…");
  const searchButton = page.getByRole("button", { name: /Search conversations/ });
  await expect(searchButton).toBeVisible();
  const expectedShortcut = await page.evaluate(() =>
    /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘ K" : "Ctrl K",
  );
  await expect(searchButton.locator("kbd")).toHaveText(expectedShortcut);

  await page.keyboard.press("Meta+K");
  await expect(searchInput).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(searchInput).toBeHidden();

  await page.keyboard.press("Control+K");
  await expect(searchInput).toBeVisible();
});

test("shows Ctrl K in the shortcut hint on Windows", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      get: () => "Win32",
    });
  });
  await page.reload();

  const searchButton = page.getByRole("button", { name: /Search conversations/ });
  await expect(searchButton).toBeVisible();
  await expect(searchButton.locator("kbd")).toHaveText("Ctrl K");
});

test("creates a channel-native WhatsApp campaign", async ({ page }) => {
  await page.goto("/campaigns/new/whatsapp");
  await expect(page.getByRole("heading", { name: "Create WhatsApp campaign" })).toBeVisible();
  await expect(page.getByText("delivery_update", { exact: true })).toBeVisible();
  await expect(page.getByText("All good! Your message is within channel limits.")).toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).first().click();
  await expect(page).toHaveURL(/\/campaigns$/);
  await expect(page.getByText("August delivery update").first()).toBeVisible();
});

test("assigns and replies from the unified inbox with mocked call controls", async ({ page }) => {
  await page.goto("/inbox");
  await expect(page.getByPlaceholder(/Reply on/i)).toBeVisible();
  if ((page.viewportSize()?.width ?? 1024) >= 768) await page.getByText("Sofia Martin").first().click();
  await page.getByPlaceholder(/Reply on/i).fill("I can help with the delivery address.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("I can help with the delivery address.", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Call contact" }).click();
  await expect(page.getByText("Twilio Voice")).toBeVisible();
  await page.getByRole("button", { name: /Mute/ }).click();
  await page.getByRole("button", { name: /Keypad/ }).click();
  await expect(page.getByRole("button", { name: "1", exact: true })).toBeVisible();
});

test("opens a signed web-chat visitor session", async ({ page }) => {
  await page.goto("/widget/atlas_demo");
  await page.getByPlaceholder("Your name").fill("Camille Martin");
  await page.getByPlaceholder("you@example.com").fill("camille@example.test");
  await page.getByPlaceholder("Write your message…").fill("Is the Atelier Chair in stock?");
  await page.getByRole("button", { name: /Start conversation/ }).click();
  await expect(page.getByText("Hi! How can the Atlas team help?")).toBeVisible();
  await expect(page.getByText("Is the Atelier Chair in stock?")).toBeVisible();
});

test("configures every managed delivery provider and verifies local connectivity", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Sending" }).click();

  await page.getByRole("button", { name: "Use SendGrid" }).click();
  await expect(page.getByLabel("SMTP host")).toHaveValue("smtp.sendgrid.net");
  await expect(page.getByRole("spinbutton", { name: "Port" })).toHaveValue(
    "587",
  );
  await expect(page.getByLabel("Username (must be apikey)")).toHaveValue(
    "apikey",
  );

  await page.getByRole("button", { name: "Use Mailjet" }).click();
  await expect(page.getByLabel("SMTP host")).toHaveValue("in-v3.mailjet.com");
  await expect(page.getByRole("spinbutton", { name: "Port" })).toHaveValue(
    "465",
  );
  await expect(page.getByRole("switch", { name: /Direct TLS/ })).toBeChecked();

  await page.getByRole("button", { name: "Use Elastic Email" }).click();
  await expect(page.getByLabel("SMTP host")).toHaveValue(
    "smtp.elasticemail.com",
  );
  await expect(page.getByRole("spinbutton", { name: "Port" })).toHaveValue(
    "2525",
  );
  await expect(
    page.getByRole("switch", { name: /Require STARTTLS/ }),
  ).toBeChecked();

  await page.getByRole("button", { name: "Use Amazon SES" }).click();
  await expect(page.getByText("Amazon SES v2 API")).toBeVisible();
  await expect(page.getByLabel("AWS region")).toHaveValue("us-east-1");

  await page.getByRole("button", { name: "Use Local stream" }).click();
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(
    page.getByText("Connection verified", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Local stream delivery is ready.")).toBeVisible();
});
