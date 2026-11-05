import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { SECRET, type TruthLine } from "../fixtures/make";
import { exportAndDownload, openBuffer, openFixture, pdfTextItems } from "./helpers";

// dirty.pdf page 1 (595 x 842): SECRET drawn at x=76, baseline 124 from the top, Helvetica 18pt.
const PAGE_W = 595;
const BASELINE = 124;

async function secretSpan(prefix: string, upTo: string) {
  const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  return { x0: 76 + font.widthOfTextAtSize(prefix, 18), x1: 76 + font.widthOfTextAtSize(upTo, 18) };
}

async function toScreen(page: Page, x: number, y: number, pageWidth = PAGE_W) {
  let r = (await page.getByTestId("page-layer").boundingBox())!;
  const s = r.width / pageWidth;
  const vh = page.viewportSize()!.height;
  const screenY = r.y + y * s;
  if (screenY < 40 || screenY > vh - 40) {
    await page.evaluate((dy) => {
      // Phones scroll inside the stage, desktops scroll the window.
      const stage = document.querySelector(".stage")!;
      const before = stage.scrollTop;
      stage.scrollBy(0, dy);
      window.scrollBy(0, dy - (stage.scrollTop - before));
    }, screenY - vh / 2);
    r = (await page.getByTestId("page-layer").boundingBox())!;
  }
  return { x: r.x + x * s, y: r.y + y * s };
}

async function boxInPage(page: Page, index = 0, pageWidth = PAGE_W) {
  const r = (await page.getByTestId("page-layer").boundingBox())!;
  const b = (await page.getByTestId("box").nth(index).boundingBox())!;
  const s = r.width / pageWidth;
  return { x0: (b.x - r.x) / s, y0: (b.y - r.y) / s, x1: (b.x + b.width - r.x) / s, y1: (b.y + b.height - r.y) / s };
}

interface Ink {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  k: number;
}

/**
 * Ink of each word, read from the rendered page canvas inside the word's true advance range.
 * This is independent of the app's snapping: it's what a reader would see.
 */
async function readInk(page: Page, pageWidth: number, lines: Pick<TruthLine, "baseline" | "size" | "words">[]) {
  // A canvas still being painted has see-through pixels, which would read as black ink.
  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".page-canvas");
    if (!canvas?.width) return false;
    const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return false;
    return true;
  });
  return page.evaluate(
    ({ lines, pageWidth }) => {
      const canvas = document.querySelector<HTMLCanvasElement>(".page-canvas")!;
      const k = canvas.width / pageWidth;
      const img = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
      const lum = (x: number, y: number) => {
        const i = (y * img.width + x) * 4;
        return 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
      };
      return lines.map((line) =>
        line.words.map((w) => {
          let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
          const y0 = Math.floor((line.baseline - line.size * 1.1) * k);
          const y1 = Math.ceil((line.baseline + line.size * 0.4) * k);
          for (let x = Math.floor((w.x0 - 0.5) * k); x < Math.ceil((w.x1 + 0.5) * k); x++) {
            for (let y = y0; y < y1; y++) {
              if (lum(x, y) < 160) {
                l = Math.min(l, x);
                r = Math.max(r, x + 1);
                t = Math.min(t, y);
                b = Math.max(b, y + 1);
              }
            }
          }
          return { x0: l / k, x1: r / k, y0: t / k, y1: b / k, k };
        }),
      );
    },
    { lines, pageWidth },
  );
}

function expectExact(box: { x0: number; x1: number; y0: number; y1: number }, ink: Ink, prev?: Ink, next?: Ink, label = "") {
  const tol = 1 / ink.k;
  expect(box.x0, label).toBeLessThanOrEqual(ink.x0 + tol);
  expect(box.x1, label).toBeGreaterThanOrEqual(ink.x1 - tol);
  expect(box.y0, label).toBeLessThanOrEqual(ink.y0 + tol);
  expect(box.y1, label).toBeGreaterThanOrEqual(ink.y1 - tol);
  if (next) expect(box.x1, `${label} reaches the next word`).toBeLessThan(next.x0);
  if (prev) expect(box.x0, `${label} reaches the previous word`).toBeGreaterThan(prev.x1);
}

async function useWords(page: Page, word: string) {
  await page.getByRole("radio", { name: "Words" }).click();
  await expect(page.locator(`[data-testid="word"][data-word="${word}"]`)).toHaveCount(1);
}

test.describe("on a plain PDF", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await openFixture(page, "dirty.pdf");
    await useWords(page, "123-45-6789");
  });

  test("clicking a word covers exactly that word, and the export verifies", async ({ page }) => {
    const ssn = await secretSpan("", "SSN");
    const num = await secretSpan("SSN ", SECRET);
    const p = await toScreen(page, (num.x0 + num.x1) / 2, BASELINE - 6);
    await page.mouse.click(p.x, p.y);
    await expect(page.getByTestId("box")).toHaveCount(1);

    const [ssnInk, numInk] = (await readInk(page, PAGE_W, [{ baseline: BASELINE, size: 18, words: [{ text: "SSN", ...ssn }, { text: "num", ...num }] }]))[0]!;
    expectExact(await boxInPage(page), numInk!, ssnInk!);

    const { bytes } = await exportAndDownload(page, 1);
    expect((await pdfTextItems(bytes)).items).toBe(0);
  });

  test("a flat drag along a line of text blacks out the words it crosses", async ({ page }) => {
    const line = await secretSpan("", SECRET);
    const a = await toScreen(page, line.x0 + 2, BASELINE - 6);
    const b = await toScreen(page, line.x1 - 2, BASELINE - 6);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, a.y, { steps: 6 });
    await expect(page.locator(".word.pending")).toHaveCount(2);
    await page.mouse.up();

    await expect(page.getByTestId("box")).toHaveCount(1);
    const [ink] = (await readInk(page, PAGE_W, [{ baseline: BASELINE, size: 18, words: [{ text: SECRET, ...line }] }]))[0]!;
    expectExact(await boxInPage(page), ink!);
  });

  test("dragging across words makes one box per line, including the gap", async ({ page }) => {
    const line = await secretSpan("", SECRET);
    const a = await toScreen(page, line.x0 + 2, BASELINE - 10);
    const b = await toScreen(page, line.x1 - 2, BASELINE - 2);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, b.y, { steps: 3 });
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await expect(page.locator(".word.pending")).toHaveCount(2);
    await page.mouse.up();

    await expect(page.getByTestId("box")).toHaveCount(1);
    const [ink] = (await readInk(page, PAGE_W, [{ baseline: BASELINE, size: 18, words: [{ text: SECRET, ...line }] }]))[0]!;
    expectExact(await boxInPage(page), ink!);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("box")).toHaveCount(0);
  });

  test("clicking a word that is already covered selects its box instead of adding one", async ({ page }) => {
    const num = await secretSpan("SSN ", SECRET);
    const p = await toScreen(page, (num.x0 + num.x1) / 2, BASELINE - 6);
    await page.mouse.click(p.x, p.y);
    // Wait for the box before tapping again: on touch, two quick taps on one spot are a double-tap zoom.
    await expect(page.getByTestId("box")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator(".box.selected")).toHaveCount(0);
    await page.mouse.click(p.x, p.y);
    await expect(page.getByTestId("box")).toHaveCount(1);
    await expect(page.locator(".box.selected")).toHaveCount(1);
  });

  test("clicking empty space in Words mode adds nothing", async ({ page }) => {
    const p = await toScreen(page, 400, 300);
    await page.mouse.click(p.x, p.y);
    await expect(page.getByTestId("box")).toHaveCount(0);
  });
});

test("Words is unavailable for images", async ({ page }) => {
  await page.goto("/");
  const png = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = c.height = 50;
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await openBuffer(page, "photo.png", "image/png", Buffer.from(png));
  await expect(page.getByRole("radio", { name: "Words" })).toBeDisabled();
});

test.describe("precision on hard text", () => {
  // A sharper canvas makes the ink measurements finer than the boxes' margins.
  test.use({ deviceScaleFactor: 2 });

  test("every word box covers its own ink and none of its neighbours'", async ({ page }) => {
    const truth = JSON.parse(readFileSync(new URL("../fixtures/hard-words.json", import.meta.url), "utf8")) as TruthLine[];
    const W = 612;
    await page.goto("/");
    await openFixture(page, "hard-words.pdf");
    await useWords(page, "PASSPORT");

    for (const line of truth) {
      for (const w of line.words) {
        const p = await toScreen(page, (w.x0 + w.x1) / 2, line.baseline - line.size * 0.3, W);
        await page.mouse.click(p.x, p.y);
      }
    }
    const total = truth.reduce((n, l) => n + l.words.length, 0);
    await expect(page.getByTestId("box")).toHaveCount(total);

    const inks = await readInk(page, W, truth);
    let i = 0;
    for (const [li, line] of truth.entries()) {
      for (const [wi, w] of line.words.entries()) {
        const row = inks[li]!;
        expectExact(await boxInPage(page, i++, W), row[wi]!, row[wi - 1], row[wi + 1], `${line.label} / ${w.text}`);
      }
    }

    const { bytes } = await exportAndDownload(page, total);
    expect((await pdfTextItems(bytes)).items).toBe(0);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Fit to words shrinks a rough box onto the words, and undoes in one step", async ({ page }) => {
    await page.goto("/");
    await openFixture(page, "dirty.pdf");
    await useWords(page, "123-45-6789");
    const word = (await page.locator('[data-testid="word"][data-word="123-45-6789"]').boundingBox())!;

    await page.getByRole("radio", { name: "Draw" }).click();
    await page.mouse.move(word.x - 6, word.y - 12);
    await page.mouse.down();
    await page.mouse.move(word.x + word.width + 6, word.y + word.height + 12, { steps: 4 });
    await page.mouse.up();
    const box = page.getByTestId("box");
    const rough = (await box.boundingBox())!;

    const fit = page.getByRole("button", { name: "Fit to words" });
    await expect(fit).toHaveCount(0); // Draw mode doesn't load the words
    await page.getByRole("radio", { name: "Words" }).click();
    await box.click();
    await fit.click();

    await expect(box).toHaveCount(1);
    const tight = (await box.boundingBox())!;
    expect(tight.height).toBeLessThan(rough.height);
    expect(tight.x).toBeLessThanOrEqual(word.x + 1);
    expect(tight.y).toBeLessThanOrEqual(word.y + 1);
    expect(tight.x + tight.width).toBeGreaterThanOrEqual(word.x + word.width - 1);
    expect(tight.y + tight.height).toBeGreaterThanOrEqual(word.y + word.height - 1);
    await expect(fit).toHaveCount(0);

    await page.getByRole("button", { name: "Undo" }).click();
    expect((await box.boundingBox())!.height).toBeCloseTo(rough.height, 0);
  });
});

test("the hint says when it is still finding the words", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    new MutationObserver(() => {
      const hint = document.querySelector('[data-testid="stage-hint"]');
      if (hint) seen.push(hint.textContent ?? "");
    }).observe(document.body, { childList: true, characterData: true, subtree: true });
  });
  await page.getByTestId("file-input").setInputFiles(fileURLToPath(new URL("../fixtures/dirty.pdf", import.meta.url)));
  await expect(page.locator('[data-testid="word"][data-word="123-45-6789"]')).toHaveCount(1);
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  expect(seen.some((t) => t.includes("Finding the words"))).toBe(true);
  await expect(page.getByTestId("stage-hint")).not.toContainText("Finding the words");
});
