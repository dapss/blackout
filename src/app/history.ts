import type { Box, Rect } from "../core/types";

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const HISTORY_LIMIT = 200;

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export function commit<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) };
}

// Box operations return the same array when nothing changes.

let counter = 0;
export function newBoxId(): string {
  counter += 1;
  return `b${Date.now().toString(36)}${counter.toString(36)}`;
}

export function addBox(boxes: Box[], box: Box): Box[] {
  return [...boxes, box];
}

export function updateBox(boxes: Box[], id: string, rect: Rect): Box[] {
  const i = boxes.findIndex((b) => b.id === id);
  const old = boxes[i];
  if (!old) return boxes;
  if (old.x === rect.x && old.y === rect.y && old.w === rect.w && old.h === rect.h) return boxes;
  const next = boxes.slice();
  next[i] = { ...old, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  return next;
}

export function removeBox(boxes: Box[], id: string): Box[] {
  const next = boxes.filter((b) => b.id !== id);
  return next.length === boxes.length ? boxes : next;
}

export function removePageBoxes(boxes: Box[], page: number): Box[] {
  const next = boxes.filter((b) => b.page !== page);
  return next.length === boxes.length ? boxes : next;
}
