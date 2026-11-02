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
  await expect(page.getByTestId("stage-hint")).toContainText("Use two fingers to scroll");
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
  await page.evaluate(() => window.scrollTo(0, 0));
  const r = (await page.getByTestId("page-layer").boundingBox())!;
  const y0 = Math.min(r.y + r.height - 20, 640);
  const start = [
    { x: r.x + 100, y: y0 },
    { x: r.x + 200, y: y0 },
  ];
  const end = start.map((p) => ({ x: p.x, y: p.y - 150 }));

  // The first finger starts a box; the second one turns the gesture into a scroll.
  await touch(cdp, "touchStart", [start[0]!]);
  await swipe(cdp, [start[0]!], [{ x: start[0]!.x + 30, y: start[0]!.y - 20 }], 2);
  await touch(cdp, "touchStart", [{ x: start[0]!.x + 30, y: start[0]!.y - 20 }, start[1]!]);
  const before = await page.evaluate(() => window.scrollY);
  await swipe(cdp, [{ x: start[0]!.x + 30, y: start[0]!.y - 20 }, start[1]!], [{ x: end[0]!.x + 30, y: end[0]!.y - 20 }, end[1]!]);
  await touch(cdp, "touchEnd", []);

  const after = await page.evaluate(() => window.scrollY);
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
