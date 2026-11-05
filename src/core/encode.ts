import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import type { AnyCanvas } from "./render";
import type { DocKind } from "./types";

export const JPEG_QUALITY = 0.92;

export type ImageFormat = "jpg" | "png";

export interface EncodedPage {
  bytes: Uint8Array;
  format: ImageFormat;
  widthPt: number;
  heightPt: number;
}

export type WorkerRequest =
  | ({ type: "page"; bitmap: ImageBitmap } & Omit<EncodedPage, "bytes">)
  | { type: "finish"; kind: DocKind }
  | { type: "inspect"; id: number; bytes: Uint8Array; pages: number };

export type WorkerReply =
  | { type: "ack" }
  | { type: "done"; bytes: Uint8Array }
  | { type: "error"; message: string }
  | { type: "inspected"; id: number; findings: Record<string, string[]> };

/**
 * Build a brand-new PDF with one full-page image per page. Nothing from the original file is
 * copied: no text, fonts, metadata, annotations, forms, attachments, scripts or old revisions.
 */
export async function buildSafePdf(pages: EncodedPage[]): Promise<Uint8Array> {
  // updateMetadata: false stops pdf-lib from writing an Info dictionary (Producer, dates...).
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (const p of pages) {
    const image = p.format === "jpg" ? await doc.embedJpg(p.bytes) : await doc.embedPng(p.bytes);
    const page = doc.addPage([p.widthPt, p.heightPt]);
    page.drawImage(image, { x: 0, y: 0, width: p.widthPt, height: p.heightPt });
    // pdf-lib adds empty /Annots, /Font and /ExtGState entries; drop them so the page holds an image and nothing else.
    page.node.delete(PDFName.of("Annots"));
    const resources = page.node.Resources();
    for (const key of ["Font", "ExtGState"]) {
      const entry = resources?.get(PDFName.of(key));
      if (entry instanceof PDFDict && entry.keys().length === 0) resources!.delete(PDFName.of(key));
    }
  }
  return doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}

/** PNG chunks needed to display the image. Everything else (eXIf, text, Firefox's deBG...) is dropped. */
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "sBIT", "pHYs"]);

/** Rebuild a PNG keeping only the chunks in PNG_KEEP. Chunk CRCs cover type+data, so they stay valid. */
export function stripPng(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let off = 8;
  while (off + 12 <= bytes.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(...bytes.subarray(off + 4, off + 8));
    const end = off + 12 + len;
    if (PNG_KEEP.has(type)) parts.push(bytes.subarray(off, end));
    off = end;
    if (type === "IEND") break;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export async function encodeCanvas(canvas: AnyCanvas, format: ImageFormat): Promise<Uint8Array> {
  const type = format === "jpg" ? "image/jpeg" : "image/png";
  const quality = format === "jpg" ? JPEG_QUALITY : undefined;
  const blob =
    "convertToBlob" in canvas
      ? await canvas.convertToBlob({ type, quality })
      : await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Encoding failed."))), type, quality),
        );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return format === "png" ? stripPng(bytes) : bytes;
}
