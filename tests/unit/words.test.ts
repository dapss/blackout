import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  lineRects,
  type Measure,
  type PixelData,
  snapWordsToInk,
  type TextItemLike,
  type TextStyleLike,
  type Word,
  wordAt,
  wordBox,
  wordsFromText,
  wordsInRect,
} from "../../src/core/words";
import { SECRET, type TruthLine } from "../fixtures/make";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
const STANDARD_FONTS = pathToFileURL(new URL("../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname).href;
const SCALE = 3;

/** Exact Helvetica widths, standing in for the browser's canvas measureText. */
async function helveticaMeasure(): Promise<Measure> {
  const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  return (text) => font.widthOfTextAtSize(text, 100);
}

/** Text-layer estimate for page 1, plus the page rendered at SCALE (Node canvas). */
async function loadPage(name: string, measure?: Measure) {
  const task = pdfjs.getDocument({ data: fixture(name), verbosity: 0, standardFontDataUrl: STANDARD_FONTS });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const vp1 = page.getViewport({ scale: 1 });
  const size = { width: vp1.width, height: vp1.height };
  const text = await page.getTextContent();
  const estimate = wordsFromText(
    text.items.filter((it) => "str" in it) as TextItemLike[],
    text.styles as Record<string, TextStyleLike>,
    vp1.transform,
    size,
    measure,
  );
  const vp = page.getViewport({ scale: SCALE });
  const { canvas, context } = (pdf as unknown as { canvasFactory: { create(w: number, h: number): { canvas: unknown; context: CanvasRenderingContext2D } } }).canvasFactory.create(
    Math.round(vp.width),
    Math.round(vp.height),
  );
  await page.render({ canvas: canvas as HTMLCanvasElement, canvasContext: context, viewport: vp, background: "#ffffff" }).promise;
  const img: PixelData = context.getImageData(0, 0, Math.round(vp.width), Math.round(vp.height));
  await task.destroy();
  return { estimate, img, size };
}

/** Ink extent of one word, measured straight from the pixels inside its true advance range. */
function inkOf(img: PixelData, line: TruthLine, x0: number, x1: number) {
  const lum = (x: number, y: number) => {
    const i = (y * img.width + x) * 4;
    return 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
  };
  const top = Math.floor((line.baseline - line.size * 1.1) * SCALE);
  const bottom = Math.ceil((line.baseline + line.size * 0.4) * SCALE);
  let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
  for (let x = Math.floor((x0 - 0.5) * SCALE); x < Math.ceil((x1 + 0.5) * SCALE); x++) {
    for (let y = top; y < bottom; y++) {
      if (lum(x, y) < 195) {
        l = Math.min(l, x);
        r = Math.max(r, x + 1);
        t = Math.min(t, y);
        b = Math.max(b, y + 1);
      }
    }
  }
  return { x0: l / SCALE, x1: r / SCALE, y0: t / SCALE, y1: b / SCALE };
}

const onLine = (words: Word[], line: TruthLine) =>
  words.filter((w) => Math.abs(w.base - line.baseline) < line.size * 0.35).sort((a, b) => a.x - b.x);

describe("text-layer estimate", () => {
  it("finds each word of the secret where pdf-lib drew it (plain text)", async () => {
    const { estimate } = await loadPage("dirty.pdf", await helveticaMeasure());
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    const at = (s: string) => 76 + font.widthOfTextAtSize(s, 18);
    const num = estimate.find((w) => w.text === "123-45-6789")!;
    expect(num.x).toBeCloseTo(at("SSN "), 0);
    expect(num.x + num.w).toBeCloseTo(at(SECRET), 0);
    expect(num.y).toBeLessThan(124 - 18 * 0.7);
    expect(num.y + num.h).toBeGreaterThan(124);
  });

  it("joins words pdf.js spells out letter by letter (P A S S P O R T)", async () => {
    const { estimate } = await loadPage("hard-words.pdf");
    const texts = estimate.map((w) => w.text);
    expect(texts).toEqual(expect.arrayContaining(["PASSPORT", "X1234567", "Condensed", "Invoice", "99812"]));
    expect(texts).not.toContain("P");
  });

  it("follows page rotation", async () => {
    const { estimate, size } = await loadPage("rotated.pdf", await helveticaMeasure());
    expect(size).toEqual({ width: 842, height: 595 });
    const ssn = estimate.find((w) => w.text === "SSN")!;
    expect(ssn.axis).toBe("v");
    expect(ssn.h).toBeGreaterThan(ssn.w);
    expect(ssn.y).toBeCloseTo(76, 0);
  });

  it("is several points off on spaced, squeezed, kerned and tight text (why snapping exists)", async () => {
    const { estimate } = await loadPage("hard-words.pdf");
    const truth = JSON.parse(readFileSync(new URL("../fixtures/hard-words.json", import.meta.url), "utf8")) as TruthLine[];
    let worst = 0;
    for (const line of truth) {
      onLine(estimate, line).forEach((w, i) => {
        const t = line.words[i]!;
        worst = Math.max(worst, Math.abs(w.x - t.x0), Math.abs(w.x + w.w - t.x1));
      });
    }
    expect(worst).toBeGreaterThan(4);
  });
});

describe("snapWordsToInk on the hard fixture", () => {
  const truth = JSON.parse(readFileSync(new URL("../fixtures/hard-words.json", import.meta.url), "utf8")) as TruthLine[];

  for (const line of truth) {
    it(`${line.label}: every box covers its word's ink and none of its neighbours'`, async () => {
      const { estimate, img, size } = await loadPage("hard-words.pdf");
      const words = onLine(snapWordsToInk(estimate, img, SCALE), line);
      expect(words.map((w) => w.text)).toEqual(line.words.map((w) => w.text));
      expect(words.every((w) => w.snapped)).toBe(true);
      const inks = line.words.map((t) => inkOf(img, line, t.x0, t.x1));
      words.forEach((w, i) => {
        const box = wordBox(w, size);
        const ink = inks[i]!;
        // Covers all of the word's ink...
        expect(box.x).toBeLessThanOrEqual(ink.x0);
        expect(box.x + box.w).toBeGreaterThanOrEqual(ink.x1);
        expect(box.y).toBeLessThanOrEqual(ink.y0);
        expect(box.y + box.h).toBeGreaterThanOrEqual(ink.y1);
        // ...and none of the next or previous word's.
        if (inks[i + 1]) expect(box.x + box.w).toBeLessThan(inks[i + 1]!.x0);
        if (inks[i - 1]) expect(box.x).toBeGreaterThan(inks[i - 1]!.x1);
      });
    });
  }

  it("also snaps the rotated page (text running down)", async () => {
    const { estimate, img } = await loadPage("rotated.pdf");
    const snapped = snapWordsToInk(estimate, img, SCALE);
    const ssn = snapped.find((w) => w.text === "SSN")!;
    const num = snapped.find((w) => w.text === "123-45-6789")!;
    expect(ssn.snapped && num.snapped).toBe(true);
    expect(ssn.y + ssn.h).toBeLessThan(num.y); // separate, in reading order down the page
  });
});

// --- Synthetic pixels ----------------------------------------------------------------------

/** White image with black rectangles (x0, x1 in px; rows fixed to the text band). */
function strip(width: number, blocks: [number, number][], extra?: (px: Uint8ClampedArray, w: number) => void): PixelData {
  const height = 40;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [x0, x1] of blocks) {
    for (let y = 12; y < 28; y++) for (let x = x0; x < x1; x++) data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
  }
  extra?.(data, width);
  return { data, width, height };
}

const word = (text: string, x: number, w: number): Word => ({
  text, x, y: 10, w, h: 20, axis: "h", reversed: false, base: 26, size: 20, snapped: false,
});

describe("snapWordsToInk (synthetic)", () => {
  it("splits at the widest gaps even when the estimate is far off", () => {
    // Two letter-spaced words: letters 6px apart, words 20px apart. Estimate puts the break wrong.
    const img = strip(200, [[10, 16], [22, 28], [34, 40], [60, 66], [72, 78], [84, 90]]);
    const out = snapWordsToInk([word("abc", 10, 70), word("def", 80, 20)], img, 1);
    expect(out.map((w) => [w.text, w.x, w.x + w.w])).toEqual([["abc", 10, 40], ["def", 60, 90]]);
    expect(out.every((w) => w.snapped)).toBe(true);
  });

  it("keeps the estimate when the gaps don't clearly separate words", () => {
    const img = strip(200, [[10, 16], [22, 28], [34, 40], [46, 52]]);
    const out = snapWordsToInk([word("ab", 10, 18), word("cd", 34, 18)], img, 1);
    expect(out.every((w) => !w.snapped)).toBe(true);
  });

  it("keeps the estimate when an underline joins the whole line", () => {
    const img = strip(200, [[10, 30], [50, 70]], (d, w) => {
      for (let x = 10; x < 70; x++) d.fill(0, (26 * w + x) * 4, (26 * w + x) * 4 + 3);
    });
    const out = snapWordsToInk([word("ab", 10, 20), word("cd", 50, 20)], img, 1);
    expect(out.every((w) => !w.snapped)).toBe(true);
  });

  it("picks up ink beyond the estimated end (drifting positions)", () => {
    const img = strip(200, [[10, 30], [40, 70]]);
    const out = snapWordsToInk([word("ab", 10, 15), word("cd", 30, 12)], img, 1);
    expect(out.map((w) => [w.x, w.x + w.w])).toEqual([[10, 30], [40, 70]]);
  });

  it("works on tinted backgrounds", () => {
    const img = strip(120, [[10, 30], [45, 70]], (d) => {
      for (let i = 0; i < d.length; i += 4) if (d[i] === 255) d.fill(230, i, i + 3);
    });
    const out = snapWordsToInk([word("ab", 10, 20), word("cd", 45, 25)], img, 1);
    expect(out.every((w) => w.snapped)).toBe(true);
  });
});

describe("selection helpers", () => {
  const page = { width: 200, height: 200 };
  const w = (text: string, x: number, y: number, width = 20, h = 10): Word => ({
    text, x, y, w: width, h, axis: "h", reversed: false, base: y + 8, size: h, snapped: true,
  });
  const words = [w("a", 10, 10), w("b", 40, 10), w("c", 70, 11), w("d", 10, 40)];

  it("wordAt hits a word and misses gaps", () => {
    expect(wordAt(words, 45, 15)?.text).toBe("b");
    expect(wordAt(words, 35, 15)).toBeUndefined();
  });

  it("wordsInRect needs a third of the word inside", () => {
    expect(wordsInRect(words, { x: 0, y: 0, w: 47, h: 30 }).map((x) => x.text)).toEqual(["a", "b"]);
    expect(wordsInRect(words, { x: 0, y: 0, w: 45, h: 30 }).map((x) => x.text)).toEqual(["a"]);
  });

  it("lineRects merges each line into one rectangle, covering the gaps", () => {
    expect(lineRects(words).map(({ x, y, w: width, h }) => ({ x, y, w: width, h }))).toEqual([
      { x: 10, y: 10, w: 80, h: 11 },
      { x: 10, y: 40, w: 20, h: 10 },
    ]);
  });

  it("wordBox pads more when the box is only an estimate", () => {
    const snapped = wordBox(w("x", 50, 50), page);
    const estimated = wordBox({ ...w("x", 50, 50), snapped: false }, page);
    expect(snapped.x).toBeLessThan(50);
    expect(estimated.x).toBeLessThan(snapped.x);
    expect(wordBox(w("x", 0, 0), page).x).toBe(0);
  });
});
