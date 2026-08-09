import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("qa@sendry.local");
  await page.getByLabel("Password").fill("TestPass123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);

  await page.goto("/templates");
  await page.getByRole("button", { name: "New template" }).click();
  const createDialog = page.getByRole("dialog", { name: "Create a template" });
  await createDialog.locator("input").fill(`Builder QA ${Date.now()}`);
  await createDialog.getByRole("button", { name: "Create template" }).click();
  await expect(page).toHaveURL(/\/templates\/.+\/builder$/);
});

test("builds, saves, and previews a responsive variable-aware email", async ({ page }) => {
  const mobile = (page.viewportSize()?.width ?? 1024) < 768;

  if (mobile) {
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", page.viewportSize()?.width);
    await page.getByRole("button", { name: "Elements", exact: true }).click();
    const elementSheet = page.getByRole("dialog").last();
    await expect(elementSheet.getByPlaceholder("Search elements")).toBeVisible();
    await elementSheet.getByRole("button", { name: "Add Heading" }).click();
    await expect(page.getByRole("button", { name: "Heading element" }).last()).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
  } else {
    const source = page.getByRole("button", { name: "Add Heading" });
    const target = page.locator(".group\\/drop").nth(2);
    await source.dragTo(target);
    await expect(page.getByRole("button", { name: "Heading element" }).last()).toBeVisible();
  }
  const heading = page.getByRole("textbox", { name: "Heading" }).last();
  await heading.fill("Hello ");
  await page.getByRole("button", { name: "Insert variable" }).last().click();
  await page.getByRole("button", { name: /First name.*\[Name\]/ }).click();
  await expect(heading).toHaveValue("Hello [Name]");
  if (mobile) await page.keyboard.press("Escape");
  await expect(page.getByText("Hello Sofia", { exact: true })).toBeVisible();

  if (mobile) await page.waitForTimeout(2_100);
  else await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await expect(page.getByText("Hello Sofia", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Responsive preview" })).toBeVisible();
  await page.getByRole("button", { name: "Mobile", exact: true }).click();
  const frame = page.getByTitle("mobile template preview");
  await expect(frame).toBeVisible();
  await expect(frame.locator("..")).toHaveAttribute("style", /width: 360px/);
});

test("asks before in-app navigation with unsaved template changes", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") runtimeErrors.push(message.text()); });
  const builderUrl = page.url();
  const nameInput = page.getByRole("textbox", { name: "Template name" }).first();
  const editedName = `${await nameInput.inputValue()} edited`;
  await nameInput.fill(editedName);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();

  await page.getByRole("button", { name: "Back to templates" }).click();
  const warning = page.getByRole("dialog", { name: "Unsaved changes" });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("If you leave now, they will be lost.");
  await warning.getByRole("button", { name: "Keep editing" }).click();
  await expect(warning).toHaveCount(0);
  await expect(page).toHaveURL(builderUrl);
  await expect(nameInput).toHaveValue(editedName);

  await nameInput.fill(`${editedName} saved`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Template saved", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Back to templates" }).click();
  await expect(page).toHaveURL(/\/templates$/);
  await expect(warning).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});

test("asks before closing or refreshing with unsaved template changes", async ({ page }) => {
  const nameInput = page.getByRole("textbox", { name: "Template name" }).first();
  const editedName = `${await nameInput.inputValue()} refresh edit`;
  await nameInput.fill(editedName);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();

  const dialogPromise = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  const warning = await dialogPromise;
  expect(warning.type()).toBe("beforeunload");
  await warning.dismiss();
  await expect.poll(() => page.isClosed()).toBe(false);
});
