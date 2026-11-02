import { buildSafePdf, type EncodedPage, encodeCanvas, type WorkerReply, type WorkerRequest } from "./encode";
import { toPixelRect } from "./geometry";
import type { LoadedDoc } from "./load";
import { type Any2D, type AnyCanvas, canvasSize, createCanvas, fitScale, get2d, releaseCanvas } from "./render";
import type { Box, DocKind, Rect } from "./types";

export const DEFAULT_DPI = 200;
/** Extra pixels painted around every box, so anti-aliased glyph edges can't peek out. */
export const BOX_PAD_PX = 1;

export interface ExportResult {
  kind: DocKind;
  bytes: Uint8Array;
  mime: string;
  fileName: string;
  /** Pixels per page unit used for each page; the verifier uses it to find the boxes again. */
  scales: number[];
  pageCount: number;
}

export interface ExportProgress {
  page: number;
  total: number;
}

export interface ExportOptions {
  dpi?: number;
  onProgress?: (p: ExportProgress) => void;
  signal?: AbortSignal;
  /** Force the main-thread encoder (browsers without OffscreenCanvas in workers). */
  inline?: boolean;
}

/** Paint the boxes as fully opaque black, whatever state the context is in. */
export function burnBoxes(ctx: Any2D, boxesPx: Rect[]): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.fillStyle = "#000000";
  for (const r of boxesPx) ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.restore();
}

export function redactedFileName(name: string, kind: DocKind): string {
  const base = name.replace(/\.[^./\\]+$/, "") || "document";
  return `${base}.redacted.${kind === "pdf" ? "pdf" : "png"}`;
}

/** Where rendered, already-redacted pages go to be encoded and assembled. */
interface PageSink {
  add(canvas: AnyCanvas, page: Omit<EncodedPage, "bytes">): Promise<void>;
  finish(kind: DocKind): Promise<Uint8Array>;
  dispose(): void;
}

class InlineSink implements PageSink {
  private pages: EncodedPage[] = [];
  async add(canvas: AnyCanvas, page: Omit<EncodedPage, "bytes">) {
    this.pages.push({ ...page, bytes: await encodeCanvas(canvas, page.format) });
    releaseCanvas(canvas);
  }
  async finish(kind: DocKind) {
    if (kind === "image") return this.pages[0]!.bytes;
    return buildSafePdf(this.pages);
  }
  dispose() {
    this.pages = [];
  }
}

let sharedWorker: Worker | null = null;

/**
 * Start the export worker ahead of time. Called at startup so its script is fetched during the
 * initial page load and exporting makes no network requests.
 */
export function warmExportWorker(): void {
  if (sharedWorker || !workerExportSupported()) return;
  sharedWorker = new Worker(new URL("../workers/export.worker.ts", import.meta.url), {
    type: "module",
    name: "blackout-export",
  });
}

let owner: WorkerSink | null = null;

/** Encodes and assembles in a Web Worker, so JPEG/PNG encoding never blocks the UI. */
class WorkerSink implements PageSink {
  private worker: Worker;
  private pending: { resolve: (v: unknown) => void; reject: (e: Error) => void } | null = null;
  private clean = false;

  constructor() {
    // Only one export at a time: a newer one takes over and the older one fails fast.
    owner?.abandon();
    warmExportWorker();
    owner = this;
    this.worker = sharedWorker!;
    this.worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const p = this.pending;
      this.pending = null;
      if (!p) return;
      if (e.data.type === "error") p.reject(new Error(e.data.message));
      else p.resolve(e.data.type === "done" ? e.data.bytes : undefined);
    };
    this.worker.onerror = (e) => {
      this.pending?.reject(new Error(e.message || "Export worker failed."));
      this.pending = null;
    };
  }

  private call(msg: WorkerRequest, transfer: Transferable[] = []): Promise<unknown> {
    if (owner !== this) return Promise.reject(new Error("Export cancelled."));
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.worker.postMessage(msg, transfer);
    });
  }

  async add(canvas: AnyCanvas, page: Omit<EncodedPage, "bytes">) {
    const bitmap =
      "transferToImageBitmap" in canvas ? canvas.transferToImageBitmap() : await createImageBitmap(canvas);
    releaseCanvas(canvas);
    await this.call({ type: "page", bitmap, ...page }, [bitmap]);
  }

  async finish(kind: DocKind) {
    const bytes = (await this.call({ type: "finish", kind })) as Uint8Array;
    this.clean = true;
    return bytes;
  }

  private abandon() {
    this.pending?.reject(new Error("Export cancelled."));
    this.pending = null;
    this.dispose();
  }

  dispose() {
    if (owner !== this) return;
    owner = null;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    // A cancelled or failed export may leave pages behind in the worker; start fresh next time.
    if (!this.clean) {
      this.worker.terminate();
      if (sharedWorker === this.worker) sharedWorker = null;
    }
  }
}

export function workerExportSupported(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof OffscreenCanvas.prototype.convertToBlob === "function"
  );
}

const nextTask = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Safe-mode export: render each page to pixels, burn the boxes in, and rebuild a new file.
 * Pages are handled one at a time and each canvas is released before the next, so memory stays
 * flat for long documents.
 */
export async function exportSafe(doc: LoadedDoc, boxes: Box[], opts: ExportOptions = {}): Promise<ExportResult> {
  const dpi = opts.dpi ?? DEFAULT_DPI;
  const sink: PageSink = !opts.inline && workerExportSupported() ? new WorkerSink() : new InlineSink();
  const scales: number[] = [];
  try {
    for (let i = 0; i < doc.pages.length; i++) {
      opts.signal?.throwIfAborted();
      opts.onProgress?.({ page: i + 1, total: doc.pages.length });
      const size = doc.pages[i]!;
      const scale = fitScale(size, doc.kind === "pdf" ? dpi / 72 : 1);
      const { w, h } = canvasSize(size, scale);
      const canvas = createCanvas(w, h);
      const ctx = get2d(canvas);
      await doc.draw(i, ctx, scale, opts.signal);
      burnBoxes(
        ctx,
        boxes.filter((b) => b.page === i).map((b) => toPixelRect(b, scale, BOX_PAD_PX, w, h)),
      );
      await sink.add(canvas, {
        format: doc.kind === "pdf" ? "jpg" : "png",
        widthPt: size.width,
        heightPt: size.height,
      });
      scales.push(scale);
      // Let the browser paint progress and handle input between pages.
      await nextTask();
    }
    const bytes = await sink.finish(doc.kind);
    return {
      kind: doc.kind,
      bytes,
      mime: doc.kind === "pdf" ? "application/pdf" : "image/png",
      fileName: redactedFileName(doc.name, doc.kind),
      scales,
      pageCount: doc.pages.length,
    };
  } finally {
    sink.dispose();
  }
}
