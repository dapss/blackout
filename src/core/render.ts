import type { PageSize } from "./types";

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type Any2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Stay under Safari's 16,777,216-pixel canvas limit. */
export const MAX_CANVAS_AREA = 16_000_000;
export const MAX_CANVAS_SIDE = 16_384;

/** Largest scale <= `wanted` at which the page still fits in one canvas. */
export function fitScale(size: PageSize, wanted: number): number {
  let s = wanted;
  const area = size.width * size.height * s * s;
  if (area > MAX_CANVAS_AREA) s = Math.sqrt(MAX_CANVAS_AREA / (size.width * size.height));
  const side = Math.max(size.width, size.height) * s;
  if (side > MAX_CANVAS_SIDE) s = MAX_CANVAS_SIDE / Math.max(size.width, size.height);
  return s;
}

export function canvasSize(size: PageSize, scale: number): { w: number; h: number } {
  return { w: Math.max(1, Math.round(size.width * scale)), h: Math.max(1, Math.round(size.height * scale)) };
}

export function createCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export function get2d(c: AnyCanvas): Any2D {
  const ctx = c.getContext("2d", { alpha: false }) as Any2D | null;
  if (!ctx) throw new Error("This browser could not create a 2D canvas.");
  return ctx;
}

/** Free a canvas's backing store right away instead of waiting for GC. */
export function releaseCanvas(c: AnyCanvas): void {
  c.width = 0;
  c.height = 0;
}

export function readPixels(ctx: Any2D, w: number, h: number): ImageData {
  return ctx.getImageData(0, 0, w, h);
}
