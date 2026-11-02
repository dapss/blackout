import { expect, test } from "@playwright/test";
import { drawBox, openFixture } from "./helpers";

// The phone layout applies up to 720px wide, in every browser.
test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "long-20.pdf");
});

test("the page gets the screen, with tools at the bottom and Export at the top", async ({ page }) => {
  const layer = (await page.getByTestId("page-layer").boundingBox())!;
  expect(layer.y).toBeLessThan(260); // was ~460px with the desktop toolbar wrapped onto a phone
  await expect(page.getByRole("navigation", { name: "Editing tools" })).toBeInViewport();
  await expect(page.getByTestId("export-button")).toBeInViewport();
  // The start-page chrome makes way for the editor.
  await expect(page.getByTestId("privacy-banner")).toHaveCount(0);
  await expect(page.locator("footer")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // The page scrolls inside the editor; the bars stay put.
  await page.locator(".stage").evaluate((s) => s.scrollTo(0, s.scrollHeight));
  await expect(page.getByRole("navigation", { name: "Editing tools" })).toBeInViewport();
  await expect(page.getByTestId("export-button")).toBeInViewport();
});

test("the Private chip explains how to verify", async ({ page }) => {
  await page.getByTestId("private-chip").click();
  const sheet = page.getByRole("dialog", { name: "Your file never leaves this device" });
  await expect(sheet).toContainText("airplane mode");
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toHaveCount(0);
});

test("the Pages sheet jumps to a page", async ({ page }) => {
  await page.getByRole("button", { name: "Pages" }).click();
  const sheet = page.getByRole("dialog", { name: "Pages" });
  await expect(sheet.getByRole("button", { name: /^Page \d+/ })).toHaveCount(20);
  await sheet.getByRole("button", { name: "Page 3", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId("page-indicator")).toHaveText("3 / 20");
});

test("the More menu zooms, peeks and clears the page", async ({ page }) => {
  await drawBox(page, 0.1, 0.05, 0.6, 0.1);
  await expect(page.getByTestId("box")).toHaveCount(1);
  const more = page.getByRole("button", { name: "More" });
  const width = async () => (await page.getByTestId("page-layer").boundingBox())!.width;
  const fit = await width();

  await more.click();
  await page.getByRole("menuitem", { name: "Zoom in" }).click();
  await expect.poll(width).toBeGreaterThan(fit * 1.1);
  await more.click();
  await page.getByRole("menuitem", { name: /^Fit to width/ }).click();
  await expect.poll(width).toBeCloseTo(fit, 0);

  await more.click();
  await page.getByRole("menuitemcheckbox", { name: "Peek under boxes" }).click();
  await expect(page.getByTestId("page-layer")).toHaveClass(/peek/);

  await more.click();
  await page.getByRole("menuitem", { name: "Clear page" }).click();
  await expect(page.getByTestId("box")).toHaveCount(0);
});

test("Delete appears only while a box is selected", async ({ page }) => {
  const del = page.getByRole("button", { name: "Delete" });
  await expect(del).toHaveCount(0);
  await drawBox(page, 0.1, 0.05, 0.6, 0.1);
  await expect(del).toBeVisible();
  await del.click();
  await expect(page.getByTestId("box")).toHaveCount(0);
  await expect(del).toHaveCount(0);
});

test("closing asks first when there are boxes, then returns to the start page", async ({ page }) => {
  await drawBox(page, 0.1, 0.05, 0.6, 0.1);
  page.once("dialog", (d) => void d.dismiss());
  await page.getByRole("button", { name: "Close file" }).click();
  await expect(page.getByTestId("page-layer")).toBeVisible();

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Close file" }).click();
  await expect(page.getByRole("button", { name: "Choose a file" })).toBeVisible();
  await expect(page.getByTestId("privacy-banner")).toBeVisible();
  await expect(page.locator("footer")).toBeVisible();
});

test("the page doesn't move when the hint above it changes", async ({ page }) => {
  const top = async () => (await page.getByTestId("page-layer").boundingBox())!.y;
  const before = await top();
  await drawBox(page, 0.1, 0.05, 0.6, 0.1); // hint switches from "Drag across…" to "1 box…"
  await expect(page.getByTestId("box")).toHaveCount(1);
  expect(await top()).toBe(before);
  await page.getByRole("radio", { name: "Words" }).click(); // and to the Words hint
  expect(await top()).toBe(before);
});
