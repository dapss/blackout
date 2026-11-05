import { openPdf, pdfjs } from "./pdfjs";
import { type Any2D, canvasSize, createCanvas, fitScale, get2d, releaseCanvas } from "./render";
import { sniffKind } from "./sniff";
import type { DocKind, PageSize } from "./types";
import {
  type Measure,
  snapWordsToInk,
  type TextItemLike,
  type TextStyleLike,
  type Word,
  wordsFromText,
} from "./words";

const WORD_SNAP_SCALE = 3;

export const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp";

export interface LoadedDoc {
  kind: DocKind;
  name: string;
  pages: PageSize[];
  draw(index: number, ctx: Any2D, scale: number, signal?: AbortSignal): Promise<void>;
  /** Empty for images and scanned pages. */
  words(index: number): Promise<Word[]>;
  destroy(): void;
}

export class LoadError extends Error {}

export async function loadDocument(file: File): Promise<LoadedDoc> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffKind(bytes.subarray(0, 1100));
  if (!kind) throw new LoadError("Unsupported file. Choose a PDF, PNG, JPEG or WebP.");
  return kind === "pdf" ? loadPdf(file.name, bytes) : loadImage(file.name, file);
}

async function loadPdf(name: string, bytes: Uint8Array): Promise<LoadedDoc> {
  const task = openPdf(bytes);
  let pdf: Awaited<typeof task.promise>;
  try {
    pdf = await task.promise;
  } catch (err) {
    if (err instanceof Error && err.name === "PasswordException") {
      throw new LoadError("This PDF is password-protected. Remove the password first, then open it here.");
    }
    throw new LoadError("This PDF could not be read. It may be damaged.");
  }
  const pages: PageSize[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    pages.push({ width: vp.width, height: vp.height });
  }
  const drawPage: LoadedDoc["draw"] = async (index, ctx, scale, signal) => {
    const page = await pdf.getPage(index + 1);
    const viewport = page.getViewport({ scale });
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
    const task = page.render({
      canvas: ctx.canvas as HTMLCanvasElement,
      canvasContext: ctx as CanvasRenderingContext2D,
      viewport,
      // Draw annotation appearances (filled form fields, stamps) into the bitmap so what you
      // see while editing is exactly what gets flattened.
      annotationMode: pdfjs.AnnotationMode.ENABLE,
    });
    const onAbort = () => task.cancel();
    signal?.addEventListener("abort", onAbort);
    try {
      await task.promise;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      page.cleanup();
    }
  };
  const wordCache = new Map<number, Promise<Word[]>>();
  const extractWords = async (index: number): Promise<Word[]> => {
    const page = await pdf.getPage(index + 1);
    const text = await page.getTextContent();
    const items = text.items.filter((it) => "str" in it) as TextItemLike[];
    const size = pages[index]!;
    const estimate = wordsFromText(
      items,
      text.styles as Record<string, TextStyleLike>,
      page.getViewport({ scale: 1 }).transform,
      size,
      canvasMeasure(),
    );
    if (!estimate.length) return estimate;
    const scale = fitScale(size, WORD_SNAP_SCALE);
    const { w, h } = canvasSize(size, scale);
    const canvas = createCanvas(w, h);
    try {
      const ctx = get2d(canvas);
      await drawPage(index, ctx, scale);
      return snapWordsToInk(estimate, ctx.getImageData(0, 0, w, h), scale);
    } catch {
      return estimate;
    } finally {
      releaseCanvas(canvas);
    }
  };
  return {
    kind: "pdf",
    name,
    pages,
    draw: drawPage,
    words(index) {
      let words = wordCache.get(index);
      if (!words) {
        words = extractWords(index).catch(() => []);
        wordCache.set(index, words);
      }
      return words;
    },
    destroy() {
      void task.destroy();
    },
  };
}

async function loadImage(name: string, file: Blob): Promise<LoadedDoc> {
  let bitmap: ImageBitmap;
  try {
    // Applies EXIF orientation, so the page looks the way the photo is meant to be viewed.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new LoadError("This image could not be decoded.");
  }
  return {
    kind: "image",
    name,
    pages: [{ width: bitmap.width, height: bitmap.height }],
    words: async () => [],
    async draw(_index, ctx, scale) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, bitmap.width * scale, bitmap.height * scale);
    },
    destroy() {
      bitmap.close();
    },
  };
}

function canvasMeasure(): Measure {
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  try {
    ctx =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(1, 1).getContext("2d")
        : document.createElement("canvas").getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx) return (text) => text.length;
  const c = ctx;
  return (text, family) => {
    const font = `100px ${family}`;
    if (c.font !== font) c.font = font;
    return c.measureText(text).width;
  };
}
