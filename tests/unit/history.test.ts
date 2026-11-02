import { describe, expect, it } from "vitest";
import {
  addBox,
  commit,
  HISTORY_LIMIT,
  initHistory,
  redo,
  removeBox,
  removePageBoxes,
  undo,
  updateBox,
} from "../../src/app/history";
import type { Box } from "../../src/core/types";

const box = (id: string, page = 0): Box => ({ id, page, x: 1, y: 2, w: 3, h: 4 });

describe("undo/redo", () => {
  it("walks back and forward through committed states", () => {
    let h = initHistory<Box[]>([]);
    h = commit(h, addBox(h.present, box("a")));
    h = commit(h, addBox(h.present, box("b")));
    expect(h.present.map((b) => b.id)).toEqual(["a", "b"]);
    h = undo(h);
    expect(h.present.map((b) => b.id)).toEqual(["a"]);
    h = undo(h);
    expect(h.present).toEqual([]);
    expect(undo(h)).toBe(h);
    h = redo(redo(h));
    expect(h.present.map((b) => b.id)).toEqual(["a", "b"]);
    expect(redo(h)).toBe(h);
  });

  it("drops the redo branch on a new change", () => {
    let h = initHistory<Box[]>([]);
    h = commit(h, addBox(h.present, box("a")));
    h = undo(h);
    h = commit(h, addBox(h.present, box("c")));
    expect(h.future).toEqual([]);
    expect(h.present.map((b) => b.id)).toEqual(["c"]);
  });

  it("ignores no-op commits", () => {
    const h = commit(initHistory<Box[]>([box("a")]), [box("z")]);
    expect(commit(h, h.present)).toBe(h);
    expect(commit(h, updateBox(h.present, "z", { x: 1, y: 2, w: 3, h: 4 }))).toBe(h);
  });

  it("caps the history length", () => {
    let h = initHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 50; i++) h = commit(h, i);
    expect(h.past.length).toBe(HISTORY_LIMIT);
  });
});

describe("box operations", () => {
  it("move/resize, delete, clear page", () => {
    let boxes = [box("a"), box("b", 1), box("c", 1)];
    boxes = updateBox(boxes, "a", { x: 10, y: 10, w: 5, h: 5 });
    expect(boxes[0]).toMatchObject({ id: "a", page: 0, x: 10, w: 5 });
    boxes = removeBox(boxes, "b");
    expect(boxes.map((b) => b.id)).toEqual(["a", "c"]);
    expect(removeBox(boxes, "missing")).toBe(boxes);
    expect(removePageBoxes(boxes, 1).map((b) => b.id)).toEqual(["a"]);
  });
});
