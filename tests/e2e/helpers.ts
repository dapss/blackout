import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

export const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));

export async function openFixture(page: Page, name: string) {
  await page.getByTestId("file-input").setInputFiles(join(FIXTURES, name));
  await expect(page.getByTestId("page-layer")).toBeVisible();
  await expect(page.locator(".page-loading")).toHaveCount(0);
}

export async function openBuffer(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.getByTestId("file-input").setInputFiles({ name, mimeType, buffer });
  await expect(page.getByTestId("page-layer")).toBeVisible();
  await expect(page.locator(".page-loading")).toHaveCount(0);
}

/** Drag a box on the current page; coordinates are fractions of the page's width and height. */
export async function drawBox(page: Page, fx0: number, fy0: number, fx1: number, fy1: number) {
  const layer = page.getByTestId("page-layer");
  await layer.scrollIntoViewIfNeeded();
  let r = (await layer.boundingBox())!;
  // Scroll so the whole drag is on screen.
  const vh = page.viewportSize()!.height;
  const top = r.y + r.height * Math.min(fy0, fy1);
  const bottom = r.y + r.height * Math.max(fy0, fy1);
  if (top < 0 || bottom > vh) {
    await page.mouse.move(r.x + r.width / 2, Math.min(Math.max(r.y + 10, 10), vh - 10));
    await page.mouse.wheel(0, (top + bottom) / 2 - vh / 2);
    await page.waitForTimeout(150);
    r = (await layer.boundingBox())!;
  }
  await page.mouse.move(r.x + r.width * fx0, r.y + r.height * fy0);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * ((fx0 + fx1) / 2), r.y + r.height * ((fy0 + fy1) / 2), { steps: 3 });
  await page.mouse.move(r.x + r.width * fx1, r.y + r.height * fy1, { steps: 3 });
  await page.mouse.up();
}

/** Export, wait for the check, download, and return the file's bytes and name. */
export async function exportAndDownload(page: Page, boxes: number) {
  await page.getByTestId("export-button").click();
  const summary = page.getByTestId("verify-summary");
  await expect(summary).toBeVisible({ timeout: 120_000 });
  // On failure, show which checks failed.
  const checks = await page.getByTestId("verify-checks").innerText();
  expect(await summary.innerText(), checks).toBe(
    `Verified: 0 of ${boxes} redacted item${boxes === 1 ? "" : "s"} recoverable`,
  );
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
  const path = await download.path();
  return { name: download.suggestedFilename(), bytes: new Uint8Array(readFileSync(path!)) };
}

export async function pdfTextItems(bytes: Uint8Array): Promise<{ items: number; text: string; pages: number; sizes: number[][] }> {
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const pdf = await task.promise;
  let items = 0;
  let text = "";
  const sizes: number[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i);
    const vp = p.getViewport({ scale: 1 });
    sizes.push([Math.round(vp.width), Math.round(vp.height)]);
    const t = await p.getTextContent();
    items += t.items.length;
    text += t.items.map((it) => ("str" in it ? it.str : "")).join(" ");
  }
  const pages = pdf.numPages;
  await task.destroy();
  return { items, text, pages, sizes };
}

export { pdfjs };
