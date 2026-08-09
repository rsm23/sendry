import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("qa@sendry.local");
  await page.getByLabel("Password").fill("TestPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await page.goto("/campaigns/cmp_draft");
  await expect(page.getByText("Email editor", { exact: true })).toBeVisible();
});

test("edits, reorders, and previews a responsive campaign without crashing", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Blocked script execution in 'about:srcdoc'")) runtimeErrors.push(message.text());
  });

  if ((page.viewportSize()?.width ?? 1024) < 768) {
    const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
  }

  const canvas = page.locator(".email-builder-canvas");
  await expect(canvas).toHaveAttribute("data-device", /desktop|mobile/);
  for (const device of ["Desktop", "Tablet", "Mobile"]) {
    await page.getByRole("button", { name: `${device} preview`, exact: true }).click();
    await expect(canvas).toHaveAttribute("data-device", device.toLowerCase());
  }

  const originalCount = await page.getByRole("button", { name: / element$/ }).count();
  const announcementSource = page.getByRole("button", { name: "Add Announcement" });
  const announcementContainment = await announcementSource.evaluate((element) => {
    const card = element.getBoundingClientRect();
    const label = element.querySelector("span:last-child")?.getBoundingClientRect();
    return label ? label.left >= card.left && label.right <= card.right && label.top >= card.top && label.bottom <= card.bottom : false;
  });
  expect(announcementContainment).toBe(true);
  await announcementSource.click();
  const headingSource = page.getByRole("button", { name: "Add Heading" });
  if ((page.viewportSize()?.width ?? 1024) < 768) await headingSource.click();
  else {
    const insertionTarget = page.locator('[data-drop-index="1"]');
    const hero = page.getByRole("button", { name: "Hero element", exact: true });
    const heroBefore = await hero.boundingBox();
    expect(heroBefore).not.toBeNull();
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await headingSource.dispatchEvent("dragstart", { dataTransfer });
    await insertionTarget.dispatchEvent("dragenter", { dataTransfer });
    await insertionTarget.dispatchEvent("dragover", { dataTransfer });
    const dragPreview = page.locator("[data-drag-preview]");
    await expect(dragPreview).toBeVisible();
    await expect(dragPreview).toContainText("Heading");
    await expect(dragPreview).toContainText("Drop content here");
    const heroDuring = await hero.boundingBox();
    expect(heroDuring).not.toBeNull();
    expect(heroDuring!.y).toBeGreaterThan(heroBefore!.y + 50);
    await insertionTarget.dispatchEvent("drop", { dataTransfer });
    await headingSource.dispatchEvent("dragend", { dataTransfer });
    await dataTransfer.dispose();
    await expect(dragPreview).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: / element$/ })).toHaveCount(originalCount + 2);

  await page.getByRole("tab", { name: "Layers", exact: true }).click();
  const layers = page.getByLabel("Email layers");
  const layerNames = layers.locator("button[aria-pressed]");
  const beforeMove = await layerNames.allTextContents();
  await layers.getByRole("button", { name: "Move layer down" }).first().click();
  await expect.poll(async () => (await layerNames.allTextContents()).join("|")).not.toBe(beforeMove.join("|"));

  await page.getByRole("tab", { name: "Elements", exact: true }).click();
  await page.getByRole("tab", { name: "Visual", exact: true }).click();
  const visualEditor = page.getByLabel("Visual email content");
  await visualEditor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Composer regression text");
  await page.getByRole("button", { name: "Mobile preview", exact: true }).click();
  await expect(visualEditor).toContainText("Composer regression text");
  await expect(page.getByText("Email editor", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "HTML", exact: true }).click();
  const htmlSource = page.getByLabel("HTML source");
  await expect(htmlSource).toContainText("Composer regression text");
  const sourceWithUnsafeImage = (await htmlSource.inputValue()).replace(/<\/body>/i, '<img src="x" onerror="throw new Error(\'visual-xss\')"></body>');
  await htmlSource.fill(sourceWithUnsafeImage);
  await page.getByRole("tab", { name: "Visual", exact: true }).click();
  await expect(page.getByLabel("Visual email content").locator("img").last()).not.toHaveAttribute("onerror");
  await page.getByRole("tab", { name: "Blocks", exact: true }).click();
  await expect(page.getByRole("button", { name: "HTML element" })).toBeVisible();

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Responsive preview" });
  await expect(preview).toBeVisible();
  for (const [device, width] of [["Desktop", 720], ["Tablet", 560], ["Mobile", 360]] as const) {
    await preview.getByRole("button", { name: `${device} preview`, exact: true }).click();
    await expect(preview.getByTitle(`${device.toLowerCase()} campaign preview`).locator("..")).toHaveAttribute("style", new RegExp(`width: ${width}px`));
  }
  await expect(runtimeErrors).toEqual([]);
});
