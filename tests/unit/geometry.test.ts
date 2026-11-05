import { describe, expect, it } from "vitest";
import { bubbleSpot, innerPixelRect, isUsableRect, LOUPE_SIZE, loupeSpot, MIN_BOX_SIZE, moveRect, rectFromPoints, resizeRect, toPixelRect } from "../../src/core/geometry";

const page = { width: 100, height: 200 };

describe("rectFromPoints", () => {
  it("normalizes any drag direction", () => {
    expect(rectFromPoints(50, 60, 10, 20, page)).toEqual({ x: 10, y: 20, w: 40, h: 40 });
  });
  it("clips to the page", () => {
    expect(rectFromPoints(-10, -10, 150, 250, page)).toEqual({ x: 0, y: 0, w: 100, h: 200 });
  });
});

describe("moveRect", () => {
  it("moves and stays on the page", () => {
    const r = { x: 10, y: 10, w: 20, h: 20 };
    expect(moveRect(r, 5, 5, page)).toEqual({ x: 15, y: 15, w: 20, h: 20 });
    expect(moveRect(r, 500, -500, page)).toEqual({ x: 80, y: 0, w: 20, h: 20 });
  });
});

describe("resizeRect", () => {
  const r = { x: 10, y: 10, w: 20, h: 20 };
  it("drags the south-east corner", () => {
    expect(resizeRect(r, "se", 5, 10, page)).toEqual({ x: 10, y: 10, w: 25, h: 30 });
  });
  it("drags the north-west corner", () => {
    expect(resizeRect(r, "nw", -5, -5, page)).toEqual({ x: 5, y: 5, w: 25, h: 25 });
  });
  it("never inverts or shrinks below the minimum", () => {
    const out = resizeRect(r, "w", 100, 0, page);
    expect(out.w).toBe(MIN_BOX_SIZE);
    expect(out.x + out.w).toBe(30);
  });
  it("edge handles only change one axis", () => {
    expect(resizeRect(r, "n", 99, -4, page)).toEqual({ x: 10, y: 6, w: 20, h: 24 });
  });
  it("cannot leave the page", () => {
    expect(resizeRect(r, "se", 1000, 1000, page)).toEqual({ x: 10, y: 10, w: 90, h: 190 });
  });
});

describe("toPixelRect", () => {
  it("rounds outward and pads, so the burned area covers the drawn box", () => {
    const px = toPixelRect({ x: 10.4, y: 10.6, w: 5.2, h: 5.2 }, 2, 1, 1000, 1000);
    expect(px).toEqual({ x: 19, y: 20, w: 14, h: 13 });
    expect(px.x).toBeLessThanOrEqual(10.4 * 2);
    expect(px.x + px.w).toBeGreaterThanOrEqual((10.4 + 5.2) * 2);
  });
  it("clips to the canvas", () => {
    expect(toPixelRect({ x: 0, y: 0, w: 100, h: 100 }, 1, 2, 50, 50)).toEqual({ x: 0, y: 0, w: 50, h: 50 });
  });
});

describe("innerPixelRect", () => {
  it("shrinks inward for the check", () => {
    expect(innerPixelRect({ x: 10, y: 10, w: 10, h: 10 }, 2, 1, 1000, 1000)).toEqual({ x: 21, y: 21, w: 18, h: 18 });
  });
  it("falls back to at least one pixel for tiny boxes", () => {
    const r = innerPixelRect({ x: 10, y: 10, w: 0.5, h: 0.5 }, 1, 1, 1000, 1000);
    expect(r.w).toBe(1);
    expect(r.h).toBe(1);
  });
});

it("isUsableRect", () => {
  expect(isUsableRect({ x: 0, y: 0, w: 1, h: 10 })).toBe(false);
  expect(isUsableRect({ x: 0, y: 0, w: 2, h: 2 })).toBe(true);
});

describe("loupeSpot", () => {
  const covers = (s: { left: number; top: number }, x: number, y: number) =>
    x >= s.left && x <= s.left + LOUPE_SIZE && y >= s.top && y <= s.top + LOUPE_SIZE;

  it("goes above and to the left of the finger", () => {
    const s = loupeSpot(300, 400, 390, 844);
    expect(s.left + LOUPE_SIZE).toBeLessThan(300);
    expect(s.top + LOUPE_SIZE).toBeLessThan(400);
  });
  it("switches to the right near the left edge", () => {
    expect(loupeSpot(40, 400, 390, 844).left).toBeGreaterThan(40);
  });
  it("is never under the finger or off screen, wherever the finger is", () => {
    for (const x of [0, 40, 148, 200, 320]) {
      for (const y of [0, 20, 130, 500, 700]) {
        const s = loupeSpot(x, y, 320, 700);
        expect(covers(s, x, y)).toBe(false);
        expect(s.left).toBeGreaterThanOrEqual(0);
        expect(s.top).toBeGreaterThanOrEqual(0);
        expect(s.left + LOUPE_SIZE).toBeLessThanOrEqual(320);
        expect(s.top + LOUPE_SIZE).toBeLessThanOrEqual(700);
      }
    }
  });
});

describe("bubbleSpot", () => {
  it("sits above the box, clear of its handles", () => {
    expect(bubbleSpot({ x: 10, y: 200, w: 50, h: 20 }, 300, 400).top).toBe(124);
  });
  it("goes below when there is no room above", () => {
    expect(bubbleSpot({ x: 10, y: 10, w: 50, h: 20 }, 300, 400).top).toBe(56);
  });
  it("stays inside a box that fills the page", () => {
    expect(bubbleSpot({ x: 0, y: 0, w: 300, h: 400 }, 300, 400).top).toBe(4);
  });
  it("lines up with the side nearer the page edge", () => {
    expect(bubbleSpot({ x: 10, y: 200, w: 50, h: 20 }, 300, 400).left).toBe(10);
    expect(bubbleSpot({ x: 240, y: 200, w: 50, h: 20 }, 300, 400).right).toBe(10);
  });
});
