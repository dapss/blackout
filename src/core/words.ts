// The PDF text layer says which words exist and roughly where; the rendered pixels say exactly
// where. pdf.js reports one start position and width per text run, not per glyph, and on spaced,
// squeezed or kerned text its positions can drift by several words. So the estimate from the text
// layer is snapped to the ink on the rendered page (`snapWordsToInk`), and only falls back to the
// padded estimate when the ink is ambiguous.
import type { PageSize, Rect } from "./types";

export interface Word extends Rect {
  text: string;
  /** Reading direction on the page; snapping only handles axis-aligned text. */
  axis: "h" | "v" | null;
  /** Text runs toward smaller coordinates (rotated pages). */
  reversed: boolean;
  /** Baseline position across the reading direction, in page units. */
  base: number;
  size: number;
  snapped: boolean;
}

export interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  fontName: string;
}
export interface TextStyleLike {
  ascent?: number;
  descent?: number;
  vertical?: boolean;
  fontFamily?: string;
}

/** Width of `text` in any unit; only ratios are used. */
export type Measure = (text: string, fontFamily: string) => number;

export const charCountMeasure: Measure = (text) => text.length;

export interface PixelData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

type Matrix = [number, number, number, number, number, number];

function multiply(m: number[], n: number[]): Matrix {
  return [
    m[0]! * n[0]! + m[2]! * n[1]!,
    m[1]! * n[0]! + m[3]! * n[1]!,
    m[0]! * n[2]! + m[2]! * n[3]!,
    m[1]! * n[2]! + m[3]! * n[3]!,
    m[0]! * n[4]! + m[2]! * n[5]! + m[4]!,
    m[1]! * n[4]! + m[3]! * n[5]! + m[5]!,
  ];
}

/**
 * pdf.js inserts a space between letters it sees spread apart (letter-spaced, squeezed or kerned
 * text), turning "PASSPORT" into "P A S S P O R T". Such runs are one word.
 */
const SPACED_OUT = /^\S( \S)+$/;

export function wordsFromText(
  items: TextItemLike[],
  styles: Record<string, TextStyleLike>,
  viewportTransform: number[],
  page: PageSize,
  measure: Measure = charCountMeasure,
): Word[] {
  const words: Word[] = [];
  const vpScale = Math.hypot(viewportTransform[0]!, viewportTransform[1]!);
  for (const item of items) {
    if (!item.str.trim()) continue;
    const style = styles[item.fontName] ?? {};
    if (style.vertical) continue; // Vertical CJK runs: use the Draw tool for now.
    const tx = multiply(viewportTransform, item.transform);
    const height = Math.hypot(tx[2], tx[3]);
    const runLength = Math.hypot(tx[0], tx[1]);
    if (!height || !runLength) continue;
    const dir = [tx[0] / runLength, tx[1] / runLength] as const;
    const up = [tx[2] / height, tx[3] / height] as const;
    const axis = Math.abs(dir[1]) < 0.01 ? "h" : Math.abs(dir[0]) < 0.01 ? "v" : null;
    const reversed = axis === "h" ? dir[0] < 0 : axis === "v" ? dir[1] < 0 : false;
    const ascent = style.ascent && style.ascent > 0 ? style.ascent : 0.8;
    const descent = style.descent && style.descent < 0 ? style.descent : -0.2;
    const total = item.width * vpScale;
    // pdf.js registers embedded fonts under the item's fontName once a page has rendered; prefer
    // that face for measuring, then the generic family it reports.
    const family = `"${item.fontName}", ${style.fontFamily ?? "sans-serif"}`;
    const full = measure(item.str, family) || item.str.length;
    const spans = SPACED_OUT.test(item.str)
      ? [{ text: item.str.replace(/ /g, ""), start: 0, end: total }]
      : [...item.str.matchAll(/\S+/g)].map((m) => ({
          text: m[0],
          start: (measure(item.str.slice(0, m.index), family) / full) * total,
          end: (measure(item.str.slice(0, m.index + m[0].length), family) / full) * total,
        }));

    for (const { text, start, end } of spans) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const t of [start, end]) {
        for (const u of [ascent, descent]) {
          xs.push(tx[4] + dir[0] * t + up[0] * u * height);
          ys.push(tx[5] + dir[1] * t + up[1] * u * height);
        }
      }
      const x0 = Math.max(0, Math.min(...xs));
      const y0 = Math.max(0, Math.min(...ys));
      const x1 = Math.min(page.width, Math.max(...xs));
      const y1 = Math.min(page.height, Math.max(...ys));
      if (x1 > x0 && y1 > y0) {
        words.push({
          text,
          x: x0,
          y: y0,
          w: x1 - x0,
          h: y1 - y0,
          axis,
          reversed,
          base: axis === "v" ? tx[4] : tx[5],
          size: height,
          snapped: false,
        });
      }
    }
  }
  return words;
}

/** A pixel is ink when its luminance differs this much from the line's background. */
const INK_CONTRAST = 60;
/** How far past the estimated end a line's ink may continue (pdf.js positions drift), in ems. */
const LINE_REACH_EM = 1.2;
/** Chosen word gaps must be clearly wider than the widest gap inside a word. */
const GAP_RATIO = 1.25;

export function groupLines(words: Word[]): Word[][] {
  const lines: Word[][] = [];
  for (const w of words) {
    const line =
      w.axis &&
      lines.find(
        (l) =>
          l[0]!.axis === w.axis &&
          l[0]!.reversed === w.reversed &&
          Math.abs(l[0]!.base - w.base) < 0.35 * Math.min(l[0]!.size, w.size),
      );
    if (line) line.push(w);
    else lines.push([w]);
  }
  return lines;
}

/**
 * Fit every word to the ink of the page rendered at `scale` pixels per page unit. For each line,
 * the ink is split at its N-1 widest gaps (N = words on that line), so the result doesn't depend on
 * pdf.js getting positions right, only on the word count and the line's location.
 */
export function snapWordsToInk(words: Word[], img: PixelData, scale: number): Word[] {
  return groupLines(words).flatMap((line) => snapLine(line, img, scale) ?? line);
}

function snapLine(line: Word[], img: PixelData, scale: number): Word[] | null {
  const first = line[0]!;
  if (!first.axis) return null;
  const horizontal = first.axis === "h";
  const a0 = (r: Rect) => (horizontal ? r.x : r.y);
  const a1 = (r: Rect) => (horizontal ? r.x + r.w : r.y + r.h);
  const c0 = (r: Rect) => (horizontal ? r.y : r.x);
  const c1 = (r: Rect) => (horizontal ? r.y + r.h : r.x + r.w);
  const alongMax = horizontal ? img.width : img.height;
  const acrossMax = horizontal ? img.height : img.width;
  const clampA = (v: number) => Math.max(0, Math.min(alongMax, v));
  const clampC = (v: number) => Math.max(0, Math.min(acrossMax, v));
  const lum = (a: number, c: number) => {
    const i = (horizontal ? c * img.width + a : a * img.width + c) * 4;
    return 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
  };

  const em = Math.max(...line.map((w) => w.size)) * scale;
  const top = clampC(Math.floor(Math.min(...line.map(c0)) * scale));
  const bottom = clampC(Math.ceil(Math.max(...line.map(c1)) * scale));
  if (bottom - top < 2) return null;
  const start = Math.min(...line.map(a0)) * scale;
  const end = Math.max(...line.map(a1)) * scale;
  // The run's start is reliable; its end can drift, so look further in the reading direction.
  const lo = clampA(Math.floor(start - (first.reversed ? LINE_REACH_EM : 0.5) * em));
  const hi = clampA(Math.ceil(end + (first.reversed ? 0.5 : LINE_REACH_EM) * em));
  if (hi - lo < 2) return null;

  // Background = 90th percentile luminance of the band (handles tinted paper and dark themes).
  const hist = new Uint32Array(256);
  for (let a = lo; a < hi; a++) for (let c = top; c < bottom; c++) hist[Math.round(lum(a, c))]! += 1;
  const n = (hi - lo) * (bottom - top);
  let bg = 255;
  for (let v = 0, acc = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc >= 0.9 * n) {
      bg = v;
      break;
    }
  }
  const isInk = (a: number, c: number) => Math.abs(lum(a, c) - bg) > INK_CONTRAST;
  const colHasInk = (a: number, from: number, to: number) => {
    for (let c = from; c < to; c++) if (isInk(a, c)) return true;
    return false;
  };

  // Runs of ink columns along the line. The scan keeps going in the reading direction while ink
  // continues, so a word that runs past the window isn't cut off.
  const reach = LINE_REACH_EM * em;
  const inkCols = new Set<number>();
  let scanLo = lo;
  let scanHi = hi;
  for (let a = lo; a < hi; a++) if (colHasInk(a, top, bottom)) inkCols.add(a);
  while (inkCols.size) {
    if (first.reversed) {
      const nearest = Math.min(...inkCols);
      if (nearest - scanLo > reach || scanLo === 0) break;
      const next = clampA(Math.floor(scanLo - reach));
      for (let a = next; a < scanLo; a++) if (colHasInk(a, top, bottom)) inkCols.add(a);
      scanLo = next;
    } else {
      const farthest = Math.max(...inkCols);
      if (scanHi - 1 - farthest > reach || scanHi === alongMax) break;
      const next = clampA(Math.ceil(scanHi + reach));
      for (let a = scanHi; a < next; a++) if (colHasInk(a, top, bottom)) inkCols.add(a);
      scanHi = next;
    }
  }
  const clusters: [number, number][] = [];
  for (const a of [...inkCols].sort((p, q) => p - q)) {
    const last = clusters.at(-1);
    if (last && last[1] === a) last[1] = a + 1;
    else clusters.push([a, a + 1]);
  }
  // Keep the ink that belongs to this line: clusters touching the estimate, then ones that
  // continue it (gap under LINE_REACH_EM) in the reading direction.
  const touches = (c: [number, number]) => c[1] > start && c[0] < end;
  let i0 = clusters.findIndex(touches);
  let i1 = clusters.findLastIndex(touches);
  if (i0 < 0) return null;
  if (first.reversed) while (i0 > 0 && clusters[i0]![0] - clusters[i0 - 1]![1] <= reach) i0--;
  else while (i1 < clusters.length - 1 && clusters[i1 + 1]![0] - clusters[i1]![1] <= reach) i1++;
  const kept = clusters.slice(i0, i1 + 1);

  const count = line.length;
  if (kept.length < count) return null;
  const gaps = kept.slice(1).map((c, i) => ({ after: i, width: c[0] - kept[i]![1] }));
  const byWidth = [...gaps].sort((p, q) => q.width - p.width);
  const breaks = byWidth.slice(0, count - 1);
  const inner = byWidth.slice(count - 1);
  if (breaks.length && inner.length && breaks.at(-1)!.width < GAP_RATIO * inner[0]!.width) return null;

  const cuts = breaks.map((g) => g.after).sort((p, q) => p - q);
  const groups: [number, number][] = [];
  let from = 0;
  for (const cut of [...cuts, kept.length - 1]) {
    groups.push([kept[from]![0], kept[cut]![1]]);
    from = cut + 1;
  }

  const sorted = [...line].sort((p, q) => a0(p) - a0(q));
  const maxGrow = Math.ceil(0.35 * em);
  return sorted.map((word, k) => {
    const [s, e] = groups[k]!;
    // Grow across the line to take in ink past the font's ascent/descent (accents, descenders),
    // stopping at the first clean row.
    let t = top;
    while (t > 0 && top - t < maxGrow && rowHasInk(t - 1)) t--;
    let b = bottom;
    while (b < acrossMax && b - bottom < maxGrow && rowHasInk(b)) b++;
    const rect = horizontal
      ? { x: s / scale, y: t / scale, w: (e - s) / scale, h: (b - t) / scale }
      : { x: t / scale, y: s / scale, w: (b - t) / scale, h: (e - s) / scale };
    return { ...word, ...rect, snapped: true };

    function rowHasInk(c: number) {
      for (let a = s; a < e; a++) if (isInk(a, c)) return true;
      return false;
    }
  });
}

/**
 * The box to burn over a word (or a merged line of words). Snapped boxes already hug the ink, so
 * they get a small margin; estimated ones get more to absorb the estimate's error.
 */
export function wordBox(r: Rect & { size: number; snapped: boolean }, page: PageSize): Rect {
  const pad = Math.max(1, r.size * (r.snapped ? 0.06 : 0.15));
  const x0 = Math.max(0, r.x - pad);
  const y0 = Math.max(0, r.y - pad);
  const x1 = Math.min(page.width, r.x + r.w + pad);
  const y1 = Math.min(page.height, r.y + r.h + pad);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function wordAt(words: Word[], x: number, y: number): Word | undefined {
  return words.find((w) => x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h);
}

function spanShare(a: number, aLen: number, b: number, bLen: number): number {
  const overlap = Math.min(a + aLen, b + bLen) - Math.max(a, b);
  if (overlap < 0) return 0;
  const shorter = Math.min(aLen, bLen);
  return shorter > 0 ? overlap / shorter : 1;
}

/**
 * Words a drag takes: at least a third of the word must be crossed. Measuring against the shorter
 * span means a flat drag along a line of text counts, like running a marker over it, even though
 * its rectangle has almost no height.
 */
export function wordsInRect(words: Word[], r: Rect): Word[] {
  return words.filter((w) => spanShare(w.x, w.w, r.x, r.w) * spanShare(w.y, w.h, r.y, r.h) >= 1 / 3);
}

/** One rectangle per line: separate boxes would reveal each word's length. */
export function lineRects(words: Word[]): (Rect & { size: number; snapped: boolean })[] {
  return groupLines(words).map((line) => {
    const x0 = Math.min(...line.map((w) => w.x));
    const y0 = Math.min(...line.map((w) => w.y));
    const x1 = Math.max(...line.map((w) => w.x + w.w));
    const y1 = Math.max(...line.map((w) => w.y + w.h));
    return {
      x: x0,
      y: y0,
      w: x1 - x0,
      h: y1 - y0,
      size: Math.max(...line.map((w) => w.size)),
      snapped: line.every((w) => w.snapped),
    };
  });
}
