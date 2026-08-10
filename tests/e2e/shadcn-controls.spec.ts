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

test("uses the shared shadcn calendar for file-share expiry", async ({ page }) => {
  await page.goto("/files");
  await page.getByRole("button", { name: "Show details for logos", exact: true }).click();
  await page.getByRole("tab", { name: "Access", exact: true }).click();
  await page.getByRole("button", { name: "Create link", exact: true }).click();

  const shareDialog = page.getByRole("dialog", { name: "Create secure external link" });
  const expiry = shareDialog.getByRole("button", { name: "Expiry date (optional)", exact: true });
  await expect(expiry).toHaveAttribute("data-slot", "popover-trigger");
  await expect(shareDialog.locator('input[type="date"]')).toHaveCount(0);
  await expiry.click();
  await expect(page.locator('[data-slot="calendar"]')).toBeVisible();
});

test("deselects items and opens folders or file previews on double click", async ({ page }) => {
  const baseUiErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error" && message.text().includes("Base UI")) baseUiErrors.push(message.text()); });
  const fileName = `Double click ${Date.now()}.txt`;
  const uploadResponse = await page.request.post("/api/brands/brd_atlas/files/upload", {
    multipart: {
      files: {
        name: fileName,
        mimeType: "text/plain",
        buffer: Buffer.from("Double-click preview fixture"),
      },
    },
  });
  expect(uploadResponse.ok()).toBe(true);
  const [uploaded] = await uploadResponse.json() as Array<{ id: string }>;

  try {
    await page.goto("/files");
    await page.getByRole("button", { name: "Select logos", exact: true }).click();
    await expect(page.getByRole("button", { name: "Selected logos", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear selection", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Selected logos", exact: true }).click();
    await expect(page.getByRole("button", { name: "Select logos", exact: true })).toBeVisible();
    await expect(page.locator('[aria-label="Clear selection"]')).toHaveCount(0);

    await page.getByRole("button", { name: "Select logos", exact: true }).dblclick();
    await expect(page).toHaveURL(/parentId=dir_logos/);
    await expect(page.locator('[aria-label="Clear selection"]')).toHaveCount(0);

    await page.goto("/files");
    await page.getByRole("button", { name: `Select ${fileName}`, exact: true }).dblclick();
    await expect(page).toHaveURL(new RegExp(`/files/${uploaded.id}`));
    await expect(page.locator(".cm-content").first()).toContainText("Double-click preview fixture");
    await expect(page.locator('[aria-label="Clear selection"]')).toHaveCount(0);
    expect(baseUiErrors).toEqual([]);
  } finally {
    await page.request.delete(`/api/brands/brd_atlas/files/${uploaded.id}`);
    await page.request.delete(`/api/brands/brd_atlas/files/${uploaded.id}/forever`);
  }
});

test("uses a compact custom drag image for file cards", async ({ page }) => {
  await page.addInitScript(() => {
    const original = DataTransfer.prototype.setDragImage;
    DataTransfer.prototype.setDragImage = function (image, x, y) {
      const element = image as HTMLElement & { width?: number; height?: number };
      (window as typeof window & { __sendryDragImage?: unknown }).__sendryDragImage = {
        tag: element.tagName,
        width: element.width,
        height: element.height,
        cssWidth: element.style.width,
        cssHeight: element.style.height,
        x,
        y,
      };
      return original.call(this, image, x, y);
    };
  });

  await page.goto("/files");
  await page.getByRole("button", { name: "Grid view" }).click();
  const logoCard = page.locator('[draggable="true"]').filter({ hasText: "logos" }).first();
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await logoCard.dispatchEvent("dragstart", { dataTransfer });

  await expect.poll(() => page.evaluate(() => (window as typeof window & { __sendryDragImage?: Record<string, string | number> }).__sendryDragImage)).toMatchObject({
    tag: "CANVAS",
    cssWidth: "280px",
    cssHeight: "64px",
    x: 28,
    y: 32,
  });
  const dragImage = await page.evaluate(() => (window as typeof window & { __sendryDragImage: Record<string, string | number> }).__sendryDragImage);
  expect([280, 560]).toContain(dragImage.width);
  expect([64, 128]).toContain(dragImage.height);
  await expect(logoCard).toHaveAttribute("data-dragging", "true");
  await logoCard.dispatchEvent("dragend", { dataTransfer });
});

test("shows moved items immediately in a previously visited folder", async ({ page }) => {
  const suffix = `${Date.now()}`;
  const targetResponse = await page.request.post("/api/brands/brd_atlas/files/folder", { data: { name: `Move target ${suffix}` } });
  const sourceResponse = await page.request.post("/api/brands/brd_atlas/files/folder", { data: { name: `Move source ${suffix}` } });
  expect(targetResponse.ok()).toBe(true);
  expect(sourceResponse.ok()).toBe(true);
  const target = await targetResponse.json() as { id: string; name: string };
  const source = await sourceResponse.json() as { id: string; name: string };

  try {
    await page.goto("/files");
    await page.getByRole("button", { name: `Select ${target.name}`, exact: true }).dispatchEvent("dblclick");
    await expect(page).toHaveURL(new RegExp(`parentId=${target.id}`));
    await expect(page.getByText("Build your file library", { exact: true }).first()).toBeVisible();
    await page.getByRole("navigation", { name: "breadcrumb" }).first().getByRole("button", { name: "All files" }).click();

    const sourceCard = page.locator('[draggable="true"]').filter({ hasText: source.name }).first();
    const targetCard = page.locator('[draggable="true"]').filter({ hasText: target.name }).first();
    await sourceCard.dragTo(targetCard);
    await expect(page.getByText("Item moved", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: `Select ${target.name}`, exact: true }).dispatchEvent("dblclick");

    await expect(page.getByText(source.name, { exact: true }).first()).toBeVisible();
  } finally {
    await page.request.delete(`/api/brands/brd_atlas/files/${source.id}`);
    await page.request.delete(`/api/brands/brd_atlas/files/${source.id}/forever`);
    await page.request.delete(`/api/brands/brd_atlas/files/${target.id}`);
    await page.request.delete(`/api/brands/brd_atlas/files/${target.id}/forever`);
  }
});
