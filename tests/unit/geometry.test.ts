import { describe, expect, it } from "vitest";
import { innerPixelRect, isUsableRect, MIN_BOX_SIZE, moveRect, rectFromPoints, resizeRect, toPixelRect } from "../../src/core/geometry";

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
