// Finds sensitive values in a page's text, line by line and again across lines that wrap.
import { DETECTORS } from "../packs";
import type { Detector } from "../packs/types";
import { validators } from "../packs/validators";
import type { PageSize, Rect } from "./types";
import { groupLines, lineRects, type Word, wordBox } from "./words";

export interface TextMatch {
  start: number;
  end: number;
  detector: Detector;
}

export interface Finding {
  id: string;
  page: number;
  detectorId: string;
  label: string;
  text: string;
  rects: Rect[];
}

/** Words closer than this (in font sizes) are one run of text that the PDF happened to split. */
const WORD_GAP_EM = 0.15;
/** Words further apart than this (in font sizes) are in different columns of the same row. */
const COLUMN_GAP_EM = 2.5;
/** The furthest apart two lines of one paragraph can be, baseline to baseline, in font sizes. */
const MAX_LINE_STEP_EM = 2.4;
const MIN_LINE_STEP_EM = 0.6;
const BREAKS_WITHOUT_SPACE = /[\-‐-―@]$/;

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const GROUP_SEPARATOR = /[ \-‐-―]/;

function standsAlone(text: string, start: number, end: number): boolean {
  const before = text[start - 1];
  const after = text[end];
  if ((before && LETTER_OR_DIGIT.test(before)) || (after && LETTER_OR_DIGIT.test(after))) return false;
  return true;
}

/** The same, and not one piece of a dotted or hyphenated number like 12-0812-3456-789. */
function standsAloneInNumber(text: string, start: number, end: number, loose: boolean): boolean {
  if (!standsAlone(text, start, end)) return false;
  const digit = (c: string | undefined) => !!c && /\d/.test(c);
  const joined = (mark: string | undefined, next: string | undefined) => (mark === "." || mark === "-") && digit(next);
  if (joined(text[start - 1], text[start - 2]) || joined(text[end], text[end + 1])) return false;
  // The tail of a number printed in groups, like the end of 1234 0812 3456 7890.
  return !(loose && digit(text[start]) && text[start - 1] === " " && digit(text[start - 2]));
}

const passes = (detector: Detector, value: string) => !detector.validator || validators[detector.validator](value);

function groupMatches(text: string, start: number, end: number, detector: Detector): { start: number; end: number }[] {
  const [min, max] = detector.groups!;
  const groups: { start: number; end: number; size: number }[] = [];
  let groupStart = start;
  for (let i = start; i <= end; i++) {
    if (i === end || GROUP_SEPARATOR.test(text[i]!)) {
      groups.push({ start: groupStart, end: i, size: i - groupStart });
      groupStart = i + 1;
    }
  }
  const found: { start: number; end: number }[] = [];
  for (let first = 0; first < groups.length; first++) {
    // Longest run first, so a value isn't cut short by a shorter one that also passes.
    const sizes: { last: number; size: number }[] = [];
    let size = 0;
    for (let last = first; last < groups.length && size < max; last++) {
      size += groups[last]!.size;
      if (size >= min && size <= max) sizes.push({ last, size });
    }
    const hit = sizes.reverse().find(({ last }) => {
      const s = groups[first]!.start;
      const e = groups[last]!.end;
      return standsAlone(text, s, e) && passes(detector, text.slice(s, e));
    });
    if (hit) {
      found.push({ start: groups[first]!.start, end: groups[hit.last]!.end });
      first = hit.last;
    }
  }
  return found;
}

/** Everything in one line of text. Where two detectors overlap, the earlier one keeps the text. */
export function findMatches(text: string, detectors: Detector[] = DETECTORS): TextMatch[] {
  const matches: TextMatch[] = [];
  const isFree = (start: number, end: number) => !matches.some((m) => start < m.end && m.start < end);
  for (const detector of detectors) {
    const pattern = new RegExp(detector.pattern.source, `${detector.pattern.flags.replace("g", "")}g`);
    for (const m of text.matchAll(pattern)) {
      const start = m.index;
      const end = start + m[0].length;
      const candidates = detector.groups
        ? groupMatches(text, start, end, detector)
        : standsAloneInNumber(text, start, end, !!detector.loose) && passes(detector, m[0])
          ? [{ start, end }]
          : [];
      for (const c of candidates) if (isFree(c.start, c.end)) matches.push({ ...c, detector });
    }
  }
  return matches.sort((a, b) => a.start - b.start);
}

const along = (w: Word) => (w.axis === "v" ? w.y : w.x);
const lengthOf = (w: Word) => (w.axis === "v" ? w.h : w.w);
const inReadingOrder = (line: Word[]) =>
  [...line].sort((a, b) => (line[0]!.reversed ? along(b) - along(a) : along(a) - along(b)));
const gapBetween = (prev: Word, w: Word) =>
  prev.reversed ? along(prev) - (along(w) + lengthOf(w)) : along(w) - (along(prev) + lengthOf(prev));

export function lineText(line: Word[]): { text: string; wordAt: number[]; words: Word[] } {
  const words = inReadingOrder(line);
  let text = "";
  const wordAt: number[] = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (prev) {
      if (gapBetween(prev, w) >= WORD_GAP_EM * Math.min(w.size, prev.size)) {
        text += " ";
        wordAt.push(-1);
      }
    }
    text += w.text;
    for (let c = 0; c < w.text.length; c++) wordAt.push(i);
  });
  return { text, wordAt, words };
}

function columnsOf(line: Word[]): Word[][] {
  const columns: Word[][] = [];
  inReadingOrder(line).forEach((w, i, words) => {
    const prev = words[i - 1];
    if (prev && gapBetween(prev, w) < COLUMN_GAP_EM * Math.min(w.size, prev.size)) columns[columns.length - 1]!.push(w);
    else columns.push([w]);
  });
  return columns;
}

/** Rotated pages read in other directions. */
const nextLineDirection = (w: Word) => ((w.axis === "h") === w.reversed ? -1 : 1);

function overlap(a: Word[], b: Word[]): number {
  const start = (l: Word[]) => Math.min(...l.map(along));
  const end = (l: Word[]) => Math.max(...l.map((w) => along(w) + lengthOf(w)));
  return Math.min(end(a), end(b)) - Math.max(start(a), start(b));
}

function carriesOn(a: Word[], b: Word[]): boolean {
  const x = a[0]!;
  const y = b[0]!;
  if (x.axis !== y.axis || x.reversed !== y.reversed) return false;
  if (Math.min(x.size, y.size) / Math.max(x.size, y.size) < 0.8) return false;
  const step = (y.base - x.base) * nextLineDirection(x);
  return step >= MIN_LINE_STEP_EM * x.size && step <= MAX_LINE_STEP_EM * x.size && overlap(a, b) > 0;
}

function paragraphs(lines: Word[][]): Word[][][] {
  const pieces = lines
    .filter((l) => l[0]!.axis)
    .flatMap(columnsOf)
    .sort((a, b) => (a[0]!.base - b[0]!.base) * nextLineDirection(a[0]!));
  const next = new Map<Word[], Word[]>();
  const taken = new Set<Word[]>();
  for (const a of pieces) {
    const best = pieces
      .filter((b) => !taken.has(b) && carriesOn(a, b))
      .sort((p, q) => (p[0]!.base - q[0]!.base) * nextLineDirection(a[0]!) || overlap(a, q) - overlap(a, p))[0];
    if (best) {
      next.set(a, best);
      taken.add(best);
    }
  }
  return pieces
    .filter((p) => !taken.has(p) && next.has(p))
    .map((head) => {
      const chain = [head];
      for (let p = next.get(head); p; p = next.get(p)) chain.push(p);
      return chain;
    });
}

interface Hit {
  detector: Detector;
  text: string;
  words: Word[];
}

function wrappedHits(lines: Word[][], detectors: Detector[]): Hit[] {
  const hits: Hit[] = [];
  for (const chain of paragraphs(lines)) {
    let text = "";
    const wordAt: number[] = [];
    const words: Word[] = [];
    const lineOf = new Map<Word, number>();
    chain.forEach((piece, i) => {
      const line = lineText(piece);
      if (i > 0 && !BREAKS_WITHOUT_SPACE.test(text)) {
        text += " ";
        wordAt.push(-1);
      }
      text += line.text;
      for (const at of line.wordAt) wordAt.push(at < 0 ? -1 : at + words.length);
      for (const w of line.words) lineOf.set(w, i);
      words.push(...line.words);
    });
    for (const match of findMatches(text, detectors)) {
      const touched = [...new Set(wordAt.slice(match.start, match.end).filter((i) => i >= 0))].map((i) => words[i]!);
      if (new Set(touched.map((w) => lineOf.get(w))).size > 1) {
        hits.push({ detector: match.detector, text: text.slice(match.start, match.end), words: touched });
      }
    }
  }
  return hits;
}

/**
 * A box covers each whole word a match touches, so nothing is left half-covered. A value that wraps
 * replaces the piece found on its first line, which could look complete: the start of a phone number
 * is a valid phone number. It can't take text from a separate value, so table rows stay separate.
 */
export function findingsOnPage(words: Word[], page: number, size: PageSize, detectors: Detector[] = DETECTORS): Finding[] {
  const lines = groupLines(words)
    .map((l) => lineText(l).words)
    .sort((a, b) => Math.min(...a.map((w) => w.y)) - Math.min(...b.map((w) => w.y)));
  let hits: Hit[] = lines.flatMap((l) => {
    const line = lineText(l);
    return findMatches(line.text, detectors).map((match) => ({
      detector: match.detector,
      text: line.text.slice(match.start, match.end),
      words: [...new Set(line.wordAt.slice(match.start, match.end).filter((i) => i >= 0))].map((i) => line.words[i]!),
    }));
  });
  for (const wrapped of wrappedHits(lines, detectors)) {
    const inside = new Set(wrapped.words);
    const touching = hits.filter((h) => h.words.some((w) => inside.has(w)));
    if (touching.length > 1 || touching.some((h) => !h.words.every((w) => inside.has(w)))) continue;
    hits = [...hits.filter((h) => !touching.includes(h)), wrapped];
  }

  const position = new Map(lines.flatMap((l, i) => l.map((w, j): [Word, number] => [w, i * 1e6 + j])));
  const at = (h: Hit) => position.get(h.words[0]!)!;
  return hits
    .sort((a, b) => at(a) - at(b))
    .map((h, i) => ({
      id: `${page}-${i}`,
      page,
      detectorId: h.detector.id,
      label: h.detector.label,
      text: h.text,
      rects: lineRects(h.words).map((r) => wordBox(r, size)),
    }));
}

/** A box covers a finding only if each of its rectangles lies fully inside one box. */
export function isCovered(finding: Finding, boxes: (Rect & { page: number })[]): boolean {
  const slack = 1;
  return finding.rects.every((r) =>
    boxes.some(
      (b) =>
        b.page === finding.page &&
        b.x <= r.x + slack &&
        b.y <= r.y + slack &&
        b.x + b.w >= r.x + r.w - slack &&
        b.y + b.h >= r.y + r.h - slack,
    ),
  );
}
