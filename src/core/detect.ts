// Finds sensitive values in a page's text. Works on the same words as the Words tool, line by line,
// so a value split across two lines isn't found. Pure code over plain data, so it also runs under Node.
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
  /** Where a redaction box goes: one per line. */
  rects: Rect[];
}

/** Words closer than this (in font sizes) are one run of text that the PDF happened to split. */
const WORD_GAP_EM = 0.15;

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const GROUP_SEPARATOR = /[ \-‐-―]/;

/** The match stands alone: it isn't the middle of a longer word or number. */
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

/** Candidates within one pattern match, for detectors whose values are printed in groups. */
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

/** A line's words in reading order, as text, with which word each character came from. */
export function lineText(line: Word[]): { text: string; wordAt: number[]; words: Word[] } {
  const first = line[0]!;
  const vertical = first.axis === "v";
  const from = (w: Word) => (vertical ? w.y : w.x);
  const length = (w: Word) => (vertical ? w.h : w.w);
  const words = [...line].sort((a, b) => (first.reversed ? from(b) - from(a) : from(a) - from(b)));
  let text = "";
  const wordAt: number[] = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (prev) {
      const gap = first.reversed ? from(prev) - (from(w) + length(w)) : from(w) - (from(prev) + length(prev));
      if (gap >= WORD_GAP_EM * Math.min(w.size, prev.size)) {
        text += " ";
        wordAt.push(-1);
      }
    }
    text += w.text;
    for (let c = 0; c < w.text.length; c++) wordAt.push(i);
  });
  return { text, wordAt, words };
}

/** Findings on one page. A box covers each whole word a match touches, so nothing is left half-covered. */
export function findingsOnPage(words: Word[], page: number, size: PageSize, detectors: Detector[] = DETECTORS): Finding[] {
  const lines = groupLines(words)
    .map(lineText)
    .sort((a, b) => Math.min(...a.words.map((w) => w.y)) - Math.min(...b.words.map((w) => w.y)));
  const findings: Finding[] = [];
  for (const line of lines) {
    for (const match of findMatches(line.text, detectors)) {
      const touched = new Set(line.wordAt.slice(match.start, match.end).filter((i) => i >= 0));
      const covered = [...touched].map((i) => line.words[i]!);
      findings.push({
        id: `${page}-${findings.length}`,
        page,
        detectorId: match.detector.id,
        label: match.detector.label,
        text: line.text.slice(match.start, match.end),
        rects: lineRects(covered).map((r) => wordBox(r, size)),
      });
    }
  }
  return findings;
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
