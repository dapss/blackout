import { OFFLINE_DOC_OPTIONS, pdfjs, startPdfWorker } from "./pdfjs";
import type { ExportResult } from "./redact-safe";
import { canvasSize, createCanvas, get2d, releaseCanvas } from "./render";
import type { Box } from "./types";
import { type PdfRasterizer, type PngRasterizer, type VerifyReport, verifyExport } from "./verify";

const rasterizePdfPage: PdfRasterizer = async (page, scale) => {
  const viewport = page.getViewport({ scale });
  const { w, h } = canvasSize({ width: viewport.width / scale, height: viewport.height / scale }, scale);
  const canvas = createCanvas(w, h);
  const ctx = get2d(canvas);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  await page.render({
    canvas: canvas as HTMLCanvasElement,
    canvasContext: ctx as CanvasRenderingContext2D,
    viewport,
  }).promise;
  const px = ctx.getImageData(0, 0, w, h);
  releaseCanvas(canvas);
  return px;
};

const rasterizePng: PngRasterizer = async (bytes) => {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }), {
    imageOrientation: "none",
  });
  const canvas = createCanvas(bitmap.width, bitmap.height);
  const ctx = get2d(canvas);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
  releaseCanvas(canvas);
  return px;
};

/** Re-open an export in this browser and run every check in `verify.ts`. */
export function verifyInBrowser(result: ExportResult, boxes: Box[]): Promise<VerifyReport> {
  startPdfWorker();
  return verifyExport(
    { kind: result.kind, bytes: result.bytes, boxes, pageCount: result.pageCount, scales: result.scales },
    { pdfjs, pdfjsOptions: OFFLINE_DOC_OPTIONS, rasterizePdfPage, rasterizePng },
  );
}
