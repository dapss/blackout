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

test("tapping a box opens its action bubble, which deletes it", async ({ page }) => {
  const bubble = page.getByTestId("box-bubble");
  await expect(bubble).toHaveCount(0);
  await drawBox(page, 0.3, 0.4, 0.7, 0.45);
  // Finishing a box doesn't open it: it would cover the text around the box.
  await expect(page.getByTestId("box")).toHaveCount(1);
  await expect(bubble).toHaveCount(0);
  await page.getByTestId("box").click();
  await expect(bubble).toBeVisible();
  // The bubble is the one Delete on a phone.
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);

  // It sits on the page, clear of the box and its handles.
  const b = (await bubble.boundingBox())!;
  const box = (await page.getByTestId("box").boundingBox())!;
  const layer = (await page.getByTestId("page-layer").boundingBox())!;
  expect(b.y + b.height).toBeLessThanOrEqual(box.y - 22);
  expect(b.x).toBeGreaterThanOrEqual(layer.x);
  expect(b.x + b.width).toBeLessThanOrEqual(layer.x + layer.width);
  expect((await bubble.getByRole("button", { name: "Delete box" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // It gets out of the way during a drag.
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 10, cy + 10);
  await expect(bubble).toHaveCount(0);
  await page.mouse.up();
  await expect(bubble).toBeVisible();

  await bubble.getByRole("button", { name: "Delete box" }).click();
  await expect(page.getByTestId("box")).toHaveCount(0);
  await expect(bubble).toHaveCount(0);
});

test("tapping a box doesn't add an undo step, and tapping away closes the bubble", async ({ page }) => {
  await drawBox(page, 0.3, 0.4, 0.7, 0.45);
  await page.getByTestId("box").click();
  await expect(page.getByTestId("box-bubble")).toBeVisible();
  const layer = (await page.getByTestId("page-layer").boundingBox())!;
  await page.mouse.click(layer.x + 20, layer.y + layer.height - 20);
  await expect(page.getByTestId("box-bubble")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("box")).toHaveCount(0);
});

test("the phone browser bar follows the top bar while a file is open", async ({ page }) => {
  const light = page.locator('meta[name="theme-color"][media*="light"]');
  await expect(light).toHaveAttribute("content", "#141414");
  await page.getByRole("button", { name: "Close file" }).click();
  await expect(light).toHaveAttribute("content", "#f4f3ef");
});
