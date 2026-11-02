// Browser-only pdf.js setup. The legacy build is used for its polyfills (Safari, older Firefox).
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

let port: Worker | null = null;

/**
 * Start the pdf.js worker. Called at startup so the worker script is fetched during the initial
 * page load; after that, opening and exporting files makes no network requests at all.
 */
export function startPdfWorker(): void {
  if (port) return;
  port = new Worker(workerUrl, { type: "module", name: "pdfjs" });
  pdfjs.GlobalWorkerOptions.workerPort = port;
}

/**
 * Options that keep pdf.js fully offline: no CMap, standard-font or wasm URLs, so it never
 * fetches anything. Fonts that aren't embedded fall back to system fonts.
 */
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
