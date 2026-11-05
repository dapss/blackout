import type { PageSize, Rect, ResizeHandle } from "./types";

/** Smallest box the editor keeps, in page units. */
export const MIN_BOX_SIZE = 2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Rectangle spanned by two corner points, clipped to the page. */
export function rectFromPoints(x0: number, y0: number, x1: number, y1: number, page: PageSize): Rect {
  const ax = clamp(Math.min(x0, x1), 0, page.width);
  const ay = clamp(Math.min(y0, y1), 0, page.height);
  const bx = clamp(Math.max(x0, x1), 0, page.width);
  const by = clamp(Math.max(y0, y1), 0, page.height);
  return { x: ax, y: ay, w: bx - ax, h: by - ay };
}

/** Translate a rectangle, keeping it fully on the page. */
export function moveRect(r: Rect, dx: number, dy: number, page: PageSize): Rect {
  return {
    x: clamp(r.x + dx, 0, Math.max(0, page.width - r.w)),
    y: clamp(r.y + dy, 0, Math.max(0, page.height - r.h)),
    w: r.w,
    h: r.h,
  };
}

/** Drag one edge or corner of a rectangle. Edges can't cross each other or leave the page. */
export function resizeRect(r: Rect, handle: ResizeHandle, dx: number, dy: number, page: PageSize): Rect {
  let left = r.x;
  let top = r.y;
  let right = r.x + r.w;
  let bottom = r.y + r.h;
  if (handle.includes("w")) left = clamp(left + dx, 0, right - MIN_BOX_SIZE);
  if (handle.includes("e")) right = clamp(right + dx, left + MIN_BOX_SIZE, page.width);
  if (handle.includes("n")) top = clamp(top + dy, 0, bottom - MIN_BOX_SIZE);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + MIN_BOX_SIZE, page.height);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function isUsableRect(r: Rect): boolean {
  return r.w >= MIN_BOX_SIZE && r.h >= MIN_BOX_SIZE;
}

/**
 * Convert a page-unit rectangle to whole device pixels at `scale`, grown outward by `pad` pixels
 * and clipped to the canvas. Rounding outward means a box never covers less than the user drew.
 */
export function toPixelRect(r: Rect, scale: number, pad: number, maxW: number, maxH: number): Rect {
  const x0 = clamp(Math.floor(r.x * scale) - pad, 0, maxW);
  const y0 = clamp(Math.floor(r.y * scale) - pad, 0, maxH);
  const x1 = clamp(Math.ceil((r.x + r.w) * scale) + pad, 0, maxW);
  const y1 = clamp(Math.ceil((r.y + r.h) * scale) + pad, 0, maxH);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The pixels that must be solid black in a rendered output: the box at `scale`, shrunk inward by
 * `inset` pixels to skip anti-aliased edges. Falls back to the centre pixel for tiny boxes.
 */
export function innerPixelRect(r: Rect, scale: number, inset: number, maxW: number, maxH: number): Rect {
  let x0 = Math.ceil(r.x * scale) + inset;
  let y0 = Math.ceil(r.y * scale) + inset;
  let x1 = Math.floor((r.x + r.w) * scale) - inset;
  let y1 = Math.floor((r.y + r.h) * scale) - inset;
  if (x1 <= x0) x0 = x1 = Math.floor((r.x + r.w / 2) * scale);
  if (y1 <= y0) y0 = y1 = Math.floor((r.y + r.h / 2) * scale);
  x0 = clamp(x0, 0, maxW - 1);
  y0 = clamp(y0, 0, maxH - 1);
  x1 = clamp(Math.max(x1, x0 + 1), 1, maxW);
  y1 = clamp(Math.max(y1, y0 + 1), 1, maxH);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Size of the touch magnifier, in screen pixels. */
export const LOUPE_SIZE = 120;

/**
 * Where the touch magnifier goes: above and to the side of the finger, so the finger never covers
 * it. It prefers the left (a right thumb reaches in from the lower right), and slides down beside
 * the finger when there's no room above.
 */
export function loupeSpot(fingerX: number, fingerY: number, viewW: number, viewH: number): { left: number; top: number } {
  const margin = 8;
  const side = 28;
  const left = fingerX - LOUPE_SIZE - side;
  return {
    left: left >= margin ? left : Math.min(fingerX + side, viewW - LOUPE_SIZE - margin),
    top: clamp(fingerY - LOUPE_SIZE - side, margin, Math.max(margin, viewH - LOUPE_SIZE - margin)),
  };
}

/** Clear of a selected box's touch handles, whose grab areas reach 22px outside it. */
const BUBBLE_GAP = 26;
const BUBBLE_HEIGHT = 50;

/**
 * Where the action bubble goes on the page, in screen pixels: above the box, below it if there's no
 * room, and just inside its top edge if it fills the page. Lined up with the box's side nearer the
 * page edge, so it stays on the page.
 */
export function bubbleSpot(box: Rect, pageW: number, pageH: number): { top: number; left?: number; right?: number } {
  const above = box.y - BUBBLE_GAP - BUBBLE_HEIGHT;
  const below = box.y + box.h + BUBBLE_GAP;
  const top = above >= 0 ? above : below + BUBBLE_HEIGHT <= pageH ? below : box.y + 4;
  return box.x + box.w / 2 < pageW / 2 ? { top, left: box.x } : { top, right: pageW - box.x - box.w };
}
