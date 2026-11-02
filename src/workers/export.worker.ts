// Encodes redacted page bitmaps, assembles the output file, and re-parses it for the export check,
// all off the main thread.
import { buildSafePdf, type EncodedPage, encodeCanvas, type WorkerReply, type WorkerRequest } from "../core/encode";
import { inspectPdfStructure } from "../core/verify";

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(msg: WorkerReply, transfer?: Transferable[]): void;
};

let pages: EncodedPage[] = [];

scope.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "inspect") {
    let findings: Record<string, string[]>;
    try {
      findings = await inspectPdfStructure(msg.bytes, msg.pages);
    } catch (err) {
      // Fail closed: an inspection that couldn't run is a failed check.
      findings = { "single-revision": [`inspection failed: ${err instanceof Error ? err.message : String(err)}`] };
    }
    scope.postMessage({ type: "inspected", id: msg.id, findings });
    return;
  }
  try {
    if (msg.type === "page") {
      const { bitmap, format, widthPt, heightPt } = msg;
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("No 2D canvas in worker.");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      pages.push({ format, widthPt, heightPt, bytes: await encodeCanvas(canvas, format) });
      canvas.width = canvas.height = 0;
      scope.postMessage({ type: "ack" });
    } else {
      const bytes = msg.kind === "image" ? pages[0]!.bytes : await buildSafePdf(pages);
      pages = [];
      scope.postMessage({ type: "done", bytes }, [bytes.buffer as ArrayBuffer]);
    }
  } catch (err) {
    pages = [];
    scope.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
