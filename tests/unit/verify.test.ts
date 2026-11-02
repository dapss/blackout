import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildSafePdf, stripPng } from "../../src/core/encode";
import type { Box } from "../../src/core/types";
import {
  inspectPdfStructure,
  inspectPng,
  isBoxBlack,
  type PixelData,
  summaryLine,
  verifyExport,
} from "../../src/core/verify";
import { makeDirtyPdf, SECRET } from "../fixtures/make";
import { makePng } from "../helpers/png";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));

async function pdfText(bytes: Uint8Array): Promise<string> {
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const pdf = await task.promise;
  let out = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const t = await (await pdf.getPage(i)).getTextContent();
    out += t.items.map((it) => ("str" in it ? it.str : "")).join(" ");
  }
  await task.destroy();
  return out;
}

function solid(w: number, h: number, v: number): PixelData {
  const data = new Uint8ClampedArray(w * h * 4).fill(v);
  return { data, width: w, height: h };
}

const box = (over: Partial<Box> = {}): Box => ({ id: "b1", page: 0, x: 10, y: 10, w: 20, h: 10, ...over });

/** What safe mode produces: an image-only PDF built from page bitmaps. */
async function safePdf(pages = 2): Promise<Uint8Array> {
  const png = makePng(60, 80, (x, y) => (x >= 10 && x < 40 && y >= 10 && y < 30 ? [0, 0, 0] : [255, 255, 255]));
  return buildSafePdf(Array.from({ length: pages }, () => ({ bytes: png, format: "png" as const, widthPt: 60, heightPt: 80 })));
}

describe("fixtures", () => {
  it("the dirty fixture really contains extractable text and everything else we strip", async () => {
    const bytes = fixture("dirty.pdf");
    expect(await pdfText(bytes)).toContain(SECRET);
    const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
    const pdf = await task.promise;
    const { info, metadata } = (await pdf.getMetadata()) as { info: Record<string, unknown>; metadata: unknown };
    expect(info.Title).toBe("Secret title");
    expect(metadata).toBeTruthy();
    expect(await pdf.getAttachments()).toBeTruthy();
    expect(await pdf.getJSActions()).toBeTruthy();
    expect((await (await pdf.getPage(1)).getAnnotations()).length).toBeGreaterThan(0);
    await task.destroy();
  });

  it("committed fixtures match the generator", async () => {
    // Regenerate with `pnpm fixtures` if this fails after changing make.ts.
    const fresh = await makeDirtyPdf();
    const doc = await PDFDocument.load(fresh);
    expect(doc.getPageCount()).toBe((await PDFDocument.load(fixture("dirty.pdf"))).getPageCount());
  });
});

describe("buildSafePdf", () => {
  it("writes no Info dictionary, metadata, fonts or text", async () => {
    const bytes = await safePdf();
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.context.trailerInfo.Info).toBeUndefined();
    expect(doc.getProducer()).toBeUndefined();
    expect(Buffer.from(bytes).toString("latin1")).not.toMatch(/Producer|CreationDate|\/Font/);
    expect(await pdfText(bytes)).toBe("");
  });
});

describe("inspectPdfStructure", () => {
  it("passes a safe-mode output", async () => {
    const findings = await inspectPdfStructure(await safePdf(2), 2);
    for (const [id, list] of Object.entries(findings)) expect(list, id).toEqual([]);
  });

  it("flags every kind of leftover in the dirty fixture", async () => {
    const f = await inspectPdfStructure(fixture("dirty.pdf"), 2);
    expect(f["no-metadata"]!.length).toBeGreaterThan(0);
    expect(f["no-annotations"]!.length).toBeGreaterThan(0);
    expect(f["no-forms"]!.length).toBeGreaterThan(0);
    expect(f["no-attachments"]!.length).toBeGreaterThan(0);
    expect(f["no-scripts"]!.length).toBeGreaterThan(0);
    expect(f["images-only"]!.length).toBeGreaterThan(0);
  });

  it("flags incremental updates (hidden old revisions)", async () => {
    const base = await safePdf(1);
    const appended = Buffer.concat([
      Buffer.from(base),
      Buffer.from("\n99 0 obj\n(old secret)\nendobj\nxref\n0 1\n0000000000 65535 f \ntrailer\n<<>>\nstartxref\n0\n%%EOF\n"),
    ]);
    const f = await inspectPdfStructure(new Uint8Array(appended), 1);
    expect(f["single-revision"]!.length).toBeGreaterThan(0);
  });

  it("flags a page-count mismatch", async () => {
    const f = await inspectPdfStructure(await safePdf(2), 3);
    expect(f["page-count"]).toEqual(["expected 3, found 2"]);
  });
});

describe("verifyExport (PDF)", () => {
  const deps = (px: PixelData) => ({ pdfjs, pdfjsOptions: { verbosity: 0 }, rasterizePdfPage: async () => px });

  it("passes a clean output whose boxes are black", async () => {
    const report = await verifyExport(
      { kind: "pdf", bytes: await safePdf(2), boxes: [box()], pageCount: 2, scales: [1, 1] },
      deps(solid(200, 200, 0)),
    );
    expect(report.checks.filter((c) => !c.ok)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.textItems).toBe(0);
    expect(summaryLine(report)).toBe("Verified: 0 of 1 redacted item recoverable");
  });

  it("fails and counts the box when the pixels under it are not black", async () => {
    const report = await verifyExport(
      { kind: "pdf", bytes: await safePdf(1), boxes: [box()], pageCount: 1, scales: [1] },
      deps(solid(200, 200, 255)),
    );
    expect(report.ok).toBe(false);
    expect(report.boxesRecoverable).toBe(1);
    expect(summaryLine(report)).toMatch(/Download blocked/);
  });

  it("fails the original (unflattened) file: text, metadata and the rest", async () => {
    const report = await verifyExport(
      { kind: "pdf", bytes: fixture("dirty.pdf"), boxes: [box(), box({ id: "b2" })], pageCount: 2, scales: [1, 1] },
      deps(solid(2000, 2000, 0)),
    );
    expect(report.ok).toBe(false);
    expect(report.textItems).toBeGreaterThan(0);
    expect(report.boxesRecoverable).toBe(2);
    const failed = report.checks.filter((c) => !c.ok).map((c) => c.id);
    expect(failed).toEqual(
      expect.arrayContaining(["no-text", "no-metadata", "no-annotations", "no-forms", "no-attachments", "no-scripts", "images-only"]),
    );
  });

  it("does not pass boxes it could not check", async () => {
    const report = await verifyExport(
      { kind: "pdf", bytes: await safePdf(1), boxes: [box()], pageCount: 1, scales: [1] },
      { pdfjs, pdfjsOptions: { verbosity: 0 } },
    );
    expect(report.ok).toBe(false);
  });
});

describe("PNG checks", () => {
  it("accepts a clean PNG", () => {
    const info = inspectPng(makePng(4, 4, () => [0, 0, 0]));
    expect(info).toMatchObject({ valid: true, width: 4, height: 4, disallowed: [] });
  });

  it("rejects EXIF, text chunks and trailing data", () => {
    const exif = makePng(4, 4, () => [0, 0, 0], [
      { type: "eXIf", data: new TextEncoder().encode("MM\0*GPS") },
      { type: "tEXt", data: new TextEncoder().encode("Author\0Jane") },
    ]);
    expect(inspectPng(exif).disallowed).toEqual(["eXIf", "tEXt"]);
    const trailing = new Uint8Array([...makePng(2, 2, () => [0, 0, 0]), 1, 2, 3]);
    expect(inspectPng(trailing).disallowed).toEqual(["3 bytes after IEND"]);
    expect(inspectPng(new Uint8Array([1, 2, 3])).valid).toBe(false);
  });

  it("stripPng removes metadata and private chunks (e.g. Firefox's deBG) and keeps the image", () => {
    const dirty = makePng(3, 3, () => [10, 20, 30], [
      { type: "eXIf", data: new TextEncoder().encode("MM\0*GPS") },
      { type: "deBG", data: new Uint8Array([1, 2, 3]) },
      { type: "tEXt", data: new TextEncoder().encode("Author\0Jane") },
    ]);
    const clean = stripPng(dirty);
    const info = inspectPng(clean);
    expect(info).toMatchObject({ valid: true, width: 3, height: 3, disallowed: [] });
    expect(info.chunks).toEqual(["IHDR", "IDAT", "IEND"]);
    // Same pixel data as a PNG that never had the extra chunks.
    expect(Buffer.from(clean).equals(Buffer.from(makePng(3, 3, () => [10, 20, 30])))).toBe(true);
  });

  it("verifyExport checks boxes at the export scale", async () => {
    const png = makePng(40, 40, () => [255, 255, 255]);
    const black = (scale: number) =>
      verifyExport(
        { kind: "image", bytes: png, boxes: [box({ x: 2, y: 2, w: 6, h: 6 })], pageCount: 1, scales: [scale] },
        {
          rasterizePng: async () => {
            // Black only where the box lands at scale 2.
            const px = solid(40, 40, 255);
            for (let y = 4; y < 16; y++) for (let x = 4; x < 16; x++) px.data.fill(0, (y * 40 + x) * 4, (y * 40 + x) * 4 + 3);
            return px;
          },
        },
      );
    expect((await black(2)).ok).toBe(true);
    expect((await black(4)).ok).toBe(false);
  });
});

describe("isBoxBlack", () => {
  it("tolerates anti-aliased edges but not content inside", () => {
    const px = solid(20, 20, 0);
    // Grey edge pixels at the border of the box are ignored by the 1px inset.
    for (let x = 0; x < 20; x++) px.data.fill(200, (5 * 20 + x) * 4, (5 * 20 + x) * 4 + 3);
    expect(isBoxBlack(px, { x: 5, y: 5, w: 10, h: 10 }, 1)).toBe(true);
    px.data.fill(255, (10 * 20 + 10) * 4, (10 * 20 + 10) * 4 + 3);
    expect(isBoxBlack(px, { x: 5, y: 5, w: 10, h: 10 }, 1)).toBe(false);
  });
});
