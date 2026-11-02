import { expect, test } from "@playwright/test";
import { drawBox, exportAndDownload, openFixture, pdfTextItems } from "./helpers";

test("fits a phone-width screen without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto("/");
  const noHScroll = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await noHScroll()).toBe(true);

  await openFixture(page, "dirty.pdf");
  expect(await noHScroll()).toBe(true);
  const layer = (await page.getByTestId("page-layer").boundingBox())!;
  expect(layer.width).toBeLessThanOrEqual(375);
  await expect(page.getByTestId("export-button")).toBeInViewport();

  await drawBox(page, 0.1, 0.1, 0.5, 0.2);
  await expect(page.getByTestId("box")).toHaveCount(1);
  const { bytes } = await exportAndDownload(page, 1);
  expect((await pdfTextItems(bytes)).items).toBe(0);
});

test("a 20-page PDF exports quickly without freezing the UI", async ({ page }) => {
  await page.goto("/");
  await openFixture(page, "long-20.pdf");
  await expect(page.getByTestId("page-indicator")).toHaveText("1 / 20");
  await drawBox(page, 0.05, 0.05, 0.9, 0.12);
  await page.getByRole("button", { name: "Next page" }).click();
  await drawBox(page, 0.05, 0.05, 0.9, 0.12);
  await page.getByRole("button", { name: "Previous page" }).click();

  // Heartbeat on the main thread: a frozen UI shows up as a long gap between timer ticks.
  await page.evaluate(() => {
    const w = window as unknown as { __maxGap: number; __beat: number };
    w.__maxGap = 0;
    let last = performance.now();
    w.__beat = window.setInterval(() => {
      const now = performance.now();
      w.__maxGap = Math.max(w.__maxGap, now - last);
      last = now;
    }, 16);
  });
  const started = Date.now();
  // Progress is reported page by page while the export runs.
  const statuses = new Set<string>();
  const watcher = (async () => {
    for (let i = 0; i < 400; i++) {
      const t = await page.getByTestId("export-status").textContent({ timeout: 100 }).catch(() => null);
      if (t) statuses.add(t);
      if (await page.getByTestId("verify-summary").isVisible()) break;
      await page.waitForTimeout(50);
    }
  })();
  const { bytes } = await exportAndDownload(page, 2);
  const elapsed = Date.now() - started;
  await watcher;
  const maxGap = await page.evaluate(() => {
    const w = window as unknown as { __maxGap: number; __beat: number };
    clearInterval(w.__beat);
    return w.__maxGap;
  });

  const out = await pdfTextItems(bytes);
  expect(out.pages).toBe(20);
  expect(out.items).toBe(0);
  console.log(`20 pages exported+verified in ${elapsed} ms; longest main-thread stall ${Math.round(maxGap)} ms`);
  expect(elapsed).toBeLessThan(60_000);
  expect([...statuses].filter((s) => / of 20/.test(s)).length).toBeGreaterThan(3);
  // The UI never locks up: the main thread is never blocked for more than half a second.
  expect(maxGap).toBeLessThan(500);
});
