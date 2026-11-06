import { expect, test } from "@playwright/test";
import { inspectPdfStructure, inspectPng } from "../../src/core/verify";
import { OTHER_TEXT, SECRET, SECRET_RECT } from "../fixtures/make";
import { addJpegExif } from "../helpers/png";
import { drawBox, exportAndDownload, openBuffer, openFixture, pdfjs, pdfTextItems } from "./helpers";

// The secret's position on page 1 of dirty.pdf, as fractions of the A4 page, with a margin.
const A4 = { w: 595, h: 842 };
const SECRET_BOX = [
  (SECRET_RECT.x - 8) / A4.w,
  (SECRET_RECT.y - 8) / A4.h,
  (SECRET_RECT.x + SECRET_RECT.w + 8) / A4.w,
  (SECRET_RECT.y + SECRET_RECT.h + 8) / A4.h,
] as const;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("the page still shows when copying it to the screen fails at first", async ({ page }) => {
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.drawImage;
    let failures = 2;
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      if (this.canvas.classList.contains("page-canvas") && failures-- > 0) return;
      (original as (...a: unknown[]) => void).apply(this, args);
    };
  });
  await page.reload();
  await openFixture(page, "dirty.pdf");
  await expect
    .poll(() =>
      page.locator(".page-canvas").evaluate((c: HTMLCanvasElement) => {
        const { data } = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
        let opaque = true;
        let ink = false;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] !== 255) opaque = false;
          if (data[i]! < 128) ink = true;
        }
        return opaque && ink;
      }),
    )
    .toBe(true);
});

test("shows the privacy banner and links to the source", async ({ page }) => {
  await expect(page.getByTestId("privacy-banner")).toContainText("Your file never leaves this device");
  await page.getByText("How to verify").click();
  await expect(page.getByText("airplane mode")).toBeVisible();
  const footer = page.locator("footer");
  await expect(footer.getByRole("link", { name: "Source on GitHub" })).toHaveAttribute("href", "https://github.com/dapss/blackout");
  await expect(footer.getByRole("link", { name: /Apache-2.0/ })).toBeVisible();
  const version = footer.getByTestId("build-version");
  await expect(version).toHaveText(/^v\d+\.\d+\.\d+ · [0-9a-f]{7} \(verify\)$/);
  await expect(version.getByRole("link").first()).toHaveAttribute("href", /github\.com\/dapss\/blackout\/commit\/[0-9a-f]{40}$/);
  await expect(version.getByRole("link", { name: "verify" })).toHaveAttribute("href", /#verify-this-copy$/);
  await expect(footer.getByTestId("preview-label")).toHaveAttribute("href", "https://blackout-redact.pages.dev");
});

test("text PDF: the export has zero extractable text and nothing else from the original", async ({ page }) => {
  await openFixture(page, "dirty.pdf");
  await expect(page.getByTestId("page-indicator")).toHaveText("1 / 2");
  await drawBox(page, ...SECRET_BOX);
  await expect(page.getByTestId("box")).toHaveCount(1);

  const { name, bytes } = await exportAndDownload(page, 1);
  expect(name).toBe("dirty.redacted.pdf");

  const out = await pdfTextItems(bytes);
  expect(out.pages).toBe(2);
  expect(out.items).toBe(0);
  expect(out.text).not.toContain(SECRET);
  expect(out.text).not.toContain(OTHER_TEXT);
  expect(Buffer.from(bytes).toString("latin1")).not.toContain("Jane Secret");

  const findings = await inspectPdfStructure(bytes, 2);
  for (const [id, list] of Object.entries(findings)) expect(list, id).toEqual([]);
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const pdf = await task.promise;
  const { info, metadata } = (await pdf.getMetadata()) as { info: Record<string, unknown>; metadata: unknown };
  expect(metadata).toBeNull();
  expect(info.Title ?? info.Author ?? info.Producer).toBeUndefined();
  expect(info.IsAcroFormPresent).toBe(false);
  expect(await pdf.getAttachments()).toBeNull();
  expect(await pdf.getJSActions()).toBeNull();
  for (let i = 1; i <= pdf.numPages; i++) expect(await (await pdf.getPage(i)).getAnnotations()).toEqual([]);
  await task.destroy();
});

test("the export keeps the displayed page geometry of a rotated page", async ({ page }) => {
  await openFixture(page, "rotated.pdf");
  const { bytes } = await exportAndDownload(page, 0);
  const out = await pdfTextItems(bytes);
  expect(out.items).toBe(0);
  expect(out.sizes).toEqual([[842, 595]]);
});

test("image: the exported PNG has no EXIF and the box is burned in", async ({ page }) => {
  const jpegB64 = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 200;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 320, 200);
    ctx.fillStyle = "#c00";
    ctx.font = "bold 28px sans-serif";
    ctx.fillText("ID 3171234567890001", 20, 100);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.95));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (const b of buf) s += String.fromCharCode(b);
    return btoa(s);
  });
  const jpeg = addJpegExif(new Uint8Array(Buffer.from(jpegB64, "base64")), "SECRET-EXIF-GPS-MARKER");
  expect(Buffer.from(jpeg).toString("latin1")).toContain("SECRET-EXIF-GPS-MARKER");

  await openBuffer(page, "id-card.jpg", "image/jpeg", Buffer.from(jpeg));
  await drawBox(page, 0.03, 0.3, 0.97, 0.6);
  const { name, bytes } = await exportAndDownload(page, 1);
  expect(name).toBe("id-card.redacted.png");

  const png = inspectPng(bytes);
  expect(png.valid).toBe(true);
  expect(png.disallowed).toEqual([]);
  expect([png.width, png.height]).toEqual([320, 200]);
  const raw = Buffer.from(bytes).toString("latin1");
  expect(raw).not.toContain("SECRET-EXIF-GPS-MARKER");
  expect(raw).not.toContain("Exif");
});

test("boxes can be drawn, moved, resized, deleted, undone and redone", async ({ page }) => {
  await openFixture(page, "dirty.pdf");
  const boxes = page.getByTestId("box");
  const undoBtn = page.getByRole("button", { name: "Undo" });
  const redoBtn = page.getByRole("button", { name: "Redo" });

  await drawBox(page, 0.1, 0.1, 0.3, 0.2);
  await drawBox(page, 0.5, 0.1, 0.7, 0.16);
  await expect(boxes).toHaveCount(2);

  const first = boxes.first();
  const before = (await first.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 40, before.y + before.height / 2 + 30, { steps: 4 });
  await page.mouse.up();
  const moved = (await first.boundingBox())!;
  expect(moved.x).toBeCloseTo(before.x + 40, 0);
  expect(moved.y).toBeCloseTo(before.y + 30, 0);
  expect(moved.width).toBeCloseTo(before.width, 0);

  const handle = first.locator('[data-handle="se"]');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 25, hb.y + hb.height / 2 + 15, { steps: 4 });
  await page.mouse.up();
  const resized = (await first.boundingBox())!;
  expect(resized.width).toBeCloseTo(moved.width + 25, 0);
  expect(resized.height).toBeCloseTo(moved.height + 15, 0);
  expect(resized.x).toBeCloseTo(moved.x, 0);

  await undoBtn.click();
  expect((await first.boundingBox())!.width).toBeCloseTo(moved.width, 0);
  await undoBtn.click();
  expect((await first.boundingBox())!.x).toBeCloseTo(before.x, 0);
  await redoBtn.click();
  expect((await first.boundingBox())!.x).toBeCloseTo(moved.x, 0);

  await first.click();
  await page.keyboard.press("Delete");
  await expect(boxes).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(boxes).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(boxes).toHaveCount(1);

  await boxes.first().click();
  await page.getByRole("button", { name: "Delete" }).click(); // the toolbar's, or the bubble's on a phone
  await expect(boxes).toHaveCount(0);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByTestId("page-indicator")).toHaveText("2 / 2");
  await drawBox(page, 0.2, 0.2, 0.4, 0.3);
  await expect(boxes).toHaveCount(1);
  await page.getByRole("button", { name: "Previous page" }).click();
  await expect(boxes).toHaveCount(0);
});

test("a tiny click does not create a box", async ({ page }) => {
  await openFixture(page, "dirty.pdf");
  const r = (await page.getByTestId("page-layer").boundingBox())!;
  await page.mouse.click(r.x + 50, r.y + 50);
  await expect(page.getByTestId("box")).toHaveCount(0);
});

test("the download is blocked when the check fails", async ({ page }) => {
  // Sabotage the burn step: black fills are silently skipped, so boxes never reach the output.
  await page.addInitScript(() => {
    const protos = new Set<object>([Object.getPrototypeOf(document.createElement("canvas").getContext("2d"))]);
    if (typeof OffscreenCanvas !== "undefined") protos.add(Object.getPrototypeOf(new OffscreenCanvas(1, 1).getContext("2d")));
    for (const proto of protos as Set<CanvasRenderingContext2D>) {
      const fill = proto.fillRect;
      proto.fillRect = function (this: CanvasRenderingContext2D, ...args: [number, number, number, number]) {
        if (this.fillStyle === "#000000") return;
        return fill.apply(this, args);
      } as typeof fill;
    }
  });
  await page.goto("/");
  await openFixture(page, "dirty.pdf");
  await drawBox(page, ...SECRET_BOX);
  await page.getByTestId("export-button").click();
  await expect(page.getByTestId("verify-summary")).toContainText("Download blocked", { timeout: 120_000 });
  await expect(page.locator('[data-check="boxes-black"]')).toHaveAttribute("data-ok", "false");
  await expect(page.getByTestId("download")).toHaveCount(0);
  await expect(page.getByTestId("download-blocked")).toBeDisabled();
});

test("rejects files that are not PDFs or images", async ({ page }) => {
  await page.getByTestId("file-input").setInputFiles({
    name: "notes.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("<html>not a pdf</html>"),
  });
  await expect(page.getByRole("alert")).toContainText("Unsupported file");
});

test.describe("on a desktop screen", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("a selected box has no action bubble", async ({ page }) => {
    await page.goto("/");
    await openFixture(page, "dirty.pdf");
    await drawBox(page, 0.3, 0.4, 0.7, 0.45);
    await expect(page.getByTestId("box")).toHaveCount(1);
    await expect(page.getByTestId("box-bubble")).toHaveCount(0);
  });
});
