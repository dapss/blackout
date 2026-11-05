// The legacy build is used for its polyfills (Safari, older Firefox).
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

let port: Worker | null = null;

/** Started at page load so its script is fetched then; after that the app makes no requests. */
export function startPdfWorker(): void {
  if (port) return;
  port = new Worker(workerUrl, { type: "module", name: "pdfjs" });
  pdfjs.GlobalWorkerOptions.workerPort = port;
}

/** No CMap, standard-font or wasm URLs, so pdf.js never fetches anything. */
export const OFFLINE_DOC_OPTIONS = {
  useSystemFonts: true,
  useWasm: false,
  useWorkerFetch: false,
  enableXfa: false,
  disableRange: true,
  disableStream: true,
  disableAutoFetch: true,
  verbosity: 0,
} as const;

export function openPdf(bytes: Uint8Array, password?: string) {
  startPdfWorker();
  // pdf.js transfers (detaches) the buffer it is given, so hand it a copy.
  return pdfjs.getDocument({ data: bytes.slice(), password, ...OFFLINE_DOC_OPTIONS });
}

export { pdfjs };
export type PdfjsLib = typeof pdfjs;
