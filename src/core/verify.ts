// Re-open an export and prove the redaction held.
// Everything that needs a browser (rasterizing) is injected, so the checks also run under Node.
import { PDFDict, PDFDocument, PDFName, PDFStream } from "pdf-lib";
import type * as PdfjsNs from "pdfjs-dist/legacy/build/pdf.mjs";
import { innerPixelRect } from "./geometry";
import type { Box, DocKind, Rect } from "./types";

type PdfjsLib = typeof PdfjsNs;
type PdfPage = Awaited<ReturnType<Awaited<ReturnType<PdfjsLib["getDocument"]>["promise"]>["getPage"]>>;

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface VerifyReport {
  ok: boolean;
  checks: Check[];
  boxesTotal: number;
  /** Boxes whose content could still be read from the output. */
  boxesRecoverable: number;
  textItems: number;
}

export interface PixelData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Render a page of the output PDF to pixels at `scale` (browser: canvas; tests: anything). */
export type PdfRasterizer = (page: PdfPage, scale: number) => Promise<PixelData>;
export type PngRasterizer = (bytes: Uint8Array) => Promise<PixelData>;

/** Scale the output is re-rendered at for the pixel check (144 DPI). */
export const VERIFY_SCALE = 2;
/** A pixel inside a box counts as black up to this luminance (0-255); leaves room for JPEG noise. */
export const MAX_BOX_LUMINANCE = 96;

// --- PDF structure (pdf-lib) ---------------------------------------------------------------

const FORBIDDEN: Record<string, { keys: string[]; types: string[] }> = {
  "no-metadata": { keys: ["Metadata", "PieceInfo", "Info"], types: ["Metadata"] },
  "no-annotations": { keys: ["Annots"], types: ["Annot"] },
  "no-forms": { keys: ["AcroForm", "XFA", "NeedsRendering"], types: [] },
  "no-attachments": { keys: ["EmbeddedFiles", "EmbeddedFile", "Collection", "Names"], types: ["EmbeddedFile", "Filespec"] },
  "no-scripts": { keys: ["JavaScript", "JS", "OpenAction", "AA", "URI", "Launch"], types: ["Action"] },
  "images-only": { keys: ["Font", "Shading", "Pattern", "Properties"], types: ["Font", "FontDescriptor", "OCG"] },
};

const CATALOG_KEYS = new Set(["Type", "Pages"]);
const PAGE_KEYS = new Set(["Type", "Parent", "MediaBox", "Resources", "Contents"]);

function dictOf(obj: unknown): PDFDict | null {
  if (obj instanceof PDFDict) return obj;
  if (obj instanceof PDFStream) return obj.dict;
  return null;
}

function nameOf(dict: PDFDict, key: string): string | undefined {
  const v = dict.get(PDFName.of(key));
  return v instanceof PDFName ? v.decodeText() : undefined;
}

/** Count an ASCII needle in raw bytes, using the engine's native string search. */
function countOccurrences(bytes: Uint8Array, needle: string): number {
  // latin1 maps every byte to one character, so offsets and ASCII matches are preserved.
  const text = new TextDecoder("latin1").decode(bytes);
  let count = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) count++;
  return count;
}

/** Structural findings keyed by check id; an empty list means the check passed. */
export async function inspectPdfStructure(bytes: Uint8Array, expectedPages: number): Promise<Record<string, string[]>> {
  const findings: Record<string, string[]> = {
    "single-revision": [],
    "page-count": [],
    ...Object.fromEntries(Object.keys(FORBIDDEN).map((k) => [k, [] as string[]])),
  };

  // Incremental updates append a new xref section; old revisions can hide redacted content.
  const xrefs = countOccurrences(bytes, "startxref");
  if (xrefs !== 1) findings["single-revision"]!.push(`${xrefs} revisions`);

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    findings["single-revision"]!.push(`unreadable: ${err instanceof Error ? err.message : String(err)}`);
    return findings;
  }

  if (doc.getPageCount() !== expectedPages) {
    findings["page-count"]!.push(`expected ${expectedPages}, found ${doc.getPageCount()}`);
  }
  if (doc.context.trailerInfo.Info) findings["no-metadata"]!.push("document Info dictionary");
  if (doc.context.trailerInfo.Encrypt) findings["no-scripts"]!.push("file is encrypted");

  for (const key of doc.catalog.keys()) {
    const k = key.decodeText();
    if (CATALOG_KEYS.has(k)) continue;
    const group = Object.entries(FORBIDDEN).find(([, f]) => f.keys.includes(k))?.[0] ?? "no-scripts";
    findings[group]!.push(`catalog /${k}`);
  }
  for (const page of doc.getPages()) {
    for (const key of page.node.keys()) {
      const k = key.decodeText();
      if (PAGE_KEYS.has(k)) continue;
      const group = Object.entries(FORBIDDEN).find(([, f]) => f.keys.includes(k))?.[0] ?? "no-scripts";
      findings[group]!.push(`page /${k}`);
    }
  }

  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = dictOf(obj);
    if (!dict) continue;
    const where = `object ${ref.objectNumber}`;
    const type = nameOf(dict, "Type");
    const subtype = nameOf(dict, "Subtype");
    for (const [group, rule] of Object.entries(FORBIDDEN)) {
      for (const key of dict.keys()) {
        if (rule.keys.includes(key.decodeText())) findings[group]!.push(`${where} /${key.decodeText()}`);
      }
      if (type && rule.types.includes(type)) findings[group]!.push(`${where} /Type /${type}`);
    }
    // Only raster images are allowed as XObjects; a Form XObject could carry text or vectors.
    if ((type === "XObject" || obj instanceof PDFStream) && subtype && subtype !== "Image") {
      findings["images-only"]!.push(`${where} /Subtype /${subtype}`);
    }
    if (nameOf(dict, "S") === "JavaScript") findings["no-scripts"]!.push(`${where} JavaScript action`);
  }

  for (const list of Object.values(findings)) list.splice(0, list.length, ...new Set(list));
  return findings;
}

// --- Pixels --------------------------------------------------------------------------------

export function luminanceAt(px: PixelData, x: number, y: number): number {
  const i = (y * px.width + x) * 4;
  return 0.299 * px.data[i]! + 0.587 * px.data[i + 1]! + 0.114 * px.data[i + 2]!;
}

/** True when every pixel inside the box (minus a 1px anti-aliasing margin) is black. */
export function isBoxBlack(px: PixelData, box: Rect, scale: number): boolean {
  const r = innerPixelRect(box, scale, 1, px.width, px.height);
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) if (luminanceAt(px, x, y) > MAX_BOX_LUMINANCE) return false;
  }
  return true;
}

// --- PNG -----------------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Chunks a re-encoded canvas image may contain. eXIf, tEXt, zTXt, iTXt and tIME are rejected. */
const PNG_ALLOWED = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "sBIT", "pHYs", "bKGD"]);

export interface PngInfo {
  valid: boolean;
  width: number;
  height: number;
  chunks: string[];
  disallowed: string[];
}

export function inspectPng(bytes: Uint8Array): PngInfo {
  const info: PngInfo = { valid: false, width: 0, height: 0, chunks: [], disallowed: [] };
  if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return info;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8;
  while (off + 8 <= bytes.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(...bytes.subarray(off + 4, off + 8));
    info.chunks.push(type);
    if (!PNG_ALLOWED.has(type)) info.disallowed.push(type);
    if (type === "IHDR") {
      info.width = view.getUint32(off + 8);
      info.height = view.getUint32(off + 12);
    }
    off += 12 + len;
    if (type === "IEND") break;
  }
  info.valid = info.chunks[0] === "IHDR" && info.chunks.at(-1) === "IEND";
  // Anything after IEND is a smuggling spot too.
  if (off < bytes.length) info.disallowed.push(`${bytes.length - off} bytes after IEND`);
  return info;
}

// --- Orchestration -------------------------------------------------------------------------

export interface VerifyInput {
  kind: DocKind;
  bytes: Uint8Array;
  boxes: Box[];
  pageCount: number;
  /** Pixels per page unit used at export (only needed for images). */
  scales: number[];
}

export interface VerifyDeps {
  pdfjs?: PdfjsLib;
  /** Run the structural check elsewhere (the browser uses the export worker to keep the UI free). */
  inspectStructure?: typeof inspectPdfStructure;
  /** Extra pdf.js getDocument options (offline settings in the browser). */
  pdfjsOptions?: Record<string, unknown>;
  rasterizePdfPage?: PdfRasterizer;
  rasterizePng?: PngRasterizer;
}

const LABELS: Record<string, string> = {
  "no-text": "No text left in the file",
  "boxes-black": "Every redaction box is solid black",
  "no-metadata": "No metadata (document info, XMP)",
  "no-annotations": "No annotations or links",
  "no-forms": "No form fields",
  "no-attachments": "No attachments",
  "no-scripts": "No JavaScript, actions or encryption",
  "images-only": "Pages are images only (no fonts or vector content)",
  "single-revision": "One clean revision (no hidden history)",
  "page-count": "Page count matches the original",
  "png-valid": "Valid PNG",
  "no-exif": "No EXIF, text or other metadata chunks",
  "image-size": "Image size matches the export",
};

function check(id: string, problems: string[], okDetail?: string): Check {
  const ok = problems.length === 0;
  return { id, label: LABELS[id] ?? id, ok, detail: ok ? okDetail : problems.slice(0, 5).join("; ") };
}

export async function verifyExport(input: VerifyInput, deps: VerifyDeps): Promise<VerifyReport> {
  return input.kind === "pdf" ? verifyPdf(input, deps) : verifyPng(input, deps);
}

async function verifyPdf(input: VerifyInput, deps: VerifyDeps): Promise<VerifyReport> {
  if (!deps.pdfjs) throw new Error("verifyPdf needs pdf.js");
  const findings = await (deps.inspectStructure ?? inspectPdfStructure)(input.bytes, input.pageCount);

  const task = deps.pdfjs.getDocument({ data: input.bytes.slice(), ...deps.pdfjsOptions });
  let textItems = 0;
  const recoverable = new Set<string>();
  const pixelChecked = !!deps.rasterizePdfPage;
  try {
    const pdf = await task.promise;
    const { info, metadata } = (await pdf.getMetadata()) as {
      info: Record<string, unknown>;
      metadata: unknown;
    };
    if (metadata) findings["no-metadata"]!.push("XMP metadata");
    for (const key of ["Title", "Author", "Subject", "Keywords", "Creator", "Producer", "CreationDate", "ModDate"]) {
      if (info[key]) findings["no-metadata"]!.push(`Info /${key}`);
    }
    if (info.IsAcroFormPresent) findings["no-forms"]!.push("AcroForm present");
    if (info.IsXFAPresent) findings["no-forms"]!.push("XFA present");
    if (await pdf.getAttachments()) findings["no-attachments"]!.push("attachments present");
    if (await pdf.getJSActions()) findings["no-scripts"]!.push("JavaScript actions present");

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const text = await page.getTextContent();
      textItems += text.items.filter((it) => "str" in it && it.str.length > 0).length;
      const annots = await page.getAnnotations();
      if (annots.length) findings["no-annotations"]!.push(`${annots.length} on page ${i}`);
      if (deps.rasterizePdfPage) {
        const pageBoxes = input.boxes.filter((b) => b.page === i - 1);
        if (pageBoxes.length) {
          const px = await deps.rasterizePdfPage(page, VERIFY_SCALE);
          for (const b of pageBoxes) if (!isBoxBlack(px, b, VERIFY_SCALE)) recoverable.add(b.id);
        }
      }
      page.cleanup();
    }
  } catch (err) {
    findings["single-revision"]!.push(`pdf.js could not open the output: ${err instanceof Error ? err.message : err}`);
    for (const b of input.boxes) recoverable.add(b.id);
  } finally {
    await task.destroy();
  }

  // Any surviving text means the flattening failed, so treat every box as recoverable.
  if (textItems > 0) for (const b of input.boxes) recoverable.add(b.id);

  const checks: Check[] = [
    check("no-text", textItems ? [`${textItems} text items found`] : [], `0 text items on ${input.pageCount} page(s)`),
    check(
      "boxes-black",
      recoverable.size ? [`${recoverable.size} of ${input.boxes.length} boxes are not solid black`] : [],
      pixelChecked ? `${input.boxes.length} of ${input.boxes.length} boxes checked` : "not checked",
    ),
    ...Object.keys(findings).map((id) => check(id, findings[id]!, id === "page-count" ? `${input.pageCount}` : undefined)),
  ];
  return summarize(checks, input.boxes.length, recoverable.size, textItems, pixelChecked);
}

async function verifyPng(input: VerifyInput, deps: VerifyDeps): Promise<VerifyReport> {
  const png = inspectPng(input.bytes);
  const recoverable = new Set<string>();
  const sizeProblems: string[] = [];
  const pixelChecked = !!deps.rasterizePng && png.valid;
  if (pixelChecked) {
    const px = await deps.rasterizePng!(input.bytes);
    if (px.width !== png.width || px.height !== png.height) sizeProblems.push("decoded size differs from header");
    const scale = input.scales[0] ?? 1;
    for (const b of input.boxes) if (!isBoxBlack(px, b, scale)) recoverable.add(b.id);
  } else if (!png.valid) {
    for (const b of input.boxes) recoverable.add(b.id);
  }
  const checks: Check[] = [
    check("png-valid", png.valid ? [] : ["not a well-formed PNG"]),
    check("no-exif", png.disallowed, `chunks: ${[...new Set(png.chunks)].join(", ")}`),
    check(
      "boxes-black",
      recoverable.size ? [`${recoverable.size} of ${input.boxes.length} boxes are not solid black`] : [],
      pixelChecked ? `${input.boxes.length} of ${input.boxes.length} boxes checked` : "not checked",
    ),
    check("image-size", sizeProblems, png.valid ? `${png.width} × ${png.height}` : undefined),
  ];
  return summarize(checks, input.boxes.length, recoverable.size, 0, pixelChecked);
}

function summarize(
  checks: Check[],
  boxesTotal: number,
  boxesRecoverable: number,
  textItems: number,
  pixelChecked: boolean,
): VerifyReport {
  // Without a pixel check the boxes are unproven, so only pass when there are none to prove.
  const pixelsOk = pixelChecked || boxesTotal === 0;
  return { ok: pixelsOk && checks.every((c) => c.ok), checks, boxesTotal, boxesRecoverable, textItems };
}

export function summaryLine(r: VerifyReport): string {
  const n = r.boxesTotal;
  return r.ok
    ? `Verified: 0 of ${n} redacted item${n === 1 ? "" : "s"} recoverable`
    : `Check failed: ${r.checks.filter((c) => !c.ok).length} problem(s) found. Download blocked.`;
}
