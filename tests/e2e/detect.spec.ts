import { expect, type Locator, type Page, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { exportAndDownload, openBuffer, openFixture, pdfTextItems } from "./helpers";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==",
  "base64",
);

const finding = (page: Page, detector: string) => page.locator(`[data-testid="finding"][data-detector="${detector}"]`);
const action = (row: Locator, name: string) => row.getByRole("button", { name, exact: true });

async function find(page: Page) {
  await page.getByTestId("find-button").click();
  await expect(page.getByTestId("review-summary")).toBeVisible({ timeout: 60_000 });
}

async function openDetect(page: Page) {
  await page.goto("/");
  await openFixture(page, "detect.pdf");
  await find(page);
}

async function pdfOf(text: string | null): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 500]);
  if (text) page.drawText(text, { x: 40, y: 400, size: 18, font: await doc.embedFont(StandardFonts.Helvetica) });
  return Buffer.from(await doc.save());
}

test("finds each type on the pages it's on, and not the look-alikes, with no network", async ({ page, context }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const requests: string[] = [];
  // On the context, to catch workers too. Blob URLs are thumbnails in memory, not requests.
  context.on("request", (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url());
  });
  await context.setOffline(true);
  await openFixture(page, "detect.pdf");
  await find(page);

  await expect(page.getByTestId("finding")).toHaveCount(6);
  for (const [detector, type, text] of [
    ["intl.email", "Email · Page 1", "jane.doe@example.com"],
    ["intl.phone", "Phone number · Page 1", "+62 812-3456-7890"],
    ["intl.card", "Card number · Page 1", "4111 1111 1111 1111"],
    ["id.nik", "NIK (Indonesian ID) · Page 1", "3201014512900001"],
    ["eu.iban", "IBAN · Page 2", "DE89 3704 0044 0532 0130 00"],
    ["id.npwp", "NPWP (Indonesian tax ID) · Page 2", "01.234.567.8-901.234"],
  ] as const) {
    await expect(finding(page, detector)).toContainText(type);
    await expect(finding(page, detector)).toContainText(text);
  }
  const panel = page.getByTestId("review-panel");
  await expect(panel).not.toContainText("1234567890123456");
  await expect(panel).not.toContainText("2024-01-15");

  await expect(page.getByTestId("box")).toHaveCount(0);
  expect(requests).toEqual([]);
});

test("a phone number that wraps is blacked out on both lines, and the export is clean", async ({ page }) => {
  const doc = await PDFDocument.create();
  const p = doc.addPage([400, 300]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  p.drawText("Please call the office on +62 21 5555", { x: 40, y: 220, size: 14, font });
  p.drawText("0199 if it is urgent.", { x: 40, y: 200, size: 14, font });
  await page.goto("/");
  await openBuffer(page, "wrapped.pdf", "application/pdf", Buffer.from(await doc.save()));
  await find(page);

  const row = finding(page, "intl.phone");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("+62 21 5555 0199");
  await page.getByRole("button", { name: /Redact all/ }).click();
  await expect(row).toContainText("Blacked out");

  await expect(page.getByTestId("box")).toHaveCount(2);
  const [first, second] = await page.getByTestId("box").evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { top: r.top, left: r.left };
    }),
  );
  expect(second!.top).toBeGreaterThan(first!.top);
  expect(second!.left).toBeLessThan(first!.left);

  const { bytes } = await exportAndDownload(page, 2);
  expect((await pdfTextItems(bytes)).items).toBe(0);
});

test("the wording doesn't promise it found everything", async ({ page }) => {
  await openDetect(page);
  const summary = page.getByTestId("review-summary");
  await expect(summary).toContainText("We found 6 items.");
  await expect(summary).toContainText("Please review the rest");
  await expect(page.getByTestId("review-panel")).toContainText("can be missed");
});

test("accept, reject, then Redact all, through a verified export", async ({ page }) => {
  await openDetect(page);
  const email = finding(page, "intl.email");
  const phone = finding(page, "intl.phone");

  await expect(page.getByTestId("finding-mark")).toHaveCount(4);
  const mark = (await page.locator('[data-finding-id="0-0"]').boundingBox())!;
  await action(email, "Accept").click();
  await expect(email).toHaveAttribute("data-status", "accepted");
  await expect(email).toContainText("Blacked out");
  await expect(page.getByTestId("box")).toHaveCount(1);
  const box = (await page.getByTestId("box").boundingBox())!;
  expect(box.x).toBeCloseTo(mark.x, 0);
  expect(box.width).toBeCloseTo(mark.width, 0);

  await action(phone, "Reject").click();
  await expect(phone).toHaveAttribute("data-status", "rejected");
  await expect(page.getByTestId("finding-mark")).toHaveCount(2);

  await page.getByRole("button", { name: "Redact all (4)" }).click();
  await expect(page.locator('[data-testid="finding"][data-status="accepted"]')).toHaveCount(5);
  await expect(phone).toHaveAttribute("data-status", "rejected");
  await expect(page.getByRole("button", { name: "Redact all" })).toBeDisabled();
  await expect(page.getByTestId("box")).toHaveCount(3);

  await page.getByTestId("export-button").click();
  await expect(page.getByTestId("verify-summary")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("export-unreviewed")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("export-dialog")).toHaveCount(0);

  const { bytes } = await exportAndDownload(page, 5);
  expect((await pdfTextItems(bytes)).items).toBe(0);
});

test("a finding is only blacked out while a box really covers it", async ({ page }) => {
  await openDetect(page);
  const email = finding(page, "intl.email");
  await action(email, "Accept").click();
  await expect(email).toHaveAttribute("data-status", "accepted");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(email).toHaveAttribute("data-status", "pending");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(email).toHaveAttribute("data-status", "accepted");

  await page.getByTestId("box").click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("box")).toHaveCount(0);
  await expect(email).toHaveAttribute("data-status", "pending");
});

test("Redact all is one step to undo, and Restore brings back a rejected finding", async ({ page }) => {
  await openDetect(page);
  const phone = finding(page, "intl.phone");
  await action(phone, "Reject").click();
  await action(phone, "Restore").click();
  await expect(phone).toHaveAttribute("data-status", "pending");

  await page.getByRole("button", { name: "Redact all (6)" }).click();
  await expect(page.locator('[data-testid="finding"][data-status="accepted"]')).toHaveCount(6);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator('[data-testid="finding"][data-status="pending"]')).toHaveCount(6);
  await expect(page.getByTestId("box")).toHaveCount(0);
});

test("a box the user made counts if it covers the finding", async ({ page }) => {
  await openDetect(page);
  await page.getByRole("radio", { name: "Words" }).click();
  const word = page.locator('[data-testid="word"][data-word="3201014512900001"]');
  await expect(word).toHaveCount(1);
  const w = (await word.boundingBox())!;
  await page.mouse.click(w.x + w.width / 2, w.y + w.height / 2);
  await expect(finding(page, "id.nik")).toHaveAttribute("data-status", "accepted");
});

test("showing a finding goes to its page", async ({ page }) => {
  await openDetect(page);
  await finding(page, "eu.iban").getByRole("button", { name: /IBAN/ }).click();
  await expect(page.getByTestId("page-indicator")).toHaveText("2 / 3");
  await expect(page.locator(".finding-mark.active")).toBeVisible();
});

test.describe("reviewing on a phone", () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true });

  test("tapping a finding shrinks the panel so the page shows, and Next steps through", async ({ page }) => {
    await openDetect(page);
    const stage = page.locator(".stage");
    const roomInList = (await stage.boundingBox())!.height;
    await expect(page.getByTestId("review-tap-hint")).toBeVisible();

    await finding(page, "intl.email").getByRole("button", { name: /Email/ }).click();
    await expect(page.getByTestId("finding")).toHaveCount(1);
    await expect(page.getByTestId("review-position")).toHaveText("1 of 6");
    expect((await stage.boundingBox())!.height).toBeGreaterThan(roomInList * 1.3);
    const panel = (await page.getByTestId("review-panel").boundingBox())!;
    expect(panel.width).toBe(page.viewportSize()!.width);
    await expect(page.locator(".finding-mark.active")).toBeInViewport({ ratio: 1 });

    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(finding(page, "intl.phone")).toHaveCount(1);
    await expect(page.getByTestId("review-position")).toHaveText("2 of 6");
    await action(finding(page, "intl.phone"), "Accept").click();
    await expect(finding(page, "intl.phone")).toContainText("Blacked out");
    await expect(page.getByTestId("box")).toHaveCount(1);

    await page.getByRole("button", { name: "All items", exact: true }).click();
    await expect(page.getByTestId("finding")).toHaveCount(6);
    await expect(page.getByRole("button", { name: /Redact all/ })).toBeVisible();
    await expect(page.getByTestId("review-panel")).toBeFocused();
  });
});

test("the desktop panel keeps the whole list when a finding is shown", async ({ page, isMobile }) => {
  test.skip(!!isMobile, "desktop layout");
  await openDetect(page);
  await finding(page, "intl.email").getByRole("button", { name: /Email/ }).click();
  await expect(page.getByTestId("finding")).toHaveCount(6);
  await expect(page.getByTestId("review-position")).toHaveCount(0);
});

test("exporting warns about findings nobody has reviewed, without blocking the download", async ({ page }) => {
  await openDetect(page);
  await action(finding(page, "intl.email"), "Accept").click();
  await action(finding(page, "intl.phone"), "Reject").click();
  await page.getByTestId("export-button").click();
  await expect(page.getByTestId("verify-summary")).toContainText("nothing under your box", { timeout: 120_000 });
  await expect(page.getByTestId("verify-scope")).toContainText("left uncovered");
  await expect(page.getByTestId("export-unreviewed")).toHaveText("4 found items haven’t been reviewed, so they aren’t blacked out in this file.");
  await expect(page.getByTestId("download")).toBeEnabled();
});

test("a page with no text says detection can't run there, and points to Draw", async ({ page }) => {
  await openDetect(page);
  const note = page.getByTestId("review-notext");
  await expect(note).toContainText("can’t run yet on page 3");
  await expect(note).toContainText("Use Draw");
  await page.getByRole("radio", { name: "Words" }).click();
  await note.getByRole("button", { name: "Use Draw on page 3" }).click();
  await expect(page.getByRole("radio", { name: "Draw" })).toBeChecked();
  await expect(page.getByTestId("page-indicator")).toHaveText("3 / 3");
});

test("in Words, the hint on a page with no text also says Find can't run", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "detect.pdf");
  await page.getByRole("radio", { name: "Words" }).click();
  await page.getByRole("button", { name: "Next page" }).click();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByTestId("stage-hint")).toContainText("Words and Find can’t run here yet");
});

test("a scanned PDF can't be searched, and says so", async ({ page }) => {
  await page.goto("/");
  await openBuffer(page, "scan.pdf", "application/pdf", await pdfOf(null));
  await find(page);
  await expect(page.getByTestId("review-summary")).toContainText("no selectable text, so detection can’t run on it yet");
  await expect(page.getByTestId("review-notext").getByRole("button", { name: "Use Draw" })).toBeVisible();
  await expect(page.getByTestId("finding")).toHaveCount(0);
});

test("an image can't be searched, and says so", async ({ page }) => {
  await page.goto("/");
  await openBuffer(page, "photo.png", "image/png", ONE_PIXEL_PNG);
  await find(page);
  await expect(page.getByTestId("review-summary")).toContainText("can’t run on it yet");
});

test("finding nothing doesn't suggest the file is clean", async ({ page }) => {
  await page.goto("/");
  await openBuffer(page, "plain.pdf", "application/pdf", await pdfOf("Nothing to see here"));
  await find(page);
  const summary = page.getByTestId("review-summary");
  await expect(summary).toContainText("We didn’t find anything");
  await expect(summary).toContainText("please review every page yourself");
  await expect(page.getByRole("button", { name: /Redact all/ })).toHaveCount(0);
});

test("Close returns focus to Find, and opening again doesn't lose the review", async ({ page }) => {
  await openDetect(page);
  await action(finding(page, "intl.phone"), "Reject").click();
  await page.getByTestId("review-panel").getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("review-panel")).toHaveCount(0);
  await expect(page.getByTestId("finding-mark")).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))).toBe("find-button");

  await page.getByTestId("find-button").click();
  await expect(finding(page, "intl.phone")).toHaveAttribute("data-status", "rejected");
});

test("a long PDF scans page by page and the page stays usable", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "long-20.pdf");
  await page.getByTestId("find-button").click();
  await expect(page.getByTestId("review-summary")).toBeVisible({ timeout: 80_000 });
  await expect(page.getByTestId("review-notext")).toHaveCount(0);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByTestId("page-indicator")).toHaveText("2 / 20");
});
