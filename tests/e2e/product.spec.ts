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
  const searchInput = page.getByPlaceholder("Search anything in Sendry…");
  const searchButton = page.getByRole("button", { name: "Search anything in Sendry" });
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

test("searches settings and workspace records from the command palette", async ({ page }) => {
  await page.getByRole("button", { name: "Search anything in Sendry" }).click();
  const searchInput = page.getByPlaceholder("Search anything in Sendry…");

  await searchInput.fill("SMTP host");
  await expect(page.getByText("Delivery provider", { exact: true })).toBeVisible();
  await page.getByText("Delivery provider", { exact: true }).click();
  await expect(page).toHaveURL(/\/settings\?section=sending#delivery-provider$/);
  await expect(page.getByRole("tab", { name: "Sending" })).toHaveAttribute("data-active");

  await page.getByRole("button", { name: "Search anything in Sendry" }).click();
  await searchInput.fill("QA Admin");
  await expect(page.getByText("qa@sendry.local · owner", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Search anything in Sendry" }).click();
  await searchInput.fill("Fresh picks");
  await expect(page.getByText("Fresh picks weekly", { exact: true })).toBeVisible();
  await page.getByText("Fresh picks weekly", { exact: true }).click();
  await expect(page).toHaveURL(/\/templates\/tpl_weekly\/builder$/);
});

test("keeps the three most recent distinct searches", async ({ page }) => {
  const searchButton = page.getByRole("button", { name: "Search anything in Sendry" });
  const searchInput = page.getByPlaceholder("Search anything in Sendry…");

  for (const query of ["SMTP host", "QA Admin", "Fresh picks", "Monthly allowance"]) {
    await searchButton.click();
    await searchInput.fill(query);
    await page.keyboard.press("Escape");
  }

  await searchButton.click();
  const recentGroup = page.locator('[data-slot="command-group"]').filter({
    has: page.getByText("Recent searches", { exact: true }),
  });
  const recentItems = recentGroup.locator('[data-slot="command-item"]');
  await expect(recentItems).toHaveCount(3);
  await expect(recentItems.nth(0)).toContainText("Monthly allowance");
  await expect(recentItems.nth(1)).toContainText("Fresh picks");
  await expect(recentItems.nth(2)).toContainText("QA Admin");
  await expect(recentGroup.getByText("SMTP host", { exact: true })).toHaveCount(0);

  await recentGroup.getByText("QA Admin", { exact: true }).click();
  await expect(searchInput).toHaveValue("QA Admin");
  await expect(page.getByText("qa@sendry.local · owner", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await searchButton.click();
  const reorderedItems = page.locator('[data-slot="command-group"]').filter({
    has: page.getByText("Recent searches", { exact: true }),
  }).locator('[data-slot="command-item"]');
  await expect(reorderedItems).toHaveCount(3);
  await expect(reorderedItems.nth(0)).toContainText("QA Admin");
});

test("keeps global search usable in every locale and dark mode", async ({ page }) => {
  await page.evaluate(async () => {
    const response = await fetch("/api/settings/profile", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language: "en", theme: "light" }),
    });
    if (!response.ok) throw new Error("Unable to reset locale and theme");
  });
  await page.reload();
  const preferences = page.locator('header button:has(svg.lucide-languages)');
  const choosePreference = async (name: string) => {
    await preferences.click();
    await Promise.all([
      page.waitForResponse((response) =>
        response.url().endsWith("/api/settings/profile") && response.request().method() === "PATCH",
      ),
      page.getByRole("menuitemradio", { name, exact: true }).click(),
    ]);
  };

  await choosePreference("Dark");
  await expect(page.locator("html")).toHaveClass(/dark/);

  const localeCases = [
    { nativeName: "English", direction: "ltr", button: "Search anything in Sendry", placeholder: "Search anything in Sendry…", result: "Delivery provider" },
    { nativeName: "Français", direction: "ltr", button: "Rechercher partout dans Sendry", placeholder: "Rechercher partout dans Sendry…", result: "Prestataire de livraison" },
    { nativeName: "Español", direction: "ltr", button: "Buscar en todo Sendry", placeholder: "Buscar en todo Sendry…", result: "Proveedor de entrega" },
    { nativeName: "العربية", direction: "rtl", button: "ابحث عن أي شيء في Sendry", placeholder: "ابحث عن أي شيء في Sendry…", result: "مزود التوصيل" },
  ];
  for (const [index, locale] of localeCases.entries()) {
    if (index > 0) await choosePreference(locale.nativeName);
    await expect(page.locator("html")).toHaveAttribute("dir", locale.direction);
    await page.getByRole("button", { name: locale.button, exact: true }).click();
    const input = page.getByPlaceholder(locale.placeholder);
    await input.fill("SMTP");
    await expect(page.getByText(locale.result, { exact: true })).toBeVisible();
    const dialogBox = await page.getByRole("dialog").boundingBox();
    const viewport = page.viewportSize();
    expect(dialogBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(viewport!.width);
    await page.keyboard.press("Escape");
  }

  await page.evaluate(async () => {
    const response = await fetch("/api/settings/profile", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language: "en", theme: "light" }),
    });
    if (!response.ok) throw new Error("Unable to restore locale and theme");
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});

test("shows Ctrl K in the shortcut hint on Windows", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      get: () => "Win32",
    });
  });
  await page.reload();

  const searchButton = page.getByRole("button", { name: "Search anything in Sendry" });
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

test("configures hosted and local AI providers without returning saved keys", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "AI & privacy" }).click();

  await page.getByLabel("AI provider").click();
  await page.getByRole("option", { name: "OpenAI", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Model", exact: true }),
  ).toHaveValue("gpt-5-mini");
  await page.getByLabel("Provider API key").fill("e2e-private-test-key");
  await page.getByRole("button", { name: "Save AI settings" }).click();
  await expect(page.getByText("Brand settings saved")).toBeVisible();
  await expect(page.getByLabel("Provider API key")).toHaveValue("");
  await expect(
    page.getByText(/A write-only key is configured for this provider/),
  ).toBeVisible();

  await page.getByLabel("AI provider").click();
  await page.getByRole("option", { name: "LM Studio", exact: true }).click();
  await expect(page.getByLabel("Local server URL")).toHaveValue(
    "http://127.0.0.1:1234/v1",
  );
  await expect(page.getByLabel("Installed model")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh models" })).toBeVisible();
  await expect(page.getByLabel("Provider API key")).toHaveCount(0);
});
