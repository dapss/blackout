// Keyboard-only use, focus handling and the unsaved-changes warning.
import { expect, type Page, test } from "@playwright/test";
import { drawBox, openFixture, pdfTextItems } from "./helpers";
import { readFileSync } from "node:fs";

/**
 * Press Tab (or Shift+Tab with `back`) until `match` has focus; fails if it never does. Real key
 * presses, no .focus() shortcuts. Go backwards to reach earlier controls: Firefox tabs out into its
 * own toolbar at the end of the page instead of wrapping round.
 */
async function tabTo(
  page: Page,
  match: (el: { text: string; label: string; testid: string; role: string }) => boolean,
  back = false,
) {
  // Safari's Tab skips buttons unless a setting is on; Option+Tab reaches every control, as
  // keyboard users there do.
  const webkit = page.context().browser()?.browserType().name() === "webkit";
  const key = `${webkit ? "Alt+" : ""}${back ? "Shift+" : ""}Tab`;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press(key);
    const el = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement;
      return {
        text: (a.textContent ?? "").trim(),
        label: a.getAttribute("aria-label") ?? "",
        testid: a.getAttribute("data-testid") ?? "",
        role: a.getAttribute("role") ?? "",
      };
    });
    if (match(el)) return;
  }
  throw new Error("Tab never reached the target");
}

const activeTestId = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("data-testid"));

test.describe("desktop keyboard", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await openFixture(page, "dirty.pdf");
  });

  test("add, move, resize and export a box using only the keyboard", async ({ page }) => {
    await tabTo(page, (el) => el.text === "Add box");
    await page.keyboard.press("Enter");
    const box = page.getByTestId("box");
    await expect(box).toHaveCount(1);
    expect(await activeTestId(page)).toBe("box");

    const before = (await box.boundingBox())!;
    for (let i = 0; i < 5; i++) await page.keyboard.press("ControlOrMeta+Shift+ArrowRight");
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
    const after = (await box.boundingBox())!;
    expect(after.width).toBeGreaterThan(before.width + 20); // 5 steps of 10 page units
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeGreaterThan(before.y);

    // Export, and keyboard focus stays inside the dialog until it closes.
    await tabTo(page, (el) => el.testid === "export-button", true);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("verify-summary")).toContainText("nothing under your box", { timeout: 120_000 });
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"))).toBe(true);
    }
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        await tabTo(page, (el) => el.testid === "download");
        await page.keyboard.press("Enter");
      })(),
    ]);
    const bytes = new Uint8Array(readFileSync((await download.path())!));
    expect((await pdfTextItems(bytes)).items).toBe(0);

    // Escape closes it and focus goes back to Export.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("export-dialog")).toHaveCount(0);
    expect(await activeTestId(page)).toBe("export-button");
  });

  test("Enter on the page adds a box; Delete removes it", async ({ page }) => {
    await tabTo(page, (el) => el.testid === "page-layer");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("box")).toHaveCount(1);
    await page.keyboard.press("Delete");
    await expect(page.getByTestId("box")).toHaveCount(0);
  });

  test("Words: arrow keys walk the words, Enter blacks out the current one", async ({ page }) => {
    await tabTo(page, (el) => el.role === "radio" && el.text === "Words");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid="word"][data-word="123-45-6789"]')).toHaveCount(1);
    await tabTo(page, (el) => el.testid === "page-layer");

    const announce = page.getByTestId("page-announce");
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("ArrowRight");
      if ((await announce.textContent())?.startsWith("123-45-6789")) break;
    }
    await expect(announce).toContainText(/^123-45-6789, word \d+ of \d+/);
    await expect(page.locator(".word.cursor")).toHaveAttribute("data-word", "123-45-6789");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("box")).toHaveCount(1);
    await expect(announce).toHaveText("123-45-6789 blacked out");
    await page.keyboard.press("Enter");
    await expect(announce).toHaveText("123-45-6789 is already covered");
    await expect(page.getByTestId("box")).toHaveCount(1);
  });
});

test.describe("phone keyboard and focus", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await openFixture(page, "long-20.pdf");
  });

  test("the More menu works with the keyboard", async ({ page }) => {
    await tabTo(page, (el) => el.label === "More");
    await page.keyboard.press("Enter");
    const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim());
    await expect.poll(focused).toBe("Add box");
    await page.keyboard.press("ArrowDown");
    expect(await focused()).toBe("Zoom in");
    await page.keyboard.press("End");
    expect(await focused()).toBe("Open another file");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("More");
  });

  test("the Pages sheet keeps focus inside and returns it on close", async ({ page }) => {
    await tabTo(page, (el) => el.text === "Pages");
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "Pages" });
    await expect(sheet).toBeVisible();
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.textContent?.trim())).toBe("Pages");
  });
});

test("leaving the page with boxes asks first; without boxes it doesn't", async ({ page, browser }) => {
  await page.goto("/");
  await openFixture(page, "dirty.pdf");
  await drawBox(page, 0.1, 0.1, 0.4, 0.2);
  const asked = page.waitForEvent("dialog").then(async (d) => {
    const type = d.type();
    await d.accept();
    return type;
  });
  await page.close({ runBeforeUnload: true });
  expect(await asked).toBe("beforeunload");

  const clean = await browser.newPage();
  await clean.goto("/");
  await openFixture(clean, "dirty.pdf");
  let prompted = false;
  clean.on("dialog", (d) => {
    prompted = true;
    void d.accept();
  });
  await clean.close({ runBeforeUnload: true });
  expect(prompted).toBe(false);
});

test("reduced motion turns off transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const seconds = await page.locator("button").first().evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
  expect(seconds).toBeLessThan(0.001);
});
