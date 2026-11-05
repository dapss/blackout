import { type CDPSession, expect, type Page, test } from "@playwright/test";
import { openFixture } from "./helpers";

// Real multi-touch input needs the Chrome DevTools Protocol, so these run in Chromium only.
test.skip(({ browserName }) => browserName !== "chromium", "Multi-touch is driven through CDP.");
test.use({ hasTouch: true, viewport: { width: 390, height: 700 } });

type Pt = { x: number; y: number };

async function touch(cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", points: Pt[]) {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id, radiusX: 2, radiusY: 2, force: 1 })),
  });
}

/** Move fingers from `from` to `to` in a few steps. */
async function swipe(cdp: CDPSession, from: Pt[], to: Pt[], steps = 6) {
  for (let i = 1; i <= steps; i++) {
    const at = from.map((f, k) => ({ x: f.x + ((to[k]!.x - f.x) * i) / steps, y: f.y + ((to[k]!.y - f.y) * i) / steps }));
    await touch(cdp, "touchMove", at);
  }
}

async function layerBox(page: Page) {
  const layer = page.getByTestId("page-layer");
  await layer.scrollIntoViewIfNeeded();
  return (await layer.boundingBox())!;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "dirty.pdf");
});

test("there is no separate scroll mode, and touch users get a hint", async ({ page }) => {
  await expect(page.getByRole("radio", { name: "Scroll" })).toHaveCount(0);
  await expect(page.getByTestId("stage-hint")).toContainText("Pinch to zoom, two fingers to scroll");
});

test("one finger draws a box", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const r = await layerBox(page);
  const a = { x: r.x + 40, y: r.y + 40 };
  const b = { x: r.x + 160, y: r.y + 90 };
  await touch(cdp, "touchStart", [a]);
  await swipe(cdp, [a], [b]);
  await touch(cdp, "touchEnd", []);
  await expect(page.getByTestId("box")).toHaveCount(1);
});

test("two fingers scroll the page and draw nothing", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  // Zoom in first: at Fit width the page nearly fits the phone screen, leaving little to scroll.
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Zoom in" }).click();
  }
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector(".stage")!.scrollTop = 0;
  });
  const r = (await page.getByTestId("page-layer").boundingBox())!;
  // Start above the bottom toolbar, on the page.
  const y0 = Math.min(r.y + r.height - 20, 520);
  const start = [
    { x: r.x + 100, y: y0 },
    { x: r.x + 200, y: y0 },
  ];
  const end = start.map((p) => ({ x: p.x, y: p.y - 150 }));

  // The first finger starts a box; the second one turns the gesture into a scroll.
  await touch(cdp, "touchStart", [start[0]!]);
  await swipe(cdp, [start[0]!], [{ x: start[0]!.x + 30, y: start[0]!.y - 20 }], 2);
  await touch(cdp, "touchStart", [{ x: start[0]!.x + 30, y: start[0]!.y - 20 }, start[1]!]);
  const before = await page.evaluate(() => window.scrollY + document.querySelector(".stage")!.scrollTop);
  await swipe(cdp, [{ x: start[0]!.x + 30, y: start[0]!.y - 20 }, start[1]!], [{ x: end[0]!.x + 30, y: end[0]!.y - 20 }, end[1]!]);
  await touch(cdp, "touchEnd", []);

  const after = await page.evaluate(() => window.scrollY + document.querySelector(".stage")!.scrollTop);
  expect(after - before).toBeGreaterThan(100);
  await expect(page.getByTestId("box")).toHaveCount(0);
});

test("a second finger during a box move cancels the move", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const r = await layerBox(page);
  const a = { x: r.x + 40, y: r.y + 40 };
  await touch(cdp, "touchStart", [a]);
  await swipe(cdp, [a], [{ x: a.x + 120, y: a.y + 50 }]);
  await touch(cdp, "touchEnd", []);
  const box = page.getByTestId("box");
  await expect(box).toHaveCount(1);
  const before = (await box.boundingBox())!;

  // Start dragging the box with one finger, then put a second finger down and lift both.
  const c = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
  await touch(cdp, "touchStart", [c]);
  await swipe(cdp, [c], [{ x: c.x + 40, y: c.y + 30 }], 3);
  await touch(cdp, "touchStart", [{ x: c.x + 40, y: c.y + 30 }, { x: c.x + 100, y: c.y + 80 }]);
  await touch(cdp, "touchEnd", []);

  const after = (await box.boundingBox())!;
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
});

test("pinching zooms in around the fingers", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const r = await layerBox(page);
  // Pinch around a point near the middle of the page, so scrolling can keep it under the fingers.
  const mid = { x: r.x + r.width * 0.5, y: Math.min(r.y + 150, 500) };
  const pageX = (mid.x - r.x) / r.width;
  const pageY = (mid.y - r.y) / r.height;

  const at = (spread: number): Pt[] => [
    { x: mid.x - spread / 2, y: mid.y },
    { x: mid.x + spread / 2, y: mid.y },
  ];
  await touch(cdp, "touchStart", at(60));
  for (let s = 70; s <= 180; s += 10) await touch(cdp, "touchMove", at(s));
  await touch(cdp, "touchEnd", []);

  await expect.poll(async () => (await page.getByTestId("page-layer").boundingBox())!.width).toBeGreaterThan(r.width * 2.5);
  const z = (await page.getByTestId("page-layer").boundingBox())!;
  // The page point that was under the fingers is still (roughly) under them.
  expect(Math.abs(z.x + pageX * z.width - mid.x)).toBeLessThan(30);
  expect(Math.abs(z.y + pageY * z.height - mid.y)).toBeLessThan(30);
  await expect(page.getByTestId("box")).toHaveCount(0);
});

test("double-tap zooms in, and again zooms back to fit", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const r = await layerBox(page);
  const p = { x: r.x + r.width * 0.5, y: r.y + 120 };
  const doubleTap = async () => {
    for (let i = 0; i < 2; i++) {
      await touch(cdp, "touchStart", [p]);
      await touch(cdp, "touchEnd", []);
    }
  };
  const width = async () => (await page.getByTestId("page-layer").boundingBox())!.width;

  await doubleTap();
  await expect.poll(width).toBeGreaterThan(r.width * 2);
  await doubleTap();
  await expect.poll(width).toBeCloseTo(r.width, 0);
  await expect(page.getByTestId("box")).toHaveCount(0);
});

test("in Words, taps still redact, including quick taps on different words", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await page.getByRole("radio", { name: "Words" }).click();
  const word = (text: string) => page.locator(`[data-testid="word"][data-word="${text}"]`).first();
  await expect(word("123-45-6789")).toHaveCount(1);
  const tap = async (text: string) => {
    const b = (await word(text).boundingBox())!;
    const p = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    await touch(cdp, "touchStart", [p]);
    await touch(cdp, "touchEnd", []);
  };

  await tap("123-45-6789");
  await expect(page.getByTestId("box")).toHaveCount(1);
  // Two different words in quick succession: neither tap is lost.
  await tap("SSN");
  await tap("Quarterly");
  await expect(page.getByTestId("box")).toHaveCount(3);
});

test("the magnifier follows a dragging finger, without covering it; a tap doesn't show it", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const loupe = page.getByTestId("loupe");
  const r = await layerBox(page);
  const a = { x: r.x + 200, y: r.y + 200 };
  const b = { x: r.x + 280, y: r.y + 260 };

  await touch(cdp, "touchStart", [a]);
  await touch(cdp, "touchEnd", []);
  await expect(loupe).toHaveCount(0);

  await touch(cdp, "touchStart", [a]);
  await swipe(cdp, [a], [b]);
  await expect(loupe).toBeVisible();
  const spot = (await loupe.boundingBox())!;
  const under = b.x >= spot.x && b.x <= spot.x + spot.width && b.y >= spot.y && b.y <= spot.y + spot.height;
  expect(under).toBe(false);
  await touch(cdp, "touchEnd", []);
  await expect(loupe).toHaveCount(0);
  await expect(page.getByTestId("box")).toHaveCount(1);
});

test("the magnifier shows a box under the finger", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const r = await layerBox(page);
  const a = { x: r.x + 60, y: r.y + 200 };
  const b = { x: r.x + 240, y: r.y + 260 };
  await touch(cdp, "touchStart", [a]);
  await swipe(cdp, [a], [b]);
  await touch(cdp, "touchEnd", []);

  // Drag the box by its middle: everything around the magnifier's crosshair should be the black box.
  const box = (await page.getByTestId("box").boundingBox())!;
  const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await touch(cdp, "touchStart", [mid]);
  await swipe(cdp, [mid], [{ x: mid.x + 20, y: mid.y }]);
  const pixel = await page.getByTestId("loupe").evaluate((el) => {
    const c = el as HTMLCanvasElement;
    return [...c.getContext("2d")!.getImageData(c.width / 2 + 20, c.height / 2 + 20, 1, 1).data];
  });
  await touch(cdp, "touchEnd", []);
  expect(pixel.slice(0, 3)).toEqual([0, 0, 0]);
});

test("a second finger puts the magnifier away", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const r = await layerBox(page);
  const a = { x: r.x + 100, y: r.y + 200 };
  const b = { x: r.x + 160, y: r.y + 240 };
  await touch(cdp, "touchStart", [a]);
  await swipe(cdp, [a], [b]);
  await expect(page.getByTestId("loupe")).toBeVisible();
  await touch(cdp, "touchStart", [b, { x: b.x + 60, y: b.y }]);
  await expect(page.getByTestId("loupe")).toHaveCount(0);
  await touch(cdp, "touchEnd", []);
  await expect(page.getByTestId("box")).toHaveCount(0);
});

test("the gesture hint goes away after the first box", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const hint = page.getByTestId("stage-hint");
  await expect(hint).toContainText("Pinch to zoom");
  const r = await layerBox(page);
  const a = { x: r.x + 40, y: r.y + 40 };
  await touch(cdp, "touchStart", [a]);
  await swipe(cdp, [a], [{ x: a.x + 120, y: a.y + 50 }]);
  await touch(cdp, "touchEnd", []);
  await expect(page.getByTestId("box")).toHaveCount(1);
  await expect(hint).not.toContainText("Pinch to zoom");
});

test("the gesture hint goes away after a two-finger scroll", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const hint = page.getByTestId("stage-hint");
  const r = await layerBox(page);
  const a = { x: r.x + 100, y: r.y + 200 };
  const b = { x: r.x + 200, y: r.y + 200 };
  await touch(cdp, "touchStart", [a]);
  await touch(cdp, "touchStart", [a, b]);
  await touch(cdp, "touchEnd", []);
  await expect(hint).not.toContainText("Pinch to zoom");
});
