// Which mode a file opens in, and the tip that explains the two modes. These open files directly,
// not through the helpers, which skip this start on purpose.
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";

const DIRTY = fileURLToPath(new URL("../fixtures/dirty.pdf", import.meta.url));
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==",
  "base64",
);

const mode = (page: Page, name: "Draw" | "Words") => page.getByRole("radio", { name });
const tip = (page: Page) => page.getByTestId("mode-tip");

/** Word highlights let touches through to the page underneath, so aim at where the word is. */
async function tapWord(page: Page) {
  const word = page.locator('[data-testid="word"][data-word="123-45-6789"]');
  await expect(word).toHaveCount(1);
  const w = (await word.boundingBox())!;
  await page.mouse.click(w.x + w.width / 2, w.y + w.height / 2);
}

/** A PDF whose pages each have the given text, or nothing, like a scan. */
async function pdfWithPages(pages: (string | null)[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([400, 500]);
    if (text) page.drawText(text, { x: 40, y: 400, size: 18, font });
  }
  return Buffer.from(await doc.save());
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("a PDF with text opens in Words, with a tip about both modes", async ({ page }) => {
  await page.getByTestId("file-input").setInputFiles(DIRTY);
  await expect(mode(page, "Words")).toBeChecked();
  await expect(tip(page)).toContainText("Words:");
  await expect(tip(page)).toContainText("Draw:");
  await expect(tip(page)).toContainText("signatures and photos");
  await expect(page.locator('[data-testid="word"][data-word="123-45-6789"]')).toHaveCount(1);

  // Words works straight away.
  await tapWord(page);
  await expect(page.getByTestId("box")).toHaveCount(1);
});

test("the tip stays clear of the mode switch and goes away for the rest of the visit", async ({ page }) => {
  await page.getByTestId("file-input").setInputFiles(DIRTY);
  const card = (await tip(page).boundingBox())!;
  const words = (await mode(page, "Words").boundingBox())!;
  const overlaps = card.x < words.x + words.width && words.x < card.x + card.width && card.y < words.y + words.height && words.y < card.y + card.height;
  expect(overlaps).toBe(false);

  await page.getByRole("button", { name: "Got it" }).click();
  await expect(tip(page)).toHaveCount(0);

  // Opening another file doesn't bring it back.
  await page.getByTestId("file-input").setInputFiles(DIRTY);
  await expect(page.locator(".page-loading")).toHaveCount(0);
  await expect(mode(page, "Words")).toBeChecked();
  await expect(tip(page)).toHaveCount(0);

  // A new visit does: nothing about it is saved.
  await page.reload();
  await page.getByTestId("file-input").setInputFiles(DIRTY);
  await expect(tip(page)).toBeVisible();
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

test("Escape dismisses the tip, and so does making a first box", async ({ page }) => {
  await page.getByTestId("file-input").setInputFiles(DIRTY);
  await expect(tip(page)).toBeVisible();
  await expect(page.locator('[data-testid="word"][data-word="123-45-6789"]')).toHaveCount(1); // fully loaded
  await page.keyboard.press("Escape");
  await expect(tip(page)).toHaveCount(0);

  await page.reload();
  await page.getByTestId("file-input").setInputFiles(DIRTY);
  await expect(tip(page)).toBeVisible();
  await tapWord(page);
  await expect(tip(page)).toHaveCount(0);
});

test("an image opens in Draw with no tip", async ({ page }) => {
  await page.getByTestId("file-input").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG });
  await expect(page.getByTestId("page-layer")).toBeVisible();
  await expect(mode(page, "Draw")).toBeChecked();
  await expect(tip(page)).toHaveCount(0);
});

test("a scanned PDF moves to Draw with no tip", async ({ page }) => {
  const buffer = await pdfWithPages([null, null]);
  await page.getByTestId("file-input").setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer });
  await expect(mode(page, "Draw")).toBeChecked();
  await expect(tip(page)).toHaveCount(0);
});

test("a page with no text in a PDF offers a way to Draw", async ({ page }) => {
  const buffer = await pdfWithPages(["Some words here", null]);
  await page.getByTestId("file-input").setInputFiles({ name: "mixed.pdf", mimeType: "application/pdf", buffer });
  await expect(page.locator('[data-testid="word"][data-word="words"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Got it" }).click();

  await page.getByRole("button", { name: "Next page" }).click();
  // Having read a page already, it stays in the mode the user can see, and says what to do.
  await expect(mode(page, "Words")).toBeChecked();
  const hint = page.getByTestId("stage-hint");
  await expect(hint).toContainText("no selectable text");
  await hint.getByRole("button", { name: "Use Draw" }).click();
  await expect(mode(page, "Draw")).toBeChecked();
});

test("choosing Draw first isn't overridden", async ({ page }) => {
  await page.getByTestId("file-input").setInputFiles(DIRTY);
  await mode(page, "Draw").click();
  await expect(mode(page, "Draw")).toBeChecked();
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(mode(page, "Draw")).toBeChecked();
});
