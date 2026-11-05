// Builds the PDF fixtures used by the unit and end-to-end tests.
// Run with `pnpm fixtures`; the outputs are committed so tests don't depend on this script.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  beginText,
  degrees,
  endText,
  moveText,
  type PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  PDFString,
  rgb,
  setCharacterSpacing,
  setCharacterSqueeze,
  setFontAndSize,
  setWordSpacing,
  StandardFonts,
} from "pdf-lib";

export const SECRET = "SSN 123-45-6789";
export const OTHER_TEXT = "Quarterly report";

/** Where the secret is drawn on page 1, in top-left page units (A4 portrait, 595 x 842). */
export const SECRET_RECT = { x: 72, y: 100, w: 220, h: 30 };

/**
 * A text PDF carrying everything safe mode must strip: metadata, XMP, a link annotation,
 * a filled form field, an attachment and document JavaScript.
 */
export async function makeDirtyPdf(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Secret title");
  doc.setAuthor("Jane Secret");
  doc.setSubject("Payroll");
  doc.setKeywords(["confidential"]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    const h = page.getHeight();
    page.drawText(`${OTHER_TEXT} page ${i + 1}`, { x: 72, y: h - 60, size: 14, font });
    if (i === 0) {
      // Baseline sits inside SECRET_RECT (top-left 100..130 => bottom-left 712..742).
      page.drawText(SECRET, { x: 76, y: h - 124, size: 18, font, color: rgb(0, 0, 0) });
    }
  }
  const first = doc.getPage(0);
  const form = doc.getForm();
  const field = form.createTextField("employee.name");
  field.setText("Jane Secret");
  field.addToPage(first, { x: 72, y: 500, width: 200, height: 24, font });

  const link = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [72, 400, 272, 420],
    Border: [0, 0, 0],
    A: { Type: "Action", S: "URI", URI: PDFString.of("https://example.com/secret") },
  });
  const annots = first.node.Annots();
  annots?.push(doc.context.register(link));

  await doc.attach(new TextEncoder().encode("secret attachment"), "secret.txt", { mimeType: "text/plain" });
  doc.addJavaScript("hello", 'app.alert("hi");');
  const xmp = doc.context.stream('<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/">secret</x:xmpmeta>', {
    Type: "Metadata",
    Subtype: "XML",
  });
  doc.catalog.set(PDFName.of("Metadata"), doc.context.register(xmp));
  return doc.save();
}

/** A plain multi-page text PDF (for the performance test). */
export async function makeLongPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([612, 792]);
    for (let line = 0; line < 40; line++) {
      page.drawText(`Page ${i + 1}, line ${line + 1}: account 4111 1111 1111 ${String(1000 + line)}`, {
        x: 50,
        y: 740 - line * 17,
        size: 11,
        font,
      });
    }
  }
  return doc.save();
}

/** A PDF whose page has /Rotate 90, to check that output geometry follows what is displayed. */
export async function makeRotatedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText(SECRET, { x: 76, y: 700, size: 18, font });
  page.setRotation(degrees(90));
  return doc.save();
}

/** Where each word of a line really is: advance-box extents in top-left page units. */
export interface TruthLine {
  label: string;
  baseline: number;
  size: number;
  words: { text: string; x0: number; x1: number }[];
}

type Piece = string | number; // text, or a TJ adjustment in thousandths of an em

/**
 * Text the word estimate gets wrong: word spacing (justified text), wide and negative letter
 * spacing, horizontal squeeze, and TJ kerning jumps. pdf.js reports one width per run, so a
 * proportional split drifts on all of these. Returns the PDF and where every word really is.
 */
export async function makeHardWordsPdf(): Promise<{ pdf: Uint8Array; truth: TruthLine[] }> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const H = page.getHeight();
  const lines: {
    label: string;
    font: StandardFonts;
    size: number;
    y: number;
    tc?: number;
    tw?: number;
    tz?: number;
    pieces: Piece[];
  }[] = [
    { label: "justified", font: StandardFonts.Helvetica, size: 12, y: 700, tw: 9, pieces: ["Name Jane Doe account 4111 1111 1111 1234"] },
    { label: "letter-spaced", font: StandardFonts.Helvetica, size: 14, y: 650, tc: 2.5, pieces: ["PASSPORT X1234567 ISSUED 2031"] },
    { label: "squeezed", font: StandardFonts.TimesRoman, size: 16, y: 600, tz: 70, pieces: ["Condensed secret phrase here"] },
    { label: "kerned", font: StandardFonts.Courier, size: 12, y: 550, pieces: ["Invoice ", -1800, "No. ", -600, "99812 ", -900, "PAID"] },
    { label: "tight", font: StandardFonts.HelveticaBold, size: 11, y: 500, tc: -0.4, pieces: ["Tight letters SSN 078-05-1120 here"] },
  ];
  const truth: TruthLine[] = [];
  for (const line of lines) {
    const font = await doc.embedFont(line.font);
    const key = page.node.newFontDictionary(font.name, font.ref);
    const tc = line.tc ?? 0;
    const tw = line.tw ?? 0;
    const th = (line.tz ?? 100) / 100;
    const x = 50;
    // Tc, Tw and Tz persist across BT/ET, so set all three on every line.
    const ops = [
      beginText(),
      setFontAndSize(key, line.size),
      moveText(x, line.y),
      setCharacterSpacing(tc),
      setWordSpacing(tw),
      setCharacterSqueeze(line.tz ?? 100),
    ];
    const arr = doc.context.obj(
      line.pieces.map((p) => (typeof p === "string" ? font.encodeText(p) : PDFNumber.of(p))),
    ) as PDFArray;
    ops.push(PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [arr]), endText());
    page.pushOperators(...ops);

    // Walk the glyphs the same way a PDF renderer does to find each word's extent.
    const words: TruthLine["words"] = [];
    let pos = x;
    let current: { text: string; x0: number; x1: number } | null = null;
    for (const p of line.pieces) {
      if (typeof p === "number") {
        pos -= (p / 1000) * line.size * th;
        continue;
      }
      for (const ch of p) {
        const w = font.widthOfTextAtSize(ch, line.size);
        if (ch === " ") {
          if (current) words.push(current);
          current = null;
        } else {
          current ??= { text: "", x0: pos, x1: pos };
          current.text += ch;
          current.x1 = pos + w * th;
        }
        pos += (w + tc + (ch === " " ? tw : 0)) * th;
      }
    }
    if (current) words.push(current);
    truth.push({ label: line.label, baseline: H - line.y, size: line.size, words });
  }
  return { pdf: await doc.save(), truth };
}

/** Made-up values for detection tests, with look-alikes that must not be flagged. */
export async function makeDetectPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = (lines: string[]) => {
    const p = doc.addPage([595, 842]);
    lines.forEach((line, i) => p.drawText(line, { x: 72, y: 760 - i * 40, size: 14, font }));
  };
  page([
    "Contact: jane.doe@example.com",
    "Phone: +62 812-3456-7890",
    "Card: 4111 1111 1111 1111",
    "NIK: 3201014512900001",
    "Reference: 1234567890123456",
    "Order date: 2024-01-15",
  ]);
  page(["IBAN: DE89 3704 0044 0532 0130 00", "NPWP: 01.234.567.8-901.234"]);
  page([]); // no text, like a scan
  return doc.save();
}

const here = dirname(fileURLToPath(import.meta.url));

export async function writeFixtures(dir = here): Promise<void> {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "dirty.pdf"), await makeDirtyPdf());
  writeFileSync(join(dir, "long-20.pdf"), await makeLongPdf(20));
  writeFileSync(join(dir, "rotated.pdf"), await makeRotatedPdf());
  writeFileSync(join(dir, "detect.pdf"), await makeDetectPdf());
  const hard = await makeHardWordsPdf();
  writeFileSync(join(dir, "hard-words.pdf"), hard.pdf);
  const round = (_k: string, v: unknown) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v);
  writeFileSync(join(dir, "hard-words.json"), JSON.stringify(hard.truth, round, 2) + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await writeFixtures();
  console.log("fixtures written to", here);
}
